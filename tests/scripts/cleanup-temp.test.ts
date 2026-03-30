/**
 * 清理临时目录测试
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// 测试用的清理函数
function cleanupTestTempDirs(dryRun = false): { count: number; dirs: string[] } {
  const tempDir = tmpdir();
  const patterns = [
    /^agent-manager-test-/,
    /^task-management-test-/,
    /^task-confirmation-test-/,
    /^agent-lifecycle-test-/,
    /^context-flow-test-/,
    /^command-processing-test-/,
    /^message-handling-test-/,
    /^error-recovery-test-/,
    /^msg-handling-test-/,
    /^cmd-test-/,
  ];

  const dirs: string[] = [];
  const fs = require("fs");
  
  try {
    const entries = fs.readdirSync(tempDir);
    for (const entry of entries) {
      for (const pattern of patterns) {
        if (pattern.test(entry)) {
          const fullPath = join(tempDir, entry);
          dirs.push(fullPath);
          if (!dryRun) {
            try {
              fs.rmSync(fullPath, { recursive: true, force: true });
            } catch {
              // 忽略清理错误
            }
          }
          break;
        }
      }
    }
  } catch {
    // 忽略读取错误
  }

  return { count: dirs.length, dirs };
}

describe("cleanupTestTempDirs", () => {
  let testDirs: string[] = [];

  beforeEach(() => {
    // 创建测试用的临时目录
    const tempDir = tmpdir();
    testDirs = [
      mkdtempSync(join(tempDir, "agent-manager-test-")),
      mkdtempSync(join(tempDir, "task-management-test-")),
      mkdtempSync(join(tempDir, "cmd-test-")),
    ];
  });

  afterEach(() => {
    // 清理测试目录
    for (const dir of testDirs) {
      try {
        require("fs").rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("应该找到测试临时目录", () => {
    const result = cleanupTestTempDirs(true); // dry run
    expect(result.count).toBeGreaterThanOrEqual(3);
  });

  it("应该清理测试临时目录", () => {
    // 确认目录存在
    for (const dir of testDirs) {
      expect(existsSync(dir)).toBe(true);
    }

    // 执行清理
    cleanupTestTempDirs(false);

    // 确认目录被删除
    for (const dir of testDirs) {
      expect(existsSync(dir)).toBe(false);
    }
  });

  it("dry run 模式不应删除目录", () => {
    const result = cleanupTestTempDirs(true);
    expect(result.count).toBeGreaterThanOrEqual(3);

    // 确认目录还在
    for (const dir of testDirs) {
      expect(existsSync(dir)).toBe(true);
    }
  });
});
