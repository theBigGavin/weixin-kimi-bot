/**
 * 微信 Kimi Bot - 多Agent版本
 *
 * 支持多个微信账号，每个账号有独立的Agent配置、工作目录和记忆
 */
import { checkKimiInstalled, ensureKimiAuthenticated } from "./kimi/handler.js";
import { agentManager } from "./agent/manager.js";
import { initializeContextSystem, type SessionContext } from "./context/index.js";
import { getScheduler } from "./scheduler.js";
import { getNotificationManager } from "./notifications/index.js";
import { sendTextReply, handleMessageWithContext, handleMessageLegacy, type AgentSession, type PendingTask } from "./handlers/index.js";
import {
  loadRestartInfo,
  clearRestartInfo,
  formatRestartNotification,
} from "./services/restart-notify.js";
import { pollMessages, startDynamicAgentLoader } from "./services/agent-poller.js";
import {
  determineAgentsToStart,
  initializeAgents,
} from "./services/session-manager.js";

// 新架构开关（用于渐进式迁移）
const ENABLE_CONTEXT_AWARE = process.env.ENABLE_CONTEXT_AWARE !== "false"; // 默认启用

// 全局上下文系统实例
let contextSystem: ReturnType<typeof initializeContextSystem> | null = null;

// ============ Agent 运行时缓存 ============
const activeAgents: Map<string, AgentSession> = new Map();
const pendingTasks: Map<string, PendingTask> = new Map();
const userAutoRoute: Map<string, boolean> = new Map();

// ============ 命令处理 ============

async function handleAgentCommand(
  session: AgentSession,
  command: string,
  args: string,
  fromUser: string,
  contextToken: string
): Promise<string | null> {
  const { handleCommand } = await import("./handlers/index.js");
  const ctx = {
    session,
    fromUser,
    contextToken,
  };
  return await handleCommand(command, args, ctx);
}

/**
 * 支持上下文的命令处理函数（新架构）
 */
async function handleAgentCommandWithContext(
  session: AgentSession,
  command: string,
  args: string,
  fromUser: string,
  contextToken: string,
  sessionContext: SessionContext
): Promise<string | null> {
  const { handleAgentCommandWithContext: handleWithContext } = await import("./handlers/command-context.js");
  if (!contextSystem) return handleAgentCommand(session, command, args, fromUser, contextToken);

  return handleWithContext(session, command, args, fromUser, contextToken, sessionContext, {
    contextManager: contextSystem.contextManager,
    stateMachine: contextSystem.stateMachine,
  });
}

// ============ 核心消息处理 ============

/**
 * 主消息处理函数（兼容层）
 */
async function handleMessage(
  session: AgentSession,
  msg: any
): Promise<void> {
  // 如果启用了新架构，使用新处理函数
  if (ENABLE_CONTEXT_AWARE && contextSystem) {
    return handleMessageWithContext(session, msg as any, contextSystem, pendingTasks, userAutoRoute);
  }

  // 否则使用传统处理流程
  return handleMessageLegacy(session, msg as any, pendingTasks, userAutoRoute);
}

// ============ 重启通知 ============

async function sendRestartNotifications(
  restartInfo: ReturnType<typeof loadRestartInfo>,
  agents: Map<string, AgentSession>
): Promise<void> {
  if (!restartInfo) return;

  console.log("[RestartNotify] 检测到重启信息，准备发送通知...");

  // 尝试发送通知到原始聊天（如果是部署触发的）
  if (restartInfo.chatId && restartInfo.contextToken) {
    const agentSession = restartInfo.agentId
      ? agents.get(restartInfo.agentId)
      : Array.from(agents.values())[0];

    if (agentSession) {
      try {
        const notifyMsg = formatRestartNotification(restartInfo);
        await sendTextReply(agentSession.api, restartInfo.chatId, restartInfo.contextToken, notifyMsg);
        console.log(`[RestartNotify] 已向用户 ${restartInfo.operator} 发送重启通知`);
      } catch (error) {
        console.error("[RestartNotify] 发送重启通知失败:", error);
      }
    }
  }

  // 同时通过通知通道发送（如果有配置）
  for (const session of agents.values()) {
    const notificationManager = getNotificationManager(session.config.id);
    try {
      const notifyMsg = formatRestartNotification(restartInfo);
      await notificationManager.sendToAll({
        title: "服务器已重启",
        content: notifyMsg,
        timestamp: Date.now(),
        metadata: {
          type: "server_restart",
          agentId: session.config.id,
        },
      });
      console.log(`[RestartNotify] 已通过通知通道发送 (Agent: ${session.config.id})`);
    } catch (error) {
      console.error(`[RestartNotify] 通知通道发送失败 (Agent: ${session.config.id}):`, error);
    }
  }

  // 清除重启信息
  clearRestartInfo();
}

// ============ 优雅关闭 ============

function setupGracefulShutdown(agents: Map<string, AgentSession>): void {
  process.on("SIGINT", async () => {
    console.log("\n\n正在关闭...");
    // 停止所有调度器
    for (const s of agents.values()) {
      const sched = getScheduler(s.config.id);
      sched.stop();
    }
    // 停止所有通知管理器
    for (const s of agents.values()) {
      const manager = getNotificationManager(s.config.id);
      await manager.shutdown();
    }
    process.exit(0);
  });
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

  // 初始化上下文感知系统
  if (ENABLE_CONTEXT_AWARE) {
    contextSystem = initializeContextSystem();
    console.log("\n🧠 上下文感知系统已启用");
  } else {
    console.log("\n⚠️  上下文感知系统已禁用（使用传统模式）");
  }

  // 确定要启动的 Agent
  const agentsToStart = determineAgentsToStart(allAgents);

  // 初始化所有 Agent
  const initializedAgents = await initializeAgents(agentsToStart, {
    onSendMessage: async (api, chatId, contextToken, text) => {
      await sendTextReply(api, chatId, contextToken, text);
    },
  });

  // 转移到 activeAgents
  for (const [id, session] of initializedAgents) {
    activeAgents.set(id, session);
  }

  if (activeAgents.size === 0) {
    console.error("\n❌ 没有成功加载的 Agent");
    process.exit(1);
  }

  console.log("\n=== 微信 Kimi Bot 已启动 ===");
  console.log(`活跃 Agent 数: ${activeAgents.size}`);
  console.log("按 Ctrl+C 停止\n");

  // 检查是否有重启通知需要发送
  const restartInfo = loadRestartInfo();
  await sendRestartNotifications(restartInfo, activeAgents);

  // 设置优雅关闭
  setupGracefulShutdown(activeAgents);

  // 为每个 Agent 启动消息轮询
  const pollPromises = Array.from(activeAgents.values()).map((session) =>
    pollMessages(session, handleMessage)
  );

  // 启动动态 Agent 加载器（定期检查新添加的 Agent）
  startDynamicAgentLoader(activeAgents, handleMessage);

  await Promise.all(pollPromises);
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
