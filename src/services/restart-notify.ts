/**
 * 服务器重启通知服务
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";

const RESTART_INFO_FILE = join(homedir(), ".weixin-kimi-bot", "restart-info.json");

export interface RestartInfo {
  timestamp: number;
  reason: "deploy" | "manual" | "crash" | "unknown";
  operator: string;
  version?: string;
  agentId?: string;
  chatId?: string;
  contextToken?: string;
}

/**
 * 保存重启信息到文件
 */
export function saveRestartInfo(info: RestartInfo): void {
  try {
    const dir = dirname(RESTART_INFO_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(RESTART_INFO_FILE, JSON.stringify(info, null, 2));
  } catch (error) {
    console.error("[RestartNotify] 保存重启信息失败:", error);
  }
}

/**
 * 读取重启信息
 */
export function loadRestartInfo(): RestartInfo | null {
  try {
    if (existsSync(RESTART_INFO_FILE)) {
      const data = readFileSync(RESTART_INFO_FILE, "utf-8");
      return JSON.parse(data) as RestartInfo;
    }
  } catch (error) {
    console.error("[RestartNotify] 读取重启信息失败:", error);
  }
  return null;
}

/**
 * 清除重启信息文件
 */
export function clearRestartInfo(): void {
  try {
    if (existsSync(RESTART_INFO_FILE)) {
      unlinkSync(RESTART_INFO_FILE);
    }
  } catch (error) {
    console.error("[RestartNotify] 清除重启信息失败:", error);
  }
}

/**
 * 格式化重启通知消息
 */
export function formatRestartNotification(info: RestartInfo): string {
  const timeStr = new Date(info.timestamp).toLocaleString("zh-CN");
  const reasonMap: Record<string, string> = {
    deploy: "部署新版本",
    manual: "手动重启",
    crash: "异常恢复",
    unknown: "未知原因",
  };

  let msg = "🔄 **服务器已重启**\n\n";
  msg += `⏰ 重启时间: ${timeStr}\n`;
  msg += `📋 重启原因: ${reasonMap[info.reason] || info.reason}`;
  if (info.version) {
    msg += ` v${info.version}`;
  }
  msg += "\n";
  msg += `👤 操作者: ${info.operator}\n`;
  if (info.agentId) {
    msg += `🤖 Agent: ${info.agentId}\n`;
  }
  msg += "\n✅ 服务已恢复正常运行。";

  return msg;
}
