/**
 * 处理器类型定义
 */

import type { ApiOptions } from "../ilink/api.js";
import type { AgentRuntime, AgentConfig } from "../agent/types.js";
import type { SessionContext } from "../context/types.js";

/**
 * Agent会话
 */
export interface AgentSession {
  runtime: AgentRuntime;
  config: AgentConfig;
  api: ApiOptions;
  credentials: {
    botToken: string;
    accountId: string;
    baseUrl: string;
  };
  conversationTurns: Map<string, number>;
  lastMemoryExtract: Map<string, number>;
  userWorkspaces: Map<string, string>;
}

/**
 * 命令上下文
 */
export interface CommandContext {
  session: AgentSession;
  fromUser: string;
  contextToken: string;
  sessionContext?: SessionContext;
}

/**
 * 命令处理函数类型
 */
export type CommandHandler = (
  args: string,
  context: CommandContext
) => Promise<string | null> | string | null;

/**
 * 用户工作目录
 */
export interface UserWorkspace {
  cwd: string;
  projectDir?: string;
}

/**
 * 待确认任务
 */
export interface PendingTaskInfo {
  taskInfo: {
    name: string;
    cron: string;
    command: string;
    description: string;
  };
  agentId: string;
  chatId: string;
  contextToken: string;
  expiresAt: number;
}
