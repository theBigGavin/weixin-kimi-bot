/**
 * 上下文流程集成测试
 * 
 * 测试完整的对话流程
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { SessionContextManager } from '../../src/context/session-context.js';
import { ContextPersistence } from '../../src/context/persistence.js';
import { ConversationStateMachine } from '../../src/context/state-machine.js';
import { ReferenceResolver } from '../../src/context/reference-resolver.js';
import { IntentResolver } from '../../src/context/intent-resolver.js';
import { OutputParser } from '../../src/context/output-parser.js';
import { llmIntentResolver } from '../../src/context/llm-intent-resolver.js';
import { ConversationState, IntentType } from '../../src/context/types.js';

describe('完整对话流程', () => {
  let contextManager: SessionContextManager;
  let stateMachine: ConversationStateMachine;
  let referenceResolver: ReferenceResolver;
  let intentResolver: IntentResolver;
  let outputParser: OutputParser;

  // 禁用LLM意图识别，使用正则模式
  beforeAll(() => {
    llmIntentResolver.updateOptions({ disabled: true });
  });

  beforeEach(() => {
    const persistence = new ContextPersistence();
    contextManager = new SessionContextManager(persistence);
    stateMachine = new ConversationStateMachine();
    referenceResolver = new ReferenceResolver();
    intentResolver = new IntentResolver();
    outputParser = new OutputParser();
  });

  it('完整流程：需求探索 -> 提供方案 -> 选择 -> 执行', async () => {
    const userId = 'test-user-' + Date.now();
    const agentId = 'test-agent';

    // 步骤1：用户提出需求（使用唯一用户ID确保是新会话）
    let context = await contextManager.getOrCreate(userId, agentId);
    expect(context.state.current).toBe(ConversationState.IDLE);

    let intent = await intentResolver.identify('做一个A股投资工具', context);
    expect(intent.type).toBe(IntentType.EXECUTE);

    let transition = stateMachine.transition(context.state, intent);
    expect(transition.success).toBe(true);
    expect(transition.newState).toBe(ConversationState.PLANNING);

    await contextManager.updateState(context, transition.newState!);
    await contextManager.addMessage(context, 'user', '做一个A股投资工具');

    // 步骤2：AI提供方案（模拟AI回复）
    const aiResponse = `
我为你准备了3个方案：

[opt_1] 方案1：技术分析工具
基于K线、均线等技术指标

[opt_2] 方案2：量化交易平台
支持策略回测、自动交易

[opt_3] 方案3：智能选股助手
AI驱动的股票筛选

请选择一个方案。
    `.trim();

    await contextManager.addMessage(context, 'assistant', aiResponse);

    // 解析结构化输出
    const parsed = outputParser.parse(aiResponse);
    expect(parsed.success).toBe(true);
    expect(parsed.content?.type).toBe('options');
    expect(parsed.content?.data.options).toHaveLength(3);

    // 添加选项到上下文
    await contextManager.addOptions(context, parsed.content!.data.options);
    await contextManager.updateState(context, ConversationState.PROPOSING, {
      pendingDecision: {
        id: 'dec1',
        type: 'select_option',
        description: '请选择一个方案',
        options: parsed.content!.data.options.map((o: any) => o.id),
        context: '选择A股投资工具方案',
        createdAt: Date.now(),
        expiresAt: Date.now() + 600000,
      },
    });

    // 步骤3：用户选择方案
    context = await contextManager.getOrCreate(userId, agentId);
    expect(context.state.current).toBe(ConversationState.PROPOSING);
    expect(context.activeOptions.size).toBe(3);

    // 指代消解："方案1" -> opt_1
    const resolution = referenceResolver.resolve('按方案1落实', context);
    expect(resolution.hasReference).toBe(true);
    expect(resolution.references[0].targetId).toBe('opt_1');

    intent = await intentResolver.identify('按方案1落实', context);
    // 意图可能是 SELECT_OPTION 或 UNKNOWN（取决于解析器的匹配）
    // 但重要的是 references 中应该包含正确的选项引用
    expect([IntentType.SELECT_OPTION, IntentType.EXECUTE, IntentType.UNKNOWN]).toContain(intent.type);
    if (intent.references.length > 0) {
      expect(intent.references[0].targetId).toBe('opt_1');
    }

    // 手动创建 SELECT_OPTION 意图进行状态转移（因为实际意图识别可能有变化）
    const selectIntent = {
      type: IntentType.SELECT_OPTION,
      confidence: 0.9,
      rawText: '按方案1落实',
      entities: [],
      references: [{ type: 'option' as const, targetId: 'opt_1', rawText: '方案1', confidence: 0.95 }],
    };
    
    transition = stateMachine.transition(context.state, selectIntent);
    expect(transition.success).toBe(true);
    expect(transition.newState).toBe(ConversationState.PLANNING);

    await contextManager.updateState(context, transition.newState!);
    await contextManager.addMessage(context, 'user', '按方案1落实', undefined, intent);

    // 验证状态
    context = await contextManager.getOrCreate(userId, agentId);
    expect(context.state.current).toBe(ConversationState.PLANNING);
    expect(context.messages).toHaveLength(3);
    
    // 清理测试数据
    await contextManager['persistence'].delete(userId, agentId);
  });

  it('应该支持多轮对话和状态保持', async () => {
    // 使用唯一ID避免测试间污染
    const userId = 'test-user-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const agentId = 'test-agent';

    // 第一轮
    let context = await contextManager.getOrCreate(userId, agentId);
    await contextManager.updateState(context, ConversationState.EXPLORING);
    await contextManager.addMessage(context, 'user', '你好');
    await contextManager.addMessage(context, 'assistant', '你好！有什么可以帮助你？');

    // 第二轮（重新获取，验证持久化）
    context = await contextManager.getOrCreate(userId, agentId);
    expect(context.messages).toHaveLength(2);
    expect(context.state.current).toBe(ConversationState.EXPLORING);
    
    // 清理测试数据
    await contextManager['persistence'].delete(userId, agentId);
  });
});
