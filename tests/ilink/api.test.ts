/**
 * iLink API 基础测试
 */

import { describe, it, expect } from "vitest";

describe("ILinkAPI", () => {
  describe("模块导入", () => {
    it("应该能够导入模块", async () => {
      // Act
      const apiModule = await import("../../src/ilink/api.js");

      // Assert
      expect(apiModule).toBeDefined();
    });

    it("应该导出 API 函数", async () => {
      // Act
      const api = await import("../../src/ilink/api.js");

      // Assert
      expect(typeof api.sendMessage).toBe("function");
      expect(typeof api.getUpdates).toBe("function");
      expect(typeof api.sendTyping).toBe("function");
    });
  });

  describe("类型定义", () => {
    it("应该导出必要的类型", async () => {
      // Arrange
      const api = await import("../../src/ilink/api.js");

      // Assert - 类型在 TypeScript 编译时检查
      expect(api).toBeDefined();
    });
  });
});
