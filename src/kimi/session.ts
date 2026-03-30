/**
 * Kimi CLI Session 管理工具
 * 
 * 负责检测和管理 Kimi CLI 的 session 状态
 * Kimi CLI 的 session 存储在: ~/.kimi/sessions/{md5(cwd)}/{session_id}/
 */

import { createHash } from "crypto";
import { readdir, stat, readFile } from "fs/promises";
import * as path from "path";
import { homedir } from "os";

/**
 * Kimi CLI Session 信息
 */
export interface KimiSessionInfo {
  /** session 是否存在 */
  exists: boolean;
  /** session ID */
  sessionId?: string;
  /** 最后修改时间 */
  lastModified?: number;
  /** context.jsonl 文件大小 */
  contextSize?: number;
}

/**
 * Kimi CLI 元数据
 */
interface KimiMetadata {
  work_dirs?: Array<{
    path: string;
    kaos?: string;
    last_session_id?: string;
  }>;
}

/**
 * 计算 cwd 对应的 Kimi CLI sessions 目录
 * 
 * Kimi CLI 使用 MD5 hash 来命名 sessions 目录
 * 实际存储位置: ~/.kimi/sessions/{md5(cwd)}/
 */
export function getKimiSessionsDir(cwd: string): string {
  const cwdHash = createHash("md5").update(cwd).digest("hex");
  return path.join(homedir(), ".kimi", "sessions", cwdHash);
}

/**
 * 检查 Kimi CLI 是否存在有效的 session
 * 
 * Kimi CLI 的 session 结构：
 * ~/.local/share/kimi/sessions/{md5(cwd)}/
 *   └── {session_id}/
 *         ├── context.jsonl    # 对话历史（必需）
 *         ├── state.json       # 状态
 *         └── wire.jsonl       # 消息日志
 */
export async function checkKimiSession(cwd: string): Promise<KimiSessionInfo> {
  const sessionsDir = getKimiSessionsDir(cwd);

  try {
    const entries = await readdir(sessionsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const sessionId = entry.name;
      const contextFile = path.join(sessionsDir, sessionId, "context.jsonl");

      try {
        const stats = await stat(contextFile);
        if (stats.isFile() && stats.size > 0) {
          return {
            exists: true,
            sessionId,
            lastModified: stats.mtimeMs,
            contextSize: stats.size,
          };
        }
      } catch {
        // context.jsonl 不存在或无法访问，跳过
      }
    }
  } catch {
    // sessions 目录不存在，返回不存在
  }

  return { exists: false };
}

/**
 * 获取指定 work_dir 的最后使用的 session ID
 * 
 * 从 ~/.kimi/kimi.json 中读取
 */
export async function getKimiLastSessionId(cwd: string): Promise<string | null> {
  const metadataPath = path.join(homedir(), ".kimi", "kimi.json");

  try {
    const content = await readFile(metadataPath, "utf-8");
    const metadata: KimiMetadata = JSON.parse(content);

    // 找到匹配的 work_dir
    const workDirMeta = metadata.work_dirs?.find((wd) => wd.path === cwd);

    return workDirMeta?.last_session_id || null;
  } catch {
    return null;
  }
}

/**
 * 获取指定 work_dir 的所有 session 列表
 */
export async function listKimiSessions(
  cwd: string
): Promise<Array<{ sessionId: string; lastModified: number; contextSize: number }>> {
  const sessionsDir = getKimiSessionsDir(cwd);
  const sessions: Array<{
    sessionId: string;
    lastModified: number;
    contextSize: number;
  }> = [];

  try {
    const entries = await readdir(sessionsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const sessionId = entry.name;
      const contextFile = path.join(sessionsDir, sessionId, "context.jsonl");

      try {
        const stats = await stat(contextFile);
        if (stats.isFile() && stats.size > 0) {
          sessions.push({
            sessionId,
            lastModified: stats.mtimeMs,
            contextSize: stats.size,
          });
        }
      } catch {
        // 跳过无效的 session
      }
    }
  } catch {
    // sessions 目录不存在，返回空列表
  }

  // 按最后修改时间排序（最新的在前）
  return sessions.sort((a, b) => b.lastModified - a.lastModified);
}

/**
 * 删除指定 work_dir 的所有 Kimi session
 * 
 * 用于 /reset 命令
 */
export async function clearKimiSessions(cwd: string): Promise<boolean> {
  const sessionsDir = getKimiSessionsDir(cwd);

  try {
    const { rm } = await import("fs/promises");
    await rm(sessionsDir, { recursive: true, force: true });
    return true;
  } catch (e) {
    console.error(`Failed to clear Kimi sessions for ${cwd}:`, e);
    return false;
  }
}
