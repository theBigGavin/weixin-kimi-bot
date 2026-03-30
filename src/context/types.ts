/**
 * 上下文感知架构 - 核心类型定义
 * 
 * 定义对话状态、意图、会话上下文等核心数据结构
 */

// ============ 对话状态 ============

/**
 * 对话状态枚举
 * 表示当前对话所处的阶段
 */
export enum ConversationState {
  /** 空闲状态，等待新任务 */
  IDLE = 'idle',
  /** 探索阶段：了解用户需求 */
  EXPLORING = 'exploring',
  /** 澄清阶段：澄清模糊需求 */
  CLARIFYING = 'clarifying',
  /** 提供方案阶段：展示多个选项 */
  PROPOSING = 'proposing',
  /** 对比阶段：对比不同选项 */
  COMPARING = 'comparing',
  /** 确认阶段：等待用户确认 */
  CONFIRMING = 'confirming',
  /** 调整阶段：根据反馈修改 */
  REFINING = 'refining',
  /** 计划阶段：制定执行计划 */
  PLANNING = 'planning',
  /** 执行阶段：正在执行任务 */
  EXECUTING = 'executing',
  /** 审查阶段：检查执行结果 */
  REVIEWING = 'reviewing',
  /** 完成阶段：任务已完成 */
  COMPLETED = 'completed',
}

/**
 * 待确认的定时任务
 * 存储在 Session 状态中，用于处理 "确认"/"取消" 流程
 */
export interface PendingScheduledTask {
  /** 任务ID */
  id: string;
  /** 任务名称 */
  name: string;
  /** Crontab 表达式 */
  cron: string;
  /** 执行命令 */
  command: string;
  /** 执行时间描述 */
  description: string;
  /** 所属Agent */
  agentId: string;
  /** 用户ID */
  userId: string;
  /** 聊天ID */
  chatId: string;
  /** 上下文Token */
  contextToken: string;
  /** 创建时间 */
  createdAt: number;
  /** 过期时间 */
  expiresAt: number;
}

/**
 * 状态上下文
 * 包含当前状态及相关的上下文数据
 */
export interface StateContext {
  /** 当前状态 */
  current: ConversationState;
  /** 上一个状态（用于回溯） */
  previous?: ConversationState;
  /** 当前主题 */
  topic: string;
  /** 待决策事项 */
  pendingDecision?: PendingDecision;
  /** 期望的输入类型 */
  expectedInput?: ExpectedInputType;
  /** 状态相关数据 */
  data?: {
    /** 待确认的定时任务 */
    pendingScheduledTask?: PendingScheduledTask;
    /** 其他状态数据 */
    [key: string]: any;
  };
}

/**
 * 待决策事项
 */
export interface PendingDecision {
  /** 决策ID */
  id: string;
  /** 决策类型 */
  type: 'select_option' | 'confirm_action' | 'provide_info';
  /** 决策描述 */
  description: string;
  /** 可选项ID列表 */
  options?: string[];
  /** 决策上下文 */
  context: string;
  /** 创建时间 */
  createdAt: number;
  /** 过期时间 */
  expiresAt: number;
}

/**
 * 期望的输入类型
 */
export interface ExpectedInputType {
  /** 输入类型 */
  type: 'free_text' | 'select_option' | 'confirm' | 'provide_info';
  /** 描述 */
  description: string;
  /** 可选项（如果适用） */
  options?: string[];
}

// ============ 意图类型 ============

/**
 * 意图类型枚举
 */
export enum IntentType {
  // ===== 信息类 =====
  /** 询问信息 */
  ASK_INFO = 'ask_info',
  /** 澄清需求 */
  CLARIFY = 'clarify',

  // ===== 决策类 =====
  /** 选择选项 */
  SELECT_OPTION = 'select_option',
  /** 确认 */
  CONFIRM = 'confirm',
  /** 拒绝 */
  REJECT = 'reject',
  /** 修改 */
  MODIFY = 'modify',

  // ===== 执行类 =====
  /** 执行 */
  EXECUTE = 'execute',
  /** 暂停 */
  PAUSE = 'pause',
  /** 继续 */
  RESUME = 'resume',
  /** 取消 */
  CANCEL = 'cancel',
  /** 完成 */
  COMPLETE = 'complete',

  // ===== 上下文类 =====
  /** 引用之前内容 */
  REFERENCE = 'reference',
  /** 切换话题 */
  SWITCH_TOPIC = 'switch_topic',
  /** 回到之前话题 */
  RETURN_TO = 'return_to',
  /** 更新上下文/同步记忆 */
  UPDATE_CONTEXT = 'update_context',

  // ===== 其他 =====
  /** 未知意图 */
  UNKNOWN = 'unknown',
}

/**
 * 意图识别结果
 */
export interface Intent {
  /** 意图类型 */
  type: IntentType;
  /** 置信度 0-1 */
  confidence: number;
  /** 原始文本 */
  rawText: string;
  /** 消解后的文本（如果有） */
  resolvedText?: string;
  /** 提取的实体 */
  entities: Entity[];
  /** 识别的引用 */
  references: Reference[];
}

/**
 * 实体
 */
export interface Entity {
  /** 实体类型 */
  type: string;
  /** 实体值 */
  value: string;
  /** 在文本中的起始位置 */
  start: number;
  /** 在文本中的结束位置 */
  end: number;
}

/**
 * 引用
 */
export interface Reference {
  /** 引用类型 */
  type: 'option' | 'topic' | 'task' | 'message';
  /** 目标ID */
  targetId: string;
  /** 原始文本 */
  rawText: string;
  /** 置信度 */
  confidence: number;
}

// ============ 消息和选项 ============

/**
 * 上下文消息
 */
export interface ContextMessage {
  /** 消息ID */
  id: string;
  /** 角色 */
  role: 'user' | 'assistant' | 'system';
  /** 内容 */
  content: string;
  /** 时间戳 */
  timestamp: number;
  /** 结构化内容（解析后） */
  structuredContent?: StructuredContent;
  /** 识别出的意图 */
  intent?: Intent;
}

/**
 * 结构化内容
 */
export interface StructuredContent {
  /** 内容类型 */
  type: 'options' | 'plan' | 'code' | 'analysis' | 'confirmation';
  /** 数据 */
  data: any;
}

/**
 * 选项
 */
export interface Option {
  /** 选项ID */
  id: string;
  /** 标签/标题 */
  label: string;
  /** 描述 */
  description: string;
  /** 元数据 */
  metadata?: Record<string, any>;
  /** 创建时间 */
  createdAt: number;
}

// ============ 话题 ============

/**
 * 话题帧
 * 用于话题栈，支持话题嵌套和回溯
 */
export interface TopicFrame {
  /** 话题ID */
  id: string;
  /** 话题标签 */
  label: string;
  /** 话题描述 */
  description: string;
  /** 创建时间 */
  createdAt: number;
  /** 关联的消息ID */
  messageIds?: string[];
}

// ============ 会话上下文 ============

/**
 * 会话上下文
 * 核心数据结构，维护用户与Agent的完整对话状态
 */
export interface SessionContext {
  /** 上下文ID */
  id: string;
  /** 用户ID */
  userId: string;
  /** Agent ID */
  agentId: string;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;

  /** 当前状态 */
  state: StateContext;
  /** 消息历史 */
  messages: ContextMessage[];
  /** 活跃选项（可用于指代消解） */
  activeOptions: Map<string, Option>;
  /** 当前任务ID */
  currentTaskId?: string;
  /** 当前FlowTask ID */
  currentFlowTaskId?: string;
  /** 话题栈 */
  topicStack: TopicFrame[];

  /** 元数据 */
  metadata: SessionMetadata;
}

/**
 * 会话元数据
 */
export interface SessionMetadata {
  /** 总消息数 */
  totalMessages: number;
  /** 最后活跃时间 */
  lastActiveAt: number;
  /** 是否新会话 */
  isNewSession: boolean;
  /** 版本号（用于数据迁移） */
  version?: string;
}

// ============ 状态机 ============

/**
 * 状态转移结果
 */
export interface StateTransitionResult {
  /** 是否成功 */
  success: boolean;
  /** 新状态 */
  newState?: ConversationState;
  /** 是否需要确认 */
  requiresConfirmation?: boolean;
  /** 消息 */
  message?: string;
  /** 期望的输入类型 */
  expectedInput?: ExpectedInputType;
}

/**
 * 状态转移规则
 */
export interface StateTransition {
  /** 源状态 */
  from: ConversationState;
  /** 触发意图 */
  intent: IntentType;
  /** 目标状态 */
  to: ConversationState;
  /** 条件函数 */
  condition?: (intent: Intent, context: StateContext) => boolean;
  /** 执行动作 */
  action?: (intent: Intent, context: StateContext) => void;
}

// ============ 指代消解 ============

/**
 * 指代消解结果
 */
export interface ResolutionResult {
  /** 是否包含引用 */
  hasReference: boolean;
  /** 消解后的文本 */
  resolvedText: string;
  /** 识别的引用 */
  references: Reference[];
  /** 整体置信度 */
  confidence: number;
}

/**
 * 指代消解模式
 */
export interface ReferencePattern {
  /** 模式名称 */
  name: string;
  /** 正则表达式 */
  pattern: RegExp;
  /** 引用类型 */
  type: 'option_index' | 'option_label' | 'option_anaphora' | 'task_reference' | 'topic_reference';
  /** 优先级 */
  priority: number;
}

// ============ 对话图谱 ============

/**
 * 对话图谱
 * 用于维护话题之间的关系
 */
export interface ConversationGraph {
  /** 节点 */
  nodes: Map<string, TopicNode>;
  /** 边 */
  edges: TopicEdge[];
}

/**
 * 话题节点
 */
export interface TopicNode {
  /** 节点ID */
  id: string;
  /** 标签 */
  label: string;
  /** 类型 */
  type: 'root' | 'task' | 'question' | 'decision' | 'information';
  /** 内容 */
  content: string;
  /** 创建时间 */
  createdAt: number;
  /** 父节点ID */
  parentId?: string;
  /** 子节点ID列表 */
  childrenIds: string[];
  /** 关联的消息ID */
  messageIds: string[];
}

/**
 * 话题边
 */
export interface TopicEdge {
  /** 起始节点 */
  from: string;
  /** 目标节点 */
  to: string;
  /** 关系类型 */
  type: 'leads_to' | 'refers_to' | 'depends_on' | 'alternative_to';
}

// ============ 工具函数 ============

/**
 * 状态中文翻译
 */
export function translateState(state: ConversationState): string {
  const translations: Record<string, string> = {
    [ConversationState.IDLE]: '空闲',
    [ConversationState.EXPLORING]: '探索需求',
    [ConversationState.CLARIFYING]: '澄清疑问',
    [ConversationState.PROPOSING]: '提供方案',
    [ConversationState.COMPARING]: '对比选项',
    [ConversationState.CONFIRMING]: '等待确认',
    [ConversationState.REFINING]: '调整优化',
    [ConversationState.PLANNING]: '制定计划',
    [ConversationState.EXECUTING]: '执行中',
    [ConversationState.REVIEWING]: '审查结果',
    [ConversationState.COMPLETED]: '已完成',
  };
  return translations[state] || state;
}

/**
 * 意图中文翻译
 */
export function translateIntent(intent: IntentType): string {
  const translations: Record<string, string> = {
    [IntentType.ASK_INFO]: '询问信息',
    [IntentType.CLARIFY]: '澄清需求',
    [IntentType.SELECT_OPTION]: '选择选项',
    [IntentType.CONFIRM]: '确认',
    [IntentType.REJECT]: '拒绝',
    [IntentType.MODIFY]: '修改',
    [IntentType.EXECUTE]: '执行',
    [IntentType.PAUSE]: '暂停',
    [IntentType.RESUME]: '继续',
    [IntentType.CANCEL]: '取消',
    [IntentType.COMPLETE]: '完成',
    [IntentType.REFERENCE]: '引用',
    [IntentType.SWITCH_TOPIC]: '切换话题',
    [IntentType.RETURN_TO]: '回到话题',
    [IntentType.UNKNOWN]: '未知',
  };
  return translations[intent] || intent;
}
