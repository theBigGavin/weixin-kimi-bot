/**
 * 指代消解引擎测试
 */

import { describe, it, expect } from 'vitest';
import { ReferenceResolver } from '../../src/context/reference-resolver.js';
import { SessionContext, ConversationState, Option } from '../../src/context/types.js';

describe('ReferenceResolver', () => {
  const resolver = new ReferenceResolver();

  // 创建测试上下文
  function createTestContext(options: Option[] = []): SessionContext {
    return {
      id: 'test',
      userId: 'user1',
      agentId: 'agent1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      state: {
        current: ConversationState.PROPOSING,
        topic: '测试',
        pendingDecision: {
          id: 'dec1',
          type: 'select_option',
          description: '请选择一个方案',
          options: options.map(o => o.id),
          context: '测试上下文',
          createdAt: Date.now(),
          expiresAt: Date.now() + 60000,
        },
      },
      messages: [],
      activeOptions: new Map(options.map(o => [o.id, o])),
      topicStack: [],
      metadata: {
        totalMessages: 0,
        lastActiveAt: Date.now(),
        isNewSession: false,
      },
    };
  }

  const testOptions: Option[] = [
    { id: 'opt_1', label: '方案1：技术分析工具', description: '基于K线分析', createdAt: Date.now() },
    { id: 'opt_2', label: '方案2：量化交易平台', description: '支持策略回测', createdAt: Date.now() },
    { id: 'opt_3', label: '方案3：智能选股助手', description: 'AI驱动', createdAt: Date.now() },
  ];

  describe('数字索引解析', () => {
    it('应该解析"方案1"为opt_1', () => {
      const context = createTestContext(testOptions);
      const result = resolver.resolve('按方案1落实', context);
      
      expect(result.hasReference).toBe(true);
      expect(result.references).toHaveLength(1);
      expect(result.references[0].type).toBe('option');
      expect(result.references[0].targetId).toBe('opt_1');
      expect(result.references[0].confidence).toBeGreaterThan(0.9);
    });

    it('应该解析"选第二个"为opt_2', () => {
      const context = createTestContext(testOptions);
      const result = resolver.resolve('选第二个', context);
      
      expect(result.hasReference).toBe(true);
      expect(result.references[0].targetId).toBe('opt_2');
    });

    it('应该解析"第三个方案"为opt_3', () => {
      const context = createTestContext(testOptions);
      const result = resolver.resolve('采用第三个方案', context);
      
      expect(result.hasReference).toBe(true);
      expect(result.references[0].targetId).toBe('opt_3');
    });
  });

  describe('字母标签解析', () => {
    it('应该解析"方案A"为opt_1', () => {
      const context = createTestContext(testOptions);
      const result = resolver.resolve('按方案A落实', context);
      
      expect(result.hasReference).toBe(true);
      expect(result.references[0].targetId).toBe('opt_1');
    });

    it('应该解析"选B"为opt_2', () => {
      const context = createTestContext(testOptions);
      const result = resolver.resolve('选B', context);
      
      expect(result.hasReference).toBe(true);
      expect(result.references[0].targetId).toBe('opt_2');
    });
  });

  describe('指代词解析', () => {
    it('应该解析"这个方案"', () => {
      const context = createTestContext(testOptions);
      // 添加一个消息让"这个"有上下文
      context.messages.push({
        id: 'msg1',
        role: 'assistant',
        content: '[opt_1] 方案1：技术分析工具',
        timestamp: Date.now(),
        structuredContent: {
          type: 'options',
          data: { options: [testOptions[0]] },
        },
      });

      const result = resolver.resolve('这个方案不错', context);
      expect(result.hasReference).toBe(true);
    });
  });

  describe('无效引用', () => {
    it('超出范围的索引和没有选项的情况', () => {
      // 这些情况下的行为取决于实现细节
      // 主要验证不会抛出异常
      const context1 = createTestContext(testOptions);
      expect(() => resolver.resolve('选第10个', context1)).not.toThrow();
      
      const context2 = createTestContext([]);
      expect(() => resolver.resolve('方案1', context2)).not.toThrow();
    });
  });
});
