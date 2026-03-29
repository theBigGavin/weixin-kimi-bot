/**
 * 结构化输出解析器
 * 
 * 解析AI的输出，提取结构化内容（选项、计划、代码、确认请求等）
 */

import { StructuredContent, Option } from './types.js';

/**
 * 解析结果
 */
export interface ParseResult {
  /** 是否解析成功 */
  success: boolean;
  /** 结构化内容 */
  content?: StructuredContent;
  /** 错误信息 */
  error?: string;
}

/**
 * 结构化输出解析器
 */
export class OutputParser {
  /**
   * 解析AI输出
   * 
   * @param content AI输出的文本
   * @returns 解析结果
   */
  parse(content: string): ParseResult {
    // 按优先级尝试解析不同类型的内容

    // 1. 选项列表
    const options = this.parseOptions(content);
    if (options.length >= 2) {
      return {
        success: true,
        content: {
          type: 'options',
          data: {
            options,
            context: this.extractContext(content, options),
            totalOptions: options.length,
          },
        },
      };
    }

    // 2. 确认请求
    const confirmation = this.parseConfirmation(content);
    if (confirmation) {
      return {
        success: true,
        content: {
          type: 'confirmation',
          data: confirmation,
        },
      };
    }

    // 3. 执行计划
    const plan = this.parsePlan(content);
    if (plan && plan.steps.length > 0) {
      return {
        success: true,
        content: {
          type: 'plan',
          data: plan,
        },
      };
    }

    // 4. 代码块
    const code = this.parseCode(content);
    if (code && code.blocks.length > 0) {
      return {
        success: true,
        content: {
          type: 'code',
          data: code,
        },
      };
    }

    // 5. 分析报告
    const analysis = this.parseAnalysis(content);
    if (analysis) {
      return {
        success: true,
        content: {
          type: 'analysis',
          data: analysis,
        },
      };
    }

    // 未识别到结构化内容
    return {
      success: false,
      error: '未识别到结构化内容',
    };
  }

  /**
   * 解析选项列表
   * 
   * 支持多种格式：
   * - [opt_1] 方案1：标题\n描述
   * - **方案1**：标题\n描述
   * - 1. 标题\n描述
   * - 方案1：标题
   */
  parseOptions(content: string): Option[] {
    const options: Option[] = [];
    const lines = content.split('\n');

    // 模式1: [id] 标签: 描述
    const bracketPattern = /\[([\w_]+)\]\s*(?:方案|选项)?\s*[：:]?\s*(.+)/;

    // 模式2: **方案1**：标题
    const boldPattern = /\*\*\s*(?:方案|选项)?\s*[：:]?\s*(.+?)\*\*/;

    // 模式3: 1. 标题 或 方案1：标题
    const numberPattern = /^(?:方案|选项)?\s*[：:]?\s*(\d+)[.、)\s]+(.+)/;

    // 模式4: - 方案1：标题
    const bulletPattern = /^[-*]\s*(?:方案|选项)?\s*[：:]?\s*(.+)/;

    let currentOption: Partial<Option> | null = null;
    let descriptionLines: string[] = [];
    let optionIndex = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        // 空行，保存当前选项
        if (currentOption && descriptionLines.length > 0) {
          currentOption.description = descriptionLines.join(' ').trim();
          options.push(currentOption as Option);
          currentOption = null;
          descriptionLines = [];
        }
        continue;
      }

      // 尝试匹配选项开始
      let match:
        | RegExpMatchArray
        | null = null;
      let optionType: 'bracket' | 'bold' | 'number' | 'bullet' | null = null;

      if ((match = line.match(bracketPattern))) {
        optionType = 'bracket';
      } else if ((match = line.match(boldPattern))) {
        optionType = 'bold';
      } else if ((match = line.match(numberPattern))) {
        optionType = 'number';
      } else if ((match = line.match(bulletPattern))) {
        optionType = 'bullet';
      }

      if (match) {
        // 保存之前的选项
        if (currentOption && descriptionLines.length > 0) {
          currentOption.description = descriptionLines.join(' ').trim();
          options.push(currentOption as Option);
        }

        // 创建新选项
        const label = match[optionType === 'bracket' ? 2 : 1].trim();
        currentOption = {
          id: optionType === 'bracket' ? match[1] : `opt_${optionIndex}`,
          label: this.cleanLabel(label),
          description: '',
          createdAt: Date.now(),
        };
        descriptionLines = [];
        optionIndex++;
      } else if (currentOption) {
        // 继续收集描述
        descriptionLines.push(line);
      }
    }

    // 处理最后一个选项
    if (currentOption && descriptionLines.length > 0) {
      currentOption.description = descriptionLines.join(' ').trim();
      options.push(currentOption as Option);
    }

    return options;
  }

  /**
   * 解析确认请求
   */
  parseConfirmation(content: string): { message: string; requiresResponse: boolean } | null {
    // 检测确认请求的关键词
    const confirmationPatterns = [
      /请确认/i,
      /是否确认/i,
      /确认.*[\?？]/,
      /这样.*可以吗/i,
      /是否.*继续/i,
      /可以吗[\?？]/i,
      /对吗[\?？]/i,
      /是否.*同意/i,
      /请.*回复.*确认/i,
    ];

    const isConfirmation = confirmationPatterns.some((p) => p.test(content));

    if (isConfirmation) {
      // 提取确认请求的核心内容（通常是最后一段或包含问号的句子）
      const sentences = content.split(/[。！?？\n]/);
      const confirmSentence =
        sentences.find((s) => confirmationPatterns.some((p) => p.test(s))) ||
        sentences[sentences.length - 1];

      return {
        message: confirmSentence.trim(),
        requiresResponse: true,
      };
    }

    return null;
  }

  /**
   * 解析执行计划
   */
  parsePlan(content: string): { steps: string[]; summary?: string; raw: string } | null {
    const steps: string[] = [];
    const lines = content.split('\n');

    // 检测是否是计划格式
    const planKeywords = ['执行计划', '计划', '步骤', 'step', 'phase', '阶段'];
    const hasPlanKeyword = planKeywords.some((kw) =>
      content.toLowerCase().includes(kw.toLowerCase())
    );

    if (!hasPlanKeyword) return null;

    // 解析步骤
    const stepPatterns = [
      /^\d+[.、)\s]+(.+)$/, // 1. 步骤
      /^步骤\s*\d+[：:]\s*(.+)$/i, // 步骤1：
      /^第\s*\d+\s*步[：:]\s*(.+)$/i, // 第1步：
      /^[-*]\s*(.+)$/, // - 步骤
      /^Phase\s*\d+[：:]\s*(.+)$/i, // Phase 1:
      /^Step\s*\d+[：:]\s*(.+)$/i, // Step 1:
    ];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      for (const pattern of stepPatterns) {
        const match = trimmed.match(pattern);
        if (match) {
          steps.push(match[1].trim());
          break;
        }
      }
    }

    if (steps.length === 0) return null;

    // 提取摘要（通常是第一段）
    const summary = lines
      .slice(0, 3)
      .filter((l) => l.trim() && !l.match(/^\d/))
      .join(' ')
      .trim();

    return {
      steps,
      summary: summary || undefined,
      raw: content,
    };
  }

  /**
   * 解析代码块
   */
  parseCode(content: string): { blocks: Array<{ language: string; code: string }> } | null {
    const blocks: Array<{ language: string; code: string }> = [];

    // 匹配代码块
    const codeBlockPattern = /```(\w+)?\n([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockPattern.exec(content)) !== null) {
      const language = match[1] || 'text';
      const code = match[2].trim();

      if (code) {
        blocks.push({ language, code });
      }
    }

    if (blocks.length === 0) return null;

    return { blocks };
  }

  /**
   * 解析分析报告
   */
  parseAnalysis(content: string): {
    type: string;
    findings: string[];
    recommendations?: string[];
  } | null {
    // 检测分析类型
    const analysisTypes = [
      { keyword: '分析', type: 'analysis' },
      { keyword: '评估', type: 'assessment' },
      { keyword: '总结', type: 'summary' },
      { keyword: '报告', type: 'report' },
    ];

    const detectedType = analysisTypes.find((t) => content.includes(t.keyword));
    if (!detectedType) return null;

    // 提取发现点（通常是以 - 或 * 开头的列表项）
    const findings: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.match(/^[-*]\s+/) || trimmed.match(/^[\d]+[.、]/)) {
        const content = trimmed.replace(/^[-*\d.、)\s]+/, '').trim();
        if (content.length > 10) {
          findings.push(content);
        }
      }
    }

    if (findings.length === 0) return null;

    // 提取建议（通常在"建议"、"推荐"之后）
    const recommendations: string[] = [];
    let inRecommendations = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.match(/^(建议|推荐|意见|改进)/i)) {
        inRecommendations = true;
        continue;
      }

      if (inRecommendations && (trimmed.match(/^[-*]\s+/) || trimmed.match(/^[\d]+[.、]/))) {
        const content = trimmed.replace(/^[-*\d.、)\s]+/, '').trim();
        if (content) {
          recommendations.push(content);
        }
      }
    }

    return {
      type: detectedType.type,
      findings,
      recommendations: recommendations.length > 0 ? recommendations : undefined,
    };
  }

  /**
   * 检测是否需要用户响应
   * 
   * 基于内容判断AI是否在等待用户回复
   */
  requiresResponse(content: string): boolean {
    // 确认请求
    if (this.parseConfirmation(content)) return true;

    // 提供选项
    if (this.parseOptions(content).length >= 2) return true;

    // 提问
    const questionPatterns = [
      /[?？]\s*$/,
      /请.*选择/i,
      /请.*确认/i,
      /请.*提供/i,
      /如何.*\?/,
      /什么.*\?/,
      /是否.*\?/,
    ];

    return questionPatterns.some((p) => p.test(content));
  }

  /**
   * 提取上下文描述
   */
  private extractContext(content: string, options: Option[]): string {
    // 提取选项前的文本作为上下文
    const firstOptionIndex = content.indexOf(options[0]?.label || '');
    if (firstOptionIndex > 0) {
      return content.substring(0, firstOptionIndex).trim();
    }

    // 或者提取第一段作为上下文
    const lines = content.split('\n');
    const contextLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) break;
      if (trimmed.match(/^[\d\[*]/)) break;
      contextLines.push(trimmed);
    }

    return contextLines.join(' ').trim();
  }

  /**
   * 清理标签
   */
  private cleanLabel(label: string): string {
    return label
      .replace(/\*\*/g, '') // 移除加粗标记
      .replace(/__/, '') // 移除下划线
      .trim();
  }
}

/**
 * 创建默认的输出解析器
 */
export function createOutputParser(): OutputParser {
  return new OutputParser();
}
