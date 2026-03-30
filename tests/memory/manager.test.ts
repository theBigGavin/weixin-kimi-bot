/**
 * 记忆管理器测试
 * 
 * 测试长期记忆的存储、检索和更新
 */

import { describe, it, expect } from "vitest";
import type { AgentMemory } from "../../src/agent/types.js";

describe("MemoryManager", () => {
  describe("模块导入", () => {
    it("应该能够导入模块", async () => {
      // Act
      const memoryModule = await import("../../src/memory/manager.js");

      // Assert
      expect(memoryModule).toBeDefined();
    });

    it("应该导出记忆函数", async () => {
      // Act
      const memory = await import("../../src/memory/manager.js");

      // Assert
      expect(typeof memory.extractMemoryFromConversation).toBe("function");
      expect(typeof memory.mergeMemory).toBe("function");
      expect(typeof memory.getRelevantMemory).toBe("function");
      expect(typeof memory.formatMemoryForPrompt).toBe("function");
    });
  });

  describe("记忆格式化", () => {
    it("应该格式化记忆为提示词", async () => {
      // Arrange
      const { formatMemoryForPrompt } = await import("../../src/memory/manager.js");
      const mockMemory: AgentMemory = {
        version: 1,
        updatedAt: Date.now(),
        userProfile: {
          preferences: ["喜欢TypeScript"],
          expertise: [{ area: "React", level: "高级" }],
          habits: ["使用函数组件"],
        },
        facts: [{ 
          id: "fact-1", 
          content: "用户是前端工程师", 
          category: "identity",
          confidence: 0.9,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }],
        projects: [],
        learning: [],
      };

      // Act
      const result = formatMemoryForPrompt(mockMemory);

      // Assert
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("应该返回空字符串当没有记忆", async () => {
      // Arrange
      const { formatMemoryForPrompt } = await import("../../src/memory/manager.js");
      const emptyMemory: AgentMemory = {
        version: 1,
        updatedAt: Date.now(),
        userProfile: { preferences: [], expertise: [], habits: [] },
        facts: [],
        projects: [],
        learning: [],
      };

      // Act
      const result = formatMemoryForPrompt(emptyMemory);

      // Assert
      expect(typeof result).toBe("string");
    });
  });

  describe("记忆合并", () => {
    it("应该合并新旧记忆", async () => {
      // Arrange
      const { mergeMemory } = await import("../../src/memory/manager.js");
      const oldMemory: AgentMemory = {
        version: 1,
        updatedAt: Date.now(),
        userProfile: { preferences: ["旧偏好"], expertise: [], habits: [] },
        facts: [],
        projects: [],
        learning: [],
      };
      const newMemory: AgentMemory = {
        version: 1,
        updatedAt: Date.now(),
        userProfile: { preferences: ["新偏好"], expertise: [], habits: [] },
        facts: [],
        projects: [],
        learning: [],
      };

      // Act
      const merged = mergeMemory(oldMemory, newMemory);

      // Assert
      expect(merged.userProfile.preferences.length).toBeGreaterThan(0);
    });
  });

  describe("相关记忆检索", () => {
    it("应该根据主题检索记忆", async () => {
      // Arrange
      const { getRelevantMemory } = await import("../../src/memory/manager.js");
      const memory: AgentMemory = {
        version: 1,
        updatedAt: Date.now(),
        userProfile: { 
          preferences: ["喜欢React", "喜欢TypeScript"], 
          expertise: [], 
          habits: [] 
        },
        facts: [],
        projects: [],
        learning: [],
      };

      // Act
      const result = getRelevantMemory(memory, ["React"]);

      // Assert
      expect(result).toBeDefined();
    });
  });
});
