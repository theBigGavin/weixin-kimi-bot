/**
 * 通用辅助函数
 */

/**
 * 睡眠函数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 解析命令
 */
export function parseCommand(text: string): { command: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return { command: trimmed.slice(1).toLowerCase(), args: "" };
  }

  return {
    command: trimmed.slice(1, spaceIndex).toLowerCase(),
    args: trimmed.slice(spaceIndex + 1).trim(),
  };
}

/**
 * 命令列表（用于帮助信息）
 */
export const COMMAND_DESCRIPTIONS: Record<string, string> = {
  help: "显示帮助信息",
  status: "查看 Agent 状态",
  reset: "重置对话上下文",
  template: "查看/切换能力模板",
  memory: "查看长期记忆",
  prompt: "预览系统提示词",
  ver: "查看 Bot 版本信息",
  task: "定时任务管理 (list/create/delete/toggle)",
  longtask: "⏱️ 后台执行耗时任务，实时跟踪进度",
  flowtask: "可靠任务流 - 结构化计划执行 (run/status/list/cancel/approve)",
  deploy: "部署 Bot (patch/minor/major)",
  route: "智能任务路由 (analyze/stats/auto)",
  auto: "开关自动路由 (on/off/status)",
};
