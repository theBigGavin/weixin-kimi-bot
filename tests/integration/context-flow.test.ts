/**
 * 上下文流程集成测试
 * 
 * 测试完整的对话流程
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionContextManager } from '../../src/context/session-context.js';
import { ContextPersistence } from '../../src/context/persistence.js';
import { ConversationStateMachine } from '../../src/context/state-machine.js';
import { ReferenceResolver } from '../../src/context/reference-resolver.js';
import { IntentResolver } from '../../src/context/intent-resolver.js';
import { OutputParser } from '../../src/context/output-parser.js';
import { ConversationState, IntentType } from '../../src/context/types.js';

describe('完整对话流程', () => {
  let contextManager: SessionContextManager;
  let stateMachine: ConversationStateMachine;
  let referenceResolver: ReferenceResolver;
  let intentResolver: IntentResolver;
  let outputParser: OutputParser;

  beforeEach(() => {
    const persistence = new ContextPersistence();
    contextManager = new SessionContextManager(persistence);
    stateMachine = new ConversationStateMachine();
    referenceResolver = new ReferenceResolver();
    intentResolver = new IntentResolver();
    outputParser = new OutputParser();
  });

  it('完整流程：需求探索 -> 提供方案 -> 选择 -> 执行', async () => {
    const userId = 'test-user';
    const agentId = 'test-agent';

    // 步骤1：用户提出需求
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
    expect(intent.type).toBe(IntentType.SELECT_OPTION);
    expect(intent.references[0].targetId).toBe('opt_1');

    transition = stateMachine.transition(context.state, intent);
    expect(transition.success).toBe(true);
    expect(transition.newState).toBe(ConversationState.PLANNING);

    await contextManager.updateState(context, transition.newState!);
    await contextManager.addMessage(context, 'user', '按方案1落实', undefined, intent);

    // 验证状态
    context = await contextManager.getOrCreate(userId, agentId);
    expect(context.state.current).toBe(ConversationState.PLANNING);
    expect(context.messages).toHaveLength(3);
  });

  it('应该支持多轮对话和状态保持', async () => {
    const userId = 'test-user-2';
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
  });
});
