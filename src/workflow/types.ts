/**
 * Workflow Engine - 可插拔工作流系统类型定义
 * 
 * 支持复杂的确定性工作流自动化执行
 */

// ============ 工作流定义 ============

/** 工作流变量定义 */
export interface WorkflowVariable {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object" | "date";
  description?: string;
  defaultValue?: unknown;
  required?: boolean;
}

/** 节点连接定义 */
export interface NodeConnection {
  from: string;           // 源节点ID
  to: string;             // 目标节点ID
  condition?: string;     // 条件表达式（可选）
}

/** 节点输入定义 */
export interface NodeInput {
  name: string;
  type?: string;
  required?: boolean;
  description?: string;
  defaultValue?: unknown;
}

/** 节点输出定义 */
export interface NodeOutput {
  name: string;
  type?: string;
  description?: string;
}

/** 工作流节点定义 */
export interface WorkflowNodeDefinition {
  id: string;
  type: string;                          // 节点类型：search, llm, send, etc.
  name: string;
  description?: string;
  config: Record<string, unknown>;       // 节点配置
  inputs?: Record<string, string>;       // 输入映射（key: 输入名, value: 表达式）
  position?: { x: number; y: number };   // 可视化位置（可选）
}

/** 工作流定义（模板） */
export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  category?: string;                     // 分类：news, report, monitoring, etc.
  tags?: string[];
  variables: WorkflowVariable[];         // 工作流变量
  nodes: WorkflowNodeDefinition[];
  connections: NodeConnection[];
  createdAt: number;
  updatedAt: number;
}

// ============ 工作流实例 ============

/** 工作流实例（用户创建的具体任务） */
export interface WorkflowInstance {
  id: string;
  userId: string;                        // 用户ID（隔离）
  agentId: string;                       // 所属Agent
  definitionId?: string;                 // 基于的模板ID（可选）
  name: string;
  description?: string;
  cron: string;                          // 定时表达式
  enabled: boolean;
  variables: Record<string, unknown>;    // 变量值
  chatId: string;                        // 发送目标的聊天ID
  contextToken: string;                  // 上下文Token
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastRunStatus?: "success" | "failed" | "running";
  lastRunError?: string;
  runCount: number;
}

// ============ 节点执行 ============

/** 节点执行上下文 */
export interface NodeContext {
  workflowId: string;                    // 工作流实例ID
  nodeId: string;                        // 当前节点ID
  userId: string;
  agentId: string;
  chatId: string;
  contextToken: string;
  inputs: Record<string, unknown>;       // 当前节点输入
  state: Record<string, unknown>;        // 全局状态（节点间传递数据）
  variables: Record<string, unknown>;    // 工作流变量
  config: Record<string, unknown>;       // 节点配置
}

/** 节点执行结果 */
export interface NodeResult {
  success: boolean;
  outputs: Record<string, unknown>;      // 节点输出
  error?: string;                        // 错误信息
  logs?: string[];                       // 执行日志
}

/** 节点处理器接口 */
export interface NodeHandler {
  type: string;
  name: string;
  description: string;
  category?: string;                     // 分类：input, process, output, control
  
  // Schema 定义（用于UI和验证）
  configSchema?: JSONSchema;
  inputSchema?: JSONSchema;
  outputSchema?: JSONSchema;
  
  // 执行方法
  execute(context: NodeContext): Promise<NodeResult>;
  
  // 可选：验证配置
  validateConfig?(config: Record<string, unknown>): string | null;
}

// ============ 工作流执行 ============

/** 执行状态 */
export type WorkflowExecutionStatus = 
  | "pending"      // 等待执行
  | "running"      // 执行中
  | "completed"    // 完成
  | "failed"       // 失败
  | "cancelled";   // 取消

/** 节点执行记录 */
export interface NodeExecutionRecord {
  nodeId: string;
  nodeType: string;
  nodeName: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: number;
  completedAt?: number;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: string;
  logs?: string[];
}

/** 工作流执行记录 */
export interface WorkflowExecution {
  id: string;
  workflowId: string;
  userId: string;
  agentId: string;
  status: WorkflowExecutionStatus;
  triggeredBy: "cron" | "manual" | "api";
  startedAt: number;
  completedAt?: number;
  nodeExecutions: NodeExecutionRecord[];
  finalOutputs?: Record<string, unknown>;
  error?: string;
}

// ============ 自然语言解析 ============

/** 解析后的工作流信息 */
export interface ParsedWorkflowInfo {
  name: string;
  description?: string;
  cron: string;
  cronDescription: string;
  nodes: WorkflowNodeDefinition[];
  connections: NodeConnection[];
  variables: WorkflowVariable[];
  suggestedVariableValues?: Record<string, unknown>;
}

// ============ JSON Schema 类型 ============

export interface JSONSchema {
  type?: string;
  title?: string;
  description?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  enumNames?: string[];
  default?: unknown;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

// ============ 管理器配置 ============

export interface WorkflowManagerConfig {
  definitionsDir: string;                // 工作流模板目录
  instancesDir: string;                  // 工作流实例目录
  executionsDir: string;                 // 执行历史目录
  maxConcurrentExecutions: number;       // 最大并发执行数
  defaultTimeout: number;                // 默认超时时间（毫秒）
  enablePersistence: boolean;            // 是否启用持久化
}

// ============ 内置变量模板 ============

export interface VariableTemplate {
  name: string;
  description: string;
  template: string;
  example: string;
}

// 内置变量模板列表
export const BUILTIN_VARIABLE_TEMPLATES: VariableTemplate[] = [
  {
    name: "date:today",
    description: "今天的日期",
    template: "${date:today}",
    example: "2024-01-15",
  },
  {
    name: "date:yesterday",
    description: "昨天的日期",
    template: "${date:yesterday}",
    example: "2024-01-14",
  },
  {
    name: "date:tomorrow",
    description: "明天的日期",
    template: "${date:tomorrow}",
    example: "2024-01-16",
  },
  {
    name: "date:now",
    description: "当前时间",
    template: "${date:now}",
    example: "2024-01-15 08:30:00",
  },
  {
    name: "user.id",
    description: "用户ID",
    template: "${user.id}",
    example: "user_123",
  },
  {
    name: "user.name",
    description: "用户名称",
    template: "${user.name}",
    example: "张三",
  },
  {
    name: "workflow.id",
    description: "工作流ID",
    template: "${workflow.id}",
    example: "wf_abc123",
  },
  {
    name: "workflow.name",
    description: "工作流名称",
    template: "${workflow.name}",
    example: "AI每日晨报",
  },
];
