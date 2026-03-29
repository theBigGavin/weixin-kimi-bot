/**
 * /flowtask 命令处理器
 */

import type { CommandContext } from "../types.js";
import { getFlowTaskManager, formatProgressMessage, formatPlanForUserConfirmation } from "../../flowtask/manager.js";
import { buildSystemPrompt } from "../../agent/prompt-builder.js";
import { getUserWorkspace, buildFounderPrompt } from "../message-utils.js";

export async function flowTaskHandler(args: string, context: CommandContext): Promise<string> {
  const { session, fromUser, contextToken } = context;
  const ftManager = getFlowTaskManager(session.config.id);

  const trimmedArgs = args.trim();
  const subCommandEnd = trimmedArgs.indexOf(" ");
  const subCommand = subCommandEnd === -1 ? trimmedArgs : trimmedArgs.slice(0, subCommandEnd);
  const subArgs = subCommandEnd === -1 ? "" : trimmedArgs.slice(subCommandEnd + 1).trim();

  if (subCommand === "list") {
    const tasks = ftManager.getUserTasks(fromUser);
    const history = ftManager.loadHistory(10);

    if (tasks.length === 0 && history.length === 0) {
      return "📋 暂无 FlowTask 任务\n\n使用 `/flowtask run <任务描述>` 启动一个可靠任务流";
    }

    let response = "📋 FlowTask 任务列表\n\n";

    if (tasks.length > 0) {
      response += "*进行中的任务:*\n";
      for (const t of tasks) {
        const statusEmoji = t.status === "running" ? "🔄" : t.status === "pending" ? "⏳" : t.status === "planning" ? "🤔" : "⏸️";
        const lastProgress = t.progressLogs[t.progressLogs.length - 1];
        const riskEmoji = t.plan?.validation.riskLevel === "high" ? "🔴" : t.plan?.validation.riskLevel === "medium" ? "🟡" : "🟢";
        response += `${statusEmoji} ${riskEmoji} \`${t.id}\` ${lastProgress?.percent || 0}% - ${lastProgress?.step || t.status}\n`;
        if (t.status === "pending") {
          response += `   排队位置: 前面还有 ${ftManager.getQueueLength()} 个任务\n`;
        }
      }
      response += "\n";
    }

    if (history.length > 0) {
      response += "*最近历史 (最近10条):*\n";
      for (const h of history.slice().reverse()) {
        const statusEmoji = h.status === "completed" ? "✅" : h.status === "failed" ? "❌" : "🚫";
        const riskEmoji = h.riskLevel === "high" ? "🔴" : h.riskLevel === "medium" ? "🟡" : "🟢";
        response += `${statusEmoji} ${riskEmoji} \`${h.id}\` ${h.stepsCount}步 | 人工${h.humanInterventions}次\n`;
      }
    }

    response += "\n操作: `/flowtask status <id>` | `/flowtask plan <id>` | `/flowtask cancel <id>`";
    return response;
  }

  if (subCommand === "status") {
    const taskId = subArgs.trim();
    if (!taskId) return "❌ 请提供任务ID\n\n用法: `/flowtask status <id>`";
    const task = ftManager.getTask(taskId);
    if (!task || task.userId !== fromUser) return `❌ 任务不存在: ${taskId}`;
    const progress = task.progressLogs[task.progressLogs.length - 1];
    return formatProgressMessage(task, progress);
  }

  if (subCommand === "plan") {
    const taskId = subArgs.trim();
    if (!taskId) return "❌ 请提供任务ID\n\n用法: `/flowtask plan <id>`";
    const task = ftManager.getTask(taskId);
    if (!task || task.userId !== fromUser) return `❌ 任务不存在: ${taskId}`;
    return formatPlanForUserConfirmation(task);
  }

  if (subCommand === "cancel") {
    const taskId = subArgs.trim();
    if (!taskId) return "❌ 请提供任务ID\n\n用法: `/flowtask cancel <id>`";
    const success = await ftManager.cancel(taskId);
    return success
      ? `🚫 已取消任务: ${taskId}`
      : `❌ 取消失败，任务不存在或已完成: ${taskId}`;
  }

  if (subCommand === "approve") {
    const taskId = subArgs.trim();
    if (!taskId) return "❌ 请提供任务ID\n\n用法: `/flowtask approve <id>`";
    const success = ftManager.submitApprovalResponse(taskId, { approved: true });
    return success
      ? `✅ 已确认任务继续执行: ${taskId}`
      : `❌ 确认失败，任务不存在或无需确认: ${taskId}`;
  }

  if (subCommand === "reject") {
    const spaceIdx = subArgs.indexOf(" ");
    const taskId = spaceIdx === -1 ? subArgs : subArgs.slice(0, spaceIdx);
    const reason = spaceIdx === -1 ? "" : subArgs.slice(spaceIdx + 1).trim();
    if (!taskId) return "❌ 请提供任务ID\n\n用法: `/flowtask reject <id> [原因]`";
    const success = ftManager.submitApprovalResponse(taskId, { approved: false, feedback: reason || "用户拒绝" });
    return success
      ? `🚫 已拒绝任务执行: ${taskId}${reason ? `\n原因: ${reason}` : ""}`
      : `❌ 拒绝失败，任务不存在或无需确认: ${taskId}`;
  }

  if (subCommand === "run") {
    const prompt = subArgs.trim();
    if (!prompt) return "❌ 请提供任务描述\n\n用法: `/flowtask run <任务描述>`";

    const userWorkspace = await getUserWorkspace(session, fromUser);

    let systemPrompt = buildSystemPrompt(session.runtime, {
      includeMemory: session.config.memory.enabled,
    });
    if (session.config.type === "founder" && session.config.projectSpace) {
      systemPrompt += buildFounderPrompt(session.config);
    }

    const task = await ftManager.submit({
      agentId: session.config.id,
      userId: fromUser,
      chatId: fromUser,
      contextToken,
      prompt,
      cwd: userWorkspace.cwd,
      model: session.config.ai.model,
      systemPrompt,
    });

    const queueLen = ftManager.getQueueLength();
    let response = `🚀 FlowTask 已提交\n\nID: \`${task.id}\`\n状态: ${task.status === "pending" ? "排队中" : "计划生成中"}\n`;
    if (task.status === "pending" && queueLen > 0) {
      response += `排队位置: 前面还有 ${queueLen} 个任务\n`;
    }
    response += `\n系统将先生成执行计划，然后进行执行。\n`;
    response += `使用 \`/flowtask status ${task.id}\` 查看进度\n`;
    response += `使用 \`/flowtask plan ${task.id}\` 查看执行计划\n`;
    response += `使用 \`/flowtask cancel ${task.id}\` 取消任务`;

    return response;
  }

  return `**FlowTask 可靠任务流**\n\n基于结构化计划的任务执行系统\n\n用法:\n- \`/flowtask run <任务描述>\` - 启动新任务\n- \`/flowtask list\` - 查看任务列表\n- \`/flowtask status <id>\` - 查看任务进度\n- \`/flowtask plan <id>\` - 查看执行计划\n- \`/flowtask cancel <id>\` - 取消任务\n- \`/flowtask approve <id>\` - 确认继续执行\n- \`/flowtask reject <id> [原因]\` - 拒绝执行\n\n特点: 结构化计划 | 状态机执行 | 人机协作 | 自动回滚`;
}
