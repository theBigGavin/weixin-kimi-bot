/**
 * 对话状态机测试
 */

import { describe, it, expect } from 'vitest';
import { ConversationStateMachine } from '../../src/context/state-machine.js';
import { ConversationState, IntentType } from '../../src/context/types.js';

describe('ConversationStateMachine', () => {
  const stateMachine = new ConversationStateMachine();

  describe('基本状态转移', () => {
    it('IDLE -> EXPLORING (ASK_INFO)', () => {
      const result = stateMachine.transition(
        { current: ConversationState.IDLE, topic: '' },
        { type: IntentType.ASK_INFO, confidence: 1, rawText: '', entities: [], references: [] }
      );
      expect(result.success).toBe(true);
      expect(result.newState).toBe(ConversationState.EXPLORING);
    });

    it('EXPLORING -> PROPOSING (需要外部触发，状态机只处理意图)', () => {
      // 实际上PROPOSING是由AI输出触发的，不是用户意图
      // 但状态机可以从EXPLORING直接到PLANNING
      const result = stateMachine.transition(
        { current: ConversationState.EXPLORING, topic: '' },
        { type: IntentType.EXECUTE, confidence: 1, rawText: '', entities: [], references: [] }
      );
      expect(result.success).toBe(true);
      expect(result.newState).toBe(ConversationState.PLANNING);
    });

    it('PROPOSING -> PLANNING (SELECT_OPTION)', () => {
      const result = stateMachine.transition(
        { current: ConversationState.PROPOSING, topic: '' },
        { type: IntentType.SELECT_OPTION, confidence: 1, rawText: '方案1', entities: [], references: [] }
      );
      expect(result.success).toBe(true);
      expect(result.newState).toBe(ConversationState.PLANNING);
    });

    it('PLANNING -> EXECUTING (CONFIRM)', () => {
      const result = stateMachine.transition(
        { current: ConversationState.PLANNING, topic: '' },
        { type: IntentType.CONFIRM, confidence: 1, rawText: '确认', entities: [], references: [] }
      );
      expect(result.success).toBe(true);
      expect(result.newState).toBe(ConversationState.EXECUTING);
      expect(result.requiresConfirmation).toBe(true);
    });

    it('EXECUTING -> IDLE (CANCEL)', () => {
      const result = stateMachine.transition(
        { current: ConversationState.EXECUTING, topic: '' },
        { type: IntentType.CANCEL, confidence: 1, rawText: '取消', entities: [], references: [] }
      );
      expect(result.success).toBe(true);
      expect(result.newState).toBe(ConversationState.IDLE);
    });
  });

  describe('无效状态转移', () => {
    it('PROPOSING状态不能EXECUTE', () => {
      const result = stateMachine.transition(
        { current: ConversationState.PROPOSING, topic: '' },
        { type: IntentType.EXECUTE, confidence: 1, rawText: '', entities: [], references: [] }
      );
      expect(result.success).toBe(false);
    });

    it('IDLE状态不能CONFIRM', () => {
      const result = stateMachine.transition(
        { current: ConversationState.IDLE, topic: '' },
        { type: IntentType.CONFIRM, confidence: 1, rawText: '', entities: [], references: [] }
      );
      expect(result.success).toBe(false);
    });
  });

  describe('期望输入类型', () => {
    it('PROPOSING状态期望select_option', () => {
      const expected = stateMachine.getExpectedInput(ConversationState.PROPOSING);
      expect(expected.type).toBe('select_option');
    });

    it('CONFIRMING状态期望confirm', () => {
      const expected = stateMachine.getExpectedInput(ConversationState.CONFIRMING);
      expect(expected.type).toBe('confirm');
    });

    it('IDLE状态期望free_text', () => {
      const expected = stateMachine.getExpectedInput(ConversationState.IDLE);
      expect(expected.type).toBe('free_text');
    });
  });
});
