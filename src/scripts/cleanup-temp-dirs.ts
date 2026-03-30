#!/usr/bin/env node
/**
 * 清理测试产生的临时目录
 * 
 * 清理 /tmp 目录下的测试临时目录：
 * - agent-manager-test-*
 * - task-management-test-*
 * - task-confirmation-test-*
 * - agent-lifecycle-test-*
 * - context-flow-test-*
 * - command-processing-test-*
 * - message-handling-test-*
 * - error-recovery-test-*
 * - msg-handling-test-*
 * - cmd-test-*
 */

import { readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// 测试临时目录匹配模式
const TEMP_DIR_PATTERNS = [
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

interface CleanupResult {
  count: number;
  dirs: string[];
  errors: string[];
}

/**
 * 清理测试临时目录
 * @param dryRun - 如果为 true，只返回要清理的目录而不实际删除
 * @returns 清理结果
 */
export function cleanupTestTempDirs(dryRun = false): CleanupResult {
  const tempDir = tmpdir();
  const result: CleanupResult = {
    count: 0,
    dirs: [],
    errors: [],
  };

  try {
    const entries = readdirSync(tempDir);

    for (const entry of entries) {
      for (const pattern of TEMP_DIR_PATTERNS) {
        if (pattern.test(entry)) {
          const fullPath = join(tempDir, entry);
          result.dirs.push(fullPath);

          if (!dryRun) {
            try {
              rmSync(fullPath, { recursive: true, force: true });
              console.log(`[Cleanup] 已删除: ${entry}`);
            } catch (error) {
              const errorMsg = `删除失败 ${entry}: ${error}`;
              result.errors.push(errorMsg);
              console.error(`[Cleanup] ${errorMsg}`);
            }
          }
          result.count++;
          break;
        }
      }
    }
  } catch (error) {
    const errorMsg = `读取临时目录失败: ${error}`;
    result.errors.push(errorMsg);
    console.error(`[Cleanup] ${errorMsg}`);
  }

  return result;
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes("--dry-run") || process.argv.includes("-d");
  
  console.log("[Cleanup] 开始清理测试临时目录...");
  if (dryRun) {
    console.log("[Cleanup] 试运行模式（不会实际删除）");
  }

  const result = cleanupTestTempDirs(dryRun);

  console.log(`[Cleanup] 找到 ${result.count} 个临时目录`);
  
  if (dryRun) {
    console.log("[Cleanup] 要清理的目录:");
    for (const dir of result.dirs) {
      console.log(`  - ${dir}`);
    }
  } else {
    console.log(`[Cleanup] 已清理 ${result.count} 个目录`);
  }

  if (result.errors.length > 0) {
    console.error(`[Cleanup] 发生 ${result.errors.length} 个错误`);
    process.exit(1);
  }

  console.log("[Cleanup] 清理完成");
}
