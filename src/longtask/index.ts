/**
 * LongTask 模块 - 耗时任务管理
 * 
 * 提供完整的长时间运行任务管理能力：
 * - 任务队列管理
 * - 并发控制
 * - 进度跟踪与报告
 * - 历史记录持久化
 * - 实时状态快照
 * - 崩溃恢复机制
 * - WAL数据一致性保证
 * - 数据压缩与轮转
 */

// 类型导出
export type {
  LongTask,
  LongTaskStatus,
  ProgressInfo,
  LongTaskHistoryRecord,
  LongTaskManagerOptions,
  PersistenceOptions,
  PersistenceStrategy,
  TaskSnapshot,
  PersistenceMetadata,
  HistoryQueryFilter,
  QueryResult,
  RecoveredTask,
  PredictedToolCall,
  ToolPrediction,
} from "./types.js";

// 核心类导出
export { LongTaskManager, getLongTaskManager, getLongTaskManagerSync } from "./manager.js";
export { TaskPersistenceManager } from "./persistence.js";
export {
  TaskRecoveryManager,
  rebuildTaskFromSnapshot,
  createTaskSnapshot,
} from "./recovery.js";

// 工具函数导出
export { parseProgress, formatProgressMessage } from "./parser.js";
export {
  ToolPredictor,
  defaultToolPredictor,
  calculateProgressPercent,
  formatPredictionSummary,
} from "./tool-predictor.js";

// 版本信息
export const VERSION = "2.0.0";
