/**
 * 定时任务确认流程测试
 * 
 * 测试点：
 * 1. prepareCreate - 准备创建任务，存储到 Session 状态
 * 2. finalizeCreate - 确认创建任务，创建正式任务
 * 3. cancelCreate - 取消创建任务
 * 4. hasPendingTask - 检查是否有待确认任务
 * 5. checkConfirmationIntent - 检查确认/取消指令
 * 6. 过期检查 - 5分钟后任务自动失效
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TaskService, getTaskService, isTaskConfirmation, isTaskCancellation } from "../src/services/task-service.js";
import { initializeContextSystem, getContextManager, resetContextSystem } from "../src/context/index.js";
import { ConversationState, type SessionContext, type PendingScheduledTask } from "../src/context/types.js";

describe("TaskService", () => {
  const TEST_AGENT_ID = "test_agent";
  // 使用唯一的用户ID避免持久化文件污染
  let testUserId: string;
  
  let taskService: TaskService;
  let sessionContext: SessionContext;
  
  beforeEach(async () => {
    // 生成唯一的用户ID
    testUserId = `test_user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    
    // 初始化上下文系统
    initializeContextSystem();
    
    // 创建 TaskService
    taskService = getTaskService(TEST_AGENT_ID);
    
    // 创建测试会话上下文
    const contextManager = getContextManager();
    sessionContext = await contextManager.getOrCreate(testUserId, TEST_AGENT_ID);
  });
  
  afterEach(() => {
    resetContextSystem();
  });

  describe("prepareCreate", () => {
    it("应该将任务信息保存到 Session 状态", async () => {
      const taskInfo = {
        name: "测试任务",
        cron: "0 8 * * *",
        command: "echo 'hello'",
        description: "每天早上8点",
      };

      const pendingId = await taskService.prepareCreate(
        sessionContext,
        taskInfo,
        testUserId,
        testUserId,
        "test_token"
      );

      expect(pendingId).toBeDefined();
      expect(pendingId.startsWith("pending_")).toBe(true);
      
      // 验证保存到 Session 状态
      const pendingTask = sessionContext.state.data?.pendingScheduledTask;
      expect(pendingTask).toBeDefined();
      expect(pendingTask?.name).toBe("测试任务");
      expect(pendingTask?.cron).toBe("0 8 * * *");
      expect(pendingTask?.command).toBe("echo 'hello'");
      expect(pendingTask?.userId).toBe(testUserId);
    });

    it("应该设置5分钟过期时间", async () => {
      const taskInfo = {
        name: "测试任务",
        cron: "0 8 * * *",
        command: "echo 'hello'",
        description: "每天早上8点",
      };

      await taskService.prepareCreate(
        sessionContext,
        taskInfo,
        testUserId,
        testUserId,
        "test_token"
      );

      const pendingTask = sessionContext.state.data?.pendingScheduledTask;
      expect(pendingTask).toBeDefined();
      
      const now = Date.now();
      const expiresAt = pendingTask!.expiresAt;
      const diff = expiresAt - now;
      
      // 应该在5分钟左右（允许1分钟误差）
      expect(diff).toBeGreaterThan(4 * 60 * 1000);
      expect(diff).toBeLessThan(6 * 60 * 1000);
    });
  });

  describe("hasPendingTask", () => {
    it("应该返回 true 当有未过期的待确认任务", async () => {
      const taskInfo = {
        name: "测试任务",
        cron: "0 8 * * *",
        command: "echo 'hello'",
        description: "每天早上8点",
      };

      await taskService.prepareCreate(
        sessionContext,
        taskInfo,
        testUserId,
        testUserId,
        "test_token"
      );

      expect(taskService.hasPendingTask(sessionContext)).toBe(true);
    });

    it("应该返回 false 当没有待确认任务", () => {
      expect(taskService.hasPendingTask(sessionContext)).toBe(false);
    });

    it("应该返回 false 当任务已过期", async () => {
      const taskInfo = {
        name: "测试任务",
        cron: "0 8 * * *",
        command: "echo 'hello'",
        description: "每天早上8点",
      };

      await taskService.prepareCreate(
        sessionContext,
        taskInfo,
        testUserId,
        testUserId,
        "test_token"
      );

      // 手动修改过期时间为过去
      const pendingTask = sessionContext.state.data?.pendingScheduledTask;
      if (pendingTask) {
        pendingTask.expiresAt = Date.now() - 1000; // 1秒前过期
      }

      expect(taskService.hasPendingTask(sessionContext)).toBe(false);
    });
  });

  describe("checkConfirmationIntent", () => {
    it("应该识别确认指令", () => {
      expect(taskService.checkConfirmationIntent("确认")).toBe("confirm");
      expect(taskService.checkConfirmationIntent("confirm")).toBe("confirm");
      expect(taskService.checkConfirmationIntent("是的")).toBe("confirm");
      expect(taskService.checkConfirmationIntent("好")).toBe("confirm");
      expect(taskService.checkConfirmationIntent("ok")).toBe("confirm");
      expect(taskService.checkConfirmationIntent("确定")).toBe("confirm");
      expect(taskService.checkConfirmationIntent("确认创建")).toBe("confirm");
      expect(taskService.checkConfirmationIntent("确定执行")).toBe("confirm");
    });

    it("应该识别取消指令", () => {
      expect(taskService.checkConfirmationIntent("取消")).toBe("cancel");
      expect(taskService.checkConfirmationIntent("cancel")).toBe("cancel");
      expect(taskService.checkConfirmationIntent("不")).toBe("cancel");
      expect(taskService.checkConfirmationIntent("算了")).toBe("cancel");
      expect(taskService.checkConfirmationIntent("放弃")).toBe("cancel");
      expect(taskService.checkConfirmationIntent("放弃创建")).toBe("cancel");
      expect(taskService.checkConfirmationIntent("取消执行")).toBe("cancel");
    });

    it("应该返回 null 当不是确认或取消指令", () => {
      expect(taskService.checkConfirmationIntent("你好")).toBeNull();
      expect(taskService.checkConfirmationIntent("其他命令")).toBeNull();
      expect(taskService.checkConfirmationIntent("/help")).toBeNull();
      expect(taskService.checkConfirmationIntent("我需要确认一下")).toBeNull();
      expect(taskService.checkConfirmationIntent("请取消这个任务")).toBeNull();
    });
  });

  describe("cancelCreate", () => {
    it("应该清除待确认任务", async () => {
      const taskInfo = {
        name: "测试任务",
        cron: "0 8 * * *",
        command: "echo 'hello'",
        description: "每天早上8点",
      };

      await taskService.prepareCreate(
        sessionContext,
        taskInfo,
        testUserId,
        testUserId,
        "test_token"
      );

      expect(taskService.hasPendingTask(sessionContext)).toBe(true);

      const result = await taskService.cancelCreate(sessionContext);

      expect(result.success).toBe(true);
      expect(taskService.hasPendingTask(sessionContext)).toBe(false);
    });

    it("应该返回失败当没有待确认任务", async () => {
      const result = await taskService.cancelCreate(sessionContext);

      expect(result.success).toBe(false);
    });
  });

  describe("getPreviewInfo", () => {
    it("应该返回任务预览信息", async () => {
      const taskInfo = {
        name: "测试任务",
        cron: "0 8 * * *",
        command: "echo 'hello'",
        description: "每天早上8点",
      };

      await taskService.prepareCreate(
        sessionContext,
        taskInfo,
        testUserId,
        testUserId,
        "test_token"
      );

      const preview = taskService.getPreviewInfo(sessionContext);

      expect(preview).toBeDefined();
      expect(preview?.name).toBe("测试任务");
      expect(preview?.cron).toBe("0 8 * * *");
      expect(preview?.description).toBe("每天早上8点");
    });

    it("应该返回 null 当没有待确认任务", () => {
      const preview = taskService.getPreviewInfo(sessionContext);
      expect(preview).toBeNull();
    });
  });
});

describe("isTaskConfirmation", () => {
  it("应该识别纯确认指令", () => {
    expect(isTaskConfirmation("确认")).toBe(true);
    expect(isTaskConfirmation("confirm")).toBe(true);
    expect(isTaskConfirmation("yes")).toBe(true);
    expect(isTaskConfirmation("ok")).toBe(true);
  });

  it("不应该识别包含确认词汇的句子", () => {
    expect(isTaskConfirmation("请确认这个任务")).toBe(false);
    expect(isTaskConfirmation("我需要确认一下")).toBe(false);
  });
});

describe("isTaskCancellation", () => {
  it("应该识别纯取消指令", () => {
    expect(isTaskCancellation("取消")).toBe(true);
    expect(isTaskCancellation("cancel")).toBe(true);
    expect(isTaskCancellation("no")).toBe(true);
    expect(isTaskCancellation("算了")).toBe(true);
  });

  it("不应该识别包含取消词汇的句子", () => {
    expect(isTaskCancellation("请取消这个任务")).toBe(false);
    expect(isTaskCancellation("我要取消")).toBe(false);
  });
});
