/**
 * Task Router - 基于 LLM 的任务复杂度分析器
 * 
 * 功能：
 * - 使用 LLM 深度分析任务复杂度
 * - 提供更准确的执行模式推荐
 * - 支持任务拆分建议
 * - 智能理解用户意图和上下文
 */

import { createHash } from 'crypto';
import { askKimi } from '../kimi/handler.js';
import type { AnalysisContext, TaskDomain, RiskLevel } from './types.js';

/** LLM 分析器选项 */
export interface LLMAnalyzerOptions {
  /** LLM 模型名称 */
  model?: string;
  /** 分析超时时间（毫秒） */
  timeout?: number;
  /** 是否启用分析缓存 */
  enableCache?: boolean;
  /** 缓存 TTL（毫秒） */
  cacheTtl?: number;
  /** 是否返回分析推理过程 */
  includeReasoning?: boolean;
  /** 是否返回子任务建议 */
  includeSubtasks?: boolean;
}

/** LLM 分析结果 */
export interface LLMAnalysisResult {
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
  /** 是否涉及多文件 */
  involvesMultipleFiles: boolean;
  /** 是否需要网络搜索 */
  requiresWebSearch: boolean;
  /** 分析推理过程 */
  reasoning?: string;
  /** 建议的子任务列表（用于复杂任务拆分） */
  suggestedSubtasks?: string[];
  /** 置信度 0-1 */
  confidence: number;
}

/** 缓存项 */
interface CacheItem {
  key: string;
  result: LLMAnalysisResult;
  timestamp: number;
}

/** 缓存统计 */
interface CacheStats {
  size: number;
  maxSize: number;
  ttl: number;
}

/** 默认选项 */
const DEFAULT_OPTIONS: Required<LLMAnalyzerOptions> = {
  model: 'kimi-code/kimi-for-coding',
  timeout: 30000,
  enableCache: true,
  cacheTtl: 5 * 60 * 1000, // 5分钟
  includeReasoning: true,
  includeSubtasks: true,
};

/** 复杂度分析提示词 */
const COMPLEXITY_ANALYSIS_PROMPT = `你是一位专业的软件开发任务复杂度分析专家。请仔细分析用户的任务请求，评估其复杂度并给出执行建议。

## 分析维度

请从以下维度评估任务（返回 JSON 格式）：

1. **complexity** (number 1-10): 整体复杂度评分
   - 1-3: 简单任务（直接回答、简单修改）
   - 4-6: 中等任务（需要多步操作但逻辑清晰）
   - 7-8: 复杂任务（需要规划、涉及多文件）
   - 9-10: 非常复杂（大型重构、系统架构设计）

2. **estimatedDuration** (number): 预估执行时间（秒）
   - 考虑代码分析、文件操作、测试验证等时间

3. **stepCount** (number): 预估需要执行的步骤数

4. **requiresPlanning** (boolean): 是否需要多步骤规划
   - 涉及多个阶段、需要事先设计执行路径的任务

5. **riskLevel** (string): 风险等级 ("low"|"medium"|"high")
   - high: 涉及删除、修改生产配置、大规模重构
   - medium: 涉及文件修改、依赖变更、配置更新
   - low: 只读操作、简单问答

6. **involvesWrite** (boolean): 是否涉及文件写操作

7. **involvesShell** (boolean): 是否涉及系统命令执行

8. **domain** (string): 任务领域
   - code: 代码编写/修改
   - refactor: 代码重构
   - analysis: 代码/项目分析
   - documentation: 文档编写
   - testing: 测试相关
   - deployment: 部署/构建
   - question: 问答/咨询
   - conversation: 日常对话
   - other: 其他

9. **involvesMultipleFiles** (boolean): 是否涉及多文件操作

10. **requiresWebSearch** (boolean): 是否需要网络搜索获取最新信息

11. **suggestedSubtasks** (string[]): 如果复杂度 >= 7，建议的子任务拆分列表
    - 将复杂任务拆分为可管理的子任务
    - 每个子任务应该是独立可执行的

12. **reasoning** (string): 分析推理过程（简要说明评分依据）

13. **confidence** (number 0-1): 你对这个分析的置信度

## 返回格式

只返回 JSON 对象，不要其他内容：

{
  "complexity": 7,
  "estimatedDuration": 300,
  "stepCount": 8,
  "requiresPlanning": true,
  "riskLevel": "medium",
  "involvesWrite": true,
  "involvesShell": false,
  "domain": "refactor",
  "involvesMultipleFiles": true,
  "requiresWebSearch": false,
  "suggestedSubtasks": ["步骤1: xxx", "步骤2: xxx", "步骤3: xxx"],
  "reasoning": "这是一个中等复杂度的重构任务，涉及...",
  "confidence": 0.85
}`;

/**
 * 基于 LLM 的任务分析器
 */
export class LLMTaskAnalyzer {
  private options: Required<LLMAnalyzerOptions>;
  private cache: Map<string, CacheItem>;

  constructor(options: LLMAnalyzerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.cache = new Map();
  }

  /**
   * 使用 LLM 分析任务复杂度
   * 
   * @param prompt 用户任务描述
   * @param context 分析上下文
   * @returns LLM 分析结果
   */
  async analyze(
    prompt: string,
    context: AnalysisContext
  ): Promise<LLMAnalysisResult> {
    const cacheKey = this.generateCacheKey(prompt, context);

    // 检查缓存
    if (this.options.enableCache) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // 构建分析提示词
    const analysisPrompt = this.buildAnalysisPrompt(prompt, context);

    try {
      // 调用 LLM 进行分析
      const response = await askKimi(analysisPrompt, {
        model: this.options.model,
        cwd: context.cwd,
        maxTurns: 1, // 只需要一轮
        planMode: false,
        yolo: false,
      });

      // 解析 LLM 响应
      const result = this.parseLLMResponse(response.text);

      // 验证结果
      this.validateResult(result);

      // 缓存结果
      if (this.options.enableCache) {
        this.setCache(cacheKey, result);
      }

      return result;
    } catch (error) {
      throw new Error(
        `LLM 分析失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 批量分析多个任务
   * 
   * @param prompts 任务描述列表
   * @param context 分析上下文
   * @returns 分析结果列表
   */
  async analyzeBatch(
    prompts: string[],
    context: AnalysisContext
  ): Promise<LLMAnalysisResult[]> {
    const results: LLMAnalysisResult[] = [];

    for (const prompt of prompts) {
      try {
        const result = await this.analyze(prompt, context);
        results.push(result);
      } catch (error) {
        // 单个任务失败时记录错误但不中断
        console.warn(`[LLMTaskAnalyzer] 分析失败: "${prompt.substring(0, 50)}..."`, error);
        results.push(this.getDefaultResult());
      }
    }

    return results;
  }

  /**
   * 构建分析提示词
   */
  private buildAnalysisPrompt(
    prompt: string,
    context: AnalysisContext
  ): string {
    const historyStr = context.history?.length
      ? context.history.slice(-5).join('\n') // 只取最近5条
      : '无';

    return `${COMPLEXITY_ANALYSIS_PROMPT}

## 上下文信息

- 工作目录: ${context.cwd}
- 用户ID: ${context.userId}
- 对话ID: ${context.chatId}
- 历史消息: ${historyStr}

## 待分析任务

"""
${prompt}
"""

请分析上述任务，返回 JSON 格式的分析结果。`;
  }

  /**
   * 解析 LLM 响应
   */
  private parseLLMResponse(response: string): LLMAnalysisResult {
    // 尝试提取 JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('LLM 响应中没有找到 JSON');
    }

    let parsed: Partial<LLMAnalysisResult>;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error('JSON 解析失败');
    }

    // 设置默认值
    return {
      complexity: this.clamp(parsed.complexity ?? 5, 1, 10),
      estimatedDuration: Math.max(1, parsed.estimatedDuration ?? 60),
      stepCount: Math.max(1, parsed.stepCount ?? 1),
      requiresPlanning: parsed.requiresPlanning ?? false,
      riskLevel: this.validateRiskLevel(parsed.riskLevel),
      involvesWrite: parsed.involvesWrite ?? false,
      involvesShell: parsed.involvesShell ?? false,
      domain: this.validateDomain(parsed.domain),
      involvesMultipleFiles: parsed.involvesMultipleFiles ?? false,
      requiresWebSearch: parsed.requiresWebSearch ?? false,
      suggestedSubtasks: this.options.includeSubtasks
        ? parsed.suggestedSubtasks
        : undefined,
      reasoning: this.options.includeReasoning
        ? parsed.reasoning
        : undefined,
      confidence: this.clamp(parsed.confidence ?? 0.7, 0, 1),
    };
  }

  /**
   * 验证并修正风险等级
   */
  private validateRiskLevel(level: string | undefined): RiskLevel {
    const validLevels: RiskLevel[] = ['low', 'medium', 'high'];
    if (level && validLevels.includes(level as RiskLevel)) {
      return level as RiskLevel;
    }
    return 'medium';
  }

  /**
   * 验证并修正领域
   */
  private validateDomain(domain: string | undefined): TaskDomain {
    const validDomains: TaskDomain[] = [
      'code', 'refactor', 'analysis', 'documentation',
      'testing', 'deployment', 'question', 'conversation', 'other'
    ];
    if (domain && validDomains.includes(domain as TaskDomain)) {
      return domain as TaskDomain;
    }
    return 'other';
  }

  /**
   * 数值范围限制
   */
  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  /**
   * 验证分析结果
   */
  private validateResult(result: LLMAnalysisResult): void {
    if (result.complexity < 1 || result.complexity > 10) {
      throw new Error('复杂度评分超出范围');
    }
    if (result.confidence < 0 || result.confidence > 1) {
      throw new Error('置信度超出范围');
    }
  }

  /**
   * 获取默认结果（失败时使用）
   */
  private getDefaultResult(): LLMAnalysisResult {
    return {
      complexity: 5,
      estimatedDuration: 120,
      stepCount: 3,
      requiresPlanning: false,
      riskLevel: 'medium',
      involvesWrite: false,
      involvesShell: false,
      domain: 'other',
      involvesMultipleFiles: false,
      requiresWebSearch: false,
      confidence: 0.5,
    };
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(
    prompt: string,
    context: AnalysisContext
  ): string {
    const normalized = prompt.trim().toLowerCase().replace(/\s+/g, ' ');
    const contextStr = `${context.userId}:${context.chatId}`;
    return createHash('md5').update(`${contextStr}:${normalized}`).digest('hex');
  }

  /**
   * 从缓存获取
   */
  private getFromCache(key: string): LLMAnalysisResult | null {
    const item = this.cache.get(key);
    if (!item) return null;

    const now = Date.now();
    if (now - item.timestamp > this.options.cacheTtl) {
      this.cache.delete(key);
      return null;
    }

    return item.result;
  }

  /**
   * 设置缓存
   */
  private setCache(key: string, result: LLMAnalysisResult): void {
    this.cleanExpiredCache();

    this.cache.set(key, {
      key,
      result,
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
    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > this.options.cacheTtl) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): CacheStats {
    return {
      size: this.cache.size,
      maxSize: 1000,
      ttl: this.options.cacheTtl,
    };
  }

  /**
   * 清除所有缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 更新选项
   */
  updateOptions(options: Partial<LLMAnalyzerOptions>): void {
    this.options = { ...this.options, ...options };
  }
}

// 导出单例
export const llmTaskAnalyzer = new LLMTaskAnalyzer();
