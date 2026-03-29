/**
 * 命令处理器
 * 
 * 处理所有 / 开头的命令
 */

import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { CommandContext, CommandHandler, PendingTaskInfo, UserWorkspace } from "./types.js";
import { agentManager } from "../agent/manager.js";
import { buildSystemPrompt, buildHelpPrompt, buildStatusPrompt } from "../agent/prompt-builder.js";
import { formatMemoryForPrompt } from "../memory/manager.js";
import { getVersionInfo } from "../version.js";
import { getScheduler, formatCronDescription } from "../scheduler.js";
import { getLongTaskManager, formatProgressMessage as formatLongTaskProgress } from "../longtask/manager.js";
import { getFlowTaskManager, formatProgressMessage as formatFlowTaskProgress, formatPlanForUserConfirmation } from "../flowtask/manager.js";
import { getTaskRouter } from "../task-router/index.js";
import { checkKimiSession, clearKimiSessions } from "../kimi/session.js";
import { loadUserSessionMeta, resetUserSessionMeta } from "../store.js";
import { getNotificationManager } from "../notifications/index.js";
import { saveRestartInfo } from "../services/restart-notify.js";
import { translateState, type SessionContext } from "../context/types.js";
import { getContextManager } from "../context/index.js";
import { sendTextReply, getUserWorkspace as getWorkspace } from "./message-utils.js";

// 待确认的定时任务
const pendingTasks = new Map<string, PendingTaskInfo>();

// 用户自动路由偏好
const userAutoRoute = new Map<string, boolean>();

/**
 * 获取命令列表
 */
export function getCommandList(): Record<string, string> {
  return {
    help: "显示帮助信息",
    status: "查看 Agent 状态",
    reset: "重置对话上下文",
    template: "查看/切换能力模板",
    memory: "查看长期记忆",
    prompt: "预览系统提示词",
    ver: "查看 Bot 版本信息",
    task: "定时任务管理 (list/create/delete/toggle)",
    longtask: "⏱️ 后台执行耗时任务，实时跟踪进度",
    flowtask: "可靠任务流 - 结构化计划执行",
    deploy: "部署 Bot (patch/minor/major)",
    route: "智能任务路由 (analyze/stats/auto)",
    auto: "开关自动路由 (on/off/status)",
    session: "查看 Session 状态",
    context: "查看上下文详情",
  };
}

/**
 * 主命令处理器
 */
export async function handleCommand(
  command: string,
  args: string,
  context: CommandContext
): Promise<string | null> {
  const handler = commandHandlers[command];
  if (handler) {
    return handler(args, context);
  }
  return handleUnknownCommand(command);
}

/**
 * 处理未知命令
 */
function handleUnknownCommand(command: string): string {
  const commands = getCommandList();
  let help = `❓ 未知命令: /${command}\n\n支持的命令：\n`;
  for (const [cmd, desc] of Object.entries(commands)) {
    help += `/${cmd} - ${desc}\n`;
  }
  help += "\n直接发送消息可与AI对话。";
  return help;
}

// ============ 命令处理器映射 ============

const commandHandlers: Record<string, CommandHandler> = {
  help: handleHelp,
  h: handleHelp,
  status: handleStatus,
  reset: handleReset,
  session: handleSession,
  template: handleTemplate,
  ver: handleVersion,
  version: handleVersion,
  memory: handleMemory,
  prompt: handlePrompt,
  task: handleTask,
  longtask: handleLongTask,
  flowtask: handleFlowTask,
  deploy: handleDeploy,
  route: handleRoute,
  auto: handleAuto,
  context: handleContext,
};

// ============ 具体命令处理器 ============

function handleHelp(_args: string, { session }: CommandContext): string {
  return buildHelpPrompt(session.runtime);
}

function handleStatus(_args: string, { session }: CommandContext): string {
  return buildStatusPrompt(session.runtime);
}

async function handleReset(_args: string, context: CommandContext): Promise<string> {
  const { session, fromUser } = context;
  
  // 重新加载配置
  const reloadedConfig = await agentManager.reloadAgentConfig(session.config.id);
  if (reloadedConfig) {
    session.config = reloadedConfig;
    const newRuntime = await agentManager.buildRuntime(session.config.id);
    if (newRuntime) {
      session.runtime = newRuntime;
    }
  }
  
  // 获取用户工作目录
  const cacheKey = `${fromUser}:workspace`;
  const cached = session.userWorkspaces.get(cacheKey);
  
  if (cached) {
    const userWorkspace: UserWorkspace = JSON.parse(cached);
    
    // 清理 Kimi session
    try {
      const cleared = await clearKimiSessions(userWorkspace.cwd);
      if (cleared) {
        console.log(`  🗑️ 已清理 Kimi session: ${fromUser}`);
      }
    } catch (e) {
      console.error(`  ⚠️ 清理 Kimi session 失败: ${e}`);
    }
    
    // 重置工作目录
    try {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(userWorkspace.cwd);
      for (const file of files) {
        if (file !== "project" && file !== "workspace") {
          await rm(join(userWorkspace.cwd, file), { recursive: true, force: true });
        }
      }
      session.userWorkspaces.delete(cacheKey);
      console.log(`  🗑️ 已重置用户工作目录: ${fromUser}`);
    } catch (e) {
      console.error(`  ⚠️ 重置工作目录失败: ${e}`);
    }
  }
  
  // 重置 session 元数据
  resetUserSessionMeta(session.config.id, fromUser);
  console.log(`  🗑️ 已重置 session 元数据: ${fromUser}`);
  
  // 重置内存状态
  session.conversationTurns.delete(fromUser);
  session.lastMemoryExtract.delete(fromUser);
  
  return "🔄 对话上下文已重置，配置已重新加载。系统提示词将在下一条消息重新注入。";
}

async function handleSession(args: string, context: CommandContext): Promise<string> {
  const { session, fromUser } = context;
  const subCmd = args || "status";
  const userWorkspace = await getWorkspace(session, fromUser);
  const sessionMeta = loadUserSessionMeta(session.config.id, fromUser);
  const kimiSession = await checkKimiSession(userWorkspace.cwd);
  
  if (subCmd === "status") {
    return `
📊 Session 状态

**Agent:** ${session.config.id}
**用户:** ${fromUser}
**工作目录:** \`${userWorkspace.cwd}\`

**对话统计:**
- 轮次: ${sessionMeta?.turnCount || 0}
- 最后对话: ${sessionMeta?.lastMessageAt ? new Date(sessionMeta.lastMessageAt).toLocaleString("zh-CN") : "无"}

**Kimi Session:** ${kimiSession.exists ? "✅ 存在" : "❌ 不存在"}
${kimiSession.exists ? `- ID: \`${kimiSession.sessionId?.slice(0, 16)}...\`
- 最后修改: ${kimiSession.lastModified ? new Date(kimiSession.lastModified).toLocaleString("zh-CN") : "未知"}` : ""}

使用 \`/reset\` 重置 session
    `.trim();
  }
  
  return "未知命令，可用: /session status";
}

async function handleTemplate(args: string, context: CommandContext): Promise<string> {
  const { session, fromUser } = context;
  const { runtime, config } = session;
  
  if (args === "list") {
    const { getTemplates } = await import("../templates/definitions.js");
    const templates = getTemplates();
    
    const { customTemplateManager } = await import("../templates/custom-manager.js");
    await customTemplateManager.initialize();
    const customTemplates = customTemplateManager.getAllTemplates();
    
    let response = "**📋 可用能力模板**\n\n";
    
    response += "*预置模板:*\n";
    for (const t of templates) {
      response += `${t.icon} **${t.name}** (${t.id})\n${t.description}\n\n`;
    }
    
    if (customTemplates.length > 0) {
      response += "*自定义模板:*\n";
      for (const t of customTemplates) {
        response += `${t.icon} **${t.name}** (${t.id})\n${t.description}${t.extends ? ` (继承自 ${t.extends})` : ""}\n\n`;
      }
    }
    
    response += "---\n\n使用 `/template switch <id>` 切换模板\n";
    response += "使用 `/template custom <提示词>` 自定义当前模板";
    return response;
  }
  
  if (args.startsWith("switch ")) {
    const templateId = args.slice(7).trim();
    const { getTemplateById } = await import("../templates/definitions.js");
    const { customTemplateManager } = await import("../templates/custom-manager.js");
    await customTemplateManager.initialize();
    
    let template = getTemplateById(templateId);
    if (!template) {
      template = customTemplateManager.buildFinalTemplate(templateId) || undefined;
    }
    
    if (!template) {
      return `❌ 模板 "${templateId}" 不存在\n\n发送 \`/template list\` 查看可用模板`;
    }
    
    const updated = await agentManager.applyTemplate(config.id, templateId);
    if (updated) {
      session.runtime.template = template;
      session.conversationTurns.delete(fromUser);
      return `✅ 已切换到模板: ${template.icon} **${template.name}**\n\n对话上下文已重置，新提示词将在下一条消息生效。`;
    }
    return "❌ 切换模板失败";
  }
  
  // 默认显示当前模板
  let response = `**当前能力模板**\n\n${runtime.template.icon} **${runtime.template.name}**\n${runtime.template.description}\n\n`;
  if (config.templateOverride?.systemPromptAppend) {
    response += `*已添加自定义提示词*\n\n`;
  }
  response += "发送 `/template list` 查看所有模板\n";
  response += "发送 `/template switch <id>` 切换模板\n";
  response += "发送 `/template custom <提示词>` 自定义提示词";
  return response;
}

function handleVersion(): string {
  return getVersionInfo();
}

async function handleMemory(_args: string, { session }: CommandContext): Promise<string> {
  const memoryContext = formatMemoryForPrompt(session.runtime.memory);
  if (!memoryContext) {
    return "📭 暂无长期记忆\n\n记忆会在对话过程中自动提取和积累。";
  }
  return `**长期记忆**\n\n${memoryContext}\n\n_共 ${session.runtime.memory.facts.length} 条事实，${session.runtime.memory.projects.length} 个项目_`;
}

function handlePrompt(_args: string, { session }: CommandContext): string {
  const prompt = buildSystemPrompt(session.runtime);
  return `**当前系统提示词**\n\n\`\`\`\n${prompt.substring(0, 2000)}${prompt.length > 2000 ? "\n... (已截断)" : ""}\n\`\`\``;
}

// 其他命令处理器在单独文件中实现
async function handleTask(args: string, context: CommandContext): Promise<string> {
  const { taskHandler } = await import("./commands/task.js");
  return taskHandler(args, context, pendingTasks);
}

async function handleLongTask(args: string, context: CommandContext): Promise<string> {
  const { longTaskHandler } = await import("./commands/longtask.js");
  return longTaskHandler(args, context);
}

async function handleFlowTask(args: string, context: CommandContext): Promise<string> {
  const { flowTaskHandler } = await import("./commands/flowtask.js");
  return flowTaskHandler(args, context);
}

async function handleDeploy(args: string, context: CommandContext): Promise<string> {
  const { deployHandler } = await import("./commands/deploy.js");
  return deployHandler(args, context);
}

async function handleRoute(args: string, context: CommandContext): Promise<string> {
  const { routeHandler } = await import("./commands/route.js");
  return routeHandler(args, context, userAutoRoute);
}

function handleAuto(args: string, context: CommandContext): string {
  const { fromUser } = context;
  const value = args.trim().toLowerCase();
  
  if (value === "on" || value === "true" || value === "1") {
    userAutoRoute.set(fromUser, true);
    return `✅ 自动路由已开启\n\n系统将根据任务复杂度自动选择执行模式。`;
  } else if (value === "off" || value === "false" || value === "0") {
    userAutoRoute.set(fromUser, false);
    return `✅ 自动路由已关闭\n\n所有任务将直接执行。`;
  } else if (value === "status" || value === "") {
    const current = userAutoRoute.get(fromUser) ?? false;
    return `**自动路由状态**: ${current ? "✅ 开启" : "❌ 关闭"}`;
  }
  return `❓ 用法: \`/auto on/off/status\``;
}

function handleContext(args: string, context: CommandContext): string {
  const { sessionContext } = context;
  if (!sessionContext) {
    return "上下文感知架构未启用";
  }
  
  const subCmd = args || "status";
  
  if (subCmd === "status" || subCmd === "") {
    let response = `**上下文状态**\n\n`;
    response += `状态: ${translateState(sessionContext.state.current)}\n`;
    response += `主题: ${sessionContext.state.topic || "无"}\n`;
    response += `消息数: ${sessionContext.messages.length}\n`;
    response += `活跃选项: ${sessionContext.activeOptions.size}\n`;
    
    if (sessionContext.state.pendingDecision) {
      response += `\n待决策: ${sessionContext.state.pendingDecision.description}\n`;
    }
    
    return response;
  }
  
  if (subCmd === "options") {
    if (sessionContext.activeOptions.size === 0) {
      return "当前没有活跃选项";
    }
    
    let response = `**活跃选项**\n\n`;
    for (const [id, option] of sessionContext.activeOptions) {
      response += `- [${id}] ${option.label}\n`;
    }
    return response;
  }
  
  if (subCmd === "history") {
    const recent = sessionContext.messages.slice(-5);
    if (recent.length === 0) {
      return "没有消息历史";
    }
    
    let response = `**近期消息**\n\n`;
    for (const msg of recent) {
      const role = msg.role === "user" ? "用户" : "AI";
      const preview = msg.content.substring(0, 50);
      response += `${role}: ${preview}${msg.content.length > 50 ? "..." : ""}\n`;
    }
    return response;
  }
  
  return `用法:\n/context status - 查看状态\n/context options - 查看活跃选项\n/context history - 查看消息历史`;
}

// 导出给外部使用
export { pendingTasks, userAutoRoute };
