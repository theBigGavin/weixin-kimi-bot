/**
 * Task Router - 智能任务路由系统
 * 
 * 自动分析用户请求并选择最合适的执行模式：
 * - direct: 直接执行（简单、快速任务）
 * - longtask: 耗时任务后台执行（中等复杂度、长时间运行）
 * - flowtask: 流程任务（高复杂度、需要规划和确认）
 * 
 * 工作流程：
 * 1. 接收用户请求
 * 2. 使用 Analyzer 分析任务特征
 * 3. 使用 DecisionEngine 决策执行模式
 * 4. 自动路由到对应的执行器
 * 5. 返回任务句柄和状态
 */

import type { 
  TaskDecision, 
  TaskAnalysis, 
  AnalysisContext, 
  TaskRouterConfig,
  ExecutionMode,
  RouterStats,
} from './types.js';
import { TaskAnalyzer, AnalyzerOptions } from './analyzer.js';
import { DecisionEngine, DEFAULT_CONFIG } from './decision.js';

// LongTask 导入
import { 
  LongTaskManager, 
  getLongTaskManager,
  type LongTask,
  type LongTaskManagerOptions,
  type ProgressInfo as LongTaskProgressInfo,
} from '../longtask/index.js';

// FlowTask 导入
import { 
  FlowTaskManager, 
  getFlowTaskManager,
  type FlowTask,
  type FlowTaskManagerOptions,
  type ProgressInfo as FlowTaskProgressInfo,
  type HumanApprovalRequest,
} from '../flowtask/index.js';

// ============ 类型定义 ============

/** 任务提交输入 */
export interface TaskSubmission {
  /** 用户提示词 */
  prompt: string;
  /** 用户ID */
  userId: string;
  /** 对话ID */
  chatId: string;
  /** 上下文Token */
  contextToken: string;
  /** 工作目录 */
  cwd: string;
  /** 模型名称（可选） */
  model?: string;
  /** 系统提示词（可选） */
  systemPrompt?: string;
}

/** 路由任务结果 */
export interface RoutedTask {
  /** 任务ID */
  taskId: string;
  /** 执行模式 */
  mode: ExecutionMode;
  /** 任务分析结果 */
  analysis: TaskAnalysis;
  /** 决策信息 */
  decision: {
    confidence: number;
    reason: string;
  };
  /** 任务状态 */
  status: string;
  /** 创建时间 */
  createdAt: number;
}

/** 执行结果 */
export interface ExecutionResult {
  success: boolean;
  taskId: string;
  mode: ExecutionMode;
  result?: string;
  error?: string;
}

/** 进度报告 */
export interface ProgressReport {
  taskId: string;
  mode: ExecutionMode;
  step: string;
  percent: number;
  detail?: string;
  timestamp: number;
}

/** 路由选项 */
export interface TaskRouterOptions {
  /** Agent ID */
  agentId: string;
  /** 分析器选项 */
  analyzerOptions?: AnalyzerOptions;
  /** 路由配置 */
  routerConfig?: Partial<TaskRouterConfig>;
  /** LongTask 管理器选项 */
  longtaskOptions?: Partial<LongTaskManagerOptions>;
  /** FlowTask 管理器选项 */
  flowtaskOptions?: Partial<FlowTaskManagerOptions>;
  /** 进度回调 */
  onProgress?: (report: ProgressReport) => Promise<void>;
  /** 完成回调 */
  onComplete?: (result: ExecutionResult) => Promise<void>;
  /** 人工确认回调（仅 FlowTask 使用） */
  onApprovalRequest?: (taskId: string, request: HumanApprovalRequest) => Promise<boolean>;
  /** 是否启用 LLM 分析（覆盖配置中的 useLLM） */
  useLLM?: boolean;
  /** LLM 模型名称 */
  llmModel?: string;
  /** LLM 分析超时时间（毫秒） */
  llmTimeout?: number;
}

/** 任务信息 */
export interface TaskInfo {
  taskId: string;
  mode: ExecutionMode;
  status: string;
  progress: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

// ============ TaskRouter 主类 ============

export class TaskRouter {
  private agentId: string;
  private analyzer: TaskAnalyzer;
  private decisionEngine: DecisionEngine;
  private longtaskManager?: LongTaskManager;
  private flowtaskManager?: FlowTaskManager;
  private options: TaskRouterOptions;
  private stats: RouterStats;

  // 任务映射表：taskId -> { mode, originalTask }
  private taskMap: Map<string, { mode: ExecutionMode; userId: string; chatId: string }> = new Map();

  constructor(options: TaskRouterOptions) {
    this.agentId = options.agentId;
    this.options = options;

    // 构建路由配置（包含 LLM 相关配置）
    const routerConfig: Partial<TaskRouterConfig> = {
      ...options.routerConfig,
    };
    
    // 如果提供了 LLM 相关选项，覆盖配置
    if (options.useLLM !== undefined) {
      routerConfig.useLLM = options.useLLM;
    }
    if (options.llmModel) {
      routerConfig.llmModel = options.llmModel;
    }
    if (options.llmTimeout) {
      routerConfig.llmTimeout = options.llmTimeout;
    }

    // 构建分析器选项
    const analyzerOptions: AnalyzerOptions = {
      ...options.analyzerOptions,
    };
    
    // 同步 LLM 配置到分析器选项
    if (options.useLLM !== undefined) {
      analyzerOptions.useLLM = options.useLLM;
    }
    if (options.llmModel) {
      analyzerOptions.llmOptions = {
        ...analyzerOptions.llmOptions,
        model: options.llmModel,
      };
    }
    if (options.llmTimeout) {
      analyzerOptions.llmTimeout = options.llmTimeout;
      analyzerOptions.llmOptions = {
        ...analyzerOptions.llmOptions,
        timeout: options.llmTimeout,
      };
    }

    // 初始化分析器和决策引擎
    this.analyzer = new TaskAnalyzer(routerConfig, analyzerOptions);
    this.decisionEngine = new DecisionEngine({ ...DEFAULT_CONFIG, ...routerConfig });

    // 初始化统计
    this.stats = {
      totalAnalyzed: 0,
      directCount: 0,
      longtaskCount: 0,
      flowtaskCount: 0,
      deepAnalysisCount: 0,
      averageAnalysisTime: 0,
      cacheHitRate: 0,
    };
  }

  /**
   * 初始化 TaskRouter
   * 初始化 LongTask 和 FlowTask 管理器
   */
  async initialize(): Promise<void> {
    // 初始化 LongTask 管理器
    this.longtaskManager = await getLongTaskManager(this.agentId, {
      maxConcurrency: 4,
      reportIntervalMs: 30_000,
      onProgress: async (task, progress) => {
        this.taskMap.set(task.id, { 
          mode: 'longtask', 
          userId: task.userId, 
          chatId: task.chatId 
        });
        await this.options.onProgress?.({
          taskId: task.id,
          mode: 'longtask',
          step: progress.step,
          percent: progress.percent,
          detail: progress.detail,
          timestamp: progress.timestamp,
        });
      },
      onComplete: async (task) => {
        await this.options.onComplete?.({
          success: task.status === 'completed',
          taskId: task.id,
          mode: 'longtask',
          result: task.result,
          error: task.error,
        });
      },
      onCancel: async () => {},
      ...this.options.longtaskOptions,
    });

    // 初始化 FlowTask 管理器
    this.flowtaskManager = await getFlowTaskManager(this.agentId, {
      maxConcurrency: 2,
      reportIntervalMs: 30_000,
      onProgress: async (task, progress) => {
        this.taskMap.set(task.id, { 
          mode: 'flowtask', 
          userId: task.userId, 
          chatId: task.chatId 
        });
        await this.options.onProgress?.({
          taskId: task.id,
          mode: 'flowtask',
          step: progress.step,
          percent: progress.percent,
          detail: progress.detail,
          timestamp: progress.timestamp,
        });
      },
      onComplete: async (task) => {
        await this.options.onComplete?.({
          success: task.status === 'completed',
          taskId: task.id,
          mode: 'flowtask',
          result: task.result,
          error: task.error,
        });
      },
      onCancel: async () => {},
      onApprovalRequest: async (task, request) => {
        const result = await this.options.onApprovalRequest?.(task.id, request);
        return result ?? false;
      },
      autoApproveLowRisk: false,
      ...this.options.flowtaskOptions,
    });

    console.log(`[TaskRouter] 初始化完成，Agent: ${this.agentId}`);
  }

  /**
   * 关闭 TaskRouter
   */
  async close(): Promise<void> {
    await this.longtaskManager?.close();
    // FlowTask 管理器如果有 close 方法也需要调用
    console.log('[TaskRouter] 已关闭');
  }

  /**
   * 分析并执行任务
   * 
   * 核心流程：
   * 1. 分析任务特征
   * 2. 决策执行模式
   * 3. 路由到对应执行器
   * 4. 返回任务句柄
   */
  async analyzeAndExecute(
    submission: TaskSubmission,
    forceMode?: ExecutionMode
  ): Promise<RoutedTask> {
    const startTime = Date.now();

    // 构建分析上下文
    const context: AnalysisContext = {
      userId: submission.userId,
      chatId: submission.chatId,
      cwd: submission.cwd,
    };

    // 分析任务
    const decision = await this.analyzer.analyze(submission.prompt, context);
    
    // 更新统计
    this.updateStats(Date.now() - startTime);

    // 确定执行模式
    const mode = forceMode || decision.mode;

    // 根据模式执行任务
    let taskId: string;
    let status: string;

    switch (mode) {
      case 'direct':
        // 直接执行模式 - 在当前上下文执行（同步返回）
        taskId = `direct_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        status = 'direct';
        // 注意：直接执行需要调用方处理
        break;

      case 'longtask':
        // LongTask 模式 - 后台执行
        if (!this.longtaskManager) {
          throw new Error('LongTask 管理器未初始化');
        }
        const longTask = this.longtaskManager.submit({
          agentId: this.agentId,
          userId: submission.userId,
          chatId: submission.chatId,
          contextToken: submission.contextToken,
          prompt: submission.prompt,
          cwd: submission.cwd,
          model: submission.model || 'default',
          systemPrompt: submission.systemPrompt,
          maxTurns: decision.config.longtask?.maxTurns || 30,
        });
        taskId = longTask.id;
        status = longTask.status;
        this.taskMap.set(taskId, { mode: 'longtask', userId: submission.userId, chatId: submission.chatId });
        this.stats.longtaskCount++;
        break;

      case 'flowtask':
        // FlowTask 模式 - 结构化流程执行
        if (!this.flowtaskManager) {
          throw new Error('FlowTask 管理器未初始化');
        }
        const flowTask = await this.flowtaskManager.submit({
          agentId: this.agentId,
          userId: submission.userId,
          chatId: submission.chatId,
          contextToken: submission.contextToken,
          prompt: submission.prompt,
          cwd: submission.cwd,
          model: submission.model || 'default',
          systemPrompt: submission.systemPrompt,
        });
        taskId = flowTask.id;
        status = flowTask.status;
        this.taskMap.set(taskId, { mode: 'flowtask', userId: submission.userId, chatId: submission.chatId });
        this.stats.flowtaskCount++;
        break;

      default:
        throw new Error(`未知的执行模式: ${mode}`);
    }

    return {
      taskId,
      mode,
      analysis: decision.analysis,
      decision: {
        confidence: decision.confidence,
        reason: decision.reason,
      },
      status,
      createdAt: Date.now(),
    };
  }

  /**
   * 仅分析任务（不执行）
   * 用于预览分析结果
   */
  async analyzeOnly(submission: TaskSubmission): Promise<TaskDecision> {
    const context: AnalysisContext = {
      userId: submission.userId,
      chatId: submission.chatId,
      cwd: submission.cwd,
    };

    return this.analyzer.analyze(submission.prompt, context);
  }

  /**
   * 获取详细分析（用于调试）
   */
  async analyzeDetailed(submission: TaskSubmission): Promise<{
    decision: TaskDecision;
    quickAnalysis: TaskAnalysis;
    usedDeepAnalysis: boolean;
    cacheHit: boolean;
  }> {
    const context: AnalysisContext = {
      userId: submission.userId,
      chatId: submission.chatId,
      cwd: submission.cwd,
    };

    return this.analyzer.analyzeDetailed(submission.prompt, context);
  }

  /**
   * 取消任务
   */
  async cancel(taskId: string): Promise<boolean> {
    const taskInfo = this.taskMap.get(taskId);
    if (!taskInfo) {
      return false;
    }

    switch (taskInfo.mode) {
      case 'longtask':
        return this.longtaskManager?.cancel(taskId) ?? false;
      case 'flowtask':
        return this.flowtaskManager?.cancel(taskId) ?? false;
      default:
        return false;
    }
  }

  /**
   * 获取任务状态
   */
  getTaskStatus(taskId: string): TaskInfo | undefined {
    const taskInfo = this.taskMap.get(taskId);
    if (!taskInfo) {
      return undefined;
    }

    let task: LongTask | FlowTask | undefined;
    if (taskInfo.mode === 'longtask') {
      task = this.longtaskManager?.getTask(taskId);
    } else if (taskInfo.mode === 'flowtask') {
      task = this.flowtaskManager?.getTask(taskId);
    }

    if (!task) {
      return undefined;
    }

    const lastProgress = task.progressLogs[task.progressLogs.length - 1];

    return {
      taskId,
      mode: taskInfo.mode,
      status: task.status,
      progress: lastProgress?.percent ?? 0,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    };
  }

  /**
   * 获取用户的所有任务
   */
  getUserTasks(userId: string): TaskInfo[] {
    const tasks: TaskInfo[] = [];

    // LongTask
    const longTasks = this.longtaskManager?.getUserTasks(userId) ?? [];
    for (const task of longTasks) {
      const lastProgress = task.progressLogs[task.progressLogs.length - 1];
      tasks.push({
        taskId: task.id,
        mode: 'longtask',
        status: task.status,
        progress: lastProgress?.percent ?? 0,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
      });
    }

    // FlowTask
    const flowTasks = this.flowtaskManager?.getUserTasks(userId) ?? [];
    for (const task of flowTasks) {
      const lastProgress = task.progressLogs[task.progressLogs.length - 1];
      tasks.push({
        taskId: task.id,
        mode: 'flowtask',
        status: task.status,
        progress: lastProgress?.percent ?? 0,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
      });
    }

    return tasks.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 获取活跃任务
   */
  getActiveTasks(): TaskInfo[] {
    const tasks: TaskInfo[] = [];

    const longTasks = this.longtaskManager?.getActiveTasks() ?? [];
    for (const task of longTasks) {
      const lastProgress = task.progressLogs[task.progressLogs.length - 1];
      tasks.push({
        taskId: task.id,
        mode: 'longtask',
        status: task.status,
        progress: lastProgress?.percent ?? 0,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
      });
    }

    return tasks;
  }

  /**
   * 获取统计信息
   */
  getStats(): RouterStats {
    return { ...this.stats };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<TaskRouterConfig>): void {
    this.analyzer.updateConfig(config);
    this.decisionEngine.updateConfig({ ...DEFAULT_CONFIG, ...config });
    
    // 同步更新选项中的 LLM 配置
    if (config.useLLM !== undefined) {
      this.options.useLLM = config.useLLM;
    }
    if (config.llmModel) {
      this.options.llmModel = config.llmModel;
    }
    if (config.llmTimeout) {
      this.options.llmTimeout = config.llmTimeout;
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.analyzer.clearCache();
  }

  // ============ 私有方法 ============

  private updateStats(analysisTime: number): void {
    this.stats.totalAnalyzed++;
    
    // 更新平均分析时间
    const totalTime = this.stats.averageAnalysisTime * (this.stats.totalAnalyzed - 1) + analysisTime;
    this.stats.averageAnalysisTime = Math.round(totalTime / this.stats.totalAnalyzed);

    // 更新缓存命中率（从分析器获取）
    const cacheStats = this.analyzer.getCacheStats();
    this.stats.cacheHitRate = cacheStats.size > 0 ? cacheStats.size / 1000 : 0;
  }
}

// ============ 单例管理 ============

const routers: Map<string, TaskRouter> = new Map();

/**
 * 获取或创建 TaskRouter 实例
 */
export async function getTaskRouter(options: TaskRouterOptions): Promise<TaskRouter> {
  if (!routers.has(options.agentId)) {
    const router = new TaskRouter(options);
    await router.initialize();
    routers.set(options.agentId, router);
  }
  return routers.get(options.agentId)!;
}

/**
 * 获取已存在的 TaskRouter 实例
 */
export function getTaskRouterSync(agentId: string): TaskRouter | undefined {
  return routers.get(agentId);
}

// ============ 便捷函数 ============

/**
 * 快速分析并执行
 */
export async function routeTask(
  agentId: string,
  submission: TaskSubmission,
  options?: Omit<TaskRouterOptions, 'agentId'>,
  forceMode?: ExecutionMode
): Promise<RoutedTask> {
  const router = await getTaskRouter({ agentId, ...options });
  return router.analyzeAndExecute(submission, forceMode);
}

/**
 * 快速分析（仅分析不执行）
 */
export async function analyzeTask(
  agentId: string,
  submission: TaskSubmission,
  options?: Omit<TaskRouterOptions, 'agentId'>
): Promise<TaskDecision> {
  const router = await getTaskRouter({ agentId, ...options });
  return router.analyzeOnly(submission);
}

// ============ 类型导出 ============

export type {
  TaskDecision,
  TaskAnalysis,
  AnalysisContext,
  TaskRouterConfig,
  ExecutionMode,
  RouterStats,
  TaskExecutionConfig,
  UserPreferences,
} from './types.js';

export { TaskAnalyzer } from './analyzer.js';
export { DecisionEngine, DEFAULT_CONFIG } from './decision.js';
export { ruleEngine, RuleEngine } from './rules.js';
export { 
  LLMTaskAnalyzer, 
  type LLMAnalysisResult, 
  type LLMAnalyzerOptions 
} from './llm-analyzer.js';

// 版本信息
export const VERSION = '1.1.0';
