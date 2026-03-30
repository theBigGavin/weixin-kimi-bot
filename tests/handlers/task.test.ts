/**
 * /task 命令处理器测试
 * 
 * TDD 示例：测试有/无 sessionContext 两种情况
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { taskHandler } from "../../src/handlers/commands/task.js";
import type { CommandContext } from "../../src/handlers/types.js";
import type { AgentSession } from "../../src/agent/types.js";
import type { SessionContext } from "../../src/context/types.js";

// Mock 依赖
vi.mock("../../src/scheduler.js", () => ({
  getScheduler: vi.fn(() => ({
    getAllTasks: vi.fn(() => []),
    addTask: vi.fn((task) => ({ ...task, id: "task-123", createdAt: Date.now() })),
    deleteTask: vi.fn(() => true),
    toggleTask: vi.fn(() => true),
  })),
  parseNaturalLanguageToCron: vi.fn(() => 
    Promise.resolve({
      name: "测试任务",
      cron: "0 9 * * *",
      command: "/task execute test",
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
    getEnabledWorkflows: vi.fn(() => []),
  })),
}));

vi.mock("../../src/workflow/scheduler-integration.js", () => ({
  getWorkflowScheduler: vi.fn(() => ({
    scheduleWorkflow: vi.fn(),
  })),
}));

describe("taskHandler", () => {
  const mockSession = {
    config: {
      id: "test-agent",
      ai: { model: "kimi-test" },
      workspace: { path: "/tmp/test" },
    },
  } as AgentSession;

  describe("create 子命令 - 有 sessionContext", () => {
    it("应该要求用户确认当 sessionContext 存在", async () => {
      // Arrange
      const mockSessionContext = {
        id: "session-123",
        state: { data: {} },
      } as SessionContext;

      const context: CommandContext = {
        session: mockSession,
        fromUser: "wxid_user123",
        contextToken: "token-123",
        sessionContext: mockSessionContext,
      };

      // Act
      const result = await taskHandler("create 每天上午9点提醒", context, new Map(), new Map());

      // Assert
      expect(result).toContain("🤖 解析结果");
      expect(result).toContain('回复 "确认" 创建此任务');
      expect(result).toContain("5分钟内有效");
    });
  });

  describe("create 子命令 - 无 sessionContext", () => {
    it("应该直接创建任务当 sessionContext 不存在", async () => {
      // Arrange
      const context: CommandContext = {
        session: mockSession,
        fromUser: "wxid_user123",
        contextToken: "token-123",
        // ❌ 没有 sessionContext
      };

      // Act
      const result = await taskHandler("create 每天上午9点提醒", context, new Map(), new Map());

      // Assert
      expect(result).toContain("✅ 任务已创建");
      expect(result).toContain("任务ID:");
      expect(result).not.toContain("回复 \"确认\"");
    });

    it("应该返回错误信息而不是 '上下文不可用'", async () => {
      // Arrange
      const context: CommandContext = {
        session: mockSession,
        fromUser: "wxid_user123",
        contextToken: "token-123",
      };

      // Act
      const result = await taskHandler("create 每天上午9点提醒", context, new Map(), new Map());

      // Assert - 不应该出现旧的错误消息
      expect(result).not.toContain("当前会话上下文不可用");
      expect(result).not.toContain("请重试");
    });
  });

  describe("list 子命令", () => {
    it("应该返回任务列表", async () => {
      // Arrange
      const context: CommandContext = {
        session: mockSession,
        fromUser: "wxid_user123",
        contextToken: "token-123",
      };

      // Act
      const result = await taskHandler("list", context, new Map(), new Map());

      // Assert
      expect(result).toContain("暂无定时任务");
    });
  });

  describe("无效命令", () => {
    it("应该返回帮助信息", async () => {
      // Arrange
      const context: CommandContext = {
        session: mockSession,
        fromUser: "wxid_user123",
        contextToken: "token-123",
      };

      // Act
      const result = await taskHandler("invalid", context, new Map(), new Map());

      // Assert
      expect(result).toContain("定时任务管理");
      expect(result).toContain("用法:");
    });
  });
});
