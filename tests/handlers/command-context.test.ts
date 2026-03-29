/**
 * Command Context Handler 测试
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentSession } from "../../src/handlers/types.js";
import type { SessionContext, StateContext } from "../../src/context/types.js";
import { ConversationState } from "../../src/context/types.js";
import { handleAgentCommandWithContext } from "../../src/handlers/command-context.js";

// Mock dependencies
vi.mock("../../src/store.js", () => ({
  loadUserSessionMeta: vi.fn(() => ({ turnCount: 5 })),
  resetUserSessionMeta: vi.fn(),
}));

vi.mock("../../src/kimi/session.js", () => ({
  checkKimiSession: vi.fn(() => Promise.resolve({ exists: true, sessionId: "test-session" })),
  clearKimiSessions: vi.fn(),
}));

vi.mock("../../src/handlers/command-handler.js", () => ({
  handleCommand: vi.fn((command: string) => {
    if (command === "reset") {
      return Promise.resolve(null); // reset 命令返回 null，让带上下文的处理器添加额外消息
    }
    return Promise.resolve("Command handled");
  }),
}));

vi.mock("../../src/handlers/message-utils.js", () => ({
  getUserWorkspace: vi.fn(() => Promise.resolve({ cwd: "/test/workspace" })),
}));

const mockSession: AgentSession = {
  runtime: {
    config: {
      id: "test-agent",
      name: "Test Agent",
      type: "assistant",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      wechat: { accountId: "test" },
      workspace: { path: "/test", createdAt: Date.now() },
      ai: { model: "kimi", templateId: "default", maxTurns: 10 },
      memory: { enabled: true, maxItems: 100, autoExtract: false },
      features: { scheduledTasks: true, notifications: true, fileAccess: true, webSearch: true },
      stats: { totalConversations: 0, totalMessages: 0 },
    },
    memory: {
      version: 1,
      updatedAt: Date.now(),
      userProfile: { preferences: [], expertise: [], habits: [] },
      facts: [],
      projects: [],
      learning: [],
    },
    template: {
      id: "default",
      name: "Default",
      description: "Test",
      icon: "🤖",
      category: "other",
      systemPrompt: "Test",
      defaults: { model: "kimi", maxTurns: 10, temperature: 0.7 },
      tools: { fileOperations: true, codeExecution: true, webSearch: true, gitOperations: true },
      behavior: { proactive: false, verbose: true, confirmDestructive: true },
    },
    context: { recentTopics: [] },
  },
  config: {
    id: "test-agent",
    name: "Test Agent",
    type: "assistant",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    wechat: { accountId: "test" },
    workspace: { path: "/test", createdAt: Date.now() },
    ai: { model: "kimi", templateId: "default", maxTurns: 10 },
    memory: { enabled: true, maxItems: 100, autoExtract: false },
    features: { scheduledTasks: true, notifications: true, fileAccess: true, webSearch: true },
    stats: { totalConversations: 0, totalMessages: 0 },
  },
  api: { baseUrl: "https://api.example.com", token: "test-token" },
  credentials: { botToken: "token", accountId: "account", baseUrl: "https://api.example.com" },
  conversationTurns: new Map(),
  lastMemoryExtract: new Map(),
  userWorkspaces: new Map(),
};

const createMockSessionContext = (state: ConversationState = ConversationState.IDLE): SessionContext => ({
  id: "test-session-id",
  userId: "test-user",
  agentId: "test-agent",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  state: {
    current: state,
    topic: "test-topic",
  } as StateContext,
  messages: [],
  activeOptions: new Map(),
  topicStack: [],
  metadata: {
    totalMessages: 0,
    lastActiveAt: Date.now(),
    isNewSession: false,
  },
});

describe("Command Context Handler", () => {
  const mockContextManager = {
    reset: vi.fn(() => Promise.resolve()),
    getStats: vi.fn(() => ({ duration: 60000, messageCount: 10 })),
  };

  const mockStateMachine = {};

  const contextSystem = {
    contextManager: mockContextManager,
    stateMachine: mockStateMachine,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("reset command", () => {
    it("should reset session context", async () => {
      const sessionContext = createMockSessionContext();

      const result = await handleAgentCommandWithContext(
        mockSession,
        "reset",
        "",
        "test-user",
        "test-token",
        sessionContext,
        contextSystem
      );

      expect(mockContextManager.reset).toHaveBeenCalledWith(sessionContext);
      expect(result).toContain("对话上下文已重置");
    });

    it("should include new architecture mention", async () => {
      const sessionContext = createMockSessionContext();

      const result = await handleAgentCommandWithContext(
        mockSession,
        "reset",
        "",
        "test-user",
        "test-token",
        sessionContext,
        contextSystem
      );

      expect(result).toContain("新架构");
    });
  });

  describe("session command", () => {
    it("should return session status by default", async () => {
      const sessionContext = createMockSessionContext(ConversationState.EXPLORING);

      const result = await handleAgentCommandWithContext(
        mockSession,
        "session",
        "",
        "test-user",
        "test-token",
        sessionContext,
        contextSystem
      );

      expect(result).toContain("Session 状态");
      expect(result).toContain("test-agent");
      expect(result).toContain("test-user");
      expect(result).toContain("探索需求"); // 翻译后的状态
    });

    it("should include conversation statistics", async () => {
      const sessionContext = createMockSessionContext();
      sessionContext.messages = [{ id: "1", role: "user", content: "test", timestamp: Date.now() }];

      const result = await handleAgentCommandWithContext(
        mockSession,
        "session",
        "status",
        "test-user",
        "test-token",
        sessionContext,
        contextSystem
      );

      expect(result).toContain("轮次:");
      expect(result).toContain("消息历史:");
    });

    it("should show Kimi session info when exists", async () => {
      const sessionContext = createMockSessionContext();

      const result = await handleAgentCommandWithContext(
        mockSession,
        "session",
        "status",
        "test-user",
        "test-token",
        sessionContext,
        contextSystem
      );

      expect(result).toContain("Kimi Session:");
    });

    it("should return unknown command message for invalid subcommand", async () => {
      const sessionContext = createMockSessionContext();

      const result = await handleAgentCommandWithContext(
        mockSession,
        "session",
        "invalid",
        "test-user",
        "test-token",
        sessionContext,
        contextSystem
      );

      expect(result).toContain("未知命令");
    });
  });

  describe("context command", () => {
    it("should return context status by default", async () => {
      const sessionContext = createMockSessionContext(ConversationState.PLANNING);
      sessionContext.state.topic = "测试主题";

      const result = await handleAgentCommandWithContext(
        mockSession,
        "context",
        "",
        "test-user",
        "test-token",
        sessionContext,
        contextSystem
      );

      expect(result).toContain("上下文状态");
      expect(result).toContain("制定计划"); // 翻译后的状态
      expect(result).toContain("测试主题");
    });

    it("should show options subcommand", async () => {
      const sessionContext = createMockSessionContext();
      sessionContext.activeOptions.set("opt_1", { id: "opt_1", label: "选项1", description: "", createdAt: Date.now() });

      const result = await handleAgentCommandWithContext(
        mockSession,
        "context",
        "options",
        "test-user",
        "test-token",
        sessionContext,
        contextSystem
      );

      expect(result).toContain("活跃选项");
      expect(result).toContain("选项1");
    });

    it("should show no options message when empty", async () => {
      const sessionContext = createMockSessionContext();

      const result = await handleAgentCommandWithContext(
        mockSession,
        "context",
        "options",
        "test-user",
        "test-token",
        sessionContext,
        contextSystem
      );

      expect(result).toContain("没有活跃选项");
    });

    it("should show history subcommand", async () => {
      const sessionContext = createMockSessionContext();
      sessionContext.messages = [
        { id: "1", role: "user", content: "Hello", timestamp: Date.now() },
        { id: "2", role: "assistant", content: "Hi there", timestamp: Date.now() },
      ];

      const result = await handleAgentCommandWithContext(
        mockSession,
        "context",
        "history",
        "test-user",
        "test-token",
        sessionContext,
        contextSystem
      );

      expect(result).toContain("近期消息");
      expect(result).toContain("用户:");
      expect(result).toContain("AI:");
    });

    it("should show no history message when empty", async () => {
      const sessionContext = createMockSessionContext();

      const result = await handleAgentCommandWithContext(
        mockSession,
        "context",
        "history",
        "test-user",
        "test-token",
        sessionContext,
        contextSystem
      );

      expect(result).toContain("没有消息历史");
    });

    it("should return usage for invalid subcommand", async () => {
      const sessionContext = createMockSessionContext();

      const result = await handleAgentCommandWithContext(
        mockSession,
        "context",
        "invalid",
        "test-user",
        "test-token",
        sessionContext,
        contextSystem
      );

      expect(result).toContain("用法:");
      expect(result).toContain("/context status");
      expect(result).toContain("/context options");
      expect(result).toContain("/context history");
    });
  });

  describe("other commands", () => {
    it("should delegate unknown commands to base handler", async () => {
      const sessionContext = createMockSessionContext();

      const result = await handleAgentCommandWithContext(
        mockSession,
        "help",
        "",
        "test-user",
        "test-token",
        sessionContext,
        contextSystem
      );

      expect(result).toBe("Command handled");
    });
  });
});
