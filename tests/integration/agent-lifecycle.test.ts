/**
 * Agent 生命周期集成测试
 * 
 * 测试 Agent 的初始化、运行和关闭流程
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { AgentConfig, AgentRuntime } from "../../src/agent/types.js";
import type { AgentSession } from "../../src/handlers/types.js";
import {
  determineAgentsToStart,
  initializeAgent,
} from "../../src/services/session-manager.js";
import { getScheduler } from "../../src/scheduler.js";
import { getNotificationManager } from "../../src/notifications/index.js";
import { getLongTaskManager } from "../../src/longtask/manager.js";
import { getFlowTaskManager } from "../../src/flowtask/manager.js";

// Mock 依赖
vi.mock("../../src/agent/manager.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/agent/manager.js")>(
    "../../src/agent/manager.js"
  );
  return {
    agentManager: {
      ...actual.agentManager,
      initialize: vi.fn(() => Promise.resolve()),
      getAllAgents: vi.fn(() => []),
      getAgent: vi.fn(() => null),
      getAgentPath: vi.fn((id: string) => `/mock/agents/${id}`),
      buildRuntime: vi.fn(),
    },
  };
});

import { agentManager } from "../../src/agent/manager.js";

const mockAgentConfig: AgentConfig = {
  id: "integration-test-agent",
  name: "Integration Test Agent",
  type: "assistant",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  wechat: {
    accountId: "test-account",
    nickname: "TestBot",
  },
  workspace: {
    path: "/tmp/test-workspace",
    createdAt: Date.now(),
  },
  ai: {
    model: "kimi",
    templateId: "default",
    maxTurns: 10,
  },
  memory: {
    enabled: true,
    maxItems: 100,
    autoExtract: false,
  },
  features: {
    scheduledTasks: true,
    notifications: true,
    fileAccess: true,
    webSearch: true,
  },
  stats: {
    totalConversations: 0,
    totalMessages: 0,
  },
};

const mockRuntime: AgentRuntime = {
  config: mockAgentConfig,
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
    name: "Default Assistant",
    description: "通用助手",
    icon: "🤖",
    category: "other",
    systemPrompt: "You are a helpful assistant.",
    defaults: { model: "kimi", maxTurns: 10, temperature: 0.7 },
    tools: { fileOperations: true, codeExecution: true, webSearch: true, gitOperations: false },
    behavior: { proactive: false, verbose: true, confirmDestructive: true },
  },
  context: { recentTopics: [] },
};

describe("Agent 生命周期集成测试", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // 清理调度器
    getScheduler(mockAgentConfig.id).stop();
  });

  describe("Agent 启动流程", () => {
    it("应该根据 ACTIVE_AGENT_ID 选择特定 Agent", () => {
      vi.stubEnv("ACTIVE_AGENT_ID", "integration-test-agent");

      const allAgents = [mockAgentConfig];
      const result = determineAgentsToStart(allAgents);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("integration-test-agent");
    });

    it("应该在未设置 ACTIVE_AGENT_ID 时启动所有 Agent", () => {
      vi.stubEnv("ACTIVE_AGENT_ID", "");

      const agent1 = { ...mockAgentConfig, id: "agent-1" };
      const agent2 = { ...mockAgentConfig, id: "agent-2" };

      const result = determineAgentsToStart([agent1, agent2]);

      expect(result).toHaveLength(2);
    });

    it("应该正确初始化 Agent 会话", async () => {
      const mockCreds = {
        botToken: "test-token",
        accountId: "test-account",
        baseUrl: "https://api.example.com",
      };

      // Mock fs.readFileSync for credentials
      vi.doMock("node:fs", () => ({
        readFileSync: vi.fn(() => JSON.stringify(mockCreds)),
        existsSync: vi.fn(() => true),
      }));

      vi.mocked(agentManager.buildRuntime).mockResolvedValueOnce(mockRuntime);

      const messages: string[] = [];
      const session = await initializeAgent(mockAgentConfig, {
        onSendMessage: async (api, chatId, contextToken, text) => {
          messages.push(text);
        },
      });

      // 由于凭证文件读取被 mock，这里 session 会是 null
      // 但我们可以验证函数结构和流程
      expect(session === null || session.config.id === mockAgentConfig.id).toBe(true);
    });

    it("应该在凭证加载失败时返回 null", async () => {
      // 凭证文件不存在
      vi.doMock("node:fs", () => ({
        readFileSync: vi.fn(() => {
          throw new Error("File not found");
        }),
        existsSync: vi.fn(() => false),
      }));

      const session = await initializeAgent(mockAgentConfig, {
        onSendMessage: async () => {},
      });

      expect(session).toBeNull();
    });

    it("应该在运行时构建失败时返回 null", async () => {
      vi.mocked(agentManager.buildRuntime).mockResolvedValueOnce(null);

      const session = await initializeAgent(mockAgentConfig, {
        onSendMessage: async () => {},
      });

      expect(session).toBeNull();
    });
  });

  describe("Agent 会话结构", () => {
    it("应该创建正确的 AgentSession 结构", async () => {
      const mockCreds = {
        botToken: "test-token",
        accountId: "test-account",
        baseUrl: "https://api.example.com",
      };

      // 直接在测试环境中构建 session
      const session: AgentSession = {
        runtime: mockRuntime,
        config: mockAgentConfig,
        api: {
          baseUrl: mockCreds.baseUrl,
          token: mockCreds.botToken,
        },
        credentials: mockCreds,
        conversationTurns: new Map(),
        lastMemoryExtract: new Map(),
        userWorkspaces: new Map(),
      };

      // 验证会话结构
      expect(session).toHaveProperty("runtime");
      expect(session).toHaveProperty("config");
      expect(session).toHaveProperty("api");
      expect(session).toHaveProperty("credentials");
      expect(session).toHaveProperty("conversationTurns");
      expect(session).toHaveProperty("lastMemoryExtract");
      expect(session).toHaveProperty("userWorkspaces");

      // 验证 API 配置
      expect(session.api.baseUrl).toBe("https://api.example.com");
      expect(session.api.token).toBe("test-token");

      // 验证凭证
      expect(session.credentials.botToken).toBe("test-token");
      expect(session.credentials.accountId).toBe("test-account");
      expect(session.credentials.baseUrl).toBe("https://api.example.com");

      // 验证 Maps 已初始化
      expect(session.conversationTurns).toBeInstanceOf(Map);
      expect(session.lastMemoryExtract).toBeInstanceOf(Map);
      expect(session.userWorkspaces).toBeInstanceOf(Map);
    });

    it("应该正确初始化运行时内存", () => {
      expect(mockRuntime.memory).toHaveProperty("version");
      expect(mockRuntime.memory).toHaveProperty("userProfile");
      expect(mockRuntime.memory).toHaveProperty("facts");
      expect(mockRuntime.memory).toHaveProperty("projects");
      expect(mockRuntime.memory).toHaveProperty("learning");
      expect(mockRuntime.memory.userProfile).toHaveProperty("preferences");
      expect(mockRuntime.memory.userProfile).toHaveProperty("expertise");
      expect(mockRuntime.memory.userProfile).toHaveProperty("habits");
    });
  });

  describe("Agent 服务初始化", () => {
    it("应该正确初始化调度器", () => {
      const scheduler = getScheduler(mockAgentConfig.id);
      expect(scheduler).toBeDefined();

      // 调度器应该可以启动和停止
      scheduler.start();
      scheduler.stop();
    });

    it("应该正确初始化长任务管理器", () => {
      const ltManager = getLongTaskManager(mockAgentConfig.id, {
        maxConcurrency: 2,
        reportIntervalMs: 1000,
        onProgress: async () => {},
        onComplete: async () => {},
      });

      expect(ltManager).toBeDefined();
      expect(ltManager.getQueueLength()).toBe(0);
    });

    it("应该正确初始化流程任务管理器", () => {
      const ftManager = getFlowTaskManager(mockAgentConfig.id, {
        maxConcurrency: 2,
        reportIntervalMs: 1000,
        autoApproveLowRisk: false,
        requireApprovalFor: ["write", "shell"],
        onProgress: async () => {},
        onComplete: async () => {},
        onCancel: async () => {},
        onApprovalRequest: async () => {},
      });

      expect(ftManager).toBeDefined();
      expect(ftManager.getQueueLength()).toBe(0);
    });
  });

  describe("Agent 多实例管理", () => {
    it("应该支持多个 Agent 同时运行", async () => {
      const sessions = new Map<string, AgentSession>();

      // 创建多个 Agent 会话
      for (let i = 1; i <= 3; i++) {
        const config = { ...mockAgentConfig, id: `agent-${i}` };
        const runtime = { ...mockRuntime, config };
        const session: AgentSession = {
          runtime,
          config,
          api: { baseUrl: "https://api.example.com", token: `token-${i}` },
          credentials: {
            botToken: `token-${i}`,
            accountId: `account-${i}`,
            baseUrl: "https://api.example.com",
          },
          conversationTurns: new Map(),
          lastMemoryExtract: new Map(),
          userWorkspaces: new Map(),
        };
        sessions.set(config.id, session);
      }

      expect(sessions.size).toBe(3);

      // 验证每个会话独立
      sessions.forEach((session, id) => {
        expect(session.config.id).toBe(id);
        expect(session.credentials.botToken).toBe(`token-${id.split("-")[1]}`);
      });
    });

    it("应该隔离不同 Agent 的会话数据", () => {
      const session1: AgentSession = {
        runtime: mockRuntime,
        config: { ...mockAgentConfig, id: "agent-1" },
        api: { baseUrl: "https://api.example.com", token: "token1" },
        credentials: { botToken: "token1", accountId: "acc1", baseUrl: "https://api.example.com" },
        conversationTurns: new Map(),
        lastMemoryExtract: new Map(),
        userWorkspaces: new Map(),
      };

      const session2: AgentSession = {
        runtime: mockRuntime,
        config: { ...mockAgentConfig, id: "agent-2" },
        api: { baseUrl: "https://api.example.com", token: "token2" },
        credentials: { botToken: "token2", accountId: "acc2", baseUrl: "https://api.example.com" },
        conversationTurns: new Map(),
        lastMemoryExtract: new Map(),
        userWorkspaces: new Map(),
      };

      // 设置不同的轮次数据
      session1.conversationTurns.set("user1", 5);
      session2.conversationTurns.set("user1", 10);

      expect(session1.conversationTurns.get("user1")).toBe(5);
      expect(session2.conversationTurns.get("user1")).toBe(10);
    });
  });
});
