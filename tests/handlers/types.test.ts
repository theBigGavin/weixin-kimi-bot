/**
 * Handlers 类型定义测试
 */

import { describe, it, expect, vi } from 'vitest';
import type { 
  AgentSession, 
  CommandContext, 
  CommandHandler,
  UserWorkspace,
  PendingTaskInfo 
} from '../../src/handlers/types.js';
import type { AgentConfig, AgentRuntime } from '../../src/agent/types.js';
import type { ApiOptions } from '../../src/ilink/api.js';
import type { SessionContext } from '../../src/context/types.js';

describe('Handlers Types', () => {
  describe('AgentSession interface', () => {
    it('should have required properties', () => {
      const mockConfig = { id: 'test-agent' } as AgentConfig;
      const mockRuntime = { template: { icon: '🤖', name: 'Test' } } as AgentRuntime;
      const mockApi = { baseUrl: 'https://test.com', token: 'token123' } as ApiOptions;

      const session: AgentSession = {
        runtime: mockRuntime,
        config: mockConfig,
        api: mockApi,
        credentials: {
          botToken: 'token123',
          accountId: 'acc123',
          baseUrl: 'https://test.com',
        },
        conversationTurns: new Map(),
        lastMemoryExtract: new Map(),
        userWorkspaces: new Map(),
      };

      expect(session.runtime).toBe(mockRuntime);
      expect(session.config).toBe(mockConfig);
      expect(session.api).toBe(mockApi);
      expect(session.credentials.botToken).toBe('token123');
      expect(session.conversationTurns).toBeInstanceOf(Map);
      expect(session.lastMemoryExtract).toBeInstanceOf(Map);
      expect(session.userWorkspaces).toBeInstanceOf(Map);
    });

    it('should support Map operations', () => {
      const session: AgentSession = {
        runtime: {} as AgentRuntime,
        config: { id: 'test' } as AgentConfig,
        api: {} as ApiOptions,
        credentials: { botToken: '', accountId: '', baseUrl: '' },
        conversationTurns: new Map([['user1', 5]]),
        lastMemoryExtract: new Map([['user1', Date.now()]]),
        userWorkspaces: new Map([['user1', '/path/to/workspace']]),
      };

      expect(session.conversationTurns.get('user1')).toBe(5);
      expect(session.userWorkspaces.get('user1')).toBe('/path/to/workspace');
    });
  });

  describe('CommandContext interface', () => {
    it('should have required properties', () => {
      const mockSession = {
        config: { id: 'test-agent' },
        runtime: {},
        api: {},
        credentials: {},
        conversationTurns: new Map(),
        lastMemoryExtract: new Map(),
        userWorkspaces: new Map(),
      } as AgentSession;

      const context: CommandContext = {
        session: mockSession,
        fromUser: 'user123',
        contextToken: 'ctx-token-123',
      };

      expect(context.session).toBe(mockSession);
      expect(context.fromUser).toBe('user123');
      expect(context.contextToken).toBe('ctx-token-123');
    });

    it('should optionally include sessionContext', () => {
      const mockSessionContext = {
        state: { current: 'idle', topic: '' },
        messages: [],
      } as unknown as SessionContext;

      const context: CommandContext = {
        session: {} as AgentSession,
        fromUser: 'user123',
        contextToken: 'ctx-token',
        sessionContext: mockSessionContext,
      };

      expect(context.sessionContext).toBe(mockSessionContext);
    });
  });

  describe('CommandHandler type', () => {
    it('should accept function with args and context params', async () => {
      const handler: CommandHandler = (args: string, context: CommandContext) => {
        return `Args: ${args}, User: ${context.fromUser}`;
      };

      const mockContext: CommandContext = {
        session: {} as AgentSession,
        fromUser: 'test-user',
        contextToken: 'token',
      };

      const result = handler('test args', mockContext);
      expect(result).toBe('Args: test args, User: test-user');
    });

    it('should accept async function', async () => {
      const handler: CommandHandler = async (args: string, context: CommandContext) => {
        return Promise.resolve(`Async result for ${context.fromUser}`);
      };

      const mockContext: CommandContext = {
        session: {} as AgentSession,
        fromUser: 'test-user',
        contextToken: 'token',
      };

      const result = await handler('', mockContext);
      expect(result).toBe('Async result for test-user');
    });

    it('should accept null return value', () => {
      const handler: CommandHandler = () => null;

      const mockContext: CommandContext = {
        session: {} as AgentSession,
        fromUser: 'test-user',
        contextToken: 'token',
      };

      const result = handler('', mockContext);
      expect(result).toBeNull();
    });
  });

  describe('UserWorkspace interface', () => {
    it('should have required cwd property', () => {
      const workspace: UserWorkspace = {
        cwd: '/path/to/workspace',
      };

      expect(workspace.cwd).toBe('/path/to/workspace');
    });

    it('should optionally have projectDir', () => {
      const workspace: UserWorkspace = {
        cwd: '/path/to/workspace',
        projectDir: '/path/to/project',
      };

      expect(workspace.cwd).toBe('/path/to/workspace');
      expect(workspace.projectDir).toBe('/path/to/project');
    });
  });

  describe('PendingTaskInfo interface', () => {
    it('should have all required properties', () => {
      const pendingTask: PendingTaskInfo = {
        taskInfo: {
          name: 'daily-backup',
          cron: '0 2 * * *',
          command: 'backup.sh',
          description: 'Daily backup task',
        },
        agentId: 'agent-123',
        chatId: 'chat-456',
        contextToken: 'ctx-token-789',
        expiresAt: Date.now() + 60000,
      };

      expect(pendingTask.taskInfo.name).toBe('daily-backup');
      expect(pendingTask.taskInfo.cron).toBe('0 2 * * *');
      expect(pendingTask.taskInfo.command).toBe('backup.sh');
      expect(pendingTask.taskInfo.description).toBe('Daily backup task');
      expect(pendingTask.agentId).toBe('agent-123');
      expect(pendingTask.chatId).toBe('chat-456');
      expect(pendingTask.contextToken).toBe('ctx-token-789');
      expect(pendingTask.expiresAt).toBeGreaterThan(Date.now());
    });
  });
});
