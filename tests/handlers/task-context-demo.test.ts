/**
 * 测试有/无 sessionContext 的完整示例
 * 
 * 演示多种测试策略
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CommandContext } from "../../src/handlers/types.js";
import type { AgentSession } from "../../src/agent/types.js";
import type { SessionContext } from "../../src/context/types.js";

// Mock 所有依赖
vi.mock("../../src/scheduler.js", () => ({
  getScheduler: vi.fn(() => ({
    getAllTasks: vi.fn(() => []),
    addTask: vi.fn((task) => ({ 
      ...task, 
      id: `task-${Date.now()}`, 
      createdAt: Date.now() 
    })),
    deleteTask: vi.fn(() => true),
    toggleTask: vi.fn(() => true),
  })),
  parseNaturalLanguageToCron: vi.fn(() => 
    Promise.resolve({
      name: "小红书种草文",
      cron: "0 9 * * *",
      command: "kimi 写一篇小红书种草文",
      description: "每天上午9点",
    })
  ),
  formatCronDescription: vi.fn(() => "每天上午9点"),
}));

vi.mock("../../src/services/task-service.js", () => ({
  getTaskService: vi.fn(() => ({
    prepareCreate: vi.fn(() => Promise.resolve("pending-task-123")),
  })),
}));

vi.mock("../../src/workflow/manager.js", () => ({
  getWorkflowManager: vi.fn(() => ({
    createFromNaturalLanguage: vi.fn(),
  })),
}));

vi.mock("../../src/workflow/scheduler-integration.js", () => ({
  getWorkflowScheduler: vi.fn(() => ({
    scheduleWorkflow: vi.fn(),
  })),
}));

describe("taskHandler - 测试有/无 sessionContext", () => {
  // 基础 mock 数据
  const mockSession = {
    config: {
      id: "agent-123",
      ai: { model: "kimi-test" },
      workspace: { path: "/tmp/test" },
    },
  } as AgentSession;

  const mockSessionContext = {
    id: "session-abc",
    agentId: "agent-123",
    userId: "wxid_user",
    state: { 
      current: "idle",
      data: {} 
    },
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as SessionContext;

  /**
   * ===========================================
   * 策略 1: 使用不同的 describe 块分组
   * ===========================================
   */
  describe("✅ 有 sessionContext 的场景", () => {
    // 创建包含 sessionContext 的 context
    const createContextWithSession = (): CommandContext => ({
      session: mockSession,
      fromUser: "wxid_user123",
      contextToken: "token-abc",
      sessionContext: mockSessionContext, // ✅ 包含 sessionContext
    });

    it("应该使用确认流程", async () => {
      const { taskHandler } = await import("../../src/handlers/commands/task.js");
      const context = createContextWithSession();

      const result = await taskHandler("create 每天上午9点提醒", context, new Map(), new Map());

      // 验证：应该要求确认
      expect(result).toContain("🤖 解析结果");
      expect(result).toContain('回复 "确认" 创建此任务');
      expect(result).toContain("5分钟内有效");
    });

    it("不应该直接创建任务", async () => {
      const { taskHandler } = await import("../../src/handlers/commands/task.js");
      const context = createContextWithSession();

      const result = await taskHandler("create 每天上午9点提醒", context, new Map(), new Map());

      // 验证：不应该直接创建成功
      expect(result).not.toContain("✅ 任务已创建");
    });
  });

  describe("❌ 无 sessionContext 的场景", () => {
    // 创建不包含 sessionContext 的 context
    const createContextWithoutSession = (): CommandContext => ({
      session: mockSession,
      fromUser: "wxid_user123",
      contextToken: "token-abc",
      // ❌ 注意：没有 sessionContext 属性
    });

    it("应该直接创建任务", async () => {
      const { taskHandler } = await import("../../src/handlers/commands/task.js");
      const context = createContextWithoutSession();

      const result = await taskHandler("create 每天上午9点提醒", context, new Map(), new Map());

      // 验证：直接创建成功
      expect(result).toContain("✅ 任务已创建");
      expect(result).toContain("任务ID:");
      expect(result).toContain("Crontab:");
    });

    it("不应该要求确认", async () => {
      const { taskHandler } = await import("../../src/handlers/commands/task.js");
      const context = createContextWithoutSession();

      const result = await taskHandler("create 每天上午9点提醒", context, new Map(), new Map());

      // 验证：没有确认提示
      expect(result).not.toContain("回复 \"确认\"");
      expect(result).not.toContain("5分钟内有效");
    });
  });

  /**
   * ===========================================
   * 策略 2: 使用 it.each 参数化测试
   * ===========================================
   */
  describe("参数化测试对比", () => {
    it.each([
      {
        name: "有 sessionContext",
        hasContext: true,
        expectedContains: "回复 \"确认\"",
        notExpectedContains: "✅ 任务已创建",
      },
      {
        name: "无 sessionContext",
        hasContext: false,
        expectedContains: "✅ 任务已创建",
        notExpectedContains: "回复 \"确认\"",
      },
    ])("$name: 应该返回 '$expectedContains'", async ({ hasContext, expectedContains, notExpectedContains }) => {
      const { taskHandler } = await import("../../src/handlers/commands/task.js");
      
      const context: CommandContext = {
        session: mockSession,
        fromUser: "wxid_user123",
        contextToken: "token-abc",
        ...(hasContext ? { sessionContext: mockSessionContext } : {}),
      };

      const result = await taskHandler("create 每天上午9点提醒", context, new Map(), new Map());

      expect(result).toContain(expectedContains);
      expect(result).not.toContain(notExpectedContains);
    });
  });

  /**
   * ===========================================
   * 策略 3: 使用工厂函数创建 Context
   * ===========================================
   */
  describe("使用工厂函数", () => {
    // Context 工厂函数
    const createContext = (options: { 
      hasSessionContext?: boolean;
      userId?: string;
    } = {}): CommandContext => {
      const { hasSessionContext = true, userId = "wxid_default" } = options;
      
      return {
        session: mockSession,
        fromUser: userId,
        contextToken: "token-test",
        ...(hasSessionContext ? { sessionContext: mockSessionContext } : {}),
      };
    };

    it("工厂函数 - 有 sessionContext", async () => {
      const { taskHandler } = await import("../../src/handlers/commands/task.js");
      const context = createContext({ hasSessionContext: true });

      const result = await taskHandler("create 测试任务", context, new Map(), new Map());

      expect(result).toContain("回复 \"确认\"");
    });

    it("工厂函数 - 无 sessionContext", async () => {
      const { taskHandler } = await import("../../src/handlers/commands/task.js");
      const context = createContext({ hasSessionContext: false });

      const result = await taskHandler("create 测试任务", context, new Map(), new Map());

      expect(result).toContain("✅ 任务已创建");
    });

    it("工厂函数 - 自定义用户ID", async () => {
      const { taskHandler } = await import("../../src/handlers/commands/task.js");
      const context = createContext({ 
        hasSessionContext: false,
        userId: "wxid_custom_user" 
      });

      const result = await taskHandler("create 测试任务", context, new Map(), new Map());

      // 任务应该包含用户信息
      expect(result).toContain("✅ 任务已创建");
    });
  });
});

describe("最佳实践总结", () => {
  it("测试应该清晰说明场景", () => {
    // ✅ 好的测试描述
    expect("有 sessionContext 时应该要求确认").toBeTruthy();
    expect("无 sessionContext 时应该直接创建").toBeTruthy();
  });

  it("测试应该独立，不依赖执行顺序", () => {
    // 每个测试应该自己创建 context，不共享状态
    expect(true).toBe(true);
  });
});
