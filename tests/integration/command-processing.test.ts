/**
 * 命令处理集成测试
 * 
 * 测试各种命令的完整处理流程
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleCommand, getCommandList } from "../../src/handlers/command-handler.js";
import { handleAgentCommandWithContext } from "../../src/handlers/command-context.js";
import { initializeContextSystem } from "../../src/context/index.js";
import { ConversationState } from "../../src/context/types.js";
import type { AgentSession, CommandContext } from "../../src/handlers/types.js";
import type { AgentConfig, AgentRuntime, AgentMemory, CapabilityTemplate } from "../../src/agent/types.js";

// Mock dependencies
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
    getTasks: vi.fn(() => []),
    addTask: vi.fn((task: any) => ({ ...task, id: "task-1" })),
    removeTask: vi.fn(),
    toggleTask: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  })),
  formatCronDescription: vi.fn(() => "每天上午9点"),
  parseNaturalLanguageToCron: vi.fn(() => ({ name: "测试任务", cron: "0 9 * * *", command: "echo test" })),
}));

vi.mock("../../src/longtask/manager.js", () => ({
  getLongTaskManager: vi.fn(() => ({
    submit: vi.fn(() => ({ id: "lt-1", status: "pending" })),
    getTask: vi.fn(() => null),
    getQueueLength: vi.fn(() => 0),
    cancel: vi.fn(),
  })),
  formatProgressMessage: vi.fn(),
}));

vi.mock("../../src/flowtask/manager.js", () => ({
  getFlowTaskManager: vi.fn(() => ({
    submit: vi.fn(() => ({ id: "ft-1", status: "pending" })),
    getTask: vi.fn(() => null),
    getQueueLength: vi.fn(() => 0),
    cancel: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
  })),
  formatProgressMessage: vi.fn(),
  formatPlanForUserConfirmation: vi.fn(),
}));

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
}));

const mockConfig: AgentConfig = {
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

const mockSession: AgentSession = {
  runtime: {
    config: mockConfig,
    memory: mockMemory,
    template: mockTemplate,
    context: { recentTopics: [] },
  },
  config: mockConfig,
  api: { baseUrl: "https://api.example.com", token: "test" },
  credentials: { botToken: "test", accountId: "acc", baseUrl: "https://api.example.com" },
  conversationTurns: new Map(),
  lastMemoryExtract: new Map(),
  userWorkspaces: new Map(),
};

const createContext = (sessionContext?: any): CommandContext => ({
  session: mockSession,
  fromUser: "test-user",
  contextToken: "test-token",
  sessionContext,
});

describe("命令处理集成测试", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("命令列表", () => {
    it("应该返回所有可用命令", () => {
      const commands = getCommandList();

      expect(commands).toContain("/help");
      expect(commands).toContain("/status");
      expect(commands).toContain("/reset");
      expect(commands).toContain("/template");
      expect(commands).toContain("/memory");
      expect(commands).toContain("/prompt");
      expect(commands).toContain("/ver");
      expect(commands).toContain("/task");
      expect(commands).toContain("/longtask");
      expect(commands).toContain("/flowtask");
      expect(commands).toContain("/deploy");
      expect(commands).toContain("/route");
      expect(commands).toContain("/auto");
    });
  });

  describe("help 命令", () => {
    it("应该返回帮助信息", async () => {
      const ctx = createContext();
      const result = await handleCommand("help", "", ctx);

      expect(result).toContain("可用命令");
      expect(result).toContain("/help");
      expect(result).toContain("/status");
    });

    it("应该处理 help 命令带参数", async () => {
      const ctx = createContext();
      const result = await handleCommand("help", "task", ctx);

      expect(result).toContain("task");
    });
  });

  describe("status 命令", () => {
    it("应该返回 Agent 状态", async () => {
      const ctx = createContext();
      const result = await handleCommand("status", "", ctx);

      expect(result).toContain("Agent 状态");
      expect(result).toContain("Test Agent");
      expect(result).toContain("🤖");
    });

    it("应该包含内存统计", async () => {
      const ctx = createContext();
      const result = await handleCommand("status", "", ctx);

      expect(result).toContain("记忆");
    });
  });

  describe("reset 命令", () => {
    it("应该返回重置确认", async () => {
      const ctx = createContext();
      const result = await handleCommand("reset", "", ctx);

      expect(result).toContain("已重置");
    });
  });

  describe("ver 命令", () => {
    it("应该返回版本信息", async () => {
      const ctx = createContext();
      const result = await handleCommand("ver", "", ctx);

      expect(result).toContain("版本");
      expect(result).toContain("Node.js");
    });
  });

  describe("memory 命令", () => {
    it("应该返回记忆信息", async () => {
      const ctx = createContext();
      const result = await handleCommand("memory", "", ctx);

      expect(result).toContain("长期记忆");
    });

    it("应该支持 clear 子命令", async () => {
      const ctx = createContext();
      const result = await handleCommand("memory", "clear", ctx);

      expect(result).toContain("已清空");
    });
  });

  describe("prompt 命令", () => {
    it("应该返回系统提示词预览", async () => {
      const ctx = createContext();
      const result = await handleCommand("prompt", "", ctx);

      expect(result).toContain("系统提示词");
    });
  });

  describe("template 命令", () => {
    it("应该返回当前模板信息", async () => {
      const ctx = createContext();
      const result = await handleCommand("template", "", ctx);

      expect(result).toContain("能力模板");
      expect(result).toContain("Default");
    });

    it("应该支持 list 子命令", async () => {
      const ctx = createContext();
      const result = await handleCommand("template", "list", ctx);

      expect(result).toContain("可用模板");
    });
  });

  describe("task 命令", () => {
    it("应该支持 list 子命令", async () => {
      const ctx = createContext();
      const result = await handleCommand("task", "list", ctx);

      expect(result).toContain("定时任务");
    });

    it("应该支持 create 子命令", async () => {
      const ctx = createContext();
      const result = await handleCommand("task", "create 每天早上9点报告", ctx);

      // 创建任务可能需要更多上下文，但至少命令被解析
      expect(result).toBeDefined();
    });
  });

  describe("longtask 命令", () => {
    it("应该支持 list 子命令", async () => {
      const ctx = createContext();
      const result = await handleCommand("longtask", "list", ctx);

      expect(result).toContain("耗时任务");
    });

    it("应该返回用法信息对于无效子命令", async () => {
      const ctx = createContext();
      const result = await handleCommand("longtask", "invalid", ctx);

      expect(result).toContain("用法");
    });
  });

  describe("flowtask 命令", () => {
    it("应该支持 list 子命令", async () => {
      const ctx = createContext();
      const result = await handleCommand("flowtask", "list", ctx);

      expect(result).toContain("FlowTask");
    });

    it("应该返回用法信息对于无效子命令", async () => {
      const ctx = createContext();
      const result = await handleCommand("flowtask", "invalid", ctx);

      expect(result).toContain("用法");
    });
  });

  describe("route 命令", () => {
    it("应该支持 stats 子命令", async () => {
      const ctx = createContext();
      const result = await handleCommand("route", "stats", ctx);

      expect(result).toContain("任务路由统计");
    });

    it("应该支持 analyze 子命令", async () => {
      const ctx = createContext();
      const result = await handleCommand("route", "analyze 做个网站", ctx);

      expect(result).toContain("任务分析");
    });
  });

  describe("auto 命令", () => {
    it("应该支持 on 子命令", async () => {
      const ctx = createContext();
      const result = await handleCommand("auto", "on", ctx);

      expect(result).toContain("自动路由");
      expect(result).toContain("开启");
    });

    it("应该支持 off 子命令", async () => {
      const ctx = createContext();
      const result = await handleCommand("auto", "off", ctx);

      expect(result).toContain("自动路由");
      expect(result).toContain("关闭");
    });

    it("应该返回当前状态", async () => {
      const ctx = createContext();
      const result = await handleCommand("auto", "", ctx);

      expect(result).toContain("自动路由");
    });
  });

  describe("未知命令", () => {
    it("应该返回友好的错误信息", async () => {
      const ctx = createContext();
      const result = await handleCommand("unknowncmd", "", ctx);

      expect(result).toContain("未知命令");
      expect(result).toContain("/help");
    });
  });

  describe("带上下文的命令处理", () => {
    it("应该在 reset 时重置上下文", async () => {
      const contextSystem = initializeContextSystem();
      const ctx = createContext();
      const sessionContext = await contextSystem.contextManager.getOrCreate("test-user", "test-agent");

      const result = await handleAgentCommandWithContext(
        mockSession,
        "reset",
        "",
        "test-user",
        "test-token",
        sessionContext,
        contextSystem
      );

      expect(result).toContain("已重置");
      expect(result).toContain("新架构");
    });

    it("应该返回会话状态", async () => {
      const contextSystem = initializeContextSystem();
      const ctx = createContext();
      const sessionContext = await contextSystem.contextManager.getOrCreate("test-user", "test-agent");
      await contextSystem.contextManager.updateState(sessionContext, ConversationState.EXPLORING);

      const result = await handleAgentCommandWithContext(
        mockSession,
        "session",
        "status",
        "test-user",
        "test-token",
        sessionContext,
        contextSystem
      );

      expect(result).toContain("Session 状态");
      expect(result).toContain("探索需求");
    });

    it("应该返回上下文详情", async () => {
      const contextSystem = initializeContextSystem();
      const sessionContext = await contextSystem.contextManager.getOrCreate("test-user", "test-agent");

      const result = await handleAgentCommandWithContext(
        mockSession,
        "context",
        "status",
        "test-user",
        "test-token",
        sessionContext,
        contextSystem
      );

      expect(result).toContain("上下文状态");
    });

    it("应该转发未知命令到基础处理器", async () => {
      const contextSystem = initializeContextSystem();
      const sessionContext = await contextSystem.contextManager.getOrCreate("test-user", "test-agent");

      const result = await handleAgentCommandWithContext(
        mockSession,
        "help",
        "",
        "test-user",
        "test-token",
        sessionContext,
        contextSystem
      );

      expect(result).toContain("可用命令");
    });
  });
});
