/**
 * Agent Poller 服务测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startDynamicAgentLoader } from '../../src/services/agent-poller.js';

// Mock dependencies
vi.mock('../../src/ilink/api.js', () => ({
  getUpdates: vi.fn(),
}));

vi.mock('../../src/store.js', () => ({
  loadSyncBuf: vi.fn(),
  saveSyncBuf: vi.fn(),
}));

vi.mock('../../src/scheduler.js', () => ({
  getScheduler: vi.fn(() => ({
    setApi: vi.fn(),
    start: vi.fn(),
  })),
}));

vi.mock('../../src/notifications/index.js', () => ({
  getNotificationManager: vi.fn(() => ({
    initialize: vi.fn(),
  })),
}));

vi.mock('../../src/flowtask/manager.js', () => ({
  getFlowTaskManager: vi.fn(() => ({
    submit: vi.fn(),
    getTask: vi.fn(),
    getQueueLength: vi.fn(() => 0),
    getReportIntervalSec: vi.fn(() => 30),
  })),
}));

vi.mock('../../src/agent/manager.js', () => ({
  agentManager: {
    reload: vi.fn(),
    getAllAgents: vi.fn(),
    getAgentPath: vi.fn((id: string) => `/agents/${id}`),
    buildRuntime: vi.fn(),
  },
}));

vi.mock('../../src/handlers/index.js', () => ({
  sendTextReply: vi.fn(),
}));

vi.mock('../../src/utils/index.js', () => ({
  sleep: vi.fn(() => Promise.resolve()),
}));

import { agentManager } from '../../src/agent/manager.js';

describe('startDynamicAgentLoader', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Suppress console output during tests
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should start the loader', () => {
    const activeAgents = new Map();
    const handleMessage = vi.fn();

    startDynamicAgentLoader(activeAgents, handleMessage);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('动态 Agent 加载器已启动'));
  });

  it('should check for new agents periodically', async () => {
    const activeAgents = new Map();
    const handleMessage = vi.fn();

    // getAllAgents is synchronous, returns array
    vi.mocked(agentManager.getAllAgents).mockReturnValue([]);
    vi.mocked(agentManager.reload).mockResolvedValue(undefined);

    startDynamicAgentLoader(activeAgents, handleMessage);

    // Advance timers to trigger setInterval callback (30 seconds interval)
    await vi.advanceTimersByTimeAsync(30000);

    expect(agentManager.reload).toHaveBeenCalled();
    expect(agentManager.getAllAgents).toHaveBeenCalled();
  });

  it('should skip already active agents', async () => {
    const activeAgents = new Map([['existing-agent', {} as any]]);
    const handleMessage = vi.fn();

    // getAllAgents is synchronous, returns array
    vi.mocked(agentManager.getAllAgents).mockReturnValue([
      { id: 'existing-agent', name: 'Existing' },
    ] as any);
    vi.mocked(agentManager.reload).mockResolvedValue(undefined);

    startDynamicAgentLoader(activeAgents, handleMessage);
    
    // Advance timers
    await vi.advanceTimersByTimeAsync(30000);

    // Should not try to load the existing agent
    expect(agentManager.buildRuntime).not.toHaveBeenCalled();
  });
});

describe('pollMessages - basic structure', () => {
  it('should export pollMessages function', async () => {
    const { pollMessages } = await import('../../src/services/agent-poller.js');
    expect(typeof pollMessages).toBe('function');
  });

  it('should have correct function signature', async () => {
    const { pollMessages } = await import('../../src/services/agent-poller.js');
    const fnStr = pollMessages.toString();
    
    // Should accept session and handleMessage parameters
    expect(fnStr).toContain('session');
    expect(fnStr).toContain('handleMessage');
  });
});
