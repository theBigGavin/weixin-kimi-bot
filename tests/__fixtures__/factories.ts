/**
 * 测试数据工厂
 * 提供标准化的测试数据创建函数
 */

import type { AgentConfig } from '../../src/agent/types.js';
import type { ILinkMessage } from '../../src/ilink/types.js';

let idCounter = 0;

export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}`;
}

/**
 * 创建 Agent 配置
 */
export function createAgentFixture(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: generateId('agent'),
    name: 'Test Agent',
    wechat: {
      accountId: generateId('wxid'),
      nickname: 'Test User',
    },
    workspace: {
      path: `/tmp/test-workspace/${generateId('ws')}`,
    },
    ai: {
      model: 'kimi-code',
      templateId: 'programmer',
      maxTurns: 100,
    },
    memory: {
      enabled: true,
      autoExtract: true,
    },
    features: {
      fileAccess: true,
      webSearch: true,
      scheduledTasks: true,
    },
    ...overrides,
  } as AgentConfig;
}

/**
 * 创建微信消息
 */
export function createMessageFixture(overrides: Partial<ILinkMessage> = {}): ILinkMessage {
  return {
    msgId: generateId('msg'),
    fromUser: generateId('wxid'),
    toUser: generateId('wxid'),
    content: 'Hello, this is a test message',
    type: 1, // 文本消息
    createTime: Date.now(),
    ...overrides,
  } as ILinkMessage;
}

/**
 * 创建会话上下文
 */
export function createSessionFixture(overrides = {}) {
  return {
    id: generateId('session'),
    agentId: generateId('agent'),
    userId: generateId('wxid'),
    state: 'idle',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}
