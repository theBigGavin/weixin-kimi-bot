/**
 * Task Router - 分析器
 * 快速规则分析 + LLM 深度分析
 */

import { createHash } from 'crypto';
import {
  TaskAnalysis,
  TaskDecision,
  AnalysisContext,
  AnalysisCacheItem,
  TaskRouterConfig,
  ExecutionMode,
} from './types.js';
import { ruleEngine, RuleEngine } from './rules.js';
import { decisionEngine, DecisionEngine, DEFAULT_CONFIG } from './decision.js';
import { LLMTaskAnalyzer, LLMAnalyzerOptions } from './llm-analyzer.js';

/** 分析器选项 */
export interface AnalyzerOptions {
  /** 是否启用缓存 */
  enableCache?: boolean;
  /** 缓存 TTL（毫秒） */
  cacheTtl?: number;
  /** 是否启用深度分析 */
  useDeepAnalysis?: boolean;
  /** 深度分析函数（可选，用于自定义分析） */
  deepAnalyzer?: ((prompt: string, context: AnalysisContext) => Promise<Partial<TaskAnalysis>>) | null;
  /** 是否启用 LLM 深度分析 */
  useLLM?: boolean;
  /** LLM 分析器选项 */
  llmOptions?: LLMAnalyzerOptions;
  /** LLM 分析超时时间（毫秒） */
  llmTimeout?: number;
}

/**
 * Task 分析器
 */
export class TaskAnalyzer {
  private ruleEngine: RuleEngine;
  private decisionEngine: DecisionEngine;
  private cache: Map<string, AnalysisCacheItem>;
  private options: Required<AnalyzerOptions>;
  private config: TaskRouterConfig;
  private llmAnalyzer?: LLMTaskAnalyzer;

  constructor(
    config: Partial<TaskRouterConfig> = {},
    options: AnalyzerOptions = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.options = {
      enableCache: true,
      cacheTtl: 5 * 60 * 1000, // 5分钟
      useDeepAnalysis: true,
      deepAnalyzer: null,
      useLLM: this.config.useLLM,
      llmOptions: {
        model: this.config.llmModel,
        timeout: this.config.llmTimeout,
        enableCache: true,
        cacheTtl: 5 * 60 * 1000,
        includeReasoning: true,
        includeSubtasks: true,
      },
      llmTimeout: this.config.llmTimeout,
      ...options,
    };

    this.ruleEngine = ruleEngine;
    this.decisionEngine = new DecisionEngine(this.config);
    this.cache = new Map();

    // 初始化 LLM 分析器（如果启用）
    if (this.options.useLLM) {
      this.llmAnalyzer = new LLMTaskAnalyzer(this.options.llmOptions);
    }
  }

  /**
   * 分析用户请求
   * 
   * 分析流程：
   * 1. 检查缓存
   * 2. 快速规则分析
   * 3. 快速决策
   * 4. 判断是否需要深度/LLM分析
   * 5. 合并分析结果
   * 6. 最终决策
   * 7. 缓存结果
   */
  async analyze(
    prompt: string,
    context: AnalysisContext
  ): Promise<TaskDecision> {
    const cacheKey = this.generateCacheKey(prompt, context);

    // 检查缓存
    if (this.options.enableCache) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // 快速规则分析
    const quickAnalysis = this.quickAnalyze(prompt);

    // 快速决策
    const quickDecision = this.decisionEngine.decide(quickAnalysis, false);

    // 判断是否需要深度分析
    let finalDecision = quickDecision;
    let usedDeepAnalysis = false;
    let analysisSource: 'rule' | 'llm' | 'hybrid' = 'rule';

    if (this.options.useDeepAnalysis &&
      this.decisionEngine.needsDeepAnalysis(quickAnalysis, quickDecision.confidence)) {

      try {
        // 尝试深度分析
        const deepAnalysis = await this.deepAnalyze(prompt, context);
        const mergedAnalysis = this.mergeAnalysis(quickAnalysis, deepAnalysis);
        finalDecision = this.decisionEngine.decide(mergedAnalysis, true);
        usedDeepAnalysis = true;

        // 判断分析来源
        if (this.options.useLLM && this.llmAnalyzer) {
          analysisSource = 'llm';
        } else if (this.options.deepAnalyzer != null) {
          analysisSource = 'hybrid';
        } else {
          analysisSource = 'hybrid';
        }
      } catch (error) {
        // 深度分析失败，使用快速分析结果
        console.warn('[TaskAnalyzer] 深度分析失败，使用快速分析:', error);
      }
    }

    // 更新分析来源
    finalDecision.analysis.analysisSource = analysisSource;

    // 缓存结果
    if (this.options.enableCache) {
      this.setCache(cacheKey, finalDecision);
    }

    return finalDecision;
  }

  /**
   * 快速规则分析
   */
  quickAnalyze(prompt: string): TaskAnalysis {
    const matches = this.ruleEngine.analyze(prompt);
    const partial = this.ruleEngine.generateAnalysis(prompt, matches);

    return {
      complexity: partial.complexity || 3,
      estimatedDuration: partial.estimatedDuration || 30,
      stepCount: partial.stepCount || 1,
      requiresPlanning: partial.requiresPlanning || false,
      riskLevel: partial.riskLevel || 'low',
      involvesWrite: partial.involvesWrite || false,
      involvesShell: partial.involvesShell || false,
      domain: partial.domain || 'other',
      keywords: partial.keywords || [],
      involvesMultipleFiles: partial.involvesMultipleFiles || false,
      requiresWebSearch: partial.requiresWebSearch || false,
      analysisSource: 'rule',
    };
  }

  /**
   * 深度分析
   * 
   * 优先顺序：
   * 1. 自定义深度分析器（如果提供）
   * 2. LLM 分析器（如果启用）
   * 3. 启发式深度分析（默认回退）
   */
  private async deepAnalyze(
    prompt: string,
    context: AnalysisContext
  ): Promise<Partial<TaskAnalysis>> {
    // 1. 如果提供了自定义深度分析器，使用它
    if (this.options.deepAnalyzer) {
      return this.options.deepAnalyzer(prompt, context);
    }

    // 2. 如果启用了 LLM 分析，使用 LLM
    if (this.options.useLLM && this.llmAnalyzer) {
      try {
        const llmResult = await this.llmAnalyzer.analyze(prompt, context);
        return this.convertLLMResult(llmResult);
      } catch (error) {
        console.warn('[TaskAnalyzer] LLM 分析失败，回退到启发式分析:', error);
        // LLM 失败时继续到启发式分析
      }
    }

    // 3. 默认使用启发式深度分析
    return this.heuristicDeepAnalysis(prompt);
  }

  /**
   * 将 LLM 分析结果转换为 TaskAnalysis 格式
   */
  private convertLLMResult(llmResult: import('./llm-analyzer.js').LLMAnalysisResult): Partial<TaskAnalysis> {
    return {
      complexity: llmResult.complexity,
      estimatedDuration: llmResult.estimatedDuration,
      stepCount: llmResult.stepCount,
      requiresPlanning: llmResult.requiresPlanning,
      riskLevel: llmResult.riskLevel,
      involvesWrite: llmResult.involvesWrite,
      involvesShell: llmResult.involvesShell,
      domain: llmResult.domain,
      involvesMultipleFiles: llmResult.involvesMultipleFiles,
      requiresWebSearch: llmResult.requiresWebSearch,
      llmReasoning: llmResult.reasoning,
      suggestedSubtasks: llmResult.suggestedSubtasks,
    };
  }

  /**
   * 启发式深度分析（备用方案）
   * 
   * 当 LLM 不可用时使用，基于更多上下文线索进行分析
   */
  private heuristicDeepAnalysis(prompt: string): Partial<TaskAnalysis> {
    const analysis: Partial<TaskAnalysis> = {};
    const lowerPrompt = prompt.toLowerCase();

    // 基于更多上下文线索的分析
    const codeBlocks = (prompt.match(/```[\s\S]*?```/g) || []).length;
    const lines = prompt.split('\n').length;
    const chars = prompt.length;

    // 代码块分析
    if (codeBlocks > 0) {
      analysis.complexity = Math.min(10, 3 + codeBlocks * 2);
    }

    // 长度分析
    if (chars > 1000) {
      analysis.estimatedDuration = Math.max(analysis.estimatedDuration || 0, 120);
    }

    // 文件路径数量
    const filePaths = prompt.match(/[\w\-./]+\.(ts|js|json|md|py|java|go|rs|vue|tsx|jsx)/gi) || [];
    if (filePaths.length > 3) {
      analysis.involvesMultipleFiles = true;
      analysis.complexity = Math.min(10, (analysis.complexity || 3) + Math.floor(filePaths.length / 2));
    }

    // 特定关键词深度分析
    const planningKeywords = ['plan', 'step', 'phase', 'stage', '设计', '规划', '步骤'];
    const planningMatches = planningKeywords.filter(k => lowerPrompt.includes(k)).length;
    if (planningMatches >= 2) {
      analysis.requiresPlanning = true;
      analysis.stepCount = Math.max(analysis.stepCount || 0, 5);
    }

    // 风险关键词深度分析
    const highRiskPatterns = [
      /删除.*所有|清空.*数据库|drop.*table/i,
      /修改.*生产环境|修改.*线上配置/i,
      /rm -rf.*\/|rm -rf \.\//i,
    ];
    for (const pattern of highRiskPatterns) {
      if (pattern.test(prompt)) {
        analysis.riskLevel = 'high';
        break;
      }
    }

    return analysis;
  }

  /**
   * 合并快速分析和深度分析结果
   * 
   * 策略：深度分析结果优先，但取加权平均值以增加稳定性
   */
  private mergeAnalysis(
    quick: TaskAnalysis,
    deep: Partial<TaskAnalysis>
  ): TaskAnalysis {
    // 深度分析权重（可根据需要调整）
    const DEEP_WEIGHT = 0.6;
    const QUICK_WEIGHT = 0.4;

    const mergeNumber = (quickVal: number, deepVal: number | undefined): number => {
      if (deepVal === undefined) return quickVal;
      return Math.round(quickVal * QUICK_WEIGHT + deepVal * DEEP_WEIGHT);
    };

    return {
      complexity: mergeNumber(quick.complexity, deep.complexity),
      estimatedDuration: mergeNumber(quick.estimatedDuration, deep.estimatedDuration),
      stepCount: mergeNumber(quick.stepCount, deep.stepCount),
      requiresPlanning: deep.requiresPlanning ?? quick.requiresPlanning,
      riskLevel: deep.riskLevel || quick.riskLevel,
      involvesWrite: deep.involvesWrite ?? quick.involvesWrite,
      involvesShell: deep.involvesShell ?? quick.involvesShell,
      domain: deep.domain || quick.domain,
      keywords: quick.keywords, // 保持快速分析的关键词
      involvesMultipleFiles: deep.involvesMultipleFiles ?? quick.involvesMultipleFiles,
      requiresWebSearch: quick.requiresWebSearch, // 保持快速分析的结果
      llmReasoning: deep.llmReasoning,
      suggestedSubtasks: deep.suggestedSubtasks,
      analysisSource: 'hybrid',
    };
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(prompt: string, context: AnalysisContext): string {
    const normalized = prompt.trim().toLowerCase().replace(/\s+/g, ' ');
    const contextStr = `${context.userId}:${context.chatId}`;
    return createHash('md5').update(`${contextStr}:${normalized}`).digest('hex');
  }

  /**
   * 从缓存获取
   */
  private getFromCache(key: string): TaskDecision | null {
    const item = this.cache.get(key);
    if (!item) return null;

    const now = Date.now();
    if (now - item.timestamp > (this.options.cacheTtl || 300000)) {
      this.cache.delete(key);
      return null;
    }

    return item.decision;
  }

  /**
   * 设置缓存
   */
  private setCache(key: string, decision: TaskDecision): void {
    // 清理过期缓存
    this.cleanExpiredCache();

    this.cache.set(key, {
      key,
      decision,
      timestamp: Date.now(),
    });

    // 限制缓存大小
    if (this.cache.size > 1000) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
  }

  /**
   * 清理过期缓存
   */
  private cleanExpiredCache(): void {
    const now = Date.now();
    const ttl = this.options.cacheTtl || 300000;

    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > ttl) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 清除所有缓存
   */
  clearCache(): void {
    this.cache.clear();
    this.llmAnalyzer?.clearCache();
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): { size: number; maxSize: number; ttl: number } {
    const llmStats = this.llmAnalyzer?.getCacheStats();
    return {
      size: this.cache.size + (llmStats?.size || 0),
      maxSize: 1000 + (llmStats?.maxSize || 0),
      ttl: this.options.cacheTtl || 300000,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<TaskRouterConfig>): void {
    this.config = { ...this.config, ...config };
    this.decisionEngine.updateConfig(this.config);

    // 更新 LLM 分析器配置
    if (this.llmAnalyzer && (config.llmModel || config.llmTimeout)) {
      this.llmAnalyzer.updateOptions({
        model: config.llmModel,
        timeout: config.llmTimeout,
      });
    }
  }

  /**
   * 更新选项
   */
  updateOptions(options: Partial<AnalyzerOptions>): void {
    this.options = { ...this.options, ...options };

    // 如果启用了 LLM 但未初始化，则初始化
    if (this.options.useLLM && !this.llmAnalyzer) {
      this.llmAnalyzer = new LLMTaskAnalyzer(this.options.llmOptions);
    }
  }

  /**
   * 分析并返回详细信息（用于调试）
   */
  async analyzeDetailed(
    prompt: string,
    context: AnalysisContext
  ): Promise<{
    decision: TaskDecision;
    quickAnalysis: TaskAnalysis;
    usedDeepAnalysis: boolean;
    usedLLM: boolean;
    cacheHit: boolean;
    analysisSource: 'rule' | 'llm' | 'hybrid';
  }> {
    const cacheKey = this.generateCacheKey(prompt, context);
    const cacheHit = this.getFromCache(cacheKey) !== null;

    const quickAnalysis = this.quickAnalyze(prompt);
    const quickDecision = this.decisionEngine.decide(quickAnalysis, false);

    let usedDeepAnalysis = false;
    let usedLLM = false;
    let finalDecision = quickDecision;
    let analysisSource: 'rule' | 'llm' | 'hybrid' = 'rule';

    if (this.options.useDeepAnalysis &&
      this.decisionEngine.needsDeepAnalysis(quickAnalysis, quickDecision.confidence)) {
      try {
        // 检查是否会使用 LLM
        if (this.options.useLLM && this.llmAnalyzer && !this.options.deepAnalyzer) {
          usedLLM = true;
        }

        const deepAnalysis = await this.deepAnalyze(prompt, context);
        const mergedAnalysis = this.mergeAnalysis(quickAnalysis, deepAnalysis);
        finalDecision = this.decisionEngine.decide(mergedAnalysis, true);
        usedDeepAnalysis = true;

        // 确定分析来源
        if (usedLLM) {
          analysisSource = 'llm';
        } else if (this.options.deepAnalyzer != null) {
          analysisSource = 'hybrid';
        } else {
          analysisSource = 'hybrid';
        }
      } catch (error) {
        console.warn('[TaskAnalyzer] 深度分析失败:', error);
      }
    }

    finalDecision.analysis.analysisSource = analysisSource;

    if (this.options.enableCache && !cacheHit) {
      this.setCache(cacheKey, finalDecision);
    }

    return {
      decision: finalDecision,
      quickAnalysis,
      usedDeepAnalysis,
      usedLLM,
      cacheHit,
      analysisSource,
    };
  }

  /**
   * 获取 LLM 分析器实例（用于直接调用）
   */
  getLLMAnalyzer(): LLMTaskAnalyzer | undefined {
    return this.llmAnalyzer;
  }
}

// 导出单例
export const taskAnalyzer = new TaskAnalyzer();
