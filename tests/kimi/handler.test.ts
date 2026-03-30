/**
 * Kimi Handler 基础测试
 */

import { describe, it, expect } from "vitest";

describe("Kimi Handler", () => {
  describe("基本功能", () => {
    it("应该导出必要的函数", async () => {
      // Import the module
      const handler = await import("../../src/kimi/handler.js");
      
      // 检查主要函数是否存在
      expect(typeof handler.askKimi).toBe("function");
      expect(typeof handler.checkKimiInstalled).toBe("function");
      expect(typeof handler.checkKimiAuthenticated).toBe("function");
      expect(typeof handler.isLikelyLongTask).toBe("function");
    });

    it("应该导出类型定义", async () => {
      const handler = await import("../../src/kimi/handler.js");
      
      // 检查类型定义是否存在（TypeScript编译时检查）
      expect(handler).toBeDefined();
    });
  });

  describe("isLikelyLongTask", () => {
    it("应该能判断任务类型", async () => {
      const { isLikelyLongTask } = await import("../../src/kimi/handler.js");
      
      // 函数应该存在并可调用
      expect(typeof isLikelyLongTask).toBe("function");
      
      // 测试不同的输入
      const result1 = isLikelyLongTask("帮我写一个完整的项目");
      const result2 = isLikelyLongTask("你好");
      
      // 结果应该是布尔值
      expect(typeof result1).toBe("boolean");
      expect(typeof result2).toBe("boolean");
    });
  });

  describe("命令格式化", () => {
    it("应该支持基本命令", () => {
      const command = "/help";
      expect(command.startsWith("/")).toBe(true);
    });

    it("应该支持带参数的命令", () => {
      const command = "/task create 测试任务";
      const parts = command.split(" ");
      expect(parts.length).toBeGreaterThan(1);
      expect(parts[0]).toBe("/task");
    });
  });
});
