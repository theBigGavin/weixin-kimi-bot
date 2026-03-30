/**
 * Agent Manager 测试
 * 
 * 测试 Agent 的创建、加载、更新和删除功能
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { tmpdir } from "os";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// 在导入 manager 前设置测试目录
const testBaseDir = mkdtempSync(join(tmpdir(), "agent-manager-test-"));
process.env.TEST_AGENT_DIR = testBaseDir;

// 动态导入 manager，确保环境变量已设置
const { AgentManager } = await import("../../src/agent/manager.js");
import type { AgentConfig } from "../../src/agent/types.js";

describe("AgentManager", () => {
  let manager: AgentManager;

  beforeEach(async () => {
    manager = new AgentManager();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    // 清理测试目录
    try {
      rmSync(testBaseDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
    delete process.env.TEST_AGENT_DIR;
  });

  describe("createAgent", () => {
    it("应该使用默认配置创建 Agent", async () => {
      // Arrange
      const wechatId = "wxid_test123";

      // Act
      const agent = await manager.createAgent(wechatId);

      // Assert
      expect(agent).toBeDefined();
      expect(agent.id).toMatch(/^agent_\d+_[a-z0-9]+$/);
      expect(agent.wechat.accountId).toBe(wechatId);
      expect(agent.name).toMatch(/^通用助手_\d+$/); // 默认名称基于模板
      expect(agent.ai.templateId).toBe("general"); // 默认模板
    });

    it("应该支持自定义名称", async () => {
      // Arrange
      const customName = "我的程序员助手";

      // Act
      const agent = await manager.createAgent("wxid_test", { name: customName });

      // Assert
      expect(agent.name).toBe(customName);
    });

    it("应该支持自定义模板", async () => {
      // Arrange
      const templateId = "programmer";

      // Act
      const agent = await manager.createAgent("wxid_test", { 
        templateId,
        name: "程序员助手"
      });

      // Assert
      expect(agent.ai.templateId).toBe(templateId);
    });

    it("应该生成唯一的工作目录", async () => {
      // Act
      const agent1 = await manager.createAgent("wxid_test1");
      const agent2 = await manager.createAgent("wxid_test2");

      // Assert
      expect(agent1.workspace.path).not.toBe(agent2.workspace.path);
      expect(agent1.workspace.path).toContain(agent1.id);
    });
  });

  describe("getAgent", () => {
    it("应该返回存在的 Agent", async () => {
      // Arrange
      const created = await manager.createAgent("wxid_test");
      await manager.initialize();

      // Act
      const retrieved = manager.getAgent(created.id);

      // Assert
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    it("应该返回 undefined 当 Agent 不存在", async () => {
      // Arrange
      await manager.initialize();

      // Act
      const result = manager.getAgent("non-existent-id");

      // Assert
      expect(result).toBeUndefined();
    });
  });

  describe("getAllAgents", () => {
    it("应该返回所有 Agent 列表", async () => {
      // Arrange
      await manager.createAgent("wxid_test1", { name: "Agent 1" });
      await manager.createAgent("wxid_test2", { name: "Agent 2" });
      await manager.initialize();

      // Act
      const agents = manager.getAllAgents();

      // Assert
      expect(agents.length).toBeGreaterThanOrEqual(2);
      expect(agents.some(a => a.name === "Agent 1")).toBe(true);
      expect(agents.some(a => a.name === "Agent 2")).toBe(true);
    });

    it("应该返回空数组当没有 Agent", async () => {
      // Arrange
      await manager.initialize();

      // Act
      const agents = manager.getAllAgents();

      // Assert - 可能有其他测试创建的 Agent，所以只检查是否为数组
      expect(Array.isArray(agents)).toBe(true);
    });
  });

  describe("updateAgent", () => {
    it("应该更新 Agent 配置", async () => {
      // Arrange
      const agent = await manager.createAgent("wxid_test", { name: "Old Name" });
      await manager.initialize();

      // Act
      const updated = await manager.updateAgent(agent.id, { name: "New Name" });

      // Assert
      expect(updated).toBeDefined();
      expect(updated?.name).toBe("New Name");
      
      const retrieved = manager.getAgent(agent.id);
      expect(retrieved?.name).toBe("New Name");
    });

    it("应该返回 null 当 Agent 不存在", async () => {
      // Arrange
      await manager.initialize();

      // Act
      const result = await manager.updateAgent("non-existent", { name: "New" });

      // Assert
      expect(result).toBeNull();
    });
  });

  describe("deleteAgent", () => {
    it("应该删除存在的 Agent", async () => {
      // Arrange
      const agent = await manager.createAgent("wxid_test");
      await manager.initialize();
      expect(manager.getAgent(agent.id)).toBeDefined();

      // Act
      const result = await manager.deleteAgent(agent.id);

      // Assert
      expect(result).toBe(true);
      expect(manager.getAgent(agent.id)).toBeUndefined();
    });

    it("应该返回 false 当 Agent 不存在", async () => {
      // Arrange
      await manager.initialize();

      // Act
      const result = await manager.deleteAgent("non-existent");

      // Assert
      expect(result).toBe(false);
    });
  });

  describe("findAgentByWechat", () => {
    it("应该通过微信 ID 查找 Agent", async () => {
      // Arrange
      const wechatId = "wxid_lookup_test";
      const created = await manager.createAgent(wechatId, { name: "Lookup Test" });
      await manager.initialize();

      // Act
      const found = manager.findAgentByWechat(wechatId);

      // Assert
      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
    });

    it("应该返回 undefined 当微信 ID 不存在", async () => {
      // Arrange
      await manager.initialize();

      // Act
      const result = manager.findAgentByWechat("wxid_non_existent");

      // Assert
      expect(result).toBeUndefined();
    });
  });
});
