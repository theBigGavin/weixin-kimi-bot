/**
 * 通知管理器基础测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { NotificationManager } from "../../src/notifications/manager.js";
import type { ChannelConfig } from "../../src/notifications/types.js";

describe("NotificationManager", () => {
  let manager: NotificationManager;

  beforeEach(() => {
    manager = new NotificationManager();
  });

  describe("初始化", () => {
    it("应该创建空的管理器", () => {
      expect(manager).toBeDefined();
      expect(manager.getAgentId()).toBeUndefined();
    });

    it("应该支持指定 Agent ID", () => {
      const agentManager = new NotificationManager("agent-123");
      expect(agentManager.getAgentId()).toBe("agent-123");
    });
  });

  describe("通道管理", () => {
    it("应该添加邮件通道", async () => {
      // Arrange
      const config: ChannelConfig = {
        id: "email-1",
        type: "email",
        name: "测试邮箱",
        config: {
          host: "smtp.test.com",
          port: 587,
          auth: { user: "test@test.com", pass: "password" },
        },
        enabled: false, // 禁用以避免实际连接
      };

      // Act
      const channel = await manager.addChannel(config);

      // Assert
      expect(channel).toBeDefined();
      expect(channel.id).toBe("email-1");
    });

    it("应该添加Telegram通道", async () => {
      // Arrange
      const config: ChannelConfig = {
        id: "tg-1",
        type: "telegram",
        name: "测试TG",
        config: {
          botToken: "test-token",
          chatId: "123456",
        },
        enabled: false,
      };

      // Act
      const channel = await manager.addChannel(config);

      // Assert
      expect(channel).toBeDefined();
      expect(channel.type).toBe("telegram");
    });

    it("应该获取指定通道", async () => {
      // Arrange
      const config: ChannelConfig = {
        id: "tg-test",
        type: "telegram",
        name: "TG通知",
        config: {},
        enabled: false,
      };
      await manager.addChannel(config);

      // Act
      const found = manager.getChannel("tg-test");

      // Assert
      expect(found).toBeDefined();
      expect(found?.type).toBe("telegram");
    });

    it("应该移除通道", async () => {
      // Arrange
      const config: ChannelConfig = {
        id: "email-rm",
        type: "email",
        name: "测试邮箱",
        config: {},
        enabled: false,
      };
      await manager.addChannel(config);

      // Act
      const result = await manager.removeChannel("email-rm");

      // Assert
      expect(result).toBe(true);
      expect(manager.getChannel("email-rm")).toBeUndefined();
    });

    it("应该返回 false 当移除不存在的通道", async () => {
      // Act
      const result = await manager.removeChannel("non-existent");

      // Assert
      expect(result).toBe(false);
    });

    it("应该拒绝无效的通道类型", async () => {
      // Arrange
      const invalidConfig = {
        id: "invalid",
        type: "unknown" as any,
        name: "无效通道",
        config: {},
        enabled: false,
      };

      // Act & Assert
      await expect(manager.addChannel(invalidConfig)).rejects.toThrow("未知的通道类型");
    });
  });
});
