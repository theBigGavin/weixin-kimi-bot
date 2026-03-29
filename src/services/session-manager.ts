/**
 * Agent 会话管理器
 * 负责初始化和管理 Agent 会话的生命周期
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ApiOptions } from "../ilink/api.js";
import { agentManager } from "../agent/manager.js";
import type { AgentConfig, AgentRuntime } from "../agent/types.js";
import { getScheduler } from "../scheduler.js";
import { getNotificationManager } from "../notifications/index.js";
import { getLongTaskManager, formatProgressMessage as formatLongTaskProgress } from "../longtask/manager.js";
import type { LongTask, ProgressInfo as LongTaskProgressInfo } from "../longtask/types.js";
import {
  getFlowTaskManager,
  formatProgressMessage as formatFlowTaskProgress,
} from "../flowtask/manager.js";
import type { FlowTask, ProgressInfo as FlowTaskProgressInfo, HumanApprovalRequest } from "../flowtask/types.js";
import { sendTextReply } from "../handlers/message-utils.js";
import type { AgentSession } from "../handlers/types.js";

export interface SessionManagerOptions {
  /** 消息发送回调 */
  onSendMessage: (api: ApiOptions, chatId: string, contextToken: string, text: string) => Promise<void>;
  /** LongTask 进度回调 */
  onLongTaskProgress?: (task: LongTask, progress: LongTaskProgressInfo) => void;
  /** LongTask 完成回调 */
  onLongTaskComplete?: (task: LongTask) => void;
  /** FlowTask 进度回调 */
  onFlowTaskProgress?: (task: FlowTask, progress: FlowTaskProgressInfo) => void;
  /** FlowTask 完成回调 */
  onFlowTaskComplete?: (task: FlowTask) => void;
  /** FlowTask 审批请求回调 */
  onFlowTaskApprovalRequest?: (task: FlowTask, request: HumanApprovalRequest) => void;
}

/**
 * Agent 凭证
 */
interface AgentCredentials {
  botToken: string;
  accountId: string;
  baseUrl: string;
}

/**
 * 加载 Agent 凭证
 */
export function loadAgentCredentials(agentId: string): AgentCredentials | null {
  const credsPath = join(agentManager.getAgentPath(agentId), "credentials.json");
  try {
    return JSON.parse(readFileSync(credsPath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * 创建 Agent 会话
 */
export async function createAgentSession(
  config: AgentConfig,
  credentials: AgentCredentials
): Promise<AgentSession | null> {
  const runtime = await agentManager.buildRuntime(config.id);
  if (!runtime) {
    return null;
  }

  const api: ApiOptions = {
    baseUrl: credentials.baseUrl,
    token: credentials.botToken,
  };

  return {
    runtime,
    config,
    api,
    credentials: {
      botToken: credentials.botToken,
      accountId: credentials.accountId,
      baseUrl: credentials.baseUrl,
    },
    conversationTurns: new Map(),
    lastMemoryExtract: new Map(),
    userWorkspaces: new Map(),
  };
}

/**
 * 初始化 LongTask 管理器
 */
export async function initializeLongTaskManager(
  session: AgentSession,
  options: SessionManagerOptions
): Promise<void> {
  const ltManager = getLongTaskManager(session.config.id, {
    maxConcurrency: 5,
    reportIntervalMs: 30_000,
    onProgress: async (task: LongTask, progress: LongTaskProgressInfo) => {
      const msg = formatLongTaskProgress(task, progress);
      await options.onSendMessage(session.api, task.chatId, task.contextToken, msg);
      console.log(`  [LongTask:${task.id}] 进度: ${progress.percent}% - ${progress.step}`);
      options.onLongTaskProgress?.(task, progress);
    },
    onComplete: async (task: LongTask) => {
      // deploy 命令会自己处理完成通知和重启，跳过默认通知
      if (task.command?.startsWith("npm run version:")) {
        console.log(`  [LongTask:${task.id}] 部署任务完成，跳过默认通知（由 deploy 命令处理）`);
        return;
      }

      const statusEmoji = task.status === "completed" ? "✅" : "❌";
      const msg =
        `${statusEmoji} **耗时任务完成** \`${task.id}\`\n\n` +
        `状态: ${task.status === "completed" ? "成功" : "失败"}\n` +
        `耗时: ${((task.completedAt! - task.startedAt!) / 1000).toFixed(1)}s\n\n` +
        `---\n${task.result?.slice(0, 3000) || task.error || ""}${(task.result?.length || 0) > 3000 ? "\n... (已截断)" : ""}`;
      await options.onSendMessage(session.api, task.chatId, task.contextToken, msg);
      console.log(`  [LongTask:${task.id}] 完成: ${task.status}`);
      options.onLongTaskComplete?.(task);
    },
    onCancel: async (task: LongTask) => {
      const msg = `🚫 **耗时任务已取消** \`${task.id}\``;
      await options.onSendMessage(session.api, task.chatId, task.contextToken, msg);
      console.log(`  [LongTask:${task.id}] 已取消`);
    },
  });
}

/**
 * 初始化 FlowTask 管理器
 */
export async function initializeFlowTaskManager(
  session: AgentSession,
  options: SessionManagerOptions
): Promise<void> {
  const ftManager = getFlowTaskManager(session.config.id, {
    maxConcurrency: 4,
    reportIntervalMs: 30_000,
    autoApproveLowRisk: false,
    requireApprovalFor: ["write", "shell", "human"],
    onProgress: async (task: FlowTask, progress: FlowTaskProgressInfo) => {
      const msg = formatFlowTaskProgress(task, progress);
      await options.onSendMessage(session.api, task.chatId, task.contextToken, msg);
      console.log(`  [FlowTask:${task.id}] 进度: ${progress.percent}% - ${progress.step}`);
      options.onFlowTaskProgress?.(task, progress);
    },
    onComplete: async (task: FlowTask) => {
      const statusEmoji = task.status === "completed" ? "✅" : task.status === "cancelled" ? "🚫" : "❌";
      const audit = task.execution?.audit;
      const humanCount = audit?.filter((a) => a.event === "human_approval_requested").length || 0;
      const msg =
        `${statusEmoji} **FlowTask 完成** \`${task.id}\`\n\n` +
        `状态: ${task.status === "completed" ? "成功" : task.status === "cancelled" ? "已取消" : "失败"}\n` +
        `步骤: ${task.plan?.steps.length || 0} | 人工介入: ${humanCount}次\n` +
        `风险等级: ${task.plan?.validation.riskLevel === "high" ? "🔴 高" : task.plan?.validation.riskLevel === "medium" ? "🟡 中" : "🟢 低"}\n` +
        `耗时: ${task.startedAt && task.completedAt ? ((task.completedAt - task.startedAt) / 1000).toFixed(1) : 0}s\n\n` +
        `---\n${task.result?.slice(0, 3000) || task.error || ""}${(task.result?.length || 0) > 3000 ? "\n... (已截断)" : ""}`;
      await options.onSendMessage(session.api, task.chatId, task.contextToken, msg);
      console.log(`  [FlowTask:${task.id}] 完成: ${task.status}`);
      options.onFlowTaskComplete?.(task);
    },
    onCancel: async (task: FlowTask) => {
      const msg = `🚫 **FlowTask 已取消** \`${task.id}\``;
      await options.onSendMessage(session.api, task.chatId, task.contextToken, msg);
      console.log(`  [FlowTask:${task.id}] 已取消`);
    },
    onApprovalRequest: async (task: FlowTask, request: HumanApprovalRequest) => {
      let msg = `⏸️ **FlowTask 等待确认** \`${task.id}\`\n\n`;
      msg += `步骤 ${request.stepNumber}: ${request.description}\n`;
      msg += `风险等级: ${request.riskLevel === "high" ? "🔴 高" : request.riskLevel === "medium" ? "🟡 中" : "🟢 低"}\n\n`;
      if (request.preview) {
        msg += `*预览*:\n\`\`\`\n${request.preview.content.slice(0, 500)}${request.preview.content.length > 500 ? "\n..." : ""}\n\`\`\`\n\n`;
      }
      msg += `请在5分钟内回复:\n`;
      msg += `- \`/flowtask approve ${task.id}\` 确认继续\n`;
      msg += `- \`/flowtask reject ${task.id} [原因]\` 拒绝执行`;
      await options.onSendMessage(session.api, task.chatId, task.contextToken, msg);
      console.log(`  [FlowTask:${task.id}] 等待用户确认: ${request.description}`);
      options.onFlowTaskApprovalRequest?.(task, request);
    },
  });
}

/**
 * 初始化调度器
 */
export function initializeScheduler(session: AgentSession, options: SessionManagerOptions): void {
  const scheduler = getScheduler(session.config.id);
  scheduler.setApi(session.api, async (chatId: string, ctxToken: string, text: string) => {
    await options.onSendMessage(session.api, chatId, ctxToken, text);
  });
  scheduler.start();
}

/**
 * 初始化通知管理器
 */
export async function initializeNotificationManager(session: AgentSession): Promise<void> {
  const notificationManager = getNotificationManager(session.config.id);
  try {
    await notificationManager.initialize();
  } catch (e) {
    console.error(`[Notification:${session.config.id}] 初始化失败:`, e);
  }
}

/**
 * 完整的 Agent 初始化流程
 */
export async function initializeAgent(
  config: AgentConfig,
  options: SessionManagerOptions
): Promise<AgentSession | null> {
  console.log(`\n🚀 初始化 Agent: ${config.name}`);

  // 加载凭证
  const credentials = loadAgentCredentials(config.id);
  if (!credentials) {
    console.error(`  ❌ 无法加载 ${config.name} 的凭证，跳过`);
    return null;
  }

  // 创建会话
  const session = await createAgentSession(config, credentials);
  if (!session) {
    console.error(`  ❌ 无法构建 ${config.name} 的运行时，跳过`);
    return null;
  }

  console.log(`  ✅ 已加载: ${config.name}`);
  console.log(`     角色: ${session.runtime.template.icon} ${session.runtime.template.name}`);
  console.log(`     工作目录: ${config.workspace.path}`);
  console.log(`     模型: ${config.ai.model}`);

  // 初始化各个子系统
  initializeScheduler(session, options);
  await initializeNotificationManager(session);
  await initializeLongTaskManager(session, options);
  await initializeFlowTaskManager(session, options);

  return session;
}

/**
 * 确定要启动的 Agent 列表
 */
export function determineAgentsToStart(allAgents: AgentConfig[]): AgentConfig[] {
  const activeAgentId = process.env.ACTIVE_AGENT_ID;

  if (activeAgentId) {
    const agent = allAgents.find((a) => a.id === activeAgentId);
    if (!agent) {
      console.error(`\n❌ 未找到 Agent: ${activeAgentId}`);
      console.error(`可用 Agent: ${allAgents.map((a) => a.id).join(", ")}`);
      process.exit(1);
    }
    return [agent];
  }

  // 默认启动所有 Agent
  return allAgents;
}

/**
 * 批量初始化多个 Agent
 */
export async function initializeAgents(
  configs: AgentConfig[],
  options: SessionManagerOptions
): Promise<Map<string, AgentSession>> {
  const activeAgents = new Map<string, AgentSession>();

  for (const config of configs) {
    const session = await initializeAgent(config, options);
    if (session) {
      activeAgents.set(config.id, session);
    }
  }

  return activeAgents;
}
