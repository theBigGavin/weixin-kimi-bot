/**
 * Command Handler 测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getCommandList, handleCommand, pendingTasks, userAutoRoute } from '../../src/handlers/command-handler.js';
import type { CommandContext } from '../../src/handlers/types.js';
import type { AgentRuntime, AgentConfig } from '../../src/agent/types.js';

describe('getCommandList', () => {
  it('should return all available commands', () => {
    const commands = getCommandList();
    
    expect(commands).toHaveProperty('help');
    expect(commands).toHaveProperty('status');
    expect(commands).toHaveProperty('reset');
    expect(commands).toHaveProperty('template');
    expect(commands).toHaveProperty('memory');
    expect(commands).toHaveProperty('prompt');
    expect(commands).toHaveProperty('ver');
    expect(commands).toHaveProperty('task');
    expect(commands).toHaveProperty('longtask');
    expect(commands).toHaveProperty('flowtask');
    expect(commands).toHaveProperty('deploy');
    expect(commands).toHaveProperty('route');
    expect(commands).toHaveProperty('auto');
    expect(commands).toHaveProperty('session');
    expect(commands).toHaveProperty('context');
  });

  it('should have descriptions for all commands', () => {
    const commands = getCommandList();
    
    for (const [cmd, desc] of Object.entries(commands)) {
      expect(desc).toBeTruthy();
      expect(typeof desc).toBe('string');
      expect(desc.length).toBeGreaterThan(0);
    }
  });
});

describe('handleCommand', () => {
  const createMockContext = (overrides = {}): CommandContext => ({
    session: {
      runtime: {
        template: { icon: '🤖', name: 'Test', description: 'Test template' },
        memory: { facts: [], projects: [] },
        config: {
          workspace: { path: '/test' },
          memory: { enabled: false },
        },
      } as unknown as AgentRuntime,
      config: { 
        id: 'test-agent', 
        workspace: { path: '/test' },
        memory: { enabled: false },
      } as AgentConfig,
      api: { baseUrl: 'https://test.com', token: 'token123' },
      credentials: { botToken: 'token', accountId: 'acc', baseUrl: 'https://test.com' },
      conversationTurns: new Map(),
      lastMemoryExtract: new Map(),
      userWorkspaces: new Map(),
    },
    fromUser: 'test-user',
    contextToken: 'ctx-token',
    ...overrides,
  });

  beforeEach(() => {
    pendingTasks.clear();
    userAutoRoute.clear();
  });

  describe('unknown commands', () => {
    it('should return help message for unknown commands', async () => {
      const context = createMockContext();
      const result = await handleCommand('unknowncmd', '', context);
      
      expect(result).toContain('❓ 未知命令');
      expect(result).toContain('unknowncmd');
      expect(result).toContain('支持的命令');
    });

    it('should list all available commands in help', async () => {
      const context = createMockContext();
      const result = await handleCommand('nonexistent', '', context);
      
      const commands = getCommandList();
      for (const cmd of Object.keys(commands)) {
        expect(result).toContain(`/${cmd}`);
      }
    });
  });

  describe('version command', () => {
    it('should handle "ver" command', async () => {
      const context = createMockContext();
      const result = await handleCommand('ver', '', context);
      
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should handle "version" alias', async () => {
      const context = createMockContext();
      const result = await handleCommand('version', '', context);
      
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });
  });

  describe('auto command', () => {
    it('should enable auto route with "on"', async () => {
      const context = createMockContext({ fromUser: 'user1' });
      const result = await handleCommand('auto', 'on', context);
      
      expect(result).toContain('自动路由');
      expect(result).toContain('开启');
      expect(userAutoRoute.get('user1')).toBe(true);
    });

    it('should enable auto route with "true"', async () => {
      const context = createMockContext({ fromUser: 'user1' });
      const result = await handleCommand('auto', 'true', context);
      
      expect(result).toContain('自动路由');
      expect(result).toContain('开启');
      expect(userAutoRoute.get('user1')).toBe(true);
    });

    it('should enable auto route with "1"', async () => {
      const context = createMockContext({ fromUser: 'user1' });
      const result = await handleCommand('auto', '1', context);
      
      expect(result).toContain('自动路由');
      expect(result).toContain('开启');
      expect(userAutoRoute.get('user1')).toBe(true);
    });

    it('should disable auto route with "off"', async () => {
      const context = createMockContext({ fromUser: 'user1' });
      const result = await handleCommand('auto', 'off', context);
      
      expect(result).toContain('自动路由');
      expect(result).toContain('关闭');
      expect(userAutoRoute.get('user1')).toBe(false);
    });

    it('should disable auto route with "false"', async () => {
      const context = createMockContext({ fromUser: 'user1' });
      const result = await handleCommand('auto', 'false', context);
      
      expect(result).toContain('自动路由');
      expect(result).toContain('关闭');
      expect(userAutoRoute.get('user1')).toBe(false);
    });

    it('should disable auto route with "0"', async () => {
      const context = createMockContext({ fromUser: 'user1' });
      const result = await handleCommand('auto', '0', context);
      
      expect(result).toContain('自动路由');
      expect(result).toContain('关闭');
      expect(userAutoRoute.get('user1')).toBe(false);
    });

    it('should show status when no argument', async () => {
      const context = createMockContext({ fromUser: 'user1' });
      const result = await handleCommand('auto', '', context);
      
      expect(result).toContain('自动路由状态');
      expect(result).toContain('🔄 自动模式');
    });

    it('should show status with "status" argument', async () => {
      userAutoRoute.set('user1', true);
      const context = createMockContext({ fromUser: 'user1' });
      const result = await handleCommand('auto', 'status', context);
      
      expect(result).toContain('自动路由状态');
      expect(result).toContain('✅ 强制开启');
    });

    it('should show usage for invalid arguments', async () => {
      const context = createMockContext();
      const result = await handleCommand('auto', 'invalid', context);
      
      expect(result).toContain('用法');
      expect(result).toContain('on/off/status');
    });
  });

  describe('prompt command', () => {
    it('should return system prompt preview', async () => {
      const context = createMockContext({
        session: {
          runtime: {
            template: { 
              icon: '🤖', 
              name: 'Test', 
              description: 'Test template',
              systemPrompt: 'Test system prompt',
            },
            memory: { facts: [], projects: [] },
            config: {
              workspace: { path: '/test' },
              memory: { enabled: false },
              ai: { model: 'test', templateId: 'general', maxTurns: 10 },
            },
          },
          config: { 
            id: 'test-agent', 
            workspace: { path: '/test' },
            memory: { enabled: false },
            ai: { model: 'test', templateId: 'general', maxTurns: 10 },
          },
          api: { baseUrl: 'https://test.com', token: 'token123' },
          credentials: { botToken: 'token', accountId: 'acc', baseUrl: 'https://test.com' },
          conversationTurns: new Map(),
          lastMemoryExtract: new Map(),
          userWorkspaces: new Map(),
        },
      });
      const result = await handleCommand('prompt', '', context);
      
      expect(result).toContain('当前系统提示词');
      expect(result).toContain('```');
    });

    it('should truncate long prompts', async () => {
      const longTemplate = 'a'.repeat(3000);
      const context = createMockContext({
        session: {
          runtime: {
            template: { 
              icon: '🤖', 
              name: 'Test', 
              description: 'Test template',
              systemPrompt: longTemplate,
            },
            memory: { facts: [], projects: [] },
            config: {
              workspace: { path: '/test' },
              memory: { enabled: false },
              ai: { model: 'test', templateId: 'test', maxTurns: 10 },
            },
          },
          config: { 
            id: 'test-agent', 
            workspace: { path: '/test' },
            memory: { enabled: false },
            ai: { model: 'test', templateId: 'test', maxTurns: 10 },
          },
          api: { baseUrl: 'https://test.com', token: 'token123' },
          credentials: { botToken: 'token', accountId: 'acc', baseUrl: 'https://test.com' },
          conversationTurns: new Map(),
          lastMemoryExtract: new Map(),
          userWorkspaces: new Map(),
        },
      });
      const result = await handleCommand('prompt', '', context);
      
      expect(result).toContain('当前系统提示词');
      expect(result).toContain('... (已截断)');
    });

    it('should include founder prompt for founder agent', async () => {
      const context = createMockContext({
        session: {
          runtime: {
            template: { 
              icon: '🤖', 
              name: 'Test', 
              description: 'Test template',
              systemPrompt: 'Test system prompt',
            },
            memory: { facts: [], projects: [] },
            config: {
              workspace: { path: '/test' },
              memory: { enabled: false },
              ai: { model: 'test', templateId: 'test', maxTurns: 10 },
              type: 'founder',
              projectSpace: {
                path: '/project/test',
                description: 'Test Project',
              },
            },
          },
          config: { 
            id: 'test-agent', 
            workspace: { path: '/test' },
            memory: { enabled: false },
            ai: { model: 'test', templateId: 'test', maxTurns: 10 },
            type: 'founder',
            projectSpace: {
              path: '/project/test',
              description: 'Test Project',
            },
          },
          api: { baseUrl: 'https://test.com', token: 'token123' },
          credentials: { botToken: 'token', accountId: 'acc', baseUrl: 'https://test.com' },
          conversationTurns: new Map(),
          lastMemoryExtract: new Map(),
          userWorkspaces: new Map(),
        },
      });
      const result = await handleCommand('prompt', '', context);
      
      expect(result).toContain('当前系统提示词');
      expect(result).toContain('项目维护规范');
    });
  });

  describe('context command (with sessionContext)', () => {
    it('should show status when no argument', async () => {
      const context = createMockContext({
        sessionContext: {
          state: { current: 'idle', topic: 'test' },
          messages: [],
          activeOptions: new Map(),
        },
      });
      const result = await handleCommand('context', '', context);
      
      expect(result).toContain('上下文状态');
      expect(result).toContain('状态:');
      expect(result).toContain('主题:');
    });

    it('should show message when context not enabled', async () => {
      const context = createMockContext({ sessionContext: undefined });
      const result = await handleCommand('context', '', context);
      
      expect(result).toContain('上下文感知架构未启用');
    });

    it('should show options with "options" subcommand', async () => {
      const options = new Map([['opt1', { id: 'opt1', label: 'Option 1', value: 'val1' }]]);
      const context = createMockContext({
        sessionContext: {
          state: { current: 'idle' },
          messages: [],
          activeOptions: options,
        },
      });
      const result = await handleCommand('context', 'options', context);
      
      expect(result).toContain('活跃选项');
      expect(result).toContain('Option 1');
    });

    it('should show no options message when empty', async () => {
      const context = createMockContext({
        sessionContext: {
          state: { current: 'idle' },
          messages: [],
          activeOptions: new Map(),
        },
      });
      const result = await handleCommand('context', 'options', context);
      
      expect(result).toContain('没有活跃选项');
    });

    it('should show history with "history" subcommand', async () => {
      const context = createMockContext({
        sessionContext: {
          state: { current: 'idle' },
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there' },
          ],
          activeOptions: new Map(),
        },
      });
      const result = await handleCommand('context', 'history', context);
      
      expect(result).toContain('近期消息');
      expect(result).toContain('用户:');
      expect(result).toContain('AI:');
    });

    it('should show no history message when empty', async () => {
      const context = createMockContext({
        sessionContext: {
          state: { current: 'idle' },
          messages: [],
          activeOptions: new Map(),
        },
      });
      const result = await handleCommand('context', 'history', context);
      
      expect(result).toContain('没有消息历史');
    });

    it('should show usage for invalid subcommand', async () => {
      const context = createMockContext({
        sessionContext: {
          state: { current: 'idle' },
          messages: [],
          activeOptions: new Map(),
        },
      });
      const result = await handleCommand('context', 'invalid', context);
      
      expect(result).toContain('用法:');
    });
  });
});

describe('exported maps', () => {
  it('should export pendingTasks as Map', () => {
    expect(pendingTasks).toBeInstanceOf(Map);
  });

  it('should export userAutoRoute as Map', () => {
    expect(userAutoRoute).toBeInstanceOf(Map);
  });

  it('should maintain separate pendingTasks instances across imports', () => {
    // Verify it's the same Map instance
    const task1 = { taskInfo: { name: 'test', cron: '* * * * *', command: 'echo', description: 'Test' }, agentId: 'a', chatId: 'c', contextToken: 't', expiresAt: Date.now() };
    pendingTasks.set('user1', task1);
    
    expect(pendingTasks.has('user1')).toBe(true);
    expect(pendingTasks.get('user1')).toBe(task1);
    
    // Cleanup
    pendingTasks.delete('user1');
  });

  it('should maintain userAutoRoute state', () => {
    userAutoRoute.set('test-user', true);
    expect(userAutoRoute.get('test-user')).toBe(true);
    
    userAutoRoute.set('test-user', false);
    expect(userAutoRoute.get('test-user')).toBe(false);
    
    // Cleanup
    userAutoRoute.delete('test-user');
  });
});
