/**
 * FlowTask - 可靠自我迭代任务系统
 * 
 * 基于"可靠自我迭代架构-v2"设计
 * - 分离控制流与数据流
 * - 结构化计划 + 状态机执行
 * - 人机协作确认点
 * - 完整审计追踪
 */

// ============ 任务状态 ============

export type FlowTaskStatus = 
  | "pending"      // 等待开始
  | "planning"     // 生成计划中
  | "validating"   // 验证计划
  | "awaiting_approval" // 等待用户确认
  | "running"      // 执行中
  | "paused"       // 暂停（检查点）
  | "completed"    // 完成
  | "failed"       // 失败
  | "cancelling"   // 取消中
  | "cancelled";   // 已取消

export type StepType = 
  | "read"       // 读取文件
  | "write"      // 写入文件
  | "shell"      // 执行命令
  | "llm"        // LLM 分析
  | "decision"   // 条件判断
  | "human";     // 人工确认点

export type ErrorAction = "abort" | "retry" | "fallback" | "human";

export type RiskLevel = "low" | "medium" | "high";

// ============ 结构化计划 ============

export interface ValidatedPlan {
  version: "1.0";
  planId: string;
  goal: string;              // 原始用户意图
  
  // === 可靠性元数据 ===
  reliability: {
    minSteps: number;        // 最少步骤（防止无限循环）
    maxSteps: number;        // 最多步骤（硬限制）
    timeout: number;         // 总超时时间（毫秒）
    rollbackOnError: boolean; // 失败时是否回滚
    checkpoints: number[];   // 关键检查点步骤索引
  };
  
  // === 步骤定义 ===
  steps: PlanStep[];
  
  // === 验证签名 ===
  validation: {
    syntaxValid: boolean;    // 语法检查通过
    semanticValid: boolean;  // 语义检查通过
    riskLevel: RiskLevel;
    requiredApproval: boolean; // 是否需要人工确认
    warnings: string[];      // 警告信息
  };
}

export interface PlanStep {
  stepId: string;
  type: StepType;
  description: string;       // 步骤描述（用于展示）
  
  // 确定性输入（必须明确指定）
  inputs: StepInputs;
  
  // 预期输出（用于验证）
  expectedOutputs?: ExpectedOutputs;
  
  // 验证器（执行后校验）
  validators?: Validator[];
  
  // 错误处理
  onError: ErrorAction;
  fallback?: string;         // fallback 步骤 ID
}

export interface StepInputs {
  paths?: string[];          // 操作的文件路径
  command?: string;          // shell 命令（白名单校验）
  prompt?: string;           // LLM 提示词
  condition?: string;        // 决策条件
  content?: string;          // 写入内容
  options?: Record<string, unknown>;
}

export interface ExpectedOutputs {
  type: "file" | "stdout" | "structured" | "none";
  path?: string;
  schema?: Record<string, unknown>; // JSON Schema
  assertions?: Assertion[];
}

export interface Assertion {
  type: "exists" | "contains" | "matches" | "custom";
  target: string;
  expected?: unknown;
}

export interface Validator {
  type: "file_exists" | "readable" | "writable" | "syntax_valid" | "schema_match" | "custom";
  path?: string;
  language?: string;         // 用于 syntax_valid
  fn?: string;               // 自定义函数名
}

// ============ 执行状态机 ============

export interface ExecutionState {
  planId: string;
  currentStep: number;
  status: FlowTaskStatus;
  
  // 执行上下文（不可变快照）
  context: ExecutionContext;
  
  // 变更追踪
  changes: ChangeLog[];
  
  // 审计记录
  audit: AuditRecord[];
  
  // 步骤结果
  stepResults: StepResult[];
}

export interface ExecutionContext {
  workingDir: string;
  env: Record<string, string>;
  stepResults: StepResult[];  // 每步的完整结果
}

export interface StepResult {
  stepId: string;
  status: "success" | "failed" | "skipped";
  output?: unknown;
  error?: string;
  startedAt: number;
  completedAt: number;
}

export interface ChangeLog {
  stepId: string;
  type: "file_write" | "file_delete" | "shell_exec" | "env_change";
  timestamp: number;
  before?: unknown;
  after?: unknown;
  reversible: boolean;
  snapshot?: string;         // 文件快照路径（用于回滚）
}

export interface AuditRecord {
  timestamp: number;
  event: 
    | "plan_generated"
    | "plan_validated"
    | "step_started"
    | "step_completed"
    | "step_failed"
    | "human_approval_requested"
    | "human_approved"
    | "human_rejected"
    | "task_completed"
    | "task_failed"
    | "task_cancelled"
    | "rollback_started"
    | "rollback_completed";
  details: Record<string, unknown>;
}

// ============ FlowTask 实例 ============

export interface FlowTask {
  id: string;
  agentId: string;
  userId: string;
  chatId: string;
  contextToken: string;
  
  // 原始输入
  prompt: string;
  
  // 执行状态
  status: FlowTaskStatus;
  
  // 计划（生成后填充）
  plan?: ValidatedPlan;
  
  // 执行状态
  execution?: ExecutionState;
  
  // 时间戳
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  
  // 结果
  result?: string;
  error?: string;
  
  // 进度报告
  progressLogs: ProgressInfo[];
  
  // 工作目录
  cwd: string;
  model: string;
  systemPrompt?: string;
  
  // 子进程（执行中）
  childPid?: number;
}

export interface ProgressInfo {
  step: string;           // 当前步骤描述
  stepNumber: number;     // 当前步骤序号
  totalSteps: number;     // 总步骤数
  fileName?: string;      // 当前操作的文件名
  percent: number;        // 0-100
  detail?: string;        // 额外详情
  timestamp: number;
  waitingForApproval?: boolean; // 是否等待用户确认
}

// ============ 人机协作 ============

export interface HumanApprovalRequest {
  taskId: string;
  stepId: string;
  stepNumber: number;
  description: string;
  riskLevel: RiskLevel;
  preview?: {
    type: "file_changes" | "command" | "plan";
    content: string;
  };
  timeout: number;         // 超时时间（毫秒）
  requestedAt: number;
}

export interface HumanApprovalResponse {
  approved: boolean;
  modifications?: string;  // 用户修改建议
  feedback?: string;       // 用户反馈
}

export interface ValidationResult {
  syntaxValid: boolean;
  semanticValid: boolean;
  riskLevel: RiskLevel;
  requiredApproval: boolean;
  warnings: string[];
}

// ============ 管理器配置 ============

export interface FlowTaskManagerOptions {
  maxConcurrency: number;
  reportIntervalMs: number;
  defaultTimeout: number;
  
  // 回调
  onProgress: (task: FlowTask, progress: ProgressInfo) => Promise<void>;
  onComplete: (task: FlowTask) => Promise<void>;
  onCancel: (task: FlowTask) => Promise<void>;
  onApprovalRequest: (task: FlowTask, request: HumanApprovalRequest) => Promise<void | boolean | { approved: boolean; modifications?: string; feedback?: string }>;
  
  // 人机协作配置
  autoApproveLowRisk: boolean;      // 低风险任务自动执行
  requireApprovalFor: StepType[];   // 哪些步骤类型需要确认
}

// ============ 历史记录 ============

export interface FlowTaskHistoryRecord {
  id: string;
  agentId: string;
  userId: string;
  prompt: string;
  status: FlowTaskStatus;
  goal: string;
  stepsCount: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
  riskLevel: RiskLevel;
  humanInterventions: number; // 人工介入次数
}

// ============ 自我迭代相关 ============

export interface ExecutionMetrics {
  taskId: string;
  totalSteps: number;
  successSteps: number;
  failedSteps: number;
  retryCount: number;
  humanInterventions: number;
  durationMs: number;
}

export interface ExecutionPattern {
  type: "frequent_failure" | "slow_step" | "validation_fail" | "human_intervention";
  stepId?: string;
  stepType?: StepType;
  frequency: number;
  description: string;
}

export interface PlanImprovement {
  id: string;
  targetPattern: string;
  suggestedChange: string;
  validation: {
    safetyCheck: boolean;
    regressionTest: boolean;
    userReviewed: boolean;
  };
}
