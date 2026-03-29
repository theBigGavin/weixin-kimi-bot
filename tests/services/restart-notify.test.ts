/**
 * Restart Notify 服务测试
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, writeFileSync, mkdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  saveRestartInfo,
  loadRestartInfo,
  clearRestartInfo,
  formatRestartNotification,
  type RestartInfo,
} from "../../src/services/restart-notify.js";

const RESTART_INFO_FILE = join(homedir(), ".weixin-kimi-bot", "restart-info.json");

describe("Restart Notify Service", () => {
  // 保存原始状态
  let originalContent: string | null = null;

  beforeEach(() => {
    // 保存原始文件内容（如果存在）
    if (existsSync(RESTART_INFO_FILE)) {
      originalContent = readFileSync(RESTART_INFO_FILE, "utf-8");
      unlinkSync(RESTART_INFO_FILE);
    }
  });

  afterEach(() => {
    // 恢复原始状态
    if (originalContent !== null) {
      writeFileSync(RESTART_INFO_FILE, originalContent);
    } else if (existsSync(RESTART_INFO_FILE)) {
      unlinkSync(RESTART_INFO_FILE);
    }
  });

  describe("saveRestartInfo", () => {
    it("should save restart info to file", () => {
      const info: RestartInfo = {
        timestamp: Date.now(),
        reason: "deploy",
        operator: "test-user",
        version: "1.0.0",
      };

      saveRestartInfo(info);

      expect(existsSync(RESTART_INFO_FILE)).toBe(true);
      const saved = loadRestartInfo();
      expect(saved).toEqual(info);
    });

    it("should handle deploy reason with all fields", () => {
      const info: RestartInfo = {
        timestamp: 1234567890,
        reason: "deploy",
        operator: "admin",
        version: "2.0.0",
        agentId: "test-agent",
        chatId: "test-chat",
        contextToken: "test-token",
      };

      saveRestartInfo(info);
      const saved = loadRestartInfo();
      expect(saved).toEqual(info);
    });

    it("should handle manual restart", () => {
      const info: RestartInfo = {
        timestamp: 1234567890,
        reason: "manual",
        operator: "user",
      };

      saveRestartInfo(info);
      const saved = loadRestartInfo();
      expect(saved?.reason).toBe("manual");
    });

    it("should handle crash restart", () => {
      const info: RestartInfo = {
        timestamp: 1234567890,
        reason: "crash",
        operator: "system",
      };

      saveRestartInfo(info);
      const saved = loadRestartInfo();
      expect(saved?.reason).toBe("crash");
    });

    it("should handle unknown reason", () => {
      const info: RestartInfo = {
        timestamp: 1234567890,
        reason: "unknown" as any,
        operator: "unknown",
      };

      saveRestartInfo(info);
      const saved = loadRestartInfo();
      expect(saved?.reason).toBe("unknown");
    });
  });

  describe("loadRestartInfo", () => {
    it("should return null when file does not exist", () => {
      const result = loadRestartInfo();
      expect(result).toBeNull();
    });

    it("should return null when file is corrupted", () => {
      writeFileSync(RESTART_INFO_FILE, "invalid json");
      const result = loadRestartInfo();
      expect(result).toBeNull();
    });

    it("should parse valid JSON", () => {
      const info = {
        timestamp: 1234567890,
        reason: "deploy",
        operator: "test",
      };
      writeFileSync(RESTART_INFO_FILE, JSON.stringify(info));

      const result = loadRestartInfo();
      expect(result).toEqual(info);
    });
  });

  describe("clearRestartInfo", () => {
    it("should remove restart info file", () => {
      const info: RestartInfo = {
        timestamp: Date.now(),
        reason: "deploy",
        operator: "test",
      };
      saveRestartInfo(info);
      expect(existsSync(RESTART_INFO_FILE)).toBe(true);

      clearRestartInfo();

      expect(existsSync(RESTART_INFO_FILE)).toBe(false);
    });

    it("should not throw when file does not exist", () => {
      expect(() => clearRestartInfo()).not.toThrow();
    });
  });

  describe("formatRestartNotification", () => {
    it("should format deploy notification with version", () => {
      const info: RestartInfo = {
        timestamp: 1234567890000,
        reason: "deploy",
        operator: "admin",
        version: "1.2.3",
      };

      const msg = formatRestartNotification(info);

      expect(msg).toContain("服务器已重启");
      expect(msg).toContain("部署新版本");
      expect(msg).toContain("v1.2.3");
      expect(msg).toContain("admin");
    });

    it("should format manual restart", () => {
      const info: RestartInfo = {
        timestamp: 1234567890000,
        reason: "manual",
        operator: "user123",
      };

      const msg = formatRestartNotification(info);

      expect(msg).toContain("手动重启");
      expect(msg).toContain("user123");
    });

    it("should format crash recovery", () => {
      const info: RestartInfo = {
        timestamp: 1234567890000,
        reason: "crash",
        operator: "system",
      };

      const msg = formatRestartNotification(info);

      expect(msg).toContain("异常恢复");
    });

    it("should format unknown reason", () => {
      const info: RestartInfo = {
        timestamp: 1234567890000,
        reason: "unknown" as any,
        operator: "unknown",
      };

      const msg = formatRestartNotification(info);

      expect(msg).toContain("未知原因");
    });

    it("should include agentId if present", () => {
      const info: RestartInfo = {
        timestamp: 1234567890000,
        reason: "deploy",
        operator: "admin",
        agentId: "my-agent",
      };

      const msg = formatRestartNotification(info);

      expect(msg).toContain("Agent: my-agent");
    });

    it("should format timestamp correctly", () => {
      // 2024-01-01 00:00:00 UTC
      const info: RestartInfo = {
        timestamp: 1704067200000,
        reason: "manual",
        operator: "test",
      };

      const msg = formatRestartNotification(info);

      expect(msg).toContain("重启时间:");
      // 由于时区差异，只验证包含日期部分
      expect(msg).toMatch(/2024/);
    });

    it("should indicate service is running normally", () => {
      const info: RestartInfo = {
        timestamp: Date.now(),
        reason: "deploy",
        operator: "test",
      };

      const msg = formatRestartNotification(info);

      expect(msg).toContain("服务已恢复正常运行");
    });
  });
});

// 辅助函数
import { readFileSync } from "node:fs";
