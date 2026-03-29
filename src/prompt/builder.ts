/**
 * 上下文感知的Prompt构建器
 * 
 * 构建包含会话状态、历史对话、活跃选项等上下文的系统提示词
 */

import type { AgentRuntime } from '../agent/types.js';
import { formatMemoryForPrompt } from '../memory/manager.js';
import {
  SessionContext,
  ConversationState,
  translateState,
} from '../context/types.js';

/**
 * Prompt构建选项
 */
export interface PromptBuildOptions {
  /** 是否包含会话状态信息 */
  includeState?: boolean;
  /** 包含多少条近期消息 */
  includeRecentMessages?: number;
  /** 是否包含活跃选项 */
  includeActiveOptions?: boolean;
  /** 是否包含话题栈 */
  includeTopicStack?: boolean;
  /** 最大长度限制 */
  maxLength?: number;
  /** 是否包含工作目录 */
  includeWorkspace?: boolean;
  /** 是否包含当前任务 */
  includeCurrentTask?: boolean;
}

/**
 * 默认选项
 */
const DEFAULT_OPTIONS: Required<PromptBuildOptions> = {
  includeState: true,
  includeRecentMessages: 5,
  includeActiveOptions: true,
  includeTopicStack: false,
  maxLength: 8000,
  includeWorkspace: true,
  includeCurrentTask: true,
};

/**
 * 上下文感知的Prompt构建器
 */
export class ContextualPromptBuilder {
  /**
   * 构建系统提示词
   * 
   * @param runtime Agent运行时
   * @param sessionContext 会话上下文
   * @param userInput 用户输入
   * @param options 构建选项
   * @returns 完整的系统提示词
   */
  build(
    runtime: AgentRuntime,
    sessionContext: SessionContext,
    userInput: string,
    options: PromptBuildOptions = {}
  ): string {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const parts: string[] = [];

    // 1. 基础系统提示词（来自模板）
    parts.push(runtime.template.systemPrompt);

    // 2. 当前会话状态（关键！）
    if (opts.includeState) {
      parts.push(this.buildStateSection(sessionContext));
    }

    // 3. 活跃选项
    if (opts.includeActiveOptions && sessionContext.activeOptions.size > 0) {
      parts.push(this.buildOptionsSection(sessionContext));
    }

    // 4. 当前任务
    if (opts.includeCurrentTask && (sessionContext.currentTaskId || sessionContext.currentFlowTaskId)) {
      parts.push(this.buildCurrentTaskSection(sessionContext));
    }

    // 5. 近期对话历史
    if (opts.includeRecentMessages && opts.includeRecentMessages > 0) {
      parts.push(this.buildHistorySection(sessionContext, opts.includeRecentMessages));
    }

    // 6. 话题栈（如果启用）
    if (opts.includeTopicStack && sessionContext.topicStack.length > 0) {
      parts.push(this.buildTopicStackSection(sessionContext));
    }

    // 7. 长期记忆
    if (runtime.config.memory.enabled) {
      const memoryContext = formatMemoryForPrompt(
        runtime.memory,
        sessionContext.state.topic ? [sessionContext.state.topic] : []
      );
      if (memoryContext) {
        parts.push(`## 关于用户的记忆\n${memoryContext}`);
      }
    }

    // 8. 工作目录
    if (opts.includeWorkspace) {
      parts.push(`## 工作目录\n当前工作目录: ${runtime.config.workspace.path}\n请在此目录下进行文件操作。`);
    }

    // 9. 日期和注意事项
    parts.push(this.buildFooter());

    // 10. 用户输入
    parts.push(`## 用户消息\n${userInput}`);

    // 11. 输出格式指导（根据当前状态）
    parts.push(this.buildOutputGuidance(sessionContext));

    // 合并所有部分
    let prompt = parts.join('\n\n---\n\n');

    // 长度控制
    if (opts.maxLength && prompt.length > opts.maxLength) {
      prompt = this.truncatePrompt(prompt, opts.maxLength, parts.length);
    }

    return prompt;
  }

  /**
   * 构建状态章节
   */
  private buildStateSection(context: SessionContext): string {
    const state = context.state;
    let section = `## 当前对话状态\n`;
    section += `阶段: ${translateState(state.current)}\n`;

    if (state.topic) {
      section += `主题: ${state.topic}\n`;
    }

    if (state.previous && state.previous !== state.current) {
      section += `上一阶段: ${translateState(state.previous)}\n`;
    }

    if (state.expectedInput) {
      section += `期望: ${state.expectedInput.description}\n`;
    }

    if (state.pendingDecision) {
      section += `\n等待决策: ${state.pendingDecision.description}\n`;
      if (state.pendingDecision.options && state.pendingDecision.options.length > 0) {
        section += `可选项: ${state.pendingDecision.options.join(', ')}\n`;
      }
    }

    if (state.data && Object.keys(state.data).length > 0) {
      section += `\n相关数据:\n`;
      for (const [key, value] of Object.entries(state.data)) {
        if (typeof value === 'string' && value.length < 100) {
          section += `- ${key}: ${value}\n`;
        }
      }
    }

    return section;
  }

  /**
   * 构建活跃选项章节
   */
  private buildOptionsSection(context: SessionContext): string {
    let section = `## 当前可选项\n`;
    section += `用户需要从以下选项中选择（用户可能会用"方案1"、"选A"等方式引用）：\n\n`;

    const options = Array.from(context.activeOptions.values());

    for (let i = 0; i < options.length; i++) {
      const option = options[i];
      const indexLabel = ['一', '二', '三', '四', '五'][i] || String(i + 1);
      section += `${i + 1}. [${option.id}] ${option.label}\n`;
      if (option.description) {
        const desc = option.description.length > 150
          ? option.description.substring(0, 150) + '...'
          : option.description;
        section += `   ${desc}\n`;
      }
      section += `   （用户可以说"方案${indexLabel}"、"选第${i + 1}个"、"选${String.fromCharCode(65 + i)}"来引用此选项）\n\n`;
    }

    return section;
  }

  /**
   * 构建当前任务章节
   */
  private buildCurrentTaskSection(context: SessionContext): string {
    let section = `## 当前任务\n`;

    if (context.currentTaskId) {
      section += `进行中的任务: ${context.currentTaskId}\n`;
    }
    if (context.currentFlowTaskId) {
      section += `进行中的FlowTask: ${context.currentFlowTaskId}\n`;
    }

    return section;
  }

  /**
   * 构建历史对话章节
   */
  private buildHistorySection(context: SessionContext, limit: number): string {
    const messages = context.messages.slice(-limit);
    if (messages.length === 0) return '';

    let section = `## 近期对话\n`;

    for (const msg of messages) {
      const role = msg.role === 'user' ? '用户' : 'AI';
      const timestamp = new Date(msg.timestamp).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      });

      // 截断过长内容
      let content = msg.content;
      if (content.length > 400) {
        content = content.substring(0, 400) + '...(已截断)';
      }

      section += `[${timestamp}] ${role}: ${content}\n\n`;
    }

    return section;
  }

  /**
   * 构建话题栈章节
   */
  private buildTopicStackSection(context: SessionContext): string {
    const topics = context.topicStack.slice(-3); // 只显示最近3个
    if (topics.length === 0) return '';

    let section = `## 话题栈\n`;
    section += `之前讨论过的话题（用户可能要求回到某个话题）：\n`;

    for (let i = topics.length - 1; i >= 0; i--) {
      const topic = topics[i];
      section += `- ${topic.label}: ${topic.description.substring(0, 50)}\n`;
    }

    return section;
  }

  /**
   * 构建页脚
   */
  private buildFooter(): string {
    const now = new Date();
    return `## 注意\n` +
      `- 当前日期: ${now.toLocaleDateString('zh-CN')}\n` +
      `- 如果上下文看起来不完整，请询问用户确认\n` +
      `- 重要决策前请先确认用户意图`;
  }

  /**
   * 构建输出格式指导
   */
  private buildOutputGuidance(context: SessionContext): string {
    const state = context.state.current;

    switch (state) {
      case ConversationState.PROPOSING:
        return `## 输出格式指导\n` +
          `当前正在提供方案，请使用以下格式方便用户引用：\n\n` +
          `[option_id] 方案标题\n方案详细描述\n\n` +
          `示例：\n` +
          `[opt_1] 方案1：技术分析工具\n` +
          `基于K线、均线等技术指标进行分析...\n\n` +
          `[opt_2] 方案2：量化交易平台\n` +
          `支持策略回测、自动交易...`;

      case ConversationState.CONFIRMING:
        return `## 输出格式指导\n` +
          `当前需要用户确认。请清晰说明需要确认的内容，并提示用户回复"确认"或"取消"。`;

      case ConversationState.PLANNING:
        return `## 输出格式指导\n` +
          `当前正在制定执行计划。请提供清晰的步骤列表（1. 2. 3.），并在最后请求用户确认。`;

      case ConversationState.EXECUTING:
        return `## 输出格式指导\n` +
          `当前正在执行任务。请提供进度更新，并告知用户可以回复"暂停"或"取消"。`;

      case ConversationState.EXPLORING:
        return `## 输出格式指导\n` +
          `当前正在探索用户需求。如果提供多个方案，请使用 [option_id] 格式标记。`;

      default:
        return `## 输出格式指导\n` +
          `如果提供多个选项供用户选择，请使用 [option_id] 格式标记每个选项，便于用户引用（如"方案1"、"选A"等）。`;
    }
  }

  /**
   * 智能截断Prompt
   */
  private truncatePrompt(prompt: string, maxLength: number, partCount: number): string {
    if (prompt.length <= maxLength) return prompt;

    console.warn(`[PromptBuilder] Prompt长度(${prompt.length})超过限制(${maxLength})，执行截断`);

    // 计算每部分的大致长度
    const avgPartLength = prompt.length / partCount;
    const targetReduction = prompt.length - maxLength;

    // 优先截断历史对话（通常是最长的部分）
    if (prompt.includes('## 近期对话')) {
      const historyMatch = prompt.match(/## 近期对话[\s\S]+?(?=---|$)/);
      if (historyMatch) {
        const historySection = historyMatch[0];
        const lines = historySection.split('\n');
        // 保留更少的历史消息
        const keepLines = Math.max(3, Math.floor(lines.length * 0.5));
        const truncatedHistory = lines.slice(0, keepLines).join('\n') + '\n...(历史消息已截断)';
        prompt = prompt.replace(historySection, truncatedHistory);
      }
    }

    // 如果还超长，截断选项描述
    if (prompt.length > maxLength && prompt.includes('## 当前可选项')) {
      const optionsMatch = prompt.match(/## 当前可选项[\s\S]+?(?=---|$)/);
      if (optionsMatch) {
        const optionsSection = optionsMatch[0];
        // 缩短每个选项的描述
        const truncatedOptions = optionsSection.replace(
          /   [^\n]{100,}/g,
          (match) => match.substring(0, 100) + '...(已截断)'
        );
        prompt = prompt.replace(optionsSection, truncatedOptions);
      }
    }

    // 最后手段：硬截断
    if (prompt.length > maxLength) {
      prompt = prompt.substring(0, maxLength - 50) + '\n\n...(提示词已截断)';
    }

    return prompt;
  }
}

/**
 * 创建默认的Prompt构建器
 */
export function createPromptBuilder(): ContextualPromptBuilder {
  return new ContextualPromptBuilder();
}
