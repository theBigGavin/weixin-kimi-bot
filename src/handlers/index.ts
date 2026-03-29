/**
 * 处理器模块统一导出
 */

export type {
  AgentSession,
  CommandContext,
  CommandHandler,
  UserWorkspace,
  PendingTaskInfo,
  PendingTask,
} from "./types.js";

export {
  handleCommand,
  getCommandList,
  pendingTasks,
  userAutoRoute,
} from "./command-handler.js";

export {
  sendTextReply,
  getUserWorkspace,
  buildFounderPrompt,
  showTyping,
} from "./message-utils.js";

export { handleMessageWithContext } from "./message-handler.js";
export { handleMessageLegacy } from "./legacy-handler.js";
export { handleAgentCommandWithContext } from "./command-context.js";
