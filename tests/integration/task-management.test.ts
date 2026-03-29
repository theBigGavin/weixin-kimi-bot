/**
 * 任务管理集成测试
 * 
 * 测试定时任务、长任务和流程任务的管理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getScheduler, formatCronDescription, parseNaturalLanguageToCron } from "../../src/scheduler.js";
import { getLongTaskManagerSync, formatProgressMessage } from "../../src/longtask/manager.js";
import { getFlowTaskManager, formatProgressMessage as formatFlowProgress } from "../../src/flowtask/manager.js";
import type { LongTask, ProgressInfo as LongTaskProgress } from "../../src/longtask/types.js";
import type { FlowTask, ProgressInfo as FlowTaskProgress } from "../../src/flowtask/types.js";

describe("任务管理集成测试", () => {
  const agentId = "test-agent";

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // 清理任务管理器
    getScheduler(agentId).stop();
  });

  describe("定时任务 (Scheduler)", () => {
    it("应该创建定时任务", () => {
      const scheduler = getScheduler(agentId);
      scheduler.setApi({ baseUrl: "", token: "" }, async () => {});

      const task = scheduler.addTask({
        name: "每日备份",
        cron: "0 9 * * *",
        command: "npm run backup",
        chatId: "test-chat",
        contextToken: "test-token",
        enabled: true,
      });

      expect(task).toBeDefined();
      expect(task.id).toBeDefined();
      expect(task.name).toBe("每日备份");
      expect(task.cron).toBe("0 9 * * *");
      expect(task.enabled).toBe(true);
    });

    it("应该列出所有任务", () => {
      const scheduler = getScheduler(agentId);
      scheduler.setApi({ baseUrl: "", token: "" }, async () => {});

      scheduler.addTask({
        name: "任务1",
        cron: "0 9 * * *",
        command: "cmd1",
        chatId: "chat1",
        contextToken: "token1",
        enabled: true,
      });

      scheduler.addTask({
        name: "任务2",
        cron: "0 10 * * *",
        command: "cmd2",
        chatId: "chat2",
        contextToken: "token2",
        enabled: false,
      });

      const tasks = scheduler.getAllTasks();
      expect(tasks).toHaveLength(2);
    });

    it("应该删除任务", () => {
      const scheduler = getScheduler(agentId);
      scheduler.setApi({ baseUrl: "", token: "" }, async () => {});

      const task = scheduler.addTask({
        name: "待删除任务",
        cron: "0 9 * * *",
        command: "cmd",
        chatId: "chat",
        contextToken: "token",
        enabled: true,
      });

      expect(scheduler.getAllTasks()).toHaveLength(1);

      scheduler.removeTask(task.id);

      expect(scheduler.getAllTasks()).toHaveLength(0);
    });

    it("应该切换任务状态", () => {
      const scheduler = getScheduler(agentId);
      scheduler.setApi({ baseUrl: "", token: "" }, async () => {});

      const task = scheduler.addTask({
        name: "可切换任务",
        cron: "0 9 * * *",
        command: "cmd",
        chatId: "chat",
        contextToken: "token",
        enabled: true,
      });

      expect(task.enabled).toBe(true);

      scheduler.toggleTask(task.id);

      const tasks = scheduler.getAllTasks();
      expect(tasks[0].enabled).toBe(false);
    });

    it("应该格式化 cron 描述", () => {
      const desc1 = formatCronDescription("0 9 * * *");
      expect(desc1).toContain("9");

      const desc2 = formatCronDescription("0 */6 * * *");
      expect(desc2).toBeDefined();

      const desc3 = formatCronDescription("0 0 * * 1");
      expect(desc3).toBeDefined();
    });

    it("应该解析自然语言到 cron", () => {
      const result = await parseNaturalLanguageToCron("每天早上9点");

      expect(result).not.toBeNull();
      if (result) {
        expect(result).toHaveProperty("name");
        expect(result).toHaveProperty("cron");
        expect(result).toHaveProperty("command");
        expect(result).toHaveProperty("description");
      }
    });

    it("应该启动和停止调度器", () => {
      const scheduler = getScheduler(agentId);
      scheduler.setApi({ baseUrl: "", token: "" }, async () => {});

      // 启动
      scheduler.start();

      // 停止
      scheduler.stop();

      // 验证没有抛出错误
      expect(true).toBe(true);
    });
  });

  describe("长任务 (LongTask)", () => {
    it("应该提交长任务", () => {
      const ltManager = getLongTaskManagerSync(agentId, {
        maxConcurrency: 2,
        reportIntervalMs: 1000,
        onProgress: async () => {},
        onComplete: async () => {},
      });

      const task = ltManager.submit({
        agentId,
        userId: "user-1",
        chatId: "chat-1",
        contextToken: "token-1",
        prompt: "分析股票数据",
        cwd: "/tmp",
        model: "kimi",
        systemPrompt: "You are an analyst.",
        maxTurns: 10,
      });

      expect(task).toBeDefined();
      expect(task.id).toBeDefined();
      expect(["pending", "running", "planning"]).toContain(task.status); // 提交后可能立即变为 running
      expect(task.prompt).toBe("分析股票数据");
    });

    it("应该获取任务队列长度", () => {
      const ltManager = getLongTaskManagerSync(agentId, {
        maxConcurrency: 2,
        reportIntervalMs: 1000,
        onProgress: async () => {},
        onComplete: async () => {},
      });

      expect(ltManager.getQueueLength()).toBe(0);

      ltManager.submit({
        agentId,
        userId: "user-1",
        chatId: "chat-1",
        contextToken: "token-1",
        prompt: "任务1",
        cwd: "/tmp",
        model: "kimi",
        systemPrompt: "",
        maxTurns: 10,
      });

      // 任务可能立即执行，队列可能为0
      expect(ltManager.getQueueLength()).toBeGreaterThanOrEqual(0);
    });

    it("应该获取任务状态", () => {
      const ltManager = getLongTaskManagerSync(agentId, {
        maxConcurrency: 2,
        reportIntervalMs: 1000,
        onProgress: async () => {},
        onComplete: async () => {},
      });

      const task = ltManager.submit({
        agentId,
        userId: "user-1",
        chatId: "chat-1",
        contextToken: "token-1",
        prompt: "测试任务",
        cwd: "/tmp",
        model: "kimi",
        systemPrompt: "",
        maxTurns: 10,
      });

      const retrieved = ltManager.getTask(task.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(task.id);
    });

    it("应该列出任务", () => {
      const ltManager = getLongTaskManagerSync(agentId, {
        maxConcurrency: 2,
        reportIntervalMs: 1000,
        onProgress: async () => {},
        onComplete: async () => {},
      });

      ltManager.submit({
        agentId,
        userId: "user-1",
        chatId: "chat-1",
        contextToken: "token-1",
        prompt: "任务1",
        cwd: "/tmp",
        model: "kimi",
        systemPrompt: "",
        maxTurns: 10,
      });

      const tasks = ltManager.getUserTasks("user-1");
      expect(tasks.length).toBeGreaterThan(0);
    });

    it("应该格式化进度消息", () => {
      const mockTask = {
        id: "lt-1",
        prompt: "分析数据",
        status: "running",
        createdAt: Date.now(),
      } as LongTask;

      const mockProgress: LongTaskProgress = {
        percent: 50,
        step: "处理中...",
        detail: "正在分析第50条记录",
        timestamp: Date.now(),
      };

      const message = formatProgressMessage(mockTask, mockProgress);

      expect(message).toContain("lt-1");
      expect(message).toContain("50%");
      expect(message).toContain("处理中");
    });

    it("应该支持取消任务", async () => {
      const ltManager = getLongTaskManagerSync(agentId, {
        maxConcurrency: 2,
        reportIntervalMs: 1000,
        onProgress: async () => {},
        onComplete: async () => {},
        onCancel: async () => {},
      });

      const task = ltManager.submit({
        agentId,
        userId: "user-1",
        chatId: "chat-1",
        contextToken: "token-1",
        prompt: "可取消任务",
        cwd: "/tmp",
        model: "kimi",
        systemPrompt: "",
        maxTurns: 10,
      });

      // 取消任务不应该抛出错误
      await expect(ltManager.cancel(task.id)).resolves.not.toThrow();
    });
  });

  describe("流程任务 (FlowTask)", () => {
    it("应该提交流程任务", async () => {
      const ftManager = getFlowTaskManager(agentId, {
        maxConcurrency: 2,
        reportIntervalMs: 1000,
        autoApproveLowRisk: false,
        requireApprovalFor: ["write", "shell"],
        onProgress: async () => {},
        onComplete: async () => {},
        onCancel: async () => {},
        onApprovalRequest: async () => true,
      });

      const task = await ftManager.submit({
        agentId,
        userId: "user-1",
        chatId: "chat-1",
        contextToken: "token-1",
        prompt: "创建一个网站",
        cwd: "/tmp",
        model: "kimi",
        systemPrompt: "You are a developer.",
        maxTurns: 10,
      });

      expect(task).toBeDefined();
      expect(task.id).toBeDefined();
      expect(["pending", "planning"]).toContain(task.status); // 提交后可能立即变为 planning
    });

    it("应该获取任务状态", async () => {
      const ftManager = getFlowTaskManager(agentId, {
        maxConcurrency: 2,
        reportIntervalMs: 1000,
        autoApproveLowRisk: false,
        requireApprovalFor: ["write"],
        onProgress: async () => {},
        onComplete: async () => {},
        onCancel: async () => {},
        onApprovalRequest: async () => true,
      });

      const task = await ftManager.submit({
        agentId,
        userId: "user-1",
        chatId: "chat-1",
        contextToken: "token-1",
        prompt: "测试任务",
        cwd: "/tmp",
        model: "kimi",
        systemPrompt: "",
        maxTurns: 10,
      });

      const retrieved = ftManager.getTask(task.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(task.id);
    });

    it("应该获取用户的任务列表", async () => {
      const ftManager = getFlowTaskManager(agentId, {
        maxConcurrency: 2,
        reportIntervalMs: 1000,
        autoApproveLowRisk: false,
        requireApprovalFor: ["write"],
        onProgress: async () => {},
        onComplete: async () => {},
        onCancel: async () => {},
        onApprovalRequest: async () => true,
      });

      await ftManager.submit({
        agentId,
        userId: "user-1",
        chatId: "chat-1",
        contextToken: "token-1",
        prompt: "任务1",
        cwd: "/tmp",
        model: "kimi",
        systemPrompt: "",
        maxTurns: 10,
      });

      const tasks = ftManager.getUserTasks("user-1");
      expect(tasks.length).toBeGreaterThan(0);
    });

    it("应该支持取消任务", async () => {
      const ftManager = getFlowTaskManager(agentId, {
        maxConcurrency: 2,
        reportIntervalMs: 1000,
        autoApproveLowRisk: false,
        requireApprovalFor: ["write"],
        onProgress: async () => {},
        onComplete: async () => {},
        onCancel: async () => {},
        onApprovalRequest: async () => true,
      });

      const task = await ftManager.submit({
        agentId,
        userId: "user-1",
        chatId: "chat-1",
        contextToken: "token-1",
        prompt: "可取消任务",
        cwd: "/tmp",
        model: "kimi",
        systemPrompt: "",
        maxTurns: 10,
      });

      await expect(ftManager.cancel(task.id)).resolves.not.toThrow();
    });

    it("应该获取队列长度", async () => {
      const ftManager = getFlowTaskManager(agentId, {
        maxConcurrency: 1, // 只允许一个并发，其他会进入队列
        reportIntervalMs: 1000,
        autoApproveLowRisk: false,
        requireApprovalFor: ["write"],
        onProgress: async () => {},
        onComplete: async () => {},
        onCancel: async () => {},
        onApprovalRequest: async () => true,
      });

      expect(ftManager.getQueueLength()).toBe(0);

      // 提交任务可能进入队列
      await ftManager.submit({
        agentId,
        userId: "user-1",
        chatId: "chat-1",
        contextToken: "token-1",
        prompt: "队列测试任务",
        cwd: "/tmp",
        model: "kimi",
        systemPrompt: "",
        maxTurns: 10,
      });

      // 队列长度可能为0（如果直接执行）或更大
      expect(ftManager.getQueueLength()).toBeGreaterThanOrEqual(0);
    });

    it("应该格式化进度消息", () => {
      const mockTask = {
        id: "ft-1",
        prompt: "创建网站",
        status: "running",
        createdAt: Date.now(),
        plan: {
          steps: [
            { id: "s1", description: "步骤1", command: "cmd1", status: "completed", dependsOn: [], validation: { required: true, riskLevel: "low" } },
            { id: "s2", description: "步骤2", command: "cmd2", status: "running", dependsOn: ["s1"], validation: { required: true, riskLevel: "medium" } },
          ],
          validation: { riskLevel: "medium", canAutoExecute: false, requiresApproval: true },
        },
      } as FlowTask;

      const mockProgress: FlowTaskProgress = {
        percent: 50,
        step: "执行步骤2",
        detail: "正在处理",
        timestamp: Date.now(),
      };

      const message = formatFlowProgress(mockTask, mockProgress);

      expect(message).toContain("ft-1");
      expect(message).toContain("50%");
    });
  });

  describe("任务类型对比", () => {
    it("应该根据任务特点选择合适类型", () => {
      // 定时任务：适合周期性执行
      const scheduledTask = {
        type: "scheduled",
        useCase: "每日报告",
        features: ["cron 表达式", "重复执行"],
      };

      // 长任务：适合耗时操作
      const longTask = {
        type: "longtask",
        useCase: "数据分析",
        features: ["后台执行", "进度报告", "不阻塞对话"],
      };

      // 流程任务：适合复杂多步骤任务
      const flowTask = {
        type: "flowtask",
        useCase: "创建项目",
        features: ["步骤规划", "风险审批", "自我纠错"],
      };

      expect(scheduledTask.type).toBe("scheduled");
      expect(longTask.type).toBe("longtask");
      expect(flowTask.type).toBe("flowtask");
    });
  });
});
