/**
 * 耗时任务 (LongTask) 类型定义
 */

export type LongTaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface ProgressInfo {
  step: string;           // 当前步骤描述
  fileName?: string;      // 当前操作的文件名
  percent: number;        // 0-100
  detail?: string;        // 额外详情
  timestamp: number;
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
}
