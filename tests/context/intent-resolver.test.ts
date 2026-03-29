/**
 * 意图识别器测试
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { IntentResolver } from '../../src/context/intent-resolver.js';
import { llmIntentResolver } from '../../src/context/llm-intent-resolver.js';
import { SessionContext, ConversationState, IntentType } from '../../src/context/types.js';

describe('IntentResolver', () => {
  const resolver = new IntentResolver();

  // 测试中禁用LLM，使用正则模式
  beforeAll(() => {
    llmIntentResolver.updateOptions({ disabled: true });
  });

  function createTestContext(state: ConversationState = ConversationState.IDLE): SessionContext {
    return {
      id: 'test',
      userId: 'user1',
      agentId: 'agent1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      state: {
        current: state,
        topic: '测试',
      },
      messages: [],
      activeOptions: new Map(),
      topicStack: [],
      metadata: {
        totalMessages: 0,
        lastActiveAt: Date.now(),
        isNewSession: false,
      },
    };
  }

  describe('选择选项意图', () => {
    it('应该识别"选方案1"', async () => {
      const context = createTestContext(ConversationState.PROPOSING);
      const intent = await resolver.identify('选方案1', context);
      
      expect(intent.type).toBe(IntentType.SELECT_OPTION);
      expect(intent.confidence).toBeGreaterThan(0.75);
    });

    it('应该识别"采用A方案"', async () => {
      const context = createTestContext(ConversationState.PROPOSING);
      const intent = await resolver.identify('采用A方案', context);
      
      expect(intent.type).toBe(IntentType.SELECT_OPTION);
    });
  });

  describe('确认意图', () => {
    it('应该识别"确认"', async () => {
      const context = createTestContext(ConversationState.CONFIRMING);
      const intent = await resolver.identify('确认', context);
      
      expect(intent.type).toBe(IntentType.CONFIRM);
      expect(intent.confidence).toBeGreaterThan(0.9);
    });

    it('应该识别"好的"', async () => {
      const context = createTestContext(ConversationState.CONFIRMING);
      const intent = await resolver.identify('好的', context);
      
      expect(intent.type).toBe(IntentType.CONFIRM);
    });
  });

  describe('拒绝意图', () => {
    it('应该识别"取消"', async () => {
      const context = createTestContext();
      const intent = await resolver.identify('取消', context);
      
      expect(intent.type).toBe(IntentType.CANCEL);
    });

    it('应该识别"不行"', async () => {
      const context = createTestContext(ConversationState.CONFIRMING);
      const intent = await resolver.identify('不行', context);
      
      expect(intent.type).toBe(IntentType.REJECT);
    });
  });

  describe('上下文推断', () => {
    it('在PROPOSING状态下，数字应该推断为SELECT_OPTION', async () => {
      const context = createTestContext(ConversationState.PROPOSING);
      const intent = await resolver.identify('2', context);
      
      expect(intent.type).toBe(IntentType.SELECT_OPTION);
    });

    it('在CONFIRMING状态下，短回复应该推断为CONFIRM或REJECT', async () => {
      const context = createTestContext(ConversationState.CONFIRMING);
      
      const confirmIntent = await resolver.identify('好', context);
      expect([IntentType.CONFIRM, IntentType.REJECT]).toContain(confirmIntent.type);
    });
  });

  describe('实体提取', () => {
    it('应该提取文件路径', async () => {
      const context = createTestContext();
      const intent = await resolver.identify('查看 src/index.ts 文件', context);
      
      const fileEntity = intent.entities.find(e => e.type === 'file');
      expect(fileEntity).toBeDefined();
      expect(fileEntity?.value).toBe('src/index.ts');
    });

    it('应该提取代码片段', async () => {
      const context = createTestContext();
      const intent = await resolver.identify('使用 `console.log` 输出', context);
      
      const codeEntity = intent.entities.find(e => e.type === 'code');
      expect(codeEntity).toBeDefined();
      expect(codeEntity?.value).toBe('console.log');
    });
  });

  describe('更新上下文意图', () => {
    it('应该识别"更新记忆"', async () => {
      const context = createTestContext(ConversationState.PLANNING);
      const intent = await resolver.identify('项目经历了重大重构，请熟悉下项目的最新情况，更新下记忆。', context);
      
      expect(intent.type).toBe(IntentType.UPDATE_CONTEXT);
      expect(intent.confidence).toBeGreaterThan(0.8);
    });

    it('应该识别"同步项目情况"', async () => {
      const context = createTestContext(ConversationState.IDLE);
      const intent = await resolver.identify('请同步一下项目的最新情况', context);
      
      expect(intent.type).toBe(IntentType.UPDATE_CONTEXT);
    });

    it('应该识别"刷新上下文"', async () => {
      const context = createTestContext(ConversationState.EXECUTING);
      const intent = await resolver.identify('刷新上下文', context);
      
      expect(intent.type).toBe(IntentType.UPDATE_CONTEXT);
    });

    it('应该识别"重新了解项目"', async () => {
      const context = createTestContext(ConversationState.COMPLETED);
      const intent = await resolver.identify('我想重新了解一下当前项目', context);
      
      expect(intent.type).toBe(IntentType.UPDATE_CONTEXT);
    });
  });
});
