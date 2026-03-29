/**
 * 对话状态机
 * 
 * 管理对话状态的流转，确保对话按预期流程进行
 */

import {
  ConversationState,
  IntentType,
  StateContext,
  Intent,
  StateTransition,
  StateTransitionResult,
  ExpectedInputType,
} from './types.js';

/**
 * 对话状态机
 */
export class ConversationStateMachine {
  /** 状态转移规则表 */
  private transitions: StateTransition[];

  constructor() {
    this.transitions = this.buildTransitions();
  }

  /**
   * 执行状态转移
   * 
   * 根据当前状态和意图，计算目标状态
   */
  transition(
    currentState: StateContext,
    intent: Intent
  ): StateTransitionResult {
    // 1. 查找匹配的状态转移规则
    const transition = this.findTransition(currentState.current, intent);

    if (!transition) {
      // 没有找到匹配的转移规则
      return this.handleNoTransition(currentState, intent);
    }

    // 2. 检查是否需要确认
    const requiresConfirmation = this.requiresConfirmation(transition, intent);

    // 3. 执行转移动作
    if (transition.action) {
      try {
        transition.action(intent, currentState);
      } catch (err) {
        console.error('[StateMachine] 执行转移动作失败:', err);
      }
    }

    // 4. 确定期望的输入类型
    const expectedInput = this.getExpectedInput(transition.to);

    return {
      success: true,
      newState: transition.to,
      requiresConfirmation,
      expectedInput,
    };
  }

  /**
   * 获取指定状态的期望输入
   */
  getExpectedInput(state: ConversationState): ExpectedInputType {
    switch (state) {
      case ConversationState.PROPOSING:
        return {
          type: 'select_option',
          description: '请从提供的选项中选择一个',
        };
      case ConversationState.CONFIRMING:
        return {
          type: 'confirm',
          description: '请确认或拒绝',
        };
      case ConversationState.CLARIFYING:
        return {
          type: 'provide_info',
          description: '请提供更多信息',
        };
      case ConversationState.PLANNING:
        return {
          type: 'confirm',
          description: '请确认执行计划',
        };
      case ConversationState.EXECUTING:
        return {
          type: 'free_text',
          description: '任务执行中，可以暂停或取消',
        };
      case ConversationState.EXPLORING:
        return {
          type: 'free_text',
          description: '请描述您的需求',
        };
      default:
        return {
          type: 'free_text',
          description: '请输入您想说的',
        };
    }
  }

  /**
   * 获取当前状态所有可能的转移
   */
  getAvailableTransitions(state: ConversationState): StateTransition[] {
    return this.transitions.filter(t => t.from === state);
  }

  /**
   * 检查是否可以转移
   */
  canTransition(
    from: ConversationState,
    intent: IntentType
  ): boolean {
    return this.transitions.some(t =>
      t.from === from && t.intent === intent
    );
  }

  // ============ 私有方法 ============

  /**
   * 构建状态转移规则表
   */
  private buildTransitions(): StateTransition[] {
    return [
      // ========== 从IDLE状态 ==========
      {
        from: ConversationState.IDLE,
        intent: IntentType.ASK_INFO,
        to: ConversationState.EXPLORING,
      },
      {
        from: ConversationState.IDLE,
        intent: IntentType.EXECUTE,
        to: ConversationState.PLANNING,
      },
      // 未知意图也接受，进入探索状态
      {
        from: ConversationState.IDLE,
        intent: IntentType.UNKNOWN,
        to: ConversationState.EXPLORING,
      },

      // ========== 从EXPLORING状态 ==========
      {
        from: ConversationState.EXPLORING,
        intent: IntentType.ASK_INFO,
        to: ConversationState.EXPLORING,
      },
      {
        from: ConversationState.EXPLORING,
        intent: IntentType.CLARIFY,
        to: ConversationState.CLARIFYING,
      },
      {
        from: ConversationState.EXPLORING,
        intent: IntentType.EXECUTE,
        to: ConversationState.PLANNING,
      },
      {
        from: ConversationState.EXPLORING,
        intent: IntentType.SELECT_OPTION,
        to: ConversationState.PLANNING,
      },

      // ========== 从CLARIFYING状态 ==========
      {
        from: ConversationState.CLARIFYING,
        intent: IntentType.ASK_INFO,
        to: ConversationState.EXPLORING,
      },
      {
        from: ConversationState.CLARIFYING,
        intent: IntentType.EXECUTE,
        to: ConversationState.PLANNING,
      },

      // ========== 从PROPOSING状态（关键！）==========
      {
        from: ConversationState.PROPOSING,
        intent: IntentType.SELECT_OPTION,
        to: ConversationState.PLANNING,
        action: (intent, context) => {
          // 清除待决策
          context.pendingDecision = undefined;
        },
      },
      {
        from: ConversationState.PROPOSING,
        intent: IntentType.ASK_INFO,
        to: ConversationState.COMPARING,
      },
      {
        from: ConversationState.PROPOSING,
        intent: IntentType.MODIFY,
        to: ConversationState.REFINING,
      },
      {
        from: ConversationState.PROPOSING,
        intent: IntentType.CONFIRM,
        to: ConversationState.PLANNING,
        action: (intent, context) => {
          // 用户可能直接确认，选择第一个选项
          context.pendingDecision = undefined;
        },
      },

      // ========== 从COMPARING状态 ==========
      {
        from: ConversationState.COMPARING,
        intent: IntentType.SELECT_OPTION,
        to: ConversationState.PLANNING,
        action: (intent, context) => {
          context.pendingDecision = undefined;
        },
      },
      {
        from: ConversationState.COMPARING,
        intent: IntentType.ASK_INFO,
        to: ConversationState.COMPARING,
      },
      {
        from: ConversationState.COMPARING,
        intent: IntentType.MODIFY,
        to: ConversationState.PROPOSING,
      },

      // ========== 从REFINING状态 ==========
      {
        from: ConversationState.REFINING,
        intent: IntentType.MODIFY,
        to: ConversationState.PROPOSING,
      },
      {
        from: ConversationState.REFINING,
        intent: IntentType.EXECUTE,
        to: ConversationState.PLANNING,
      },

      // ========== 从PLANNING状态 ==========
      {
        from: ConversationState.PLANNING,
        intent: IntentType.CONFIRM,
        to: ConversationState.EXECUTING,
        action: (intent, context) => {
          context.pendingDecision = undefined;
        },
      },
      {
        from: ConversationState.PLANNING,
        intent: IntentType.MODIFY,
        to: ConversationState.REFINING,
      },
      {
        from: ConversationState.PLANNING,
        intent: IntentType.REJECT,
        to: ConversationState.REFINING,
      },
      // 未知意图允许重新开始探索（用户可能切换了新话题）
      {
        from: ConversationState.PLANNING,
        intent: IntentType.UNKNOWN,
        to: ConversationState.EXPLORING,
      },

      // ========== 从EXECUTING状态 ==========
      {
        from: ConversationState.EXECUTING,
        intent: IntentType.PAUSE,
        to: ConversationState.CONFIRMING,
      },
      {
        from: ConversationState.EXECUTING,
        intent: IntentType.CANCEL,
        to: ConversationState.IDLE,
      },
      {
        from: ConversationState.EXECUTING,
        intent: IntentType.COMPLETE,
        to: ConversationState.REVIEWING,
      },
      {
        from: ConversationState.EXECUTING,
        intent: IntentType.ASK_INFO,
        to: ConversationState.EXECUTING,
      },

      // ========== 从CONFIRMING状态 ==========
      {
        from: ConversationState.CONFIRMING,
        intent: IntentType.CONFIRM,
        to: ConversationState.EXECUTING,
      },
      {
        from: ConversationState.CONFIRMING,
        intent: IntentType.CANCEL,
        to: ConversationState.IDLE,
      },
      {
        from: ConversationState.CONFIRMING,
        intent: IntentType.RESUME,
        to: ConversationState.EXECUTING,
      },

      // ========== 从REVIEWING状态 ==========
      {
        from: ConversationState.REVIEWING,
        intent: IntentType.CONFIRM,
        to: ConversationState.COMPLETED,
      },
      {
        from: ConversationState.REVIEWING,
        intent: IntentType.MODIFY,
        to: ConversationState.REFINING,
      },
      {
        from: ConversationState.REVIEWING,
        intent: IntentType.REJECT,
        to: ConversationState.REFINING,
      },

      // ========== 从COMPLETED状态 ==========
      {
        from: ConversationState.COMPLETED,
        intent: IntentType.ASK_INFO,
        to: ConversationState.EXPLORING,
      },
      {
        from: ConversationState.COMPLETED,
        intent: IntentType.EXECUTE,
        to: ConversationState.PLANNING,
      },
      {
        from: ConversationState.COMPLETED,
        intent: IntentType.UPDATE_CONTEXT,
        to: ConversationState.EXPLORING,
      },

      // ========== 从任何状态都可以更新上下文 ==========
      {
        from: ConversationState.IDLE,
        intent: IntentType.UPDATE_CONTEXT,
        to: ConversationState.EXPLORING,
      },
      {
        from: ConversationState.EXPLORING,
        intent: IntentType.UPDATE_CONTEXT,
        to: ConversationState.EXPLORING,
      },
      {
        from: ConversationState.CLARIFYING,
        intent: IntentType.UPDATE_CONTEXT,
        to: ConversationState.EXPLORING,
      },
      {
        from: ConversationState.PROPOSING,
        intent: IntentType.UPDATE_CONTEXT,
        to: ConversationState.EXPLORING,
      },
      {
        from: ConversationState.COMPARING,
        intent: IntentType.UPDATE_CONTEXT,
        to: ConversationState.EXPLORING,
      },
      {
        from: ConversationState.REFINING,
        intent: IntentType.UPDATE_CONTEXT,
        to: ConversationState.EXPLORING,
      },
      {
        from: ConversationState.PLANNING,
        intent: IntentType.UPDATE_CONTEXT,
        to: ConversationState.EXPLORING,
      },
      {
        from: ConversationState.EXECUTING,
        intent: IntentType.UPDATE_CONTEXT,
        to: ConversationState.EXPLORING,
      },
      {
        from: ConversationState.CONFIRMING,
        intent: IntentType.UPDATE_CONTEXT,
        to: ConversationState.EXPLORING,
      },
      {
        from: ConversationState.REVIEWING,
        intent: IntentType.UPDATE_CONTEXT,
        to: ConversationState.EXPLORING,
      },

      // ========== 从任何状态都可以取消 ==========
      {
        from: ConversationState.EXPLORING,
        intent: IntentType.CANCEL,
        to: ConversationState.IDLE,
      },
      {
        from: ConversationState.PROPOSING,
        intent: IntentType.CANCEL,
        to: ConversationState.IDLE,
      },
      {
        from: ConversationState.COMPARING,
        intent: IntentType.CANCEL,
        to: ConversationState.IDLE,
      },
      {
        from: ConversationState.REFINING,
        intent: IntentType.CANCEL,
        to: ConversationState.IDLE,
      },
      {
        from: ConversationState.PLANNING,
        intent: IntentType.CANCEL,
        to: ConversationState.IDLE,
      },

      // ========== 上下文类意图 ==========
      {
        from: ConversationState.EXPLORING,
        intent: IntentType.SWITCH_TOPIC,
        to: ConversationState.EXPLORING,
        action: (intent, context) => {
          // 保存当前话题到栈
          if (context.topic) {
            // 这里需要外部调用来实际push话题
          }
        },
      },
      {
        from: ConversationState.EXPLORING,
        intent: IntentType.RETURN_TO,
        to: ConversationState.EXPLORING,
      },
    ];
  }

  /**
   * 查找匹配的状态转移规则
   */
  private findTransition(
    currentState: ConversationState,
    intent: Intent
  ): StateTransition | undefined {
    return this.transitions.find(t =>
      t.from === currentState &&
      t.intent === intent.type &&
      (!t.condition || t.condition(intent, { current: currentState, topic: '' }))
    );
  }

  /**
   * 处理无匹配转移的情况
   */
  private handleNoTransition(
    currentState: StateContext,
    intent: Intent
  ): StateTransitionResult {
    // 如果是引用类型的意图，保持当前状态
    if (intent.type === IntentType.REFERENCE) {
      return {
        success: true,
        newState: currentState.current,
        message: '保持当前状态',
      };
    }

    // 未知意图，提供友好提示
    return {
      success: false,
      message: this.buildClarificationMessage(currentState),
    };
  }

  /**
   * 构建澄清消息
   */
  private buildClarificationMessage(context: StateContext): string {
    const state = context.current;

    switch (state) {
      case ConversationState.IDLE:
        return '你好！我是您的 AI 助手。请告诉我您需要什么帮助，比如：\n• "帮我分析一下数据"\n• "写一个简单的网页"\n• "解释一下这个概念"';
      case ConversationState.EXPLORING:
        return '我正在了解您的需求，请提供更多细节，或告诉我您的具体目标。';
      case ConversationState.PROPOSING:
        return '当前正在提供方案，请选择其中一个方案（如"方案1"），或询问更多信息。';
      case ConversationState.CONFIRMING:
        return '当前需要您的确认，请回复"确认"或"取消"。';
      case ConversationState.PLANNING:
        return '📋 当前正在制定计划，您可以：\n• 回复 **确认** 开始执行\n• 回复 **修改** 调整计划\n• 或描述新的需求重新开始';
      case ConversationState.EXECUTING:
        return '当前正在执行任务，可以回复"暂停"或"取消"。';
      default:
        return '我不太理解您的意思，能否换个方式描述？';
    }
  }

  /**
   * 判断是否需要确认
   */
  private requiresConfirmation(
    transition: StateTransition,
    intent: Intent
  ): boolean {
    // 进入执行阶段需要确认
    if (transition.to === ConversationState.EXECUTING) {
      return true;
    }

    // 取消操作需要确认（如果已经在执行）
    if (
      intent.type === IntentType.CANCEL &&
      transition.from === ConversationState.EXECUTING
    ) {
      return true;
    }

    // 完成操作需要确认
    if (intent.type === IntentType.COMPLETE) {
      return true;
    }

    return false;
  }
}
