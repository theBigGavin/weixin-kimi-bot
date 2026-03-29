/**
 * /longtask 命令处理器
 */

import type { CommandContext } from "../types.js";
import { getLongTaskManager, formatProgressMessage } from "../../longtask/manager.js";
import { buildSystemPrompt } from "../../agent/prompt-builder.js";
import { getUserWorkspace, buildFounderPrompt } from "../message-utils.js";

export async function longTaskHandler(args: string, context: CommandContext): Promise<string> {
  const { session, fromUser, contextToken } = context;
  const ltManager = await getLongTaskManager(session.config.id);

  // 显示用法信息（当无参数或只有空格时）
  const prompt = args.trim();
  if (!prompt) {
    return `**⏱️ 耗时任务管理**

在后台执行复杂任务，实时跟踪进度，不阻塞对话。

用法:
- \`/longtask <任务描述>\` - 启动耗时任务
- \`/longtask list\` - 查看任务列表
- \`/longtask status <id>\` - 查看任务进度
- \`/longtask cancel <id>\` - 取消任务

特点:
• 每 ${ltManager.getReportIntervalSec()} 秒自动推送进度报告
• 基于工具调用实时计算进度百分比
• 支持并发执行（最多 4 个）
• 崩溃后可恢复未完成任务

示例:
\`/longtask 分析这个项目的所有代码文件\``;
  }

  if (args === "list") {
    const tasks = ltManager.getUserTasks(fromUser);
    const historyRes = await ltManager.queryHistory({ userId: fromUser }, 10);
    const history = historyRes.items;

    if (tasks.length === 0 && history.length === 0) {
      return "📋 暂无耗时任务\n\n使用 `/longtask <任务描述>` 启动一个耗时任务";
    }

    let response = "📋 耗时任务\n\n";

    if (tasks.length > 0) {
      response += "*进行中的任务:*\n";
      for (const t of tasks) {
        const statusEmoji = t.status === "running" ? "🔄" : t.status === "pending" ? "⏳" : "✅";
        const lastProgress = t.progressLogs[t.progressLogs.length - 1];
        response += `${statusEmoji} \`${t.id}\` ${lastProgress?.percent || 0}% - ${lastProgress?.step || t.status}\n`;
        if (t.status === "pending") {
          response += `   排队位置: 前面还有 ${ltManager.getQueueLength()} 个任务\n`;
        }
      }
      response += "\n";
    }

    if (history.length > 0) {
      response += "*最近历史 (最近10条):*\n";
      for (const h of history.slice().reverse()) {
        const statusEmoji = h.status === "completed" ? "✅" : h.status === "failed" ? "❌" : "🚫";
        response += `${statusEmoji} \`${h.id}\` ${h.finalProgress.percent}% - ${h.finalProgress.step}\n`;
      }
    }

    response += "\n操作: `/longtask status <id>` | `/longtask cancel <id>`";
    return response;
  }

  if (args.startsWith("status ")) {
    const taskId = args.slice(7).trim();
    const task = ltManager.getTask(taskId);
    if (!task || task.userId !== fromUser) {
      return `❌ 任务不存在: ${taskId}`;
    }
    const progress = task.progressLogs[task.progressLogs.length - 1];
    return formatProgressMessage(task, progress);
  }

  if (args.startsWith("cancel ")) {
    const taskId = args.slice(7).trim();
    const success = await ltManager.cancel(taskId);
    return success
      ? `🚫 已取消任务: ${taskId}`
      : `❌ 取消失败，任务不存在或已完成: ${taskId}`;
  }

  const userWorkspace = await getUserWorkspace(session, fromUser);

  let systemPrompt = buildSystemPrompt(session.runtime, {
    includeMemory: session.config.memory.enabled,
  });
  if (session.config.type === "founder" && session.config.projectSpace) {
    systemPrompt += buildFounderPrompt(session.config);
  }

  const task = ltManager.submit({
    agentId: session.config.id,
    userId: fromUser,
    chatId: fromUser,
    contextToken,
    prompt,
    cwd: userWorkspace.cwd,
    model: session.config.ai.model,
    systemPrompt,
    maxTurns: session.config.ai.maxTurns,
  });

  const queueLen = ltManager.getQueueLength();
  let response = `🚀 耗时任务已提交\n\nID: \`${task.id}\`\n状态: ${task.status === "pending" ? "排队中" : "运行中"}\n`;
  if (task.status === "pending" && queueLen > 0) {
    response += `排队位置: 前面还有 ${queueLen} 个任务\n`;
  }
  response += `\n每 ${ltManager.getReportIntervalSec()} 秒会收到进度报告。\n`;
  response += `使用 \`/longtask status ${task.id}\` 查看进度\n`;
  response += `使用 \`/longtask cancel ${task.id}\` 取消任务`;

  return response;
}
