/**
 * 微信 Kimi Bot - 多Agent版本
 * 
 * 支持多个微信账号，每个账号有独立的Agent配置、工作目录和记忆
 */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  getUpdates,
  sendMessage,
  sendTyping,
  getConfig,
  type ApiOptions,
} from "./ilink/api.js";
import {
  MessageType,
  MessageItemType,
  MessageState,
  TypingStatus,
  type WeixinMessage,
} from "./ilink/types.js";
import { askKimi, checkKimiInstalled, ensureKimiAuthenticated } from "./kimi/handler.js";
import type { KimiOptions } from "./kimi/handler.js";
import {
  loadSyncBuf,
  saveSyncBuf,
  getContextToken,
  setContextToken,
} from "./store.js";
import { getScheduler, formatCronDescription } from "./scheduler.js";
import { getNotificationManager } from "./notifications/index.js";
import { getVersionInfo, VERSION } from "./version.js";

// Agent 相关导入
import { agentManager } from "./agent/manager.js";
import { buildSystemPrompt, buildWelcomeMessage, buildHelpPrompt, buildStatusPrompt } from "./agent/prompt-builder.js";
import type { AgentConfig, AgentRuntime, AgentMemory } from "./agent/types.js";
import { extractMemoryFromConversation, mergeMemory, saveMemory } from "./memory/manager.js";

const SESSION_EXPIRED_ERRCODE = -14;
const SESSION_PAUSE_MS = 60 * 60 * 1000;

// ============ Agent 运行时缓存 ============

interface AgentSession {
  runtime: AgentRuntime;
  config: AgentConfig;
  api: ApiOptions;
  credentials: {
    botToken: string;
    accountId: string;
    baseUrl: string;
  };
  conversationTurns: Map<string, number>; // userId -> turns
  lastMemoryExtract: Map<string, number>; // userId -> timestamp
  userWorkspaces: Map<string, string>; // userId -> 用户专属工作目录
}

const activeAgents: Map<string, AgentSession> = new Map();

// ============ 命令处理 ============

const COMMANDS = {
  help: { desc: "显示帮助信息" },
  status: { desc: "查看 Agent 状态" },
  reset: { desc: "重置对话上下文" },
  template: { desc: "查看/切换能力模板" },
  memory: { desc: "查看长期记忆" },
  prompt: { desc: "预览系统提示词" },
  ver: { desc: "查看 Bot 版本信息" },
};

function parseCommand(text: string): { command: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return { command: trimmed.slice(1).toLowerCase(), args: "" };
  }
  
  return {
    command: trimmed.slice(1, spaceIndex).toLowerCase(),
    args: trimmed.slice(spaceIndex + 1).trim(),
  };
}

async function handleAgentCommand(
  session: AgentSession,
  command: string,
  args: string,
  fromUser: string
): Promise<string | null> {
  const { runtime, config } = session;

  switch (command) {
    case "help":
    case "h":
      return buildHelpPrompt(runtime);

    case "status":
      return buildStatusPrompt(runtime);

    case "reset": {
      // 重新加载配置，确保 config.json 的修改生效
      const reloadedConfig = await agentManager.reloadAgentConfig(session.config.id);
      if (reloadedConfig) {
        session.config = reloadedConfig;
        const newRuntime = await agentManager.buildRuntime(session.config.id);
        if (newRuntime) {
          session.runtime = newRuntime;
        }
      }
      
      // 清除用户 Kimi session
      const cacheKey = `${fromUser}:workspace`;
      const cached = session.userWorkspaces.get(cacheKey);
      
      if (cached) {
        const userWorkspace: UserWorkspace = JSON.parse(cached);
        
        if (session.config.type === "founder" && session.config.projectSpace) {
          // 创始Agent：删除整个 session 目录（软链接会一并删除，下次自动重建）
          try {
            await rm(userWorkspace.cwd, { recursive: true, force: true });
            session.userWorkspaces.delete(cacheKey);
            console.log(`  🗑️ 已重置创始Agent session: ${fromUser}`);
          } catch (e) {
            console.error(`  ⚠️ 重置 session 失败: ${e}`);
          }
        } else {
          // 普通Agent：直接删除用户目录
          if (existsSync(userWorkspace.cwd)) {
            try {
              await rm(userWorkspace.cwd, { recursive: true, force: true });
              session.userWorkspaces.delete(cacheKey);
              console.log(`  🗑️ 已清除用户工作目录: ${userWorkspace.cwd}`);
            } catch (e) {
              console.error(`  ⚠️ 清除用户目录失败: ${e}`);
            }
          }
        }
      }
      
      // 重置对话轮次
      session.conversationTurns.delete(fromUser);
      session.lastMemoryExtract.delete(fromUser);
      return "🔄 对话上下文已重置，配置已重新加载。系统提示词将在下一条消息重新注入。";
    }

    case "template": {
      const { getTemplates } = await import("./templates/definitions.js");
      
      if (args === "list") {
        const templates = getTemplates();
        // 获取自定义模板
        const { customTemplateManager } = await import("./templates/custom-manager.js");
        await customTemplateManager.initialize();
        const customTemplates = customTemplateManager.getAllTemplates();
        
        let response = "**📋 可用能力模板**\n\n";
        
        // 预置模板
        response += "*预置模板:*\n";
        for (const t of templates) {
          response += `${t.icon} **${t.name}** (${t.id})\n${t.description}\n\n`;
        }
        
        // 自定义模板
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
      
      // 切换模板
      if (args.startsWith("switch ")) {
        const templateId = args.slice(7).trim();
        const { getTemplateById } = await import("./templates/definitions.js");
        const { customTemplateManager } = await import("./templates/custom-manager.js");
        await customTemplateManager.initialize();
        
        // 检查预置模板
        let template = getTemplateById(templateId);
        // 检查自定义模板
        if (!template) {
          template = customTemplateManager.buildFinalTemplate(templateId) || undefined;
        }
        
        if (!template) {
          return `❌ 模板 "${templateId}" 不存在\n\n发送 \`/template list\` 查看可用模板`;
        }
        
        // 更新 Agent 配置
        const updated = await agentManager.applyTemplate(config.id, templateId);
        if (updated) {
          // 更新运行时
          session.runtime.template = template;
          session.conversationTurns.delete(fromUser);
          return `✅ 已切换到模板: ${template.icon} **${template.name}**\n\n对话上下文已重置，新提示词将在下一条消息生效。`;
        }
        return "❌ 切换模板失败";
      }
      
      // 自定义提示词（追加）
      if (args.startsWith("custom ")) {
        const customPrompt = args.slice(7).trim();
        if (!customPrompt) {
          return "❌ 请输入自定义提示词\n\n用法: `/template custom 你的自定义提示词`";
        }
        
        // 保存到 Agent 配置
        const updated = await agentManager.updateAgent(config.id, {
          templateOverride: {
            systemPromptAppend: customPrompt,
            updatedAt: Date.now(),
          },
        });
        
        if (updated) {
          // 更新运行时
          session.config.templateOverride = updated.templateOverride;
          // 重新构建模板
          const newTemplate = await agentManager.buildRuntime(config.id);
          if (newTemplate) {
            session.runtime = newTemplate;
          }
          session.conversationTurns.delete(fromUser);
          return `✅ 已添加自定义提示词\n\n追加内容:\n\`\`\`${customPrompt.substring(0, 100)}${customPrompt.length > 100 ? "..." : ""}\`\`\`\n\n对话上下文已重置，将在下一条消息生效。`;
        }
        return "❌ 保存自定义提示词失败";
      }
      
      // 查看自定义提示词
      if (args === "custom") {
        if (config.templateOverride?.systemPromptAppend) {
          return `**当前自定义提示词**\n\n\`\`\`\n${config.templateOverride.systemPromptAppend}\n\`\`\`\n\n使用 \`/template custom <新提示词>\` 修改\n使用 \`/template reset\` 清除自定义`;
        }
        return "📭 当前没有自定义提示词\n\n使用 `/template custom <提示词>` 添加";
      }
      
      // 重置自定义
      if (args === "reset") {
        const updated = await agentManager.updateAgent(config.id, {
          templateOverride: undefined,
        });
        if (updated) {
          session.config.templateOverride = undefined;
          const newTemplate = await agentManager.buildRuntime(config.id);
          if (newTemplate) {
            session.runtime = newTemplate;
          }
          session.conversationTurns.delete(fromUser);
          return "✅ 已清除自定义提示词，恢复为模板默认";
        }
        return "❌ 重置失败";
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

    case "ver":
    case "version":
      return getVersionInfo();

    case "memory":
      const { formatMemoryForPrompt } = await import("./memory/manager.js");
      const memoryContext = formatMemoryForPrompt(runtime.memory);
      if (!memoryContext) {
        return "📭 暂无长期记忆\n\n记忆会在对话过程中自动提取和积累。";
      }
      return `**长期记忆**\n\n${memoryContext}\n\n_共 ${runtime.memory.facts.length} 条事实，${runtime.memory.projects.length} 个项目_`;

    case "prompt":
      const prompt = buildSystemPrompt(runtime);
      return `**当前系统提示词**\n\n\`\`\`\n${prompt.substring(0, 2000)}${prompt.length > 2000 ? "\n... (已截断)" : ""}\n\`\`\``;

    default:
      return null;
  }
}

// ============ 消息处理 ============

function extractText(msg: WeixinMessage): string {
  if (!msg.item_list?.length) return "";
  for (const item of msg.item_list) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      const ref = item.ref_msg;
      if (ref?.title) {
        return `[引用: ${ref.title}]\n${item.text_item.text}`;
      }
      return item.text_item.text;
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return "";
}

const MAX_MSG_LEN = 4000;

function generateClientId(): string {
  return `wkb-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

async function sendTextReply(
  api: ApiOptions,
  toUserId: string,
  contextToken: string,
  text: string,
): Promise<void> {
  const chunks = text.length <= MAX_MSG_LEN
    ? [text]
    : text.match(new RegExp(`.{1,${MAX_MSG_LEN}}`, "gs")) || [text];

  for (const chunk of chunks) {
    const msg: WeixinMessage = {
      to_user_id: toUserId,
      from_user_id: "",
      client_id: generateClientId(),
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: contextToken,
      item_list: [{
        type: MessageItemType.TEXT,
        text_item: { text: chunk },
      }],
    };
    await sendMessage(api, { msg });
  }
}

async function showTyping(api: ApiOptions, userId: string, contextToken?: string): Promise<void> {
  try {
    const config = await getConfig(api, userId, contextToken);
    if (config.typing_ticket) {
      await sendTyping(api, {
        ilink_user_id: userId,
        typing_ticket: config.typing_ticket,
        status: TypingStatus.TYPING,
      });
    }
  } catch {
    // 忽略错误
  }
}

// ============ 创始Agent提示词构建 ============

/**
 * 构建创始Agent的项目维护规范提示词
 */
function buildFounderPrompt(config: AgentConfig): string {
  if (!config.projectSpace) return "";
  
  const project = config.projectSpace;
  const workspace = config.workspace.path;
  const projectName = project.description || "当前项目";
  
  return `

## 项目维护规范 (ProjectSpace)

你当前正在维护项目：${projectName}
项目路径：${project.path}
${project.repository ? `代码仓库：${project.repository}` : ""}

### 目录结构说明
当前目录 (${workspace}/.sessions/{userId}/) 包含：
- ./project/ → 软链接到 ${project.path} (项目源码，操作此目录)
- ./workspace/ → 软链接到 ${workspace} (你的持久化空间)

### 工作规范

**1. 整洁性原则**
- 临时文件、过程性文件必须放在 ./workspace/ 下，禁止放入 ./project/
- ./project/ 只存放：源码、配置、文档

**2. 开发流程 (必须遵循)**
每次修改前，按此 checklist：
- [ ] 进入 ./project/ 目录
- [ ] git status 确认无未提交变更
- [ ] 全面了解变更影响范围
- [ ] 在 ./workspace/Projects/${projectName.replace(/\s+/g, "_")}/ 写方案草稿
- [ ] 给用户确认方案后再实施
- [ ] 修改完成：git add . && git commit -m "wip: xxx"
- [ ] 用户测试确认后：git commit -m "feat: 清晰描述" && git push
- [ ] 更新版本：npm run deploy:patch

**3. PARA 整理 (每周执行)**
你的 workspace 应遵循 PARA 模式：
- Projects/ - 进行中的项目（如本项目）
- Areas/ - 持续维护的职责领域
- Resources/ - 参考资料、学习笔记
- Archives/ - 已完成或暂停的项目

**4. CI/CD 利用**
已配置 GitHub Actions，push 后自动构建。关注 Actions 状态。`;
}

// ============ 工作目录和 Session 管理 ============

interface UserWorkspace {
  /** 操作目录（Kimi 执行命令的 cwd） */
  cwd: string;
  /** 实际项目目录（用于创始Agent操作 projectSpace） */
  projectDir?: string;
}

/**
 * 获取用户的工作目录配置
 * 
 * 设计原则：
 * - 创始Agent: 
 *   - CWD: workspace/.sessions/{userId}/ (满足 Kimi session 绑定工作目录的机制)
 *   - 通过软链接将 projectSpace 链接到 CWD/project，实现无侵入式操作
 * - 普通Agent:
 *   - CWD: workspace/users/{userId}/ (个人持久化空间)
 */
async function getUserWorkspace(
  session: AgentSession,
  userId: string
): Promise<UserWorkspace> {
  const cacheKey = `${userId}:workspace`;
  const cached = session.userWorkspaces.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as UserWorkspace;
  }

  const isFounder = session.config.type === "founder";
  const workspaceBase = session.config.workspace.path;
  
  let cwd: string;
  let projectDir: string | undefined;

  if (isFounder && session.config.projectSpace) {
    // 创始Agent：CWD 在 session 目录，通过软链接访问 projectSpace
    cwd = join(workspaceBase, ".sessions", userId);
    await mkdir(cwd, { recursive: true });
    
    projectDir = session.config.projectSpace.path;
    
    // 创建指向 projectSpace 的软链接
    const projectLink = join(cwd, "project");
    if (!existsSync(projectLink)) {
      const { symlink } = await import("node:fs/promises");
      await symlink(projectDir, projectLink, "dir");
      console.log(`  🔗 创建项目软链接: ${projectLink} -> ${projectDir}`);
    }
    
    // 同时创建指向 workspace 的软链接，方便访问持久化空间
    const workspaceLink = join(cwd, "workspace");
    if (!existsSync(workspaceLink)) {
      const { symlink } = await import("node:fs/promises");
      await symlink(workspaceBase, workspaceLink, "dir");
    }
  } else {
    // 普通Agent：直接在个人目录操作
    cwd = join(workspaceBase, "users", userId);
    if (!existsSync(cwd)) {
      await mkdir(cwd, { recursive: true });
      console.log(`  📁 创建用户工作目录: ${cwd}`);
    }
  }

  const result: UserWorkspace = { cwd, projectDir };
  session.userWorkspaces.set(cacheKey, JSON.stringify(result));
  return result;
}

// ============ 核心消息处理 ============

async function handleMessage(
  session: AgentSession,
  msg: WeixinMessage,
): Promise<void> {
  if (msg.message_type !== MessageType.USER) return;

  const fromUser = msg.from_user_id;
  if (!fromUser) return;

  const text = extractText(msg);
  if (!text) {
    console.log(`  [skip] 非文本消息 from ${fromUser}`);
    return;
  }

  // 缓存 context_token（按Agent隔离）
  if (msg.context_token) {
    setContextToken(fromUser, msg.context_token, session.config.id);
  }
  const contextToken = msg.context_token || getContextToken(fromUser, session.config.id);
  if (!contextToken) {
    console.error(`  [error] 没有 context_token for ${fromUser}`);
    return;
  }

  console.log(`\n📩 [${session.config.name}] 收到消息 from ${fromUser}: ${text.substring(0, 80)}${text.length > 80 ? "..." : ""}`);

  // 更新统计
  await agentManager.updateStats(session.config.id, false);

  // 检查命令
  const commandInfo = parseCommand(text);
  if (commandInfo) {
    console.log(`  📝 检测到命令: /${commandInfo.command}`);
    
    const response = await handleAgentCommand(session, commandInfo.command, commandInfo.args, fromUser);
    if (response !== null) {
      await sendTextReply(session.api, fromUser, contextToken, response);
      console.log(`  📤 已发送命令回复`);
      return;
    }
    // 未知命令，继续处理
  }

  // 构建 Kimi 选项
  const turns = session.conversationTurns.get(fromUser) || 0;
  
  // 获取用户专属工作目录配置
  const userWorkspace = await getUserWorkspace(session, fromUser);
  
  // 构建系统提示词（每轮都注入，确保记忆始终可用）
  let systemPrompt = buildSystemPrompt(session.runtime, {
    includeMemory: session.config.memory.enabled,
  });
  
  // 如果是创始Agent，注入项目维护规范
  if (session.config.type === "founder" && session.config.projectSpace) {
    systemPrompt += buildFounderPrompt(session.config);
  }

  const kimiOpts: KimiOptions & { systemPrompt?: string } = {
    model: session.config.ai.model,
    cwd: userWorkspace.cwd,  // CWD 在 session 目录（控制 session 存储位置）
    maxTurns: session.config.ai.maxTurns,
    planMode: false,
    systemPrompt: systemPrompt,
    continueSession: turns > 0,  // 非第一轮时复用 session
  };

  // 显示输入中
  showTyping(session.api, fromUser, contextToken);

  try {
    console.log(`  🤖 调用 Kimi (${session.config.ai.model}, 轮次: ${turns + 1})...`);
    const response = await askKimi(text, kimiOpts);
    console.log(`  ✅ 响应完成 (${(response.durationMs / 1000).toFixed(1)}s)`);

    // 发送回复
    await sendTextReply(session.api, fromUser, contextToken, response.text);
    console.log(`  📤 已发送回复 (${response.text.length} 字符)`);

    // 更新轮次
    session.conversationTurns.set(fromUser, turns + 1);

    // 提取记忆（如果启用）
    if (session.config.memory.enabled && session.config.memory.autoExtract) {
      const lastExtract = session.lastMemoryExtract.get(fromUser) || 0;
      // 放宽提取条件：每3轮或超过5分钟提取一次
      const shouldExtract = (turns > 0 && turns % 3 === 0) || Date.now() - lastExtract > 5 * 60 * 1000;
      
      if (shouldExtract) {
        console.log(`  🧠 提取记忆...`);
        // 使用更完整的对话上下文
        const conversation = `用户: ${text}\nAI: ${response.text}`;
        const extraction = await extractMemoryFromConversation(conversation, session.config.id);
        
        if (extraction && (extraction.facts?.length || extraction.projects?.length || extraction.userProfile)) {
          const updatedMemory = mergeMemory(session.runtime.memory, extraction, `conv_${Date.now()}`);
          await saveMemory(session.config.id, updatedMemory);
          session.runtime.memory = updatedMemory;
          session.lastMemoryExtract.set(fromUser, Date.now());
          console.log(`  ✅ 已提取 ${extraction.facts?.length || 0} 条事实, ${extraction.projects?.length || 0} 个项目`);
        }
      }
    }

  } catch (err) {
    console.error(`  ❌ 处理失败:`, err);
    await sendTextReply(
      session.api,
      fromUser,
      contextToken,
      `处理消息时出错: ${err instanceof Error ? err.message : String(err)}`,
    ).catch(() => {});
  }
}

// ============ 主程序 ============

async function main() {
  // 检查 Kimi CLI
  const kimiInstalled = await checkKimiInstalled();
  if (!kimiInstalled) {
    console.error("错误: 未找到 Kimi CLI。请先安装:");
    console.error("  uv tool install kimi-cli");
    process.exit(1);
  }

  const kimiAuthenticated = await ensureKimiAuthenticated();
  if (!kimiAuthenticated) {
    console.error("\n错误: Kimi CLI 登录失败");
    process.exit(1);
  }

  // 初始化 AgentManager
  await agentManager.initialize();
  const allAgents = agentManager.getAllAgents();

  if (allAgents.length === 0) {
    console.error("\n❌ 没有可用的 Agent");
    console.error("请先运行: npm run login");
    process.exit(1);
  }

  // 确定要启动的 Agent
  const activeAgentId = process.env.ACTIVE_AGENT_ID;
  let agentsToStart: AgentConfig[];

  if (activeAgentId) {
    const agent = agentManager.getAgent(activeAgentId);
    if (!agent) {
      console.error(`\n❌ 未找到 Agent: ${activeAgentId}`);
      console.error(`可用 Agent: ${allAgents.map(a => a.id).join(", ")}`);
      process.exit(1);
    }
    agentsToStart = [agent];
  } else {
    // 默认启动所有 Agent
    agentsToStart = allAgents;
  }

  // 初始化每个 Agent
  for (const agentConfig of agentsToStart) {
    console.log(`\n🚀 初始化 Agent: ${agentConfig.name}`);

    // 加载凭证
    const credsPath = join(agentManager.getAgentPath(agentConfig.id), "credentials.json");
    let creds;
    try {
      creds = JSON.parse(readFileSync(credsPath, "utf-8"));
    } catch {
      console.error(`  ❌ 无法加载 ${agentConfig.name} 的凭证，跳过`);
      continue;
    }

    // 构建运行时
    const runtime = await agentManager.buildRuntime(agentConfig.id);
    if (!runtime) {
      console.error(`  ❌ 无法构建 ${agentConfig.name} 的运行时，跳过`);
      continue;
    }

    // 创建 API 配置
    const api: ApiOptions = {
      baseUrl: creds.baseUrl,
      token: creds.botToken,
    };

    // 创建会话
    const session: AgentSession = {
      runtime,
      config: agentConfig,
      api,
      credentials: {
        botToken: creds.botToken,
        accountId: creds.accountId,
        baseUrl: creds.baseUrl,
      },
      conversationTurns: new Map(),
      lastMemoryExtract: new Map(),
      userWorkspaces: new Map(),
    };

    activeAgents.set(agentConfig.id, session);

    console.log(`  ✅ 已加载: ${agentConfig.name}`);
    console.log(`     角色: ${runtime.template.icon} ${runtime.template.name}`);
    console.log(`     工作目录: ${agentConfig.workspace.path}`);
    console.log(`     模型: ${agentConfig.ai.model}`);

    // 设置定时任务
    const scheduler = getScheduler(session.config.id);
    scheduler.setApi(api, async (chatId: string, ctxToken: string, text: string) => {
      await sendTextReply(api, chatId, ctxToken, text);
    });
    scheduler.start();

    // 初始化通知管理器（每个Agent独立的通知配置）
    const notificationManager = getNotificationManager(session.config.id);
    try {
      await notificationManager.initialize();
    } catch (e) {
      console.error(`[Notification:${session.config.id}] 初始化失败:`, e);
    }
  }

  if (activeAgents.size === 0) {
    console.error("\n❌ 没有成功加载的 Agent");
    process.exit(1);
  }

  console.log("\n=== 微信 Kimi Bot 已启动 ===");
  console.log(`活跃 Agent 数: ${activeAgents.size}`);
  console.log("按 Ctrl+C 停止\n");

  // 定时任务和通知管理器已在各Agent初始化时启动

  // 优雅关闭
  process.on("SIGINT", async () => {
    console.log("\n\n正在关闭...");
    // 停止所有调度器
    for (const s of activeAgents.values()) {
      const sched = getScheduler(s.config.id);
      sched.stop();
    }
    // 停止所有通知管理器
    for (const s of activeAgents.values()) {
      const manager = getNotificationManager(s.config.id);
      await manager.shutdown();
    }
    process.exit(0);
  });

  // 为每个 Agent 启动消息轮询
  const pollPromises = Array.from(activeAgents.values()).map(session => 
    pollMessages(session)
  );

  // 启动动态 Agent 加载器（定期检查新添加的 Agent）
  startDynamicAgentLoader();

  await Promise.all(pollPromises);
}

// ============ 动态 Agent 加载 ============

/**
 * 动态加载新添加的 Agent
 * 定期检查是否有新 Agent 被创建，并自动加载
 */
function startDynamicAgentLoader(): void {
  const CHECK_INTERVAL = 30_000; // 每30秒检查一次

  setInterval(async () => {
    // 重新加载所有 Agent 列表
    await agentManager.reload();
    const allAgents = agentManager.getAllAgents();

    for (const agentConfig of allAgents) {
      // 如果 Agent 已经在运行中，跳过
      if (activeAgents.has(agentConfig.id)) continue;

      console.log(`\n🆕 发现新 Agent: ${agentConfig.name}，正在加载...`);

      try {
        // 加载凭证
        const credsPath = join(agentManager.getAgentPath(agentConfig.id), "credentials.json");
        let creds;
        try {
          creds = JSON.parse(readFileSync(credsPath, "utf-8"));
        } catch {
          console.error(`  ❌ 无法加载 ${agentConfig.name} 的凭证，跳过`);
          continue;
        }

        // 构建运行时
        const runtime = await agentManager.buildRuntime(agentConfig.id);
        if (!runtime) {
          console.error(`  ❌ 无法构建 ${agentConfig.name} 的运行时，跳过`);
          continue;
        }

        // 创建 API 配置
        const api: ApiOptions = {
          baseUrl: creds.baseUrl,
          token: creds.botToken,
        };

        // 创建会话
        const session: AgentSession = {
          runtime,
          config: agentConfig,
          api,
          credentials: {
            botToken: creds.botToken,
            accountId: creds.accountId,
            baseUrl: creds.baseUrl,
          },
          conversationTurns: new Map(),
          lastMemoryExtract: new Map(),
          userWorkspaces: new Map(),
        };

        activeAgents.set(agentConfig.id, session);

        console.log(`  ✅ 已加载: ${agentConfig.name}`);
        console.log(`     角色: ${runtime.template.icon} ${runtime.template.name}`);
        console.log(`     工作目录: ${agentConfig.workspace.path}`);

        // 设置定时任务
        const scheduler = getScheduler(session.config.id);
        scheduler.setApi(api, async (chatId: string, ctxToken: string, text: string) => {
          await sendTextReply(api, chatId, ctxToken, text);
        });
        scheduler.start();

        // 初始化通知管理器
        const notificationManager = getNotificationManager(session.config.id);
        try {
          await notificationManager.initialize();
        } catch (e) {
          console.error(`[Notification:${session.config.id}] 初始化失败:`, e);
        }

        // 启动消息轮询
        pollMessages(session);

      } catch (error) {
        console.error(`  ❌ 加载新 Agent ${agentConfig.name} 失败:`, error);
      }
    }
  }, CHECK_INTERVAL);

  console.log("\n🔄 动态 Agent 加载器已启动（每30秒检查新Agent）");
}

// 消息轮询循环
async function pollMessages(session: AgentSession): Promise<void> {
  let syncBuf = loadSyncBuf(session.config.id);
  let consecutiveFailures = 0;

  while (true) {
    try {
      const resp = await getUpdates(session.api, { get_updates_buf: syncBuf });

      if ((resp.ret && resp.ret !== 0) || (resp.errcode && resp.errcode !== 0)) {
        if (resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE) {
          console.error(`[${session.config.name}] ⚠️ Session 过期，暂停 1 小时...`);
          await sleep(SESSION_PAUSE_MS);
          continue;
        }

        consecutiveFailures++;
        console.error(
          `[${session.config.name}] getUpdates 错误: ret=${resp.ret} errcode=${resp.errcode} (${consecutiveFailures}/3)`,
        );
        
        if (consecutiveFailures >= 3) {
          consecutiveFailures = 0;
          await sleep(30_000);
        } else {
          await sleep(2_000);
        }
        continue;
      }

      consecutiveFailures = 0;

      if (resp.get_updates_buf) {
        saveSyncBuf(resp.get_updates_buf, session.config.id);
        syncBuf = resp.get_updates_buf;
      }

      const msgs = resp.msgs ?? [];
      for (const msg of msgs) {
        await handleMessage(session, msg);
      }
    } catch (err) {
      consecutiveFailures++;
      console.error(`[${session.config.name}] Poll 异常 (${consecutiveFailures}/3):`, err);
      
      if (consecutiveFailures >= 3) {
        consecutiveFailures = 0;
        await sleep(30_000);
      } else {
        await sleep(2_000);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
