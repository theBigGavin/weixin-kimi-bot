/**
 * /task 命令处理器
 */

import type { CommandContext, PendingTaskInfo } from "../types.js";
import { getScheduler, formatCronDescription, parseNaturalLanguageToCron } from "../../scheduler.js";
import { getWorkflowManager } from "../../workflow/manager.js";
import { getWorkflowScheduler } from "../../workflow/scheduler-integration.js";
import { getTaskService } from "../../services/task-service.js";
import type { PendingWorkflowInfo } from "./workflow.js";

export async function taskHandler(
  args: string,
  context: CommandContext,
  pendingTasks: Map<string, PendingTaskInfo>,  // 保持兼容，但不再使用
  pendingWorkflows?: Map<string, PendingWorkflowInfo>,
): Promise<string> {
  const { session, fromUser, contextToken, sessionContext } = context;
  const scheduler = getScheduler(session.config.id);
  const workflowManager = getWorkflowManager(session.config.id, session.config.workspace.path);
  const workflowScheduler = getWorkflowScheduler(session.config.id, session.config.workspace.path);
  const taskService = getTaskService(session.config.id);

  if (args.trim() === "list" || args.trim() === "") {
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

  if (args.trim().startsWith("delete ")) {
    const taskId = args.slice(7).trim();
    if (!taskId) return "❌ 请提供任务ID\n\n用法: `/task delete <id>`";

    const success = scheduler.deleteTask(taskId);
    return success
      ? `✅ 已删除任务: ${taskId}`
      : `❌ 删除失败，任务不存在: ${taskId}`;
  }

  if (args.trim().startsWith("toggle ")) {
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

  if (args.trim().startsWith("create ")) {
    const description = args.slice(7).trim();
    if (!description) return "❌ 请提供任务描述\n\n用法: `/task create <描述>`";

    // 检测是否是复杂任务（需要多步骤工作流）
    const isComplexTask = detectComplexTask(description);

    if (isComplexTask && pendingWorkflows) {
      // 使用工作流创建复杂任务
      try {
        const { instance, info } = await workflowManager.createFromNaturalLanguage(
          description,
          fromUser,
          fromUser,
          contextToken,
          session.config.ai.model
        );

        // 添加到调度
        workflowScheduler.scheduleWorkflow(instance);

        // 保存到 pending（工作流保持原有方式，因为 workflow 有独立的确认机制）
        pendingWorkflows.set(fromUser, {
          workflowInfo: {
            name: info.name,
            description: info.description,
            cron: info.cron,
            cronDescription: info.cronDescription,
            nodes: info.nodes.map((n) => ({ id: n.id, type: n.type, name: n.name })),
          },
          agentId: session.config.id,
          userId: fromUser,
          chatId: fromUser,
          contextToken,
          expiresAt: Date.now() + 5 * 60 * 1000,
        });

        let response = `🤖 检测到复杂任务，已创建工作流\n\n`;
        response += `**${info.name}**\n`;
        response += `ID: \`${instance.id}\`\n`;
        response += `执行时间: ${info.cronDescription}\n`;
        response += `Crontab: \`${info.cron}\`\n\n`;
        
        response += `执行流程:\n`;
        for (let i = 0; i < info.nodes.length; i++) {
          const node = info.nodes[i];
          const icon = getNodeIcon(node.type);
          response += `${i + 1}. ${icon} ${node.name}\n`;
        }

        response += `\n✅ 工作流已创建并启用\n`;
        response += `使用 \`/workflow run ${instance.id}\` 立即执行测试\n`;
        response += `使用 \`/workflow list\` 查看所有工作流`;

        return response;
      } catch (e) {
        // 工作流创建失败，回退到简单任务
        console.error("[Task] 工作流创建失败，回退到简单任务:", e);
      }
    }

    // 创建简单任务（使用 TaskService）
    try {
      const taskInfo = await parseNaturalLanguageToCron(
        description,
        session.config.ai.model,
        session.config.workspace.path,
      );

      // 使用 TaskService 准备创建任务（存入 Session 状态）
      if (!sessionContext) {
        return "❌ 当前会话上下文不可用，请重试";
      }

      await taskService.prepareCreate(
        sessionContext,
        taskInfo,
        fromUser,
        fromUser,
        contextToken
      );

      return `🤖 解析结果\n\n任务名称: ${taskInfo.name}\n执行时间: ${taskInfo.description}\nCrontab: \`${taskInfo.cron}\`\n执行命令: ${taskInfo.command.substring(0, 50)}${taskInfo.command.length > 50 ? "..." : ""}\n\n回复 "确认" 创建此任务，或 "取消" 放弃\n(5分钟内有效)`;
    } catch (e) {
      return `❌ 解析失败: ${e instanceof Error ? e.message : String(e)}\n\n请尝试用更清晰的描述，或直接发送消息让我帮你创建任务。`;
    }
  }

  return `**定时任务管理**

用法:
- \`/task list\` - 列出所有任务
- \`/task create <描述>\` - 创建任务
- \`/task delete <id>\` - 删除任务
- \`/task toggle <id>\` - 启用/禁用任务

💡 **提示**: 对于复杂任务（如"搜索新闻并生成报告"），系统会自动创建工作流。使用 \`/workflow\` 命令管理工作流。`;
}

/**
 * 检测是否是复杂任务（需要工作流）
 */
function detectComplexTask(description: string): boolean {
  // 复杂任务的关键词模式
  const complexPatterns = [
    /搜索.*然后.*生成|搜索.*并.*生成|搜索.*再.*发送/i,
    /抓取.*然后|抓取.*并|获取.*然后|获取.*并/i,
    /查询.*然后|查询.*并|查找.*然后|查找.*并/i,
    /收集.*然后|收集.*并|汇总.*然后|汇总.*并/i,
    /分析.*然后|分析.*并|处理.*然后|处理.*并/i,
    /多个步骤|多步骤|工作流|workflow/i,
    /每天.*晨报|每天.*日报|每天.*报告/i,
    /定时.*搜索.*发送|定时.*获取.*发送/i,
  ];

  return complexPatterns.some((pattern) => pattern.test(description));
}

/**
 * 获取节点图标
 */
function getNodeIcon(type: string): string {
  const icons: Record<string, string> = {
    search: "🔍",
    llm: "🤖",
    send: "📤",
    transform: "🔄",
    condition: "❓",
    shell: "💻",
    http: "🌐",
  };
  return icons[type] || "📦";
}
