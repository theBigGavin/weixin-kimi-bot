/**
 * 意图识别器
 * 
 * 识别用户输入的意图类型，结合指代消解结果进行理解
 */

import {
  Intent,
  IntentType,
  Entity,
  Reference,
  SessionContext,
  ConversationState,
  ResolutionResult,
} from './types.js';
import { ReferenceResolver } from './reference-resolver.js';

/**
 * 意图模式定义
 */
interface IntentPattern {
  type: IntentType;
  patterns: RegExp[];
  confidence: number;
  extractEntities?: (match: RegExpMatchArray, input: string) => Entity[];
}

/**
 * 意图模式库
 */
const INTENT_PATTERNS: IntentPattern[] = [
  // ===== 选择选项（最高优先级）=====
  {
    type: IntentType.SELECT_OPTION,
    patterns: [
      // 选择第X个
      /^(选择|选|采用|使用|按|按照|就|确定|决定)\s*第?\s*[123一二三ABCabc]/i,
      // 选这个/那个
      /^(选|选择|采用|使用)\s*(这个|那个|此|该)/i,
      // 用方案X
      /^(用|使用)\s*(方案|选项)/i,
      // 落实/执行方案
      /^(落实|执行|实施|按|按照)\s*(方案|选项)?\s*[123一二三ABCabc]/i,
    ],
    confidence: 0.95,
  },

  // ===== 确认 =====
  {
    type: IntentType.CONFIRM,
    patterns: [
      /^(确认|确定|是的|没错|可以|好|行|OK|ok|👍|没问题|就这样|可以|同意)/i,
      /^(就这么办|就这么做|开始吧|执行吧|继续|好[的]?|行[的]?)/i,
      /^(对的|正确|没问题|赞成)/i,
    ],
    confidence: 0.95,
  },

  // ===== 拒绝 =====
  {
    type: IntentType.REJECT,
    patterns: [
      /^(不|否|拒绝|不行|不要|别|算了|NO|no)/i,
      /^(不对|错了|有问题|不同意|不合适|不好)/i,
      /^(不用|不需要|不想)/i,
    ],
    confidence: 0.9,
  },

  // ===== 修改 =====
  {
    type: IntentType.MODIFY,
    patterns: [
      /^(修改|调整|改|换成|改为|改成|换成)/i,
      /^(不对|错了|重新|再|换)/i,
      /^(不是|不对).*而是/i,
      /^(能否|能不能|可以).*(改|换)/i,
    ],
    confidence: 0.85,
  },

  // ===== 执行 =====
  {
    type: IntentType.EXECUTE,
    patterns: [
      /^(执行|落实|实施|开始|做|搞|弄|动手|动手吧)/i,
      /^(帮我|给我|请|麻烦).*做/i,
      /^(现在|立刻|马上).*开始/i,
    ],
    confidence: 0.85,
  },

  // ===== 暂停 =====
  {
    type: IntentType.PAUSE,
    patterns: [
      /^(暂停|停|等一下|稍等|待会|等一会|稍后)/i,
      /^(先|暂时).*停/i,
    ],
    confidence: 0.85,
  },

  // ===== 继续 =====
  {
    type: IntentType.RESUME,
    patterns: [
      /^(继续|接着|恢复|接着做|继续吧)/i,
      /^(继续|接着).*刚才/i,
    ],
    confidence: 0.85,
  },

  // ===== 取消 =====
  {
    type: IntentType.CANCEL,
    patterns: [
      /^(取消|放弃|停止|不做了|终止|结束)/i,
      /^(算了|别做了|不要了)/i,
    ],
    confidence: 0.9,
  },

  // ===== 完成 =====
  {
    type: IntentType.COMPLETE,
    patterns: [
      /^(完成|做完了|结束了|搞定|OK了)/i,
      /^(已经|都).*完成/i,
    ],
    confidence: 0.85,
  },

  // ===== 询问信息 =====
  {
    type: IntentType.ASK_INFO,
    patterns: [
      /^(什么|怎么|为什么|如何|哪里|谁|多少|几|哪些|啥|怎样|如何)/i,
      /^(请问|我想知道|能|可以|能不能|能不能).*\?$/i,
      /^(详细|具体|更多).*说明/i,
      /^(解释|介绍|说明|讲).*一下/i,
    ],
    confidence: 0.8,
  },

  // ===== 澄清 =====
  {
    type: IntentType.CLARIFY,
    patterns: [
      /^(我是说|我的意思是|其实是|应该是|应该是说)/i,
      /^(不是|不对|并非).*而是/i,
      /^(更正|纠正)一下/i,
      /^(准确|确切).*说/i,
    ],
    confidence: 0.8,
  },

  // ===== 引用 =====
  {
    type: IntentType.REFERENCE,
    patterns: [
      /^(这个|那个|刚才|之前|上面|下面|第[123一二三])/i,
      /^(方案|选项)[\s]*[123一二三ABCabc]/i,
    ],
    confidence: 0.75,
  },

  // ===== 切换话题 =====
  {
    type: IntentType.SWITCH_TOPIC,
    patterns: [
      /^(换个话题|另外|还有|对了|顺便|另外|再说)/i,
      /^(先不说|不说这个|换个)/i,
    ],
    confidence: 0.75,
  },

  // ===== 回到话题 =====
  {
    type: IntentType.RETURN_TO,
    patterns: [
      /^(回到|回到刚才|继续说|继续刚才|接着)/i,
      /^(刚才|之前).*说到/i,
    ],
    confidence: 0.8,
  },
];

/**
 * 上下文相关的意图推断规则
 */
interface ContextInferenceRule {
  states: ConversationState[];
  pattern: RegExp;
  intent: IntentType;
  confidence: number;
}

const CONTEXT_RULES: ContextInferenceRule[] = [
  // 在PROPOSING状态下，数字/字母可能表示选择
  {
    states: [ConversationState.PROPOSING],
    pattern: /^[123一二三ABCabc]$/i,
    intent: IntentType.SELECT_OPTION,
    confidence: 0.8,
  },
  {
    states: [ConversationState.PROPOSING],
    pattern: /^(这个|那个)$/i,
    intent: IntentType.SELECT_OPTION,
    confidence: 0.7,
  },
  // 在CONFIRMING状态下，短回复
  {
    states: [ConversationState.CONFIRMING],
    pattern: /^[\s\S]{1,5}$/,
    intent: IntentType.CONFIRM,
    confidence: 0.6,
  },
  // 在PLANNING状态下，确认相关词汇
  {
    states: [ConversationState.PLANNING],
    pattern: /^(可以|行|好|OK|不错|完美)$/i,
    intent: IntentType.CONFIRM,
    confidence: 0.75,
  },
  // 在EXECUTING状态下，暂停相关词汇
  {
    states: [ConversationState.EXECUTING],
    pattern: /^(停|等|稍后|暂停)/i,
    intent: IntentType.PAUSE,
    confidence: 0.7,
  },
];

/**
 * 意图识别器
 */
export class IntentResolver {
  private referenceResolver: ReferenceResolver;

  constructor() {
    this.referenceResolver = new ReferenceResolver();
  }

  /**
   * 识别用户意图
   * 
   * @param input 用户输入文本
   * @param context 当前会话上下文
   * @returns 识别结果
   */
  async identify(input: string, context: SessionContext): Promise<Intent> {
    // 1. 先进行指代消解
    const resolution = this.referenceResolver.resolve(input, context);
    const resolvedInput = resolution.resolvedText;

    // 2. 基于模式的意图识别
    let bestMatch = this.matchByPatterns(resolvedInput);

    // 3. 基于上下文的意图推断
    const contextMatch = this.inferFromContext(resolvedInput, context);

    // 4. 综合判断
    if (contextMatch && (!bestMatch || contextMatch.confidence > bestMatch.confidence)) {
      bestMatch = contextMatch;
    }

    // 5. 提取实体
    const entities = this.extractEntities(resolvedInput);

    // 6. 构建结果
    const intent: Intent = {
      type: bestMatch?.type || IntentType.UNKNOWN,
      confidence: bestMatch?.confidence || 0.5,
      rawText: input,
      resolvedText: resolution.hasReference ? resolvedInput : undefined,
      entities,
      references: resolution.references,
    };

    // 7. 后处理：根据引用调整置信度
    if (resolution.references.length > 0) {
      // 如果有明确引用，提高置信度
      const avgRefConfidence =
        resolution.references.reduce((sum, r) => sum + r.confidence, 0) /
        resolution.references.length;
      intent.confidence = Math.min(1.0, intent.confidence * (0.8 + avgRefConfidence * 0.2));
    }

    return intent;
  }

  /**
   * 基于模式匹配意图
   */
  private matchByPatterns(input: string): { type: IntentType; confidence: number } | null {
    let bestMatch: { type: IntentType; confidence: number } | null = null;

    for (const pattern of INTENT_PATTERNS) {
      for (const regex of pattern.patterns) {
        if (regex.test(input)) {
          if (!bestMatch || pattern.confidence > bestMatch.confidence) {
            bestMatch = {
              type: pattern.type,
              confidence: pattern.confidence,
            };
          }
          break; // 匹配到该意图的一个模式即可
        }
      }
    }

    return bestMatch;
  }

  /**
   * 基于上下文推断意图
   */
  private inferFromContext(
    input: string,
    context: SessionContext
  ): { type: IntentType; confidence: number } | null {
    const currentState = context.state.current;

    // 检查上下文规则
    for (const rule of CONTEXT_RULES) {
      if (rule.states.includes(currentState) && rule.pattern.test(input)) {
        return {
          type: rule.intent,
          confidence: rule.confidence,
        };
      }
    }

    // 状态特定的启发式推断
    return this.heuristicInference(input, context);
  }

  /**
   * 启发式推断
   */
  private heuristicInference(
    input: string,
    context: SessionContext
  ): { type: IntentType; confidence: number } | null {
    const state = context.state.current;
    const trimmed = input.trim();

    switch (state) {
      case ConversationState.PROPOSING:
        // 在PROPOSING状态，如果输入包含数字或字母，可能是选择选项
        if (/^[123一二三ABCabc]$/.test(trimmed)) {
          return { type: IntentType.SELECT_OPTION, confidence: 0.75 };
        }
        // 如果待决策类型是select_option，且输入较短
        if (context.state.pendingDecision?.type === 'select_option' && trimmed.length <= 10) {
          // 可能是选项名称或描述
          const options = context.state.pendingDecision.options || [];
          for (const optionId of options) {
            const option = context.activeOptions.get(optionId);
            if (option && (trimmed.includes(option.label) || option.label.includes(trimmed))) {
              return { type: IntentType.SELECT_OPTION, confidence: 0.7 };
            }
          }
        }
        break;

      case ConversationState.CONFIRMING:
        // 在CONFIRMING状态，短回复通常是确认或拒绝
        if (trimmed.length <= 5) {
          const positiveWords = ['好', '行', '可以', '是的', '确定', 'OK', '👍', '对'];
          const negativeWords = ['不', '否', '拒绝', '算了', '别', 'NO'];

          if (positiveWords.some((w) => trimmed.includes(w))) {
            return { type: IntentType.CONFIRM, confidence: 0.75 };
          }
          if (negativeWords.some((w) => trimmed.includes(w))) {
            return { type: IntentType.REJECT, confidence: 0.75 };
          }
        }
        break;

      case ConversationState.EXECUTING:
        // 在EXECUTING状态，简单词汇可能是控制命令
        const pauseWords = ['停', '暂停', '等', '稍等', '等一下'];
        const continueWords = ['继续', '接着', '恢复'];
        const cancelWords = ['取消', '放弃', '停止', '算了'];

        if (pauseWords.some((w) => trimmed.includes(w))) {
          return { type: IntentType.PAUSE, confidence: 0.7 };
        }
        if (continueWords.some((w) => trimmed.includes(w))) {
          return { type: IntentType.RESUME, confidence: 0.7 };
        }
        if (cancelWords.some((w) => trimmed.includes(w))) {
          return { type: IntentType.CANCEL, confidence: 0.8 };
        }
        break;

      default:
        break;
    }

    return null;
  }

  /**
   * 提取实体
   */
  private extractEntities(input: string): Entity[] {
    const entities: Entity[] = [];

    // 提取文件路径
    const filePattern = /[\w\-./\\]+\.(ts|js|json|md|txt|yaml|yml|py|java|go|rs)/gi;
    let match;
    while ((match = filePattern.exec(input)) !== null) {
      entities.push({
        type: 'file',
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    // 提取代码片段（反引号包围）
    const codePattern = /`([^`]+)`/g;
    while ((match = codePattern.exec(input)) !== null) {
      entities.push({
        type: 'code',
        value: match[1],
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    // 提取URL
    const urlPattern = /https?:\/\/[^\s]+/gi;
    while ((match = urlPattern.exec(input)) !== null) {
      entities.push({
        type: 'url',
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    // 提取任务ID（以 lt_ 或 ft_ 开头的）
    const taskPattern = /\b(lt_|ft_)[a-z0-9_]+\b/gi;
    while ((match = taskPattern.exec(input)) !== null) {
      entities.push({
        type: 'task_id',
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    // 提取数字
    const numberPattern = /\b\d+\b/g;
    while ((match = numberPattern.exec(input)) !== null) {
      // 排除已经作为其他实体一部分的数字
      const isOverlapping = entities.some(
        (e) => match!.index >= e.start && match!.index < e.end
      );
      if (!isOverlapping) {
        entities.push({
          type: 'number',
          value: match[0],
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }

    return entities;
  }

  /**
   * 获取意图的详细说明
   */
  getIntentDescription(intent: IntentType): string {
    const descriptions: Record<string, string> = {
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
    return descriptions[intent] || intent;
  }
}

/**
 * 创建默认的意图识别器
 */
export function createIntentResolver(): IntentResolver {
  return new IntentResolver();
}
