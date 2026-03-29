/**
 * 类型定义统一导出
 * 
 * 聚合项目中所有模块的类型定义，简化跨模块导入
 */

// ============ Agent 类型 ============
export type {
  AgentConfig,
  AgentRuntime,
  AgentMemory,
  MemoryFact,
  MemoryProject,
  CapabilityTemplate,
  MemoryExtraction,
  AgentOperationResult,
  // PromptBuildOptions 来自 agent/types.ts，如需使用请从 agent/types 导入
} from "../agent/types.js";

// ============ 处理器类型 ============
export type {
  AgentSession,
  CommandContext,
  CommandHandler,
  UserWorkspace,
  PendingTaskInfo,
  PendingTask,
} from "../handlers/types.js";

// ============ 服务类型 ============
export type {
  RestartInfo,
} from "../services/restart-notify.js";
export type {
  MessageHandler,
} from "../services/agent-poller.js";
export type {
  SessionManagerOptions,
} from "../services/session-manager.js";

// ============ 上下文类型 ============
export type {
  SessionContext,
  StateContext,
  ContextMessage,
  Intent,
  Entity,
  Reference,
  Option,
  TopicFrame,
  PendingDecision,
  ExpectedInputType,
  StructuredContent,
  SessionMetadata,
  StateTransitionResult,
  StateTransition,
  ResolutionResult,
  ReferencePattern,
  ConversationGraph,
  TopicNode,
  TopicEdge,
} from "../context/types.js";
export {
  ConversationState,
  IntentType,
  translateState,
  translateIntent,
} from "../context/types.js";

// ============ ilink API 类型 ============
export type {
  WeixinMessage,
  MessageItem,
} from "../ilink/types.js";
export {
  MessageType,
  MessageItemType,
  MessageState,
  TypingStatus,
} from "../ilink/types.js";

// ============ 长任务类型 ============
export type {
  LongTask,
  ProgressInfo as LongTaskProgressInfo,
} from "../longtask/types.js";

// ============ 流程任务类型 ============
export type {
  FlowTask,
  HumanApprovalRequest,
  ProgressInfo as FlowTaskProgressInfo,
} from "../flowtask/types.js";
export {
  RiskLevel,
} from "../flowtask/types.js";

// ============ 任务路由类型 ============
export type {
  TaskAnalysis,
  TaskDecision,
  ExecutionMode,
} from "../task-router/types.js";

// ============ 通知类型 ============
export type {
  NotificationMessage,
} from "../notifications/types.js";

// ============ Prompt 构建类型 ============
// 注意：PromptBuildOptions 在 agent/types.ts 和 prompt/builder.ts 都有定义
// 请根据使用场景从对应模块导入
export type {
  ContextualPromptBuilder,
  // PromptBuildOptions, // 名称冲突，请从具体模块导入
} from "../prompt/builder.js";
