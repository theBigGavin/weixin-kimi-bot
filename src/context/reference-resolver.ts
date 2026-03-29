/**
 * 指代消解引擎
 * 
 * 解析用户输入中的指代词（如"方案1"、"这个"、"刚才的"等），
 * 将其映射到具体的上下文对象
 */

import {
  SessionContext,
  ResolutionResult,
  Reference,
  Option,
  ReferencePattern,
} from './types.js';

/**
 * 指代消解模式定义
 */
const REFERENCE_PATTERNS: ReferencePattern[] = [
  // ===== 数字索引（最高优先级）=====
  // 方案1、选项2、第3个、第一个
  {
    name: 'option_number_cn',
    pattern: /^(方案|选项|第)?\s*([123一二三])\s*[个方案选项]?/i,
    type: 'option_index',
    priority: 100,
  },
  // 第1个、第2个（阿拉伯数字）
  {
    name: 'option_number_arabic',
    pattern: /^(第)?\s*([123])\s*[个方案选项]?/i,
    type: 'option_index',
    priority: 95,
  },

  // ===== 字母标签 =====
  // 方案A、选项B、选C
  {
    name: 'option_letter',
    pattern: /^(方案|选项)?\s*([ABCabc])\s*$/i,
    type: 'option_label',
    priority: 90,
  },

  // ===== 指代词（当前焦点）=====
  // 这个、该、此
  {
    name: 'anaphora_this',
    pattern: /^(这个|该|此)\s*(方案|选项|计划|任务)?/i,
    type: 'option_anaphora',
    priority: 80,
  },
  // 那个
  {
    name: 'anaphora_that',
    pattern: /^(那个)\s*(方案|选项|计划|任务)?/i,
    type: 'option_anaphora',
    priority: 75,
  },

  // ===== 时间指代 =====
  // 刚才的、之前的、上面、下面
  {
    name: 'anaphora_temporal',
    pattern: /^(刚才的?|之前的?|上面|下面|刚刚)的?\s*(方案|选项|计划|任务|说的)?/i,
    type: 'option_anaphora',
    priority: 70,
  },

  // ===== 任务引用 =====
  // 刚才的任务、之前的任务、刚才说的任务
  {
    name: 'task_recent',
    pattern: /^(刚才|之前|刚才说|之前说|刚刚)的?任务/i,
    type: 'task_reference',
    priority: 60,
  },
  // 继续、接着做、完成
  {
    name: 'task_continue',
    pattern: /^(继续|接着做?|完成|做完)[刚才那个]?/i,
    type: 'task_reference',
    priority: 60,
  },
  // 那个任务
  {
    name: 'task_anaphora',
    pattern: /^(那个|刚才的|之前的)\s*任务/i,
    type: 'task_reference',
    priority: 55,
  },

  // ===== 话题引用 =====
  // 回到话题、继续话题
  {
    name: 'topic_return',
    pattern: /^(回到|继续|回到刚才|继续刚才)[那个]?[的]?话题/i,
    type: 'topic_reference',
    priority: 50,
  },
  // 换个话题、另外
  {
    name: 'topic_switch',
    pattern: /^(换个话题|另外|还有|对了|顺便)/i,
    type: 'topic_reference',
    priority: 45,
  },

  // ===== 特殊表达 =====
  // 第一个、最后一个
  {
    name: 'option_first_last',
    pattern: /^(第一个|最后一个|最前面|最后面)/i,
    type: 'option_index',
    priority: 85,
  },
  // 选第一个、选第二个
  {
    name: 'option_select_index',
    pattern: /^(选|选择|采用|用|按)\s*第?\s*([123一二三])/i,
    type: 'option_index',
    priority: 95,
  },
];

/**
 * 指代消解引擎
 */
export class ReferenceResolver {
  /**
   * 解析用户输入中的指代
   * 
   * @param input 用户输入文本
   * @param context 当前会话上下文
   * @returns 消解结果
   */
  resolve(input: string, context: SessionContext): ResolutionResult {
    const references: Reference[] = [];
    let resolvedText = input;
    let totalConfidence = 1.0;

    // 按优先级排序模式
    const sortedPatterns = [...REFERENCE_PATTERNS].sort(
      (a, b) => b.priority - a.priority
    );

    // 尝试匹配所有模式
    for (const pattern of sortedPatterns) {
      const regex = new RegExp(pattern.pattern.source, 'gi');
      let match;

      while ((match = regex.exec(input)) !== null) {
        // 避免重复匹配同一位置
        const alreadyMatched = references.some(
          (r) =>
            r.rawText === match![0] ||
            (match!.index >= r.rawText.length &&
              match!.index <= r.rawText.length + match![0].length)
        );

        if (alreadyMatched) continue;

        const reference = this.resolveByPattern(pattern, match, context);
        if (reference && reference.confidence > 0) {
          references.push(reference);
          totalConfidence *= reference.confidence;

          // 替换文本中的指代
          resolvedText = this.replaceReference(
            resolvedText,
            match[0],
            reference,
            match.index
          );
        }
      }
    }

    return {
      hasReference: references.length > 0,
      resolvedText,
      references,
      confidence: references.length > 0 ? totalConfidence : 1.0,
    };
  }

  /**
   * 根据模式解析指代
   */
  private resolveByPattern(
    pattern: ReferencePattern,
    match: RegExpMatchArray,
    context: SessionContext
  ): Reference | null {
    switch (pattern.type) {
      case 'option_index':
        return this.resolveOptionIndex(match, context);
      case 'option_label':
        return this.resolveOptionLabel(match, context);
      case 'option_anaphora':
        return this.resolveAnaphora(match, context, pattern.name);
      case 'task_reference':
        return this.resolveTaskReference(match, context, pattern.name);
      case 'topic_reference':
        return this.resolveTopicReference(match, context, pattern.name);
      default:
        return null;
    }
  }

  /**
   * 解析数字索引（方案1、第2个等）
   */
  private resolveOptionIndex(
    match: RegExpMatchArray,
    context: SessionContext
  ): Reference | null {
    const fullMatch = match[0];
    
    // 特殊处理"第一个"、"最后一个"
    if (fullMatch.includes('第一个') || fullMatch.includes('最前面')) {
      return this.resolveByIndex(context, 0, fullMatch);
    }
    if (fullMatch.includes('最后一个') || fullMatch.includes('最后面')) {
      const options = Array.from(context.activeOptions.values());
      return this.resolveByIndex(context, options.length - 1, fullMatch);
    }

    // 数字映射
    const indexMap: Record<string, number> = {
      '1': 0,
      '2': 1,
      '3': 2,
      '一': 0,
      '二': 1,
      '三': 2,
    };

    // 查找匹配的数字
    let index: number | undefined;
    for (let i = 1; i < match.length; i++) {
      if (match[i] && indexMap[match[i]] !== undefined) {
        index = indexMap[match[i]];
        break;
      }
    }

    if (index === undefined) return null;

    return this.resolveByIndex(context, index, fullMatch);
  }

  /**
   * 按索引解析选项
   */
  private resolveByIndex(
    context: SessionContext,
    index: number,
    rawText: string
  ): Reference | null {
    const options = Array.from(context.activeOptions.values());

    if (index < 0 || index >= options.length) {
      // 索引超出范围，返回低置信度引用
      return {
        type: 'option',
        targetId: `invalid_index_${index}`,
        rawText,
        confidence: 0.2,
      };
    }

    return {
      type: 'option',
      targetId: options[index].id,
      rawText,
      confidence: 0.95,
    };
  }

  /**
   * 解析字母标签（方案A、选项B等）
   */
  private resolveOptionLabel(
    match: RegExpMatchArray,
    context: SessionContext
  ): Reference | null {
    // 查找字母
    let letter: string | undefined;
    for (let i = 1; i < match.length; i++) {
      if (match[i] && /^[ABCabc]$/.test(match[i])) {
        letter = match[i].toUpperCase();
        break;
      }
    }

    if (!letter) return null;

    const index = letter.charCodeAt(0) - 'A'.charCodeAt(0);
    return this.resolveByIndex(context, index, match[0]);
  }

  /**
   * 解析指代词（这个、那个、刚才的等）
   */
  private resolveAnaphora(
    match: RegExpMatchArray,
    context: SessionContext,
    patternName: string
  ): Reference | null {
    const keyword = match[1] || match[0];

    // 根据当前状态判断指代对象
    switch (patternName) {
      case 'anaphora_this':
        // "这个" - 通常指当前焦点或最近提到的
        return this.resolveCurrentFocus(context, match[0], keyword);

      case 'anaphora_that':
      case 'anaphora_temporal':
        // "那个"、"刚才的" - 指之前提到的
        return this.resolveRecentMention(context, match[0], keyword);

      default:
        return null;
    }
  }

  /**
   * 解析当前焦点
   */
  private resolveCurrentFocus(
    context: SessionContext,
    rawText: string,
    keyword: string
  ): Reference | null {
    // 如果有待决策的选项，可能指代它
    if (context.state.pendingDecision?.type === 'select_option') {
      const recentOption = this.getMostRecentOption(context);
      if (recentOption) {
        return {
          type: 'option',
          targetId: recentOption.id,
          rawText,
          confidence: 0.75,
        };
      }
    }

    // 返回当前话题
    if (context.state.topic) {
      return {
        type: 'topic',
        targetId: context.state.topic,
        rawText,
        confidence: 0.6,
      };
    }

    return null;
  }

  /**
   * 解析最近提到
   */
  private resolveRecentMention(
    context: SessionContext,
    rawText: string,
    keyword: string
  ): Reference | null {
    // 从消息历史中找到最近提到的选项
    const recentOption = this.getMostRecentOption(context);
    if (recentOption) {
      return {
        type: 'option',
        targetId: recentOption.id,
        rawText,
        confidence: 0.7,
      };
    }

    // 查找最近的话题
    if (context.topicStack.length > 0) {
      const lastTopic = context.topicStack[context.topicStack.length - 1];
      return {
        type: 'topic',
        targetId: lastTopic.id,
        rawText,
        confidence: 0.65,
      };
    }

    return null;
  }

  /**
   * 解析任务引用
   */
  private resolveTaskReference(
    match: RegExpMatchArray,
    context: SessionContext,
    patternName: string
  ): Reference | null {
    switch (patternName) {
      case 'task_recent':
      case 'task_anaphora':
        // 引用当前任务
        if (context.currentTaskId) {
          return {
            type: 'task',
            targetId: context.currentTaskId,
            rawText: match[0],
            confidence: 0.85,
          };
        }
        if (context.currentFlowTaskId) {
          return {
            type: 'task',
            targetId: context.currentFlowTaskId,
            rawText: match[0],
            confidence: 0.85,
          };
        }
        return null;

      case 'task_continue':
        // 继续任务 - 需要有正在进行的任务
        if (context.currentTaskId || context.currentFlowTaskId) {
          return {
            type: 'task',
            targetId: context.currentTaskId || context.currentFlowTaskId!,
            rawText: match[0],
            confidence: 0.9,
          };
        }
        return null;

      default:
        return null;
    }
  }

  /**
   * 解析话题引用
   */
  private resolveTopicReference(
    match: RegExpMatchArray,
    context: SessionContext,
    patternName: string
  ): Reference | null {
    switch (patternName) {
      case 'topic_return':
        // 回到之前的话题
        if (context.topicStack.length > 0) {
          const previousTopic =
            context.topicStack[context.topicStack.length - 1];
          return {
            type: 'topic',
            targetId: previousTopic.id,
            rawText: match[0],
            confidence: 0.8,
          };
        }
        return null;

      case 'topic_switch':
        // 切换话题 - 不指向特定话题
        return {
          type: 'topic',
          targetId: 'new_topic',
          rawText: match[0],
          confidence: 0.7,
        };

      default:
        return null;
    }
  }

  /**
   * 获取最近提到的选项
   */
  private getMostRecentOption(context: SessionContext): Option | null {
    // 从消息历史中找到最近提到的选项
    for (let i = context.messages.length - 1; i >= 0; i--) {
      const msg = context.messages[i];
      if (msg.structuredContent?.type === 'options') {
        const options = msg.structuredContent.data.options as Option[];
        if (options.length > 0) {
          return options[options.length - 1];
        }
      }
    }

    // 如果没有结构化内容，尝试从活跃选项中获取最新的
    const options = Array.from(context.activeOptions.values());
    if (options.length > 0) {
      return options.reduce((latest, opt) =>
        opt.createdAt > latest.createdAt ? opt : latest
      );
    }

    return null;
  }

  /**
   * 替换文本中的指代
   */
  private replaceReference(
    text: string,
    rawRef: string,
    reference: Reference,
    position: number
  ): string {
    // 根据引用类型生成替换文本
    let replacement: string;

    switch (reference.type) {
      case 'option':
        if (reference.confidence > 0.5) {
          replacement = `[选项:${reference.targetId}]`;
        } else {
          replacement = rawRef; // 低置信度，保持原样
        }
        break;
      case 'task':
        replacement = `[任务:${reference.targetId}]`;
        break;
      case 'topic':
        replacement = `[话题:${reference.targetId}]`;
        break;
      default:
        replacement = rawRef;
    }

    // 替换指定位置的内容
    return (
      text.substring(0, position) +
      replacement +
      text.substring(position + rawRef.length)
    );
  }

  /**
   * 批量解析（用于测试）
   */
  resolveBatch(
    inputs: string[],
    context: SessionContext
  ): Array<{ input: string; result: ResolutionResult }> {
    return inputs.map((input) => ({
      input,
      result: this.resolve(input, context),
    }));
  }
}

/**
 * 创建默认的指代消解引擎
 */
export function createReferenceResolver(): ReferenceResolver {
  return new ReferenceResolver();
}
