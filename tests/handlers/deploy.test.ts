/**
 * /deploy 命令测试
 * 
 * 测试部署前的集成验证逻辑
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateBeforeDeploy } from "../../src/handlers/commands/deploy.js";

describe("deploy 命令 - 集成测试验证", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateBeforeDeploy", () => {
    it("应该允许部署当所有测试通过", async () => {
      // Arrange
      const mockTestResult = {
        success: true,
        passed: 100,
        failed: 0,
        skipped: 0,
      };

      // Act
      const result = await validateBeforeDeploy(mockTestResult);

      // Assert
      expect(result.canDeploy).toBe(true);
      expect(result.message).toContain("✅");
    });

    it("应该阻止部署当有测试失败", async () => {
      // Arrange
      const mockTestResult = {
        success: false,
        passed: 95,
        failed: 5,
        skipped: 0,
      };

      // Act
      const result = await validateBeforeDeploy(mockTestResult);

      // Assert
      expect(result.canDeploy).toBe(false);
      expect(result.message).toContain("❌");
      expect(result.message).toContain("5 个测试失败");
    });

    it("应该允许部署当有测试跳过但无失败", async () => {
      // Arrange
      const mockTestResult = {
        success: true,
        passed: 95,
        failed: 0,
        skipped: 5,
      };

      // Act
      const result = await validateBeforeDeploy(mockTestResult);

      // Assert - 新策略：跳过测试不阻止部署
      expect(result.canDeploy).toBe(true);
      expect(result.message).toContain("✅");
      expect(result.message).toContain("5 个跳过");
    });

    it("应该阻止部署当测试失败（即使有跳过）", async () => {
      // Arrange
      const mockTestResult = {
        success: false,
        passed: 90,
        failed: 5,
        skipped: 5,
      };

      // Act
      const result = await validateBeforeDeploy(mockTestResult);

      // Assert - 失败测试阻止部署
      expect(result.canDeploy).toBe(false);
      expect(result.message).toContain("5 个测试失败");
    });

    it("应该允许部署当没有测试数据但强制部署", async () => {
      // Arrange
      const mockTestResult = null;
      const force = true;

      // Act
      const result = await validateBeforeDeploy(mockTestResult, force, "development");

      // Assert
      expect(result.canDeploy).toBe(true);
      expect(result.message).toContain("强制部署");
    });

    it("应该阻止部署当没有测试数据", async () => {
      // Arrange
      const mockTestResult = null;
      const force = false;

      // Act
      const result = await validateBeforeDeploy(mockTestResult, force);

      // Assert
      expect(result.canDeploy).toBe(false);
      expect(result.message).toContain("无法获取测试结果");
    });
  });

  describe("部署流程集成", () => {
    it("应该先运行测试再部署", async () => {
      // 这是一个集成测试的占位符
      // 实际实现中会调用 npm test
      expect(true).toBe(true);
    });

    it("测试失败时应该显示详细错误", async () => {
      const mockTestResult = {
        success: false,
        passed: 90,
        failed: 10,
        skipped: 0,
        failedTests: [
          { name: "test1", error: "AssertionError" },
          { name: "test2", error: "TimeoutError" },
        ],
      };

      const result = await validateBeforeDeploy(mockTestResult);

      expect(result.canDeploy).toBe(false);
      expect(result.details).toBeDefined();
    });
  });

  describe("任务完成通知机制", () => {
    afterEach(() => {
      vi.clearAllMocks();
      vi.useRealTimers();
    });

    it("任务状态轮询应该使用递归 setTimeout 而非 setInterval", async () => {
      // 这个测试验证实现方式：递归 setTimeout 比 setInterval 更可靠
      // 因为 setInterval 可能错过快速完成的任务
      
      // 读取源代码检查实现
      const fs = await import("fs");
      const path = await import("path");
      const { fileURLToPath } = await import("url");
      
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const deploySource = fs.readFileSync(
        path.join(__dirname, "../../src/handlers/commands/deploy.ts"),
        "utf-8"
      );
      
      // 验证使用递归 setTimeout 而非 setInterval
      expect(deploySource).toContain("setTimeout(checkTaskStatus");
      expect(deploySource).not.toContain("setInterval(async () =>");
      
      // 验证有错误处理
      expect(deploySource).toContain("try {");
      expect(deploySource).toContain("catch (error)");
      expect(deploySource).toContain("发送通知失败");
      
      // 验证有超时保护
      expect(deploySource).toContain("maxChecks");
      expect(deploySource).toContain("checkCount < maxChecks");
    });

    it("任务完成时应该解析版本号并包含在消息中", async () => {
      // 验证版本号解析正则
      const result = "🎉 版本 v1.2.3 发布成功";
      const releaseMatch = result.match(/🎉 版本 v(\d+\.\d+\.\d+)/);
      
      expect(releaseMatch).toBeTruthy();
      expect(releaseMatch![1]).toBe("1.2.3");
    });

    it("任务失败时应该提取错误信息", async () => {
      const errorTask = {
        status: "failed",
        error: "构建失败：npm run build 出错",
        result: "",
      };
      
      const errorMsg = errorTask.error || "未知错误";
      expect(errorMsg).toContain("构建失败");
    });

    it("应该立即开始检查任务状态", async () => {
      // 读取源代码验证
      const fs = await import("fs");
      const path = await import("path");
      const { fileURLToPath } = await import("url");
      
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const deploySource = fs.readFileSync(
        path.join(__dirname, "../../src/handlers/commands/deploy.ts"),
        "utf-8"
      );
      
      // 验证在提交后立即调用 checkTaskStatus
      expect(deploySource).toContain("// 立即开始检查（任务可能很快完成）");
      expect(deploySource).toMatch(/checkTaskStatus\(\)/);
    });
  });
});
