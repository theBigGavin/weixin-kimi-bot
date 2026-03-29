/**
 * Task Router - 任务路由分析系统类型定义
 * 自动分析用户内容并选择最合适的执行模式
 */

/** 执行模式 */
export type ExecutionMode = 'direct' | 'longtask' | 'flowtask';

/** 风险等级 */
export type RiskLevel = 'low' | 'medium' | 'high';

/** 任务领域 */
export type TaskDomain = 
  | 'code'           // 代码相关
  | 'refactor'       // 重构
  | 'analysis'       // 分析
  | 'documentation'  // 文档
  | 'configuration'  // 配置
  | 'testing'        // 测试
  | 'deployment'     // 部署
  | 'question'       // 问答
  | 'conversation'   // 对话
  | 'other';         // 其他

/** 任务分析结果 */
export interface TaskAnalysis {
  /** 复杂度评分 1-10 */
  complexity: number;
  /** 预估执行时间（秒） */
  estimatedDuration: number;
  /** 预估步骤数 */
  stepCount: number;
  /** 是否需要多步骤规划 */
  requiresPlanning: boolean;
  /** 风险等级 */
  riskLevel: RiskLevel;
  /** 是否涉及文件写操作 */
  involvesWrite: boolean;
  /** 是否涉及系统命令 */
  involvesShell: boolean;
  /** 任务领域 */
  domain: TaskDomain;
  /** 提取的关键词 */
  keywords: string[];
  /** 是否涉及多文件 */
  involvesMultipleFiles: boolean;
  /** 是否需要网络搜索 */
  requiresWebSearch: boolean;
}

/** 执行决策 */
export interface TaskDecision {
  /** 选择的执行模式 */
  mode: ExecutionMode;
  /** 决策置信度 0-1 */
  confidence: number;
  /** 决策理由 */
  reason: string;
  /** 详细分析结果 */
  analysis: TaskAnalysis;
  /** 执行配置 */
  config: TaskExecutionConfig;
}

/** 任务执行配置 */
export interface TaskExecutionConfig {
  /** LongTask 配置 */
  longtask?: {
    /** 优先级 1-10 */
    priority?: number;
    /** 最大交互轮数 */
    maxTurns?: number;
    /** 是否自动重试 */
    autoRetry?: boolean;
  };
  /** FlowTask 配置 */
  flowtask?: {
    /** 是否自动批准低风险步骤 */
    autoApproveLowRisk?: boolean;
    /** 是否需要检查点 */
    requireCheckpoint?: boolean;
    /** 最大步骤数限制 */
    maxSteps?: number;
    /** 是否允许自动拆分 */
    allowSplitting?: boolean;
  };
  /** 直接执行配置 */
  direct?: {
    /** 超时时间（秒） */
    timeout?: number;
    /** 是否启用工具调用 */
    enableTools?: boolean;
  };
}

/** 规则匹配结果 */
export interface RuleMatch {
  /** 匹配的规则名 */
  rule: string;
  /** 匹配得分 */
  score: number;
  /** 匹配的关键要素 */
  matchedElements: string[];
}

/** 分析上下文 */
export interface AnalysisContext {
  /** 用户ID */
  userId: string;
  /** 对话ID */
  chatId: string;
  /** 当前工作目录 */
  cwd: string;
  /** 历史消息（可选） */
  history?: string[];
  /** 用户偏好（可选） */
  preferences?: UserPreferences;
}

/** 用户偏好 */
export interface UserPreferences {
  /** 默认执行模式 */
  defaultMode?: ExecutionMode;
  /** 是否总是询问 */
  alwaysAsk?: boolean;
  /** 风险阈值 */
  riskThreshold?: RiskLevel;
  /** 是否偏好后台执行 */
  preferBackground?: boolean;
}

/** Task Router 配置 */
export interface TaskRouterConfig {
  /** 复杂度阈值 */
  complexityThreshold: {
    /** 直接执行上限（含） */
    direct: number;
    /** LongTask 上限（含），超过则使用 FlowTask */
    longtask: number;
  };
  /** 耗时阈值（秒） */
  durationThreshold: {
    /** 直接执行上限 */
    direct: number;
    /** LongTask 上限 */
    longtask: number;
  };
  /** 步骤数阈值 */
  stepThreshold: {
    /** 直接执行上限 */
    direct: number;
    /** LongTask 上限 */
    longtask: number;
  };
  /** 是否启用深度分析 */
  useDeepAnalysis: boolean;
  /** 深度分析触发阈值（置信度低于此值时触发） */
  deepAnalysisThreshold: number;
  /** 默认执行模式（当分析不确定时） */
  defaultMode: ExecutionMode;
  /** 是否启用缓存 */
  enableCache: boolean;
  /** 缓存有效期（毫秒） */
  cacheTtl: number;
}

/** 分析缓存项 */
export interface AnalysisCacheItem {
  /** 缓存键（prompt 哈希） */
  key: string;
  /** 分析结果 */
  decision: TaskDecision;
  /** 缓存时间 */
  timestamp: number;
}

/** 路由统计信息 */
export interface RouterStats {
  /** 总分析次数 */
  totalAnalyzed: number;
  /** 直接执行次数 */
  directCount: number;
  /** LongTask 次数 */
  longtaskCount: number;
  /** FlowTask 次数 */
  flowtaskCount: number;
  /** 深度分析次数 */
  deepAnalysisCount: number;
  /** 平均分析时间（毫秒） */
  averageAnalysisTime: number;
  /** 缓存命中率 */
  cacheHitRate: number;
}
