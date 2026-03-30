/**
 * 部署环境识别测试
 * 
 * 测试不同环境下的部署策略
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { 
  getDeployEnvironment, 
  validateBeforeDeploy,
  type DeployEnvironment,
  type TestResult 
} from "../../src/handlers/commands/deploy.js";

describe("部署环境识别", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // 重置环境变量
    process.env = { ...originalEnv };
    delete process.env.DEPLOY_ENV;
    delete process.env.NODE_ENV;
    vi.clearAllMocks();
  });

  describe("getDeployEnvironment", () => {
    it("应该从 DEPLOY_ENV 环境变量读取", () => {
      // Arrange
      process.env.DEPLOY_ENV = "production";

      // Act
      const env = getDeployEnvironment();

      // Assert
      expect(env).toBe("production");
    });

    it("应该回退到 NODE_ENV", () => {
      // Arrange
      process.env.NODE_ENV = "staging";

      // Act
      const env = getDeployEnvironment();

      // Assert
      expect(env).toBe("staging");
    });

    it("默认值应该是 development", () => {
      // Arrange - 没有设置任何环境变量
      delete process.env.DEPLOY_ENV;
      delete process.env.NODE_ENV;

      // Act
      const env = getDeployEnvironment();

      // Assert
      expect(env).toBe("development");
    });

    it("应该支持 production 环境", () => {
      process.env.DEPLOY_ENV = "production";
      expect(getDeployEnvironment()).toBe("production");
    });

    it("应该支持 staging 环境", () => {
      process.env.DEPLOY_ENV = "staging";
      expect(getDeployEnvironment()).toBe("staging");
    });

    it("应该支持 development 环境", () => {
      process.env.DEPLOY_ENV = "development";
      expect(getDeployEnvironment()).toBe("development");
    });
  });

  describe("不同环境的部署策略", () => {
    const mockTestResult: TestResult = {
      success: true,
      passed: 100,
      failed: 0,
      skipped: 5,
    };

    it("production 环境：跳过测试应该阻止部署", async () => {
      // Arrange
      process.env.DEPLOY_ENV = "production";

      // Act
      const result = await validateBeforeDeploy(mockTestResult, false, "production");

      // Assert
      expect(result.canDeploy).toBe(false);
      expect(result.message).toContain("production");
      expect(result.message).toContain("跳过");
    });

    it("staging 环境：不允许有跳过测试", async () => {
      // Arrange
      process.env.DEPLOY_ENV = "staging";

      // Act
      const result = await validateBeforeDeploy(mockTestResult, false, "staging");

      // Assert - staging 不允许跳过
      expect(result.canDeploy).toBe(false);
      expect(result.message).toContain("staging");
      expect(result.message).toContain("跳过");
    });

    it("development 环境：允许有跳过测试", async () => {
      // Arrange
      process.env.DEPLOY_ENV = "development";

      // Act
      const result = await validateBeforeDeploy(mockTestResult, false, "development");

      // Assert
      expect(result.canDeploy).toBe(true);
    });

    it("production 环境：所有测试通过时允许部署", async () => {
      // Arrange
      process.env.DEPLOY_ENV = "production";
      const perfectResult: TestResult = {
        success: true,
        passed: 105,
        failed: 0,
        skipped: 0,
      };

      // Act
      const result = await validateBeforeDeploy(perfectResult, false, "production");

      // Assert
      expect(result.canDeploy).toBe(true);
      expect(result.message).toContain("✅");
    });
  });

  describe("环境特定的测试要求", () => {
    it("production 应该要求 100% 测试通过率", async () => {
      const result = await validateBeforeDeploy(
        { success: true, passed: 100, failed: 0, skipped: 0 },
        false,
        "production"
      );
      expect(result.canDeploy).toBe(true);
    });

    it("production 应该要求最低测试覆盖率", async () => {
      // 生产环境应该有覆盖率要求
      const result = await validateBeforeDeploy(
        { success: true, passed: 10, failed: 0, skipped: 0 },
        false,
        "production"
      );
      // 测试数量太少也应该阻止
      expect(result.canDeploy).toBe(false);
      expect(result.message).toContain("测试数量不足");
    });
  });
});
