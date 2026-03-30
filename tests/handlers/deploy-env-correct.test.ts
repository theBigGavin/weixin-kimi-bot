/**
 * 部署环境识别测试 - 修正版
 * 
 * 正确逻辑：
 * - production: 最严格，不允许跳过
 * - staging: 严格，尽量避免跳过
 * - development: 宽松，允许跳过（方便调试）
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { 
  validateBeforeDeploy,
  type TestResult 
} from "../../src/handlers/commands/deploy.js";

describe("部署环境策略 - 正确逻辑", () => {
  const mockTestResult = (passed: number, failed: number, skipped: number): TestResult => ({
    success: failed === 0,
    passed,
    failed,
    skipped,
  });

  describe("production 环境 - 最严格", () => {
    it("应该阻止部署当有测试跳过", async () => {
      const result = await validateBeforeDeploy(
        mockTestResult(100, 0, 5),
        false,
        "production"
      );

      expect(result.canDeploy).toBe(false);
      expect(result.message).toContain("production");
      expect(result.message).toContain("跳过");
    });

    it("应该要求 100% 测试通过", async () => {
      const result = await validateBeforeDeploy(
        mockTestResult(105, 0, 0),
        false,
        "production"
      );

      expect(result.canDeploy).toBe(true);
      expect(result.message).toContain("100%");
    });

    it("应该阻止部署当有失败", async () => {
      const result = await validateBeforeDeploy(
        mockTestResult(95, 5, 0),
        false,
        "production"
      );

      expect(result.canDeploy).toBe(false);
    });
  });

  describe("staging 环境 - 严格", () => {
    it("应该阻止部署当有测试跳过", async () => {
      const result = await validateBeforeDeploy(
        mockTestResult(100, 0, 5),
        false,
        "staging"
      );

      expect(result.canDeploy).toBe(false);
      expect(result.message).toContain("跳过");
    });

    it("应该允许部署当所有测试通过", async () => {
      const result = await validateBeforeDeploy(
        mockTestResult(100, 0, 0),
        false,
        "staging"
      );

      expect(result.canDeploy).toBe(true);
    });

    it("应该阻止部署当有失败", async () => {
      const result = await validateBeforeDeploy(
        mockTestResult(95, 5, 0),
        false,
        "staging"
      );

      expect(result.canDeploy).toBe(false);
    });
  });

  describe("development 环境 - 宽松（允许跳过）", () => {
    it("应该允许部署当有测试跳过", async () => {
      const result = await validateBeforeDeploy(
        mockTestResult(100, 0, 5),
        false,
        "development"
      );

      expect(result.canDeploy).toBe(true);
      expect(result.message).toContain("跳过");
    });

    it("应该阻止部署当有失败", async () => {
      const result = await validateBeforeDeploy(
        mockTestResult(95, 5, 0),
        false,
        "development"
      );

      expect(result.canDeploy).toBe(false);
    });

    it("应该允许完全通过", async () => {
      const result = await validateBeforeDeploy(
        mockTestResult(100, 0, 0),
        false,
        "development"
      );

      expect(result.canDeploy).toBe(true);
    });
  });

  describe("核心原则", () => {
    it("任何环境都不允许失败测试", async () => {
      const environments = ["production", "staging", "development"] as const;
      
      for (const env of environments) {
        const result = await validateBeforeDeploy(
          mockTestResult(95, 5, 0),
          false,
          env
        );
        expect(result.canDeploy).toBe(false);
        expect(result.message).toContain("失败");
      }
    });

    it("只有 development 允许跳过", async () => {
      // production 不允许
      const prod = await validateBeforeDeploy(
        mockTestResult(100, 0, 5), false, "production"
      );
      expect(prod.canDeploy).toBe(false);

      // staging 不允许
      const staging = await validateBeforeDeploy(
        mockTestResult(100, 0, 5), false, "staging"
      );
      expect(staging.canDeploy).toBe(false);

      // development 允许
      const dev = await validateBeforeDeploy(
        mockTestResult(100, 0, 5), false, "development"
      );
      expect(dev.canDeploy).toBe(true);
    });
  });
});
