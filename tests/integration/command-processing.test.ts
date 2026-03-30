/**
 * 命令处理集成测试
 * 
 * 测试各种命令的完整处理流程
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { tmpdir } from "os";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { handleCommand, getCommandList } from "../../src/handlers/command-handler.js";
import { handleAgentCommandWithContext } from "../../src/handlers/command-context.js";
import { initializeContextSystem } from "../../src/context/index.js";
import { ConversationState } from "../../src/context/types.js";
import type { AgentSession, CommandContext } from "../../src/handlers/types.js";
import type { AgentConfig, AgentRuntime, AgentMemory, CapabilityTemplate } from "../../src/agent/types.js";

// ============ 测试环境设置 ============
const testTempDir = mkdtempSync(join(tmpdir(), "cmd-test-"));
process.env.TEST_DATA_DIR = testTempDir;

// ============ Mock 设置 ============
vi.mock("../../src/kimi/session.js", () => ({
  checkKimiSession: vi.fn(() => Promise.resolve({ exists: true, sessionId: "test-session" })),
  clearKimiSessions: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../src/store.js", () => ({
  loadUserSessionMeta: vi.fn(() => ({ turnCount: 5 })),
  saveUserSessionMeta: vi.fn(),
  resetUserSessionMeta: vi.fn(),
  clearAllUserSessionMeta: vi.fn(),
  getContextToken: vi.fn(() => "test-token"),
  setContextToken: vi.fn(),
}));

vi.mock("../../src/scheduler.js", () => ({
  getScheduler: vi.fn(() => ({
    getAllTasks: vi.fn(() => []),
    addTask: vi.fn((task: any) => ({ ...task, id: "task-1" })),
    removeTask: vi.fn(),
    toggleTask: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  })),
  formatCronDescription: vi.fn(() => "每天上午9点"),
  parseNaturalLanguageToCron: vi.fn(() => Promise.resolve({ name: "测试任务", cron: "0 9 * * *", command: "echo test" })),
}));

vi.mock("../../src/longtask/manager.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/longtask/manager.js")>();
  return {
    ...actual,
    getLongTaskManager: vi.fn(() => Promise.resolve({
      submit: vi.fn(() => ({ id: "lt-1", status: "pending" })),
      getTask: vi.fn(() => null),
      getQueueLength: vi.fn(() => 0),
      getUserTasks: vi.fn(() => []),
      cancel: vi.fn(() => Promise.resolve(true)),
      queryHistory: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
      getReportIntervalSec: vi.fn(() => 30),
    })),
    formatProgressMessage: vi.fn(),
  };
});

vi.mock("../../src/flowtask/manager.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/flowtask/manager.js")>();
  return {
    ...actual,
    getFlowTaskManager: vi.fn(() => ({
      submit: vi.fn(() => ({ id: "ft-1", status: "pending" })),
      getTask: vi.fn(() => undefined),
      getQueueLength: vi.fn(() => 0),
      getUserTasks: vi.fn(() => []),
      cancel: vi.fn(() => true),
      loadHistory: vi.fn(() => []),
      queryHistory: vi.fn(() => ({ tasks: [], total: 0 })),
      getReportIntervalSec: vi.fn(() => 30),
    })),
    formatProgressMessage: vi.fn(() => ""),
    formatPlanForUserConfirmation: vi.fn(() => ""),
  };
});

vi.mock("../../src/task-router/index.js", () => ({
  getTaskRouter: vi.fn(() => ({
    getStats: vi.fn(() => ({})),
  })),
  analyzeTask: vi.fn(() => Promise.resolve({ complexity: "medium", estimatedDuration: 300 })),
  routeTask: vi.fn(() => Promise.resolve({ mode: "direct", decision: { confidence: 0.9, reason: "test" } })),
}));

vi.mock("../../src/notifications/index.js", () => ({
  getNotificationManager: vi.fn(() => ({
    getChannels: vi.fn(() => []),
    addChannel: vi.fn(),
    removeChannel: vi.fn(),
  })),
}));

vi.mock("../../src/memory/manager.js", () => ({
  getMemory: vi.fn(() => Promise.resolve({ version: 1, userProfile: { preferences: [] }, facts: [], projects: [], learning: [] })),
  saveMemory: vi.fn(),
  mergeMemory: vi.fn((m1: any, m2: any) => ({ ...m1, ...m2 })),
  extractMemoryFromConversation: vi.fn(() => Promise.resolve({ facts: [], projects: [] })),
  formatMemoryForPrompt: vi.fn(() => ""),
}));

vi.mock("../../src/handlers/message-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/handlers/message-utils.js")>();
  return {
    ...actual,
    getUserWorkspace: vi.fn(() => Promise.resolve({ cwd: testTempDir })),
  };
});

vi.mock("../../src/agent/manager.js", () => ({
  agentManager: {
    reloadAgentConfig: vi.fn(() => Promise.resolve(null)),
    getAgentPath: vi.fn((id: string) => join(testTempDir, id)),
  },
}));

// ============ 测试数据 ============
const mockConfig: AgentConfig = {
  id: "test-agent",
  name: "Test Agent",
  type: "assistant",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  wechat: { accountId: "test" },
  workspace: { path: testTempDir, createdAt: Date.now() },
  ai: { model: "kimi", templateId: "default", maxTurns: 10 },
  memory: { enabled: true, maxItems: 100, autoExtract: false },
  features: { scheduledTasks: true, notifications: true, fileAccess: true, webSearch: true },
  stats: { totalConversations: 0, totalMessages: 0 },
};

const mockMemory: AgentMemory = {
  version: 1,
  updatedAt: Date.now(),
  userProfile: { preferences: [], expertise: [], habits: [] },
  facts: [],
  projects: [],
  learning: [],
};

const mockTemplate: CapabilityTemplate = {
  id: "default",
  name: "Default",
  description: "Default template",
  icon: "🤖",
  category: "other",
  systemPrompt: "You are helpful.",
  defaults: { model: "kimi", maxTurns: 10, temperature: 0.7 },
  tools: { fileOperations: true, codeExecution: true, webSearch: true, gitOperations: false },
  behavior: { proactive: false, verbose: true, confirmDestructive: true },
};

const createMockContext = (): CommandContext => ({
  session: {
    runtime: {
      config: mockConfig,
      memory: mockMemory,
      template: mockTemplate,
      context: { recentTopics: [] },
    },
    config: mockConfig,
    api: { baseUrl: "https://test.com", token: "test-token" },
    credentials: { botToken: "test-token", accountId: "test", baseUrl: "https://test.com" },
    conversationTurns: new Map(),
    lastMemoryExtract: new Map(),
    userWorkspaces: new Map(),
  },
  fromUser: "test-user",
  contextToken: "test-token",
});

// ============ 测试套件 ============
describe("命令处理集成测试", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("命令列表", () => {
    it("应该返回所有可用命令", () => {
      const commands = getCommandList();
      expect(commands).toHaveProperty("help");
      expect(commands).toHaveProperty("status");
      expect(commands).toHaveProperty("prompt");
    });

    it("所有命令应该有描述", () => {
      const commands = getCommandList();
      for (const [cmd, desc] of Object.entries(commands)) {
        expect(desc).toBeTruthy();
        expect(typeof desc).toBe("string");
      }
    });
  });

  describe("help 命令", () => {
    it("应该返回帮助信息", async () => {
      const result = await handleCommand("help", "", createMockContext());
      expect(result).toContain("命令帮助");
    });

    it("应该处理 help 命令带参数", async () => {
      const result = await handleCommand("help", "status", createMockContext());
      expect(result).toBeTruthy();
    });
  });

  describe("status 命令", () => {
    it("应该返回 Agent 状态", async () => {
      const result = await handleCommand("status", "", createMockContext());
      expect(result).toContain("Agent状态");
      expect(result).toContain("Test Agent");
    });
  });

  describe("prompt 命令", () => {
    it("应该返回系统提示词预览", async () => {
      const result = await handleCommand("prompt", "", createMockContext());
      expect(result).toContain("系统提示词");
      expect(result).toContain("```");
    });
  });

  describe("ver 命令", () => {
    it("应该返回版本信息", async () => {
      const result = await handleCommand("ver", "", createMockContext());
      expect(result).toBeTruthy();
    });
  });

  describe("memory 命令", () => {
    it("应该返回记忆信息", async () => {
      const result = await handleCommand("memory", "", createMockContext());
      expect(result).toContain("长期记忆");
    });
  });

  describe("reset 命令", () => {
    it("应该返回重置确认", async () => {
      const result = await handleCommand("reset", "", createMockContext());
      expect(result).toContain("重置");
    });
  });

  describe("带上下文的命令处理", () => {
    it("应该转发命令到基础处理器", async () => {
      const contextSystem = initializeContextSystem();
      const sessionContext = await contextSystem.contextManager.getOrCreate("test-user", "test-agent");

      const result = await handleAgentCommandWithContext(
        createMockContext().session,
        "help",
        "",
        "test-user",
        "test-token",
        sessionContext,
        contextSystem
      );

      expect(result).toContain("命令帮助");
    });
  });

  // 清理
  afterAll(() => {
    try {
      rmSync(testTempDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
    delete process.env.TEST_DATA_DIR;
  });
});
