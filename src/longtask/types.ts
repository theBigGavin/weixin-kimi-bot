/**
 * 耗时任务 (LongTask) 类型定义
 */

export type LongTaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/**
 * 持久化策略类型
 */
export type PersistenceStrategy = "jsonl" | "sqlite" | "none";

/**
 * 任务快照 - 用于实时持久化
 */
export interface TaskSnapshot {
  id: string;
  agentId: string;
  userId: string;
  chatId: string;
  contextToken: string;
  prompt: string;
  status: LongTaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
  progressLogs: ProgressInfo[];
  childPid?: number;
  cwd: string;
  model: string;
  systemPrompt?: string;
  maxTurns: number;
  /** 自定义命令（如果设置，则执行此命令而非 kimi） */
  command?: string;
  /** 快照版本号 */
  snapshotVersion: number;
  /** 最后更新时间 */
  lastUpdatedAt: number;
  /** 工具调用预测 */
  toolPrediction?: ToolPrediction;
}

export interface ProgressInfo {
  step: string;           // 当前步骤描述
  fileName?: string;      // 当前操作的文件名
  percent: number;        // 0-100
  detail?: string;        // 额外详情
  timestamp: number;
  /** 基于预测的总步骤数 */
  predictedTotalSteps?: number;
  /** 已完成的步骤数 */
  completedSteps?: number;
}

/**
 * 预测的工具调用
 */
export interface PredictedToolCall {
  name: string;
  reason: string;
}

/**
 * 工具调用预测结果
 */
export interface ToolPrediction {
  predictedTools: PredictedToolCall[];
  confidence: number; // 0-1
  reasoning?: string;
}

export interface LongTask {
  id: string;
  agentId: string;
  userId: string;
  chatId: string;
  contextToken: string;
  prompt: string;
  status: LongTaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
  progressLogs: ProgressInfo[];
  childPid?: number;
  cwd: string;
  model: string;
  systemPrompt?: string;
  maxTurns: number;
  /** 自定义命令（如果设置，则执行此命令而非 kimi） */
  command?: string;
  /** 工具调用预测 */
  toolPrediction?: ToolPrediction;
}

export interface LongTaskHistoryRecord {
  id: string;
  agentId: string;
  userId: string;
  prompt: string;
  status: LongTaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
  finalProgress: ProgressInfo;
}

export interface LongTaskManagerOptions {
  maxConcurrency: number;
  reportIntervalMs: number;
  onProgress: (task: LongTask, progress: ProgressInfo) => Promise<void>;
  onComplete: (task: LongTask) => Promise<void>;
  onCancel: (task: LongTask) => Promise<void>;
  /** 持久化配置 */
  persistence?: PersistenceOptions;
}

/**
 * 持久化配置选项
 */
export interface PersistenceOptions {
  /** 持久化策略 */
  strategy?: PersistenceStrategy;
  /** 数据目录 */
  dataDir?: string;
  /** 快照保存间隔（毫秒） */
  snapshotIntervalMs?: number;
  /** 是否启用WAL日志 */
  enableWAL?: boolean;
  /** 历史记录保留天数 */
  historyRetentionDays?: number;
  /** 是否启用自动压缩 */
  enableCompression?: boolean;
  /** 单个文件最大大小（MB） */
  maxFileSizeMB?: number;
  /** 是否启用崩溃恢复 */
  enableRecovery?: boolean;
  /** 最大并发写入数 */
  maxConcurrentWrites?: number;
}

/**
 * 持久化元数据
 */
export interface PersistenceMetadata {
  /** 最后快照时间 */
  lastSnapshotAt: number;
  /** 快照任务数量 */
  snapshotTaskCount: number;
  /** 总历史记录数 */
  totalHistoryRecords: number;
  /** 数据文件大小（字节） */
  dataSizeBytes: number;
  /** 版本号 */
  version: string;
}

/**
 * 查询过滤器
 */
export interface HistoryQueryFilter {
  /** 用户ID过滤 */
  userId?: string;
  /** 状态过滤 */
  status?: LongTaskStatus | LongTaskStatus[];
  /** 起始时间 */
  startTime?: number;
  /** 结束时间 */
  endTime?: number;
  /** 关键词搜索（匹配prompt） */
  keyword?: string;
}

/**
 * 查询结果
 */
export interface QueryResult<T> {
  /** 结果列表 */
  items: T[];
  /** 总数 */
  total: number;
  /** 是否有更多 */
  hasMore: boolean;
  /** 下一页游标 */
  nextCursor?: string;
}

/**
 * 恢复的任务信息
 */
export interface RecoveredTask {
  /** 原始任务数据 */
  task: TaskSnapshot;
  /** 恢复建议 */
  recoverySuggestion: "restart" | "resume" | "cleanup";
  /** 恢复原因 */
  recoveryReason: string;
}
