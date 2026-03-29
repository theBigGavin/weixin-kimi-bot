/**
 * Task Router - 分析器
 * 快速规则分析 + 深度 LLM 分析
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

/** 深度分析提示词 */
const DEEP_ANALYSIS_PROMPT = `你是一位任务分析专家。请分析用户请求，评估任务复杂度。

请从以下维度分析（1-10分）：
1. complexity: 整体复杂度
2. duration: 预估耗时（秒）
3. steps: 预估步骤数
4. riskLevel: 风险等级 (low/medium/high)
5. involvesWrite: 是否涉及写操作 (true/false)
6. involvesShell: 是否涉及命令执行 (true/false)
7. domain: 任务领域 (code/refactor/analysis/documentation/testing/deployment/question/conversation/other)
8. requiresPlanning: 是否需要多步骤规划 (true/false)
9. involvesMultipleFiles: 是否涉及多文件 (true/false)

只返回 JSON 格式，不要其他内容：
{
  "complexity": number,
  "estimatedDuration": number,
  "stepCount": number,
  "riskLevel": "low|medium|high",
  "involvesWrite": boolean,
  "involvesShell": boolean,
  "domain": string,
  "requiresPlanning": boolean,
  "involvesMultipleFiles": boolean,
  "reason": "简短分析理由"
}`;

/** 分析器选项 */
export interface AnalyzerOptions {
  /** 是否启用缓存 */
  enableCache?: boolean;
  /** 缓存 TTL（毫秒） */
  cacheTtl?: number;
  /** 是否启用深度分析 */
  useDeepAnalysis?: boolean;
  /** 深度分析函数 */
  deepAnalyzer?: (prompt: string, context: AnalysisContext) => Promise<Partial<TaskAnalysis>>;
}

/**
 * Task 分析器
 */
export class TaskAnalyzer {
  private ruleEngine: RuleEngine;
  private decisionEngine: DecisionEngine;
  private cache: Map<string, AnalysisCacheItem>;
  private options: AnalyzerOptions;
  private config: TaskRouterConfig;

  constructor(
    config: Partial<TaskRouterConfig> = {},
    options: AnalyzerOptions = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.options = {
      enableCache: true,
      cacheTtl: 5 * 60 * 1000, // 5分钟
      useDeepAnalysis: true,
      ...options,
    };
    
    this.ruleEngine = ruleEngine;
    this.decisionEngine = new DecisionEngine(this.config);
    this.cache = new Map();
  }

  /**
   * 分析用户请求
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

    // 快速分析
    const quickAnalysis = this.quickAnalyze(prompt);
    
    // 快速决策
    const quickDecision = this.decisionEngine.decide(quickAnalysis, false);

    // 判断是否需要深度分析
    let finalDecision = quickDecision;
    if (this.options.useDeepAnalysis && 
        this.decisionEngine.needsDeepAnalysis(quickAnalysis, quickDecision.confidence)) {
      
      try {
        const deepAnalysis = await this.deepAnalyze(prompt, context);
        const mergedAnalysis = this.mergeAnalysis(quickAnalysis, deepAnalysis);
        finalDecision = this.decisionEngine.decide(mergedAnalysis, true);
      } catch (error) {
        // 深度分析失败，使用快速分析结果
        console.warn('Deep analysis failed, using quick analysis:', error);
      }
    }

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
    };
  }

  /**
   * 深度 LLM 分析
   */
  private async deepAnalyze(
    prompt: string,
    context: AnalysisContext
  ): Promise<Partial<TaskAnalysis>> {
    // 如果提供了自定义深度分析器，使用它
    if (this.options.deepAnalyzer) {
      return this.options.deepAnalyzer(prompt, context);
    }

    // 默认实现：简单的启发式深度分析（不依赖外部 LLM）
    // 实际项目中可以调用 Kimi CLI 或其他 LLM
    return this.heuristicDeepAnalysis(prompt);
  }

  /**
   * 启发式深度分析（备用方案）
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
   */
  private mergeAnalysis(
    quick: TaskAnalysis,
    deep: Partial<TaskAnalysis>
  ): TaskAnalysis {
    // 深度分析结果优先，但取两者平均值以增加稳定性
    const mergeNumber = (a: number, b: number | undefined, weight: number = 0.6): number => {
      if (b === undefined) return a;
      return Math.round(a * (1 - weight) + b * weight);
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
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): { size: number; maxSize: number; ttl: number } {
    return {
      size: this.cache.size,
      maxSize: 1000,
      ttl: this.options.cacheTtl || 300000,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<TaskRouterConfig>): void {
    this.config = { ...this.config, ...config };
    this.decisionEngine.updateConfig(this.config);
  }

  /**
   * 更新选项
   */
  updateOptions(options: Partial<AnalyzerOptions>): void {
    this.options = { ...this.options, ...options };
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
    cacheHit: boolean;
  }> {
    const cacheKey = this.generateCacheKey(prompt, context);
    const cacheHit = this.getFromCache(cacheKey) !== null;

    const quickAnalysis = this.quickAnalyze(prompt);
    const quickDecision = this.decisionEngine.decide(quickAnalysis, false);

    let usedDeepAnalysis = false;
    let finalDecision = quickDecision;

    if (this.options.useDeepAnalysis && 
        this.decisionEngine.needsDeepAnalysis(quickAnalysis, quickDecision.confidence)) {
      try {
        const deepAnalysis = await this.deepAnalyze(prompt, context);
        const mergedAnalysis = this.mergeAnalysis(quickAnalysis, deepAnalysis);
        finalDecision = this.decisionEngine.decide(mergedAnalysis, true);
        usedDeepAnalysis = true;
      } catch (error) {
        console.warn('Deep analysis failed:', error);
      }
    }

    if (this.options.enableCache && !cacheHit) {
      this.setCache(cacheKey, finalDecision);
    }

    return {
      decision: finalDecision,
      quickAnalysis,
      usedDeepAnalysis,
      cacheHit,
    };
  }
}

// 导出单例
export const taskAnalyzer = new TaskAnalyzer();
