/**
 * 带上下文的命令处理器
 */
import {
  setContextToken,
  getContextToken,
  loadUserSessionMeta,
  saveUserSessionMeta,
  incrementUserTurnCount,
  resetUserSessionMeta,
} from "../store.js";
import { checkKimiSession, clearKimiSessions } from "../kimi/session.js";
import {
  initializeContextSystem,
  getContextManager,
  getStateMachine,
  ConversationState,
  IntentType,
  translateState,
  type SessionContext,
  type Intent,
} from "../context/index.js";
import { buildSystemPrompt, buildStatusPrompt, buildHelpPrompt } from "../agent/prompt-builder.js";
import { handleCommand } from "./command-handler.js";
import { sendTextReply, getUserWorkspace } from "./message-utils.js";
import type { AgentSession } from "./types.js";

interface ContextSystem {
  contextManager: ReturnType<typeof getContextManager>;
  stateMachine: ReturnType<typeof getStateMachine>;
}

/**
 * 支持上下文的命令处理函数（新架构）
 */
export async function handleAgentCommandWithContext(
  session: AgentSession,
  command: string,
  args: string,
  fromUser: string,
  contextToken: string,
  sessionContext: SessionContext,
  contextSystem: ContextSystem
): Promise<string | null> {
  const { runtime, config } = session;
  const { contextManager } = contextSystem;

  switch (command) {
    case "reset": {
      // 复用原有的reset逻辑
      const result = await handleCommand(command, args, {
        session,
        fromUser,
        contextToken,
      });

      // 额外重置上下文
      await contextManager.reset(sessionContext);

      return result || "🔄 对话上下文已重置（包含新架构的会话状态）";
    }

    case "session": {
      const subCmd = args || "status";
      const userWorkspace = await getUserWorkspace(session, fromUser);
      const sessionMeta = loadUserSessionMeta(session.config.id, fromUser);
      const kimiSession = await checkKimiSession(userWorkspace.cwd);

      if (subCmd === "status") {
        let response = `
📊 Session 状态（上下文感知架构）

**Agent:** ${session.config.id}
**用户:** ${fromUser}
**工作目录:** \`${userWorkspace.cwd}\`

**对话统计:**
- 轮次: ${sessionMeta?.turnCount || 0}
- 当前状态: ${translateState(sessionContext.state.current)}
- 活跃选项: ${sessionContext.activeOptions.size}
- 消息历史: ${sessionContext.messages.length}
`;

        if (sessionContext.state.pendingDecision) {
          response += `- 待决策: ${sessionContext.state.pendingDecision.description}\n`;
        }

        if (sessionContext.currentTaskId) {
          response += `- 当前任务: ${sessionContext.currentTaskId}\n`;
        }

        const stats = contextManager.getStats(sessionContext);
        response += `- 会话时长: ${Math.floor(stats.duration / 60000)}分钟\n`;

        response += `
**Kimi Session:** ${kimiSession.exists ? "✅ 存在" : "❌ 不存在"}
${kimiSession.exists ? `- ID: \`${kimiSession.sessionId?.slice(0, 16)}...\`
- 最后修改: ${kimiSession.lastModified ? new Date(kimiSession.lastModified).toLocaleString("zh-CN") : "未知"}` : ""}

使用 \`/reset\` 重置 session
        `.trim();
        return response;
      }

      return "未知命令，可用: /session status";
    }

    case "context": {
      // 新架构专属命令：查看上下文详情
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

    default:
      // 其他命令使用原有逻辑
      return handleCommand(command, args, {
        session,
        fromUser,
        contextToken,
      });
  }
}
