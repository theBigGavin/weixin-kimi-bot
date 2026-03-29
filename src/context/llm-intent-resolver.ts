/**
 * 基于LLM的意图识别器
 * 
 * 使用Kimi LLM进行深度意图理解，优先级高于正则模式匹配
 * 特点：
 * - 理解自然语言变体和口语化表达
 * - 结合对话上下文准确识别意图
 * - 支持复杂、模糊的表达方式
 * - 正则模式作为fallback
 */

import { askKimi } from '../kimi/handler.js';
import {
  Intent,
  IntentType,
  Entity,
  SessionContext,
  ConversationState,
} from './types.js';
import { ReferenceResolver } from './reference-resolver.js';

/** LLM意图识别选项 */
export interface LLMIntentResolverOptions {
  /** 模型名称 */
  model?: string;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 是否启用缓存 */
  enableCache?: boolean;
  /** 缓存TTL（毫秒） */
  cacheTtl?: number;
  /** 最低置信度阈值 */
  minConfidence?: number;
  /** 是否禁用LLM（用于测试） */
  disabled?: boolean;
}

/** 缓存项 */
interface CacheItem {
  key: string;
  intent: Intent;
  timestamp: number;
}

/** 默认选项 */
const DEFAULT_OPTIONS: Required<LLMIntentResolverOptions> = {
  model: 'kimi-code/kimi-for-coding',
  timeout: 10000,
  enableCache: true,
  cacheTtl: 2 * 60 * 1000, // 2分钟
  minConfidence: 0.7,
  disabled: false,
};

/** 意图识别Prompt */
const INTENT_RECOGNITION_PROMPT = `你是一位专业的对话意图识别专家。请分析用户的输入，识别其真实意图并提取相关实体。

## 可选的意图类型

- **ask_info**: 询问信息、提问、寻求解释（如"什么是XXX"、"怎么做"、"为什么"）
- **clarify**: 澄清、纠正、补充说明（如"我是说..."、"不对，应该是..."）
- **select_option**: 选择选项（如"选第一个"、"用方案A"、"选这个"）
- **confirm**: 确认、同意、批准（如"确认"、"好的"、"可以"、"行"）
- **reject**: 拒绝、不同意（如"不行"、"不要"、"拒绝"）
- **modify**: 修改、调整、变更（如"改成..."、"换成..."、"改一下"）
- **execute**: 执行、开始、实施（如"开始吧"、"执行"、"动手"）
- **pause**: 暂停、等一下（如"暂停"、"等一下"、"稍等"）
- **resume**: 继续、恢复（如"继续"、"接着做"）
- **cancel**: 取消、放弃（如"取消"、"算了"、"不做了"）
- **complete**: 完成、结束（如"完成了"、"搞定了"）
- **reference**: 引用之前内容（如"这个"、"那个"、"刚才说的"）
- **switch_topic**: 切换话题（如"换个话题"、"另外"、"对了"）
- **return_to**: 回到之前话题（如"回到刚才"、"继续说"）
- **update_context**: 更新上下文、同步记忆（如"更新记忆"、"重新了解项目"、"项目变了"）
- **unknown**: 无法识别或闲聊

## 返回格式

只返回JSON对象，不要其他内容：

{
  "intent": "意图类型",
  "confidence": 0.95,
  "reason": "识别理由的简要说明",
  "entities": [
    {"type": "file|code|url|task_id|number|other", "value": "提取的值"}
  ]
}

## 判断规则

1. 结合当前对话状态理解意图
2. 注意用户可能在继续之前的话题
3. 短回复（1-3字）通常与当前状态相关
4. 识别隐含的意图，不只是表面关键词
5. 置信度0-1，不确定时给较低值`;

/**
 * 基于LLM的意图识别器
 */
export class LLMIntentResolver {
  private options: Required<LLMIntentResolverOptions>;
  private cache: Map<string, CacheItem>;
  private referenceResolver: ReferenceResolver;

  constructor(options: LLMIntentResolverOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.cache = new Map();
    this.referenceResolver = new ReferenceResolver();
  }

  /**
   * 使用LLM识别用户意图
   * 
   * @param input 用户输入文本
   * @param context 当前会话上下文
   * @returns 识别结果
   */
  async identify(input: string, context: SessionContext): Promise<Intent> {
    // 1. 先进行指代消解
    const resolution = this.referenceResolver.resolve(input, context);
    const resolvedInput = resolution.resolvedText;

    // 2. 检查缓存
    const cacheKey = this.generateCacheKey(resolvedInput, context);
    if (this.options.enableCache) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // 3. 构建LLM提示词
    const prompt = this.buildPrompt(resolvedInput, context);

    try {
      // 4. 调用LLM进行意图识别
      const response = await askKimi(prompt, {
        model: this.options.model,
        cwd: process.cwd(),
        maxTurns: 1,
        planMode: false,
        yolo: false,
      });

      // 5. 解析LLM响应
      const llmResult = this.parseLLMResponse(response.text);

      // 6. 验证置信度
      if (llmResult.confidence < this.options.minConfidence) {
        throw new Error(`置信度过低: ${llmResult.confidence}`);
      }

      // 7. 构建意图对象
      const intent: Intent = {
        type: llmResult.intent,
        confidence: llmResult.confidence,
        rawText: input,
        resolvedText: resolution.hasReference ? resolvedInput : undefined,
        entities: llmResult.entities,
        references: resolution.references,
      };

      // 8. 缓存结果
      if (this.options.enableCache) {
        this.setCache(cacheKey, intent);
      }

      return intent;
    } catch (error) {
      console.warn('[LLMIntentResolver] LLM识别失败，将使用fallback:', error);
      throw error; // 让上层调用者处理fallback
    }
  }

  /**
   * 构建LLM提示词
   */
  private buildPrompt(input: string, context: SessionContext): string {
    // 获取最近的消息历史（最多3条）
    const recentMessages = context.messages
      .slice(-3)
      .map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content.substring(0, 100)}`)
      .join('\n');

    // 获取当前话题
    const currentTopic = context.state.topic || '无';

    return `${INTENT_RECOGNITION_PROMPT}

## 当前对话上下文

- 当前状态: ${context.state.current}
- 当前话题: ${currentTopic}
- 最近消息:
${recentMessages || '无'}

## 待识别的用户输入

"""
${input}
"""

请识别上述输入的意图，返回JSON格式结果。`;
  }

  /**
   * 解析LLM响应
   */
  private parseLLMResponse(response: string): {
    intent: IntentType;
    confidence: number;
    reason: string;
    entities: Entity[];
  } {
    // 尝试提取JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('LLM响应中没有找到JSON');
    }

    let parsed: {
      intent?: string;
      confidence?: number;
      reason?: string;
      entities?: Array<{ type: string; value: string }>;
    };

    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error('JSON解析失败');
    }

    // 验证并转换意图类型
    const intentType = this.validateIntentType(parsed.intent);

    // 转换实体
    const entities: Entity[] = (parsed.entities || [])
      .filter(e => e.value && e.value.trim())
      .map(e => ({
        type: e.type || 'other',
        value: e.value.trim(),
        start: 0,
        end: 0, // LLM识别不记录位置
      }));

    return {
      intent: intentType,
      confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.7)),
      reason: parsed.reason || '',
      entities,
    };
  }

  /**
   * 验证意图类型
   */
  private validateIntentType(intent: string | undefined): IntentType {
    const validIntents = Object.values(IntentType) as string[];
    
    if (intent && validIntents.includes(intent)) {
      return intent as IntentType;
    }
    
    return IntentType.UNKNOWN;
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(input: string, context: SessionContext): string {
    const normalized = input.trim().toLowerCase().replace(/\s+/g, ' ');
    const contextStr = `${context.agentId}:${context.userId}:${context.state.current}`;
    return `${contextStr}:${normalized}`;
  }

  /**
   * 从缓存获取
   */
  private getFromCache(key: string): Intent | null {
    const item = this.cache.get(key);
    if (!item) return null;

    const now = Date.now();
    if (now - item.timestamp > this.options.cacheTtl) {
      this.cache.delete(key);
      return null;
    }

    return item.intent;
  }

  /**
   * 设置缓存
   */
  private setCache(key: string, intent: Intent): void {
    this.cache.set(key, {
      key,
      intent,
      timestamp: Date.now(),
    });

    // 限制缓存大小
    if (this.cache.size > 500) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 更新选项
   */
  updateOptions(options: Partial<LLMIntentResolverOptions>): void {
    this.options = { ...this.options, ...options };
  }
}

// 导出单例
export const llmIntentResolver = new LLMIntentResolver();
