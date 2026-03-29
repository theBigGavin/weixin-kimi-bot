/**
 * Prompt Builder 测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  ContextualPromptBuilder, 
  createPromptBuilder,
  PromptBuildOptions 
} from '../../src/prompt/builder.js';
import { ConversationState } from '../../src/context/types.js';
import type { SessionContext } from '../../src/context/types.js';
import type { AgentRuntime } from '../../src/agent/types.js';

describe('ContextualPromptBuilder', () => {
  let builder: ContextualPromptBuilder;

  beforeEach(() => {
    builder = new ContextualPromptBuilder();
  });

  const createMockSessionContext = (overrides = {}): SessionContext => ({
    userId: 'test-user',
    agentId: 'test-agent',
    state: {
      current: ConversationState.IDLE,
      topic: '',
    },
    messages: [],
    activeOptions: new Map(),
    topicStack: [],
    metadata: {
      version: '1.0',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    ...overrides,
  });

  const createMockRuntime = (overrides = {}): AgentRuntime => ({
    config: {
      id: 'test-agent',
      name: 'Test Agent',
      workspace: { path: '/test/workspace' },
      memory: { enabled: false },
    },
    template: {
      id: 'default',
      name: 'Default',
      icon: '🤖',
      description: 'Default template',
      systemPrompt: 'You are a helpful assistant.',
    },
    memory: {
      facts: [],
      projects: [],
      userProfile: {},
    },
    ...overrides,
  });

  describe('createPromptBuilder', () => {
    it('should create a new ContextualPromptBuilder instance', () => {
      const builder = createPromptBuilder();
      expect(builder).toBeInstanceOf(ContextualPromptBuilder);
    });
  });

  describe('basic build', () => {
    it('should build prompt with basic structure', () => {
      const runtime = createMockRuntime();
      const context = createMockSessionContext();
      const userInput = 'Hello';

      const prompt = builder.build(runtime, context, userInput);

      expect(prompt).toContain('You are a helpful assistant.');
      expect(prompt).toContain('## 当前对话状态');
      expect(prompt).toContain('## 用户消息');
      expect(prompt).toContain('Hello');
    });

    it('should include state translation', () => {
      const runtime = createMockRuntime();
      const context = createMockSessionContext({
        state: { current: ConversationState.EXPLORING, topic: '' },
      });

      const prompt = builder.build(runtime, context, 'Hi');

      expect(prompt).toContain('阶段: 探索');
    });

    it('should include topic if present', () => {
      const runtime = createMockRuntime();
      const context = createMockSessionContext({
        state: { current: ConversationState.IDLE, topic: 'AI Tools' },
      });

      const prompt = builder.build(runtime, context, 'Hello');

      expect(prompt).toContain('主题: AI Tools');
    });
  });

  describe('options section', () => {
    it('should include active options when available', () => {
      const runtime = createMockRuntime();
      const options = new Map([
        ['opt_1', { id: 'opt_1', label: 'Option 1', description: 'First option description' }],
        ['opt_2', { id: 'opt_2', label: 'Option 2', description: 'Second option description' }],
      ]);
      const context = createMockSessionContext({
        activeOptions: options,
      });

      const prompt = builder.build(runtime, context, 'Select one');

      expect(prompt).toContain('## 当前可选项');
      expect(prompt).toContain('[opt_1] Option 1');
      expect(prompt).toContain('[opt_2] Option 2');
      expect(prompt).toContain('方案一');
      expect(prompt).toContain('方案二');
    });

    it('should not include options section when empty', () => {
      const runtime = createMockRuntime();
      const context = createMockSessionContext({
        activeOptions: new Map(),
      });

      const prompt = builder.build(runtime, context, 'Hello');

      expect(prompt).not.toContain('## 当前可选项');
    });

    it('should truncate long option descriptions', () => {
      const runtime = createMockRuntime();
      const longDescription = 'A'.repeat(200);
      const options = new Map([
        ['opt_1', { id: 'opt_1', label: 'Option 1', description: longDescription }],
      ]);
      const context = createMockSessionContext({
        activeOptions: options,
      });

      const prompt = builder.build(runtime, context, 'Select');

      // 验证描述被截断（代码中使用'...'而非'...(已截断)'）
      expect(prompt).toContain('A'.repeat(150) + '...');
      expect(prompt).not.toContain('A'.repeat(160));
    });
  });

  describe('history section', () => {
    it('should include recent messages', () => {
      const runtime = createMockRuntime();
      const messages = [
        { role: 'user' as const, content: 'Hello', timestamp: Date.now() - 10000 },
        { role: 'assistant' as const, content: 'Hi there!', timestamp: Date.now() - 5000 },
      ];
      const context = createMockSessionContext({ messages });

      const prompt = builder.build(runtime, context, 'How are you?');

      expect(prompt).toContain('## 近期对话');
      expect(prompt).toContain('用户:');
      expect(prompt).toContain('Hello');
      expect(prompt).toContain('AI:');
      expect(prompt).toContain('Hi there!');
    });

    it('should respect includeRecentMessages limit', () => {
      const runtime = createMockRuntime();
      const messages = [
        { role: 'user' as const, content: 'Message 1', timestamp: Date.now() - 30000 },
        { role: 'user' as const, content: 'Message 2', timestamp: Date.now() - 20000 },
        { role: 'user' as const, content: 'Message 3', timestamp: Date.now() - 10000 },
      ];
      const context = createMockSessionContext({ messages });

      const options: PromptBuildOptions = { includeRecentMessages: 2 };
      const prompt = builder.build(runtime, context, 'Hello', options);

      expect(prompt).toContain('Message 2');
      expect(prompt).toContain('Message 3');
      expect(prompt).not.toContain('Message 1');
    });

    it('should truncate long message content', () => {
      const runtime = createMockRuntime();
      const longContent = 'A'.repeat(500);
      const messages = [
        { role: 'user' as const, content: longContent, timestamp: Date.now() },
      ];
      const context = createMockSessionContext({ messages });

      const prompt = builder.build(runtime, context, 'Hello');

      expect(prompt).toContain('...(已截断)');
    });

    it('should not include history section when no messages', () => {
      const runtime = createMockRuntime();
      const context = createMockSessionContext({ messages: [] });

      const prompt = builder.build(runtime, context, 'Hello');

      expect(prompt).not.toContain('## 近期对话');
    });

    it('should not include history when includeRecentMessages is 0', () => {
      const runtime = createMockRuntime();
      const messages = [
        { role: 'user' as const, content: 'Hello', timestamp: Date.now() },
      ];
      const context = createMockSessionContext({ messages });

      const options: PromptBuildOptions = { includeRecentMessages: 0 };
      const prompt = builder.build(runtime, context, 'Hello', options);

      expect(prompt).not.toContain('## 近期对话');
    });
  });

  describe('current task section', () => {
    it('should include current task when available', () => {
      const runtime = createMockRuntime();
      const context = createMockSessionContext({
        currentTaskId: 'task-123',
      });

      const prompt = builder.build(runtime, context, 'Hello');

      expect(prompt).toContain('## 当前任务');
      expect(prompt).toContain('进行中的任务: task-123');
    });

    it('should include flow task when available', () => {
      const runtime = createMockRuntime();
      const context = createMockSessionContext({
        currentFlowTaskId: 'flow-456',
      });

      const prompt = builder.build(runtime, context, 'Hello');

      expect(prompt).toContain('## 当前任务');
      expect(prompt).toContain('进行中的FlowTask: flow-456');
    });

    it('should not include task section when no tasks', () => {
      const runtime = createMockRuntime();
      const context = createMockSessionContext();

      const prompt = builder.build(runtime, context, 'Hello');

      expect(prompt).not.toContain('## 当前任务');
    });
  });

  describe('topic stack section', () => {
    it('should include topic stack when enabled', () => {
      const runtime = createMockRuntime();
      const topicStack = [
        { id: 'topic1', label: 'Topic 1', description: 'Description 1', createdAt: Date.now() },
        { id: 'topic2', label: 'Topic 2', description: 'Description 2', createdAt: Date.now() },
      ];
      const context = createMockSessionContext({ topicStack });

      const options: PromptBuildOptions = { includeTopicStack: true };
      const prompt = builder.build(runtime, context, 'Hello', options);

      expect(prompt).toContain('## 话题栈');
      expect(prompt).toContain('Topic 1');
      expect(prompt).toContain('Topic 2');
    });

    it('should not include topic stack when disabled', () => {
      const runtime = createMockRuntime();
      const topicStack = [
        { id: 'topic1', label: 'Topic 1', description: 'Description 1', createdAt: Date.now() },
      ];
      const context = createMockSessionContext({ topicStack });

      const options: PromptBuildOptions = { includeTopicStack: false };
      const prompt = builder.build(runtime, context, 'Hello', options);

      expect(prompt).not.toContain('## 话题栈');
    });

    it('should not include topic stack when empty', () => {
      const runtime = createMockRuntime();
      const context = createMockSessionContext({ topicStack: [] });

      const options: PromptBuildOptions = { includeTopicStack: true };
      const prompt = builder.build(runtime, context, 'Hello', options);

      expect(prompt).not.toContain('## 话题栈');
    });
  });

  describe('workspace section', () => {
    it('should include workspace by default', () => {
      const runtime = createMockRuntime();
      const context = createMockSessionContext();

      const prompt = builder.build(runtime, context, 'Hello');

      expect(prompt).toContain('## 工作目录');
      expect(prompt).toContain('/test/workspace');
    });

    it('should not include workspace when disabled', () => {
      const runtime = createMockRuntime();
      const context = createMockSessionContext();

      const options: PromptBuildOptions = { includeWorkspace: false };
      const prompt = builder.build(runtime, context, 'Hello', options);

      expect(prompt).not.toContain('## 工作目录');
    });
  });

  describe('state-specific output guidance', () => {
    it('should include proposing guidance for PROPOSING state', () => {
      const runtime = createMockRuntime();
      const context = createMockSessionContext({
        state: { current: ConversationState.PROPOSING, topic: '' },
      });

      const prompt = builder.build(runtime, context, 'Hello');

      expect(prompt).toContain('## 输出格式指导');
      expect(prompt).toContain('[option_id]');
    });

    it('should include confirming guidance for CONFIRMING state', () => {
      const runtime = createMockRuntime();
      const context = createMockSessionContext({
        state: { current: ConversationState.CONFIRMING, topic: '' },
      });

      const prompt = builder.build(runtime, context, 'Hello');

      expect(prompt).toContain('当前需要用户确认');
    });

    it('should include planning guidance for PLANNING state', () => {
      const runtime = createMockRuntime();
      const context = createMockSessionContext({
        state: { current: ConversationState.PLANNING, topic: '' },
      });

      const prompt = builder.build(runtime, context, 'Hello');

      expect(prompt).toContain('当前正在制定执行计划');
    });

    it('should include executing guidance for EXECUTING state', () => {
      const runtime = createMockRuntime();
      const context = createMockSessionContext({
        state: { current: ConversationState.EXECUTING, topic: '' },
      });

      const prompt = builder.build(runtime, context, 'Hello');

      expect(prompt).toContain('当前正在执行任务');
    });

    it('should include exploring guidance for EXPLORING state', () => {
      const runtime = createMockRuntime();
      const context = createMockSessionContext({
        state: { current: ConversationState.EXPLORING, topic: '' },
      });

      const prompt = builder.build(runtime, context, 'Hello');

      expect(prompt).toContain('当前正在探索用户需求');
    });
  });

  describe('pending decision', () => {
    it('should include pending decision info', () => {
      const runtime = createMockRuntime();
      const context = createMockSessionContext({
        state: {
          current: ConversationState.CONFIRMING,
          topic: '',
          pendingDecision: {
            id: 'dec1',
            type: 'select_option',
            description: 'Choose a plan',
            options: ['opt1', 'opt2'],
            createdAt: Date.now(),
            expiresAt: Date.now() + 600000,
          },
        },
      });

      const prompt = builder.build(runtime, context, 'Hello');

      expect(prompt).toContain('等待决策: Choose a plan');
      expect(prompt).toContain('可选项: opt1, opt2');
    });
  });

  describe('state data', () => {
    it('should include state data if present', () => {
      const runtime = createMockRuntime();
      const context = createMockSessionContext({
        state: {
          current: ConversationState.IDLE,
          topic: '',
          data: {
            projectName: 'Test Project',
            status: 'active',
          },
        },
      });

      const prompt = builder.build(runtime, context, 'Hello');

      expect(prompt).toContain('相关数据:');
      expect(prompt).toContain('projectName: Test Project');
      expect(prompt).toContain('status: active');
    });
  });

  describe('footer', () => {
    it('should include date in footer', () => {
      const runtime = createMockRuntime();
      const context = createMockSessionContext();

      const prompt = builder.build(runtime, context, 'Hello');

      expect(prompt).toContain('## 注意');
      expect(prompt).toContain('当前日期:');
      expect(prompt).toContain(new Date().toLocaleDateString('zh-CN'));
    });
  });

  describe('prompt truncation', () => {
    it('should truncate when exceeding maxLength', () => {
      const runtime = createMockRuntime({
        template: {
          id: 'default',
          name: 'Default',
          icon: '🤖',
          description: 'Default template',
          systemPrompt: 'A'.repeat(5000),
        },
      });
      const context = createMockSessionContext();

      const options: PromptBuildOptions = { maxLength: 1000 };
      const prompt = builder.build(runtime, context, 'Hello', options);

      expect(prompt.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('option indexing', () => {
    it('should use Chinese numerals for first 5 options', () => {
      const runtime = createMockRuntime();
      const options = new Map([
        ['opt_1', { id: 'opt_1', label: 'Option 1', description: 'Desc 1' }],
        ['opt_2', { id: 'opt_2', label: 'Option 2', description: 'Desc 2' }],
        ['opt_3', { id: 'opt_3', label: 'Option 3', description: 'Desc 3' }],
        ['opt_4', { id: 'opt_4', label: 'Option 4', description: 'Desc 4' }],
        ['opt_5', { id: 'opt_5', label: 'Option 5', description: 'Desc 5' }],
      ]);
      const context = createMockSessionContext({ activeOptions: options });

      const prompt = builder.build(runtime, context, 'Select');

      expect(prompt).toContain('方案一');
      expect(prompt).toContain('方案二');
      expect(prompt).toContain('方案三');
      expect(prompt).toContain('方案四');
      expect(prompt).toContain('方案五');
      expect(prompt).toContain('选A');
      expect(prompt).toContain('选B');
      expect(prompt).toContain('选C');
      expect(prompt).toContain('选D');
      expect(prompt).toContain('选E');
    });

    it('should use Arabic numerals for options beyond 5', () => {
      const runtime = createMockRuntime();
      // 需要6个选项来测试第6个(i=5)的显示
      const options = new Map([
        ['opt_1', { id: 'opt_1', label: 'Option 1', description: 'Desc 1' }],
        ['opt_2', { id: 'opt_2', label: 'Option 2', description: 'Desc 2' }],
        ['opt_3', { id: 'opt_3', label: 'Option 3', description: 'Desc 3' }],
        ['opt_4', { id: 'opt_4', label: 'Option 4', description: 'Desc 4' }],
        ['opt_5', { id: 'opt_5', label: 'Option 5', description: 'Desc 5' }],
        ['opt_6', { id: 'opt_6', label: 'Option 6', description: 'Desc 6' }],
      ]);
      const context = createMockSessionContext({ activeOptions: options });

      const prompt = builder.build(runtime, context, 'Select');

      // 第6个选项(i=5)应该使用阿拉伯数字和字母F
      expect(prompt).toContain('方案6');
      expect(prompt).toContain('选F');
    });
  });
});
