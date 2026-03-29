/**
 * /task 命令处理器
 */

import type { CommandContext, PendingTaskInfo } from "../types.js";
import { getScheduler, formatCronDescription, parseNaturalLanguageToCron } from "../../scheduler.js";

export async function taskHandler(
  args: string,
  context: CommandContext,
  pendingTasks: Map<string, PendingTaskInfo>,
): Promise<string> {
  const { session, fromUser, contextToken } = context;
  const scheduler = getScheduler(session.config.id);

  if (args === "list" || args === "") {
    const tasks = scheduler.getAllTasks();
    if (tasks.length === 0) {
      return "📋 暂无定时任务\n\n使用 `/task create <描述>` 创建任务";
    }

    let response = "📋 定时任务列表\n\n";
    for (const task of tasks) {
      const status = task.enabled ? "✅" : "⏸️";
      const desc = formatCronDescription(task.cron);
      response += `${status} **${task.name}**\n   ID: \`${task.id}\`\n   ${desc}\n   命令: ${task.command.substring(0, 30)}...\n\n`;
    }
    response += "操作: `/task delete <id>` 删除 | `/task toggle <id>` 启用/禁用";
    return response;
  }

  if (args.startsWith("delete ")) {
    const taskId = args.slice(7).trim();
    if (!taskId) return "❌ 请提供任务ID\n\n用法: `/task delete <id>`";

    const success = scheduler.deleteTask(taskId);
    return success
      ? `✅ 已删除任务: ${taskId}`
      : `❌ 删除失败，任务不存在: ${taskId}`;
  }

  if (args.startsWith("toggle ")) {
    const taskId = args.slice(7).trim();
    if (!taskId) return "❌ 请提供任务ID\n\n用法: `/task toggle <id>`";

    const tasks = scheduler.getAllTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return `❌ 任务不存在: ${taskId}`;

    const newState = !task.enabled;
    const success = scheduler.toggleTask(taskId, newState);
    return success
      ? `${newState ? "✅" : "⏸️"} 任务已${newState ? "启用" : "禁用"}: ${task.name}`
      : `❌ 操作失败`;
  }

  if (args.startsWith("create ")) {
    const description = args.slice(7).trim();
    if (!description) return "❌ 请提供任务描述\n\n用法: `/task create <描述>`";

    try {
      const taskInfo = await parseNaturalLanguageToCron(
        description,
        session.config.ai.model,
        session.config.workspace.path,
      );

      pendingTasks.set(fromUser, {
        taskInfo,
        agentId: session.config.id,
        chatId: fromUser,
        contextToken,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

      return `🤖 解析结果\n\n任务名称: ${taskInfo.name}\n执行时间: ${taskInfo.description}\nCrontab: \`${taskInfo.cron}\`\n执行命令: ${taskInfo.command.substring(0, 50)}${taskInfo.command.length > 50 ? "..." : ""}\n\n回复 "确认" 创建此任务，或 "取消" 放弃\n(5分钟内有效)`;
    } catch (e) {
      return `❌ 解析失败: ${e instanceof Error ? e.message : String(e)}\n\n请尝试用更清晰的描述，或直接发送消息让我帮你创建任务。`;
    }
  }

  return `**定时任务管理**\n\n用法:\n- \`/task list\` - 列出所有任务\n- \`/task create <描述>\` - 创建任务\n- \`/task delete <id>\` - 删除任务\n- \`/task toggle <id>\` - 启用/禁用任务`;
}
