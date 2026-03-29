/**
 * FlowTask 模块 - 可靠自我迭代任务系统 V2
 * 
 * 新特性：
 * 1. 继承 LongTask 后台执行能力（子进程执行，不受 HTTP 超时限制）
 * 2. 自动任务拆分（方案2）：大任务自动拆分为小任务并行/串行执行
 * 3. 结构化计划 + 状态机执行
 * 4. 人机协作确认点
 * 5. 完整审计追踪
 */

// 类型导出
export type {
  FlowTask,
  FlowTaskStatus,
  FlowTaskManagerOptions,
  FlowTaskHistoryRecord,
  ValidatedPlan,
  PlanStep,
  StepType,
  StepInputs,
  ExpectedOutputs,
  ExecutionState,
  ExecutionContext,
  StepResult,
  ChangeLog,
  AuditRecord,
  HumanApprovalRequest,
  HumanApprovalResponse,
  ValidationResult,
  ProgressInfo,
  RiskLevel,
  ErrorAction,
  ExecutionMetrics,
  ExecutionPattern,
  PlanImprovement,
} from "./types.js";

// 管理器导出
export {
  FlowTaskManager,
  getFlowTaskManager,
  formatProgressMessage,
  formatPlanForUserConfirmation,
} from "./manager.js";

// 后台执行器导出
export {
  FlowTaskBackgroundExecutor,
  createBackgroundExecutor,
  type BackgroundExecutionOptions,
  type BackgroundExecutionResult,
} from "./background-executor.js";

// 任务拆分器导出（方案2）
export {
  TaskSplitter,
  ResultMerger,
  createTaskSplitter,
  createResultMerger,
  type SubTask,
  type SubTaskResult,
  type SplitTaskGroup,
  type SplitStrategy,
  type TaskSplitResult,
} from "./task-splitter.js";

// 计划生成器导出
export {
  generatePlan,
  formatPlanForDisplay,
  type PlanGenerationResult,
} from "./plan-generator.js";

// 状态机导出
export {
  ExecutionEngine,
  createExecutionEngine,
  type ExecutionOptions,
} from "./state-machine.js";
