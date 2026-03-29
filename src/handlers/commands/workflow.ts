/**
 * /workflow 命令处理器
 * 
 * 工作流管理命令
 */

import type { CommandContext, PendingTaskInfo } from "../types.js";
import { getWorkflowManager } from "../../workflow/manager.js";
import { getWorkflowScheduler } from "../../workflow/scheduler-integration.js";

export interface PendingWorkflowInfo {
  workflowInfo: {
    name: string;
    description?: string;
    cron: string;
    cronDescription: string;
    nodes: Array<{
      id: string;
      type: string;
      name: string;
    }>;
  };
  agentId: string;
  userId: string;
  chatId: string;
  contextToken: string;
  expiresAt: number;
}

export async function workflowHandler(
  args: string,
  context: CommandContext,
  pendingWorkflows: Map<string, PendingWorkflowInfo>
): Promise<string> {
  const { session, fromUser, contextToken } = context;
  const manager = getWorkflowManager(session.config.id, session.config.workspace.path);
  const scheduler = getWorkflowScheduler(session.config.id, session.config.workspace.path);

  const trimmedArgs = args.trim();
  const subCommandEnd = trimmedArgs.indexOf(" ");
  const subCommand = subCommandEnd === -1 ? trimmedArgs : trimmedArgs.slice(0, subCommandEnd);
  const subArgs = subCommandEnd === -1 ? "" : trimmedArgs.slice(subCommandEnd + 1).trim();

  // 列出工作流
  if (subCommand === "list" || subCommand === "") {
    const workflows = manager.getUserWorkflows(fromUser);

    if (workflows.length === 0) {
      return "📋 暂无工作流\n\n使用 `/workflow create <描述>` 创建工作流";
    }

    let response = "📋 我的工作流\n\n";
    for (const wf of workflows) {
      const statusEmoji = wf.enabled ? "✅" : "⏸️";
      const scheduleStr = formatCronDescription(wf.cron);
      const lastRun = wf.lastRunAt
        ? new Date(wf.lastRunAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : "从未";
      const runStatus = wf.lastRunStatus === "success" ? "✓" : wf.lastRunStatus === "failed" ? "✗" : "○";
      
      response += `${statusEmoji} **${wf.name}**\n`;
      response += `   ID: \`${wf.id}\`\n`;
      response += `   执行: ${scheduleStr}\n`;
      response += `   上次执行: ${lastRun} ${runStatus}\n`;
      response += `   执行次数: ${wf.runCount}\n\n`;
    }

    response += "操作: `/workflow run <id>` 立即执行 | `/workflow toggle <id>` 启用/禁用 | `/workflow delete <id>` 删除";
    return response;
  }

  // 创建工作流
  if (subCommand === "create") {
    const description = subArgs.trim();
    if (!description) {
      return "❌ 请提供工作流描述\n\n用法: `/workflow create <描述>`\n\n示例:\n- `/workflow create 每天早上8点搜索AI新闻并生成晨报`\n- `/workflow create 每小时检查服务器状态`";
    }

    try {
      const { instance, info } = await manager.createFromNaturalLanguage(
        description,
        fromUser,
        fromUser,
        contextToken,
        session.config.ai.model
      );

      // 添加到调度
      scheduler.scheduleWorkflow(instance);

      // 保存到 pending（等待用户确认）
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

      let response = `🤖 工作流创建成功\n\n`;
      response += `**${info.name}**\n`;
      response += `ID: \`${instance.id}\`\n`;
      response += `描述: ${info.description || "无"}\n`;
      response += `执行时间: ${info.cronDescription}\n`;
      response += `Crontab: \`${info.cron}\`\n\n`;
      
      response += `节点流程:\n`;
      for (let i = 0; i < info.nodes.length; i++) {
        const node = info.nodes[i];
        const icon = getNodeIcon(node.type);
        response += `${i + 1}. ${icon} ${node.name} (${node.type})\n`;
      }

      if (info.variables.length > 0) {
        response += `\n变量:\n`;
        for (const v of info.variables) {
          response += `- ${v.name}: ${v.description || ""}${v.defaultValue !== undefined ? ` (默认: ${v.defaultValue})` : ""}\n`;
        }
      }

      response += `\n✅ 工作流已创建并启用\n`;
      response += `使用 \`/workflow run ${instance.id}\` 立即执行测试`;

      return response;
    } catch (e) {
      return `❌ 创建工作流失败: ${e instanceof Error ? e.message : String(e)}\n\n请尝试用更清晰的描述，或检查系统配置。`;
    }
  }

  // 删除工作流
  if (subCommand === "delete") {
    const workflowId = subArgs.trim();
    if (!workflowId) {
      return "❌ 请提供工作流ID\n\n用法: `/workflow delete <id>`";
    }

    const success = manager.deleteWorkflow(workflowId, fromUser);
    if (success) {
      scheduler.unscheduleWorkflow(workflowId);
    }

    return success
      ? `✅ 已删除工作流: ${workflowId}`
      : `❌ 删除失败，工作流不存在或无权限: ${workflowId}`;
  }

  // 启用/禁用工作流
  if (subCommand === "toggle") {
    const workflowId = subArgs.trim();
    if (!workflowId) {
      return "❌ 请提供工作流ID\n\n用法: `/workflow toggle <id>`";
    }

    const result = manager.toggleWorkflow(workflowId, fromUser);
    
    if (result.success) {
      const workflow = manager.getWorkflow(workflowId, fromUser);
      if (workflow) {
        if (result.enabled) {
          scheduler.scheduleWorkflow(workflow);
        } else {
          scheduler.unscheduleWorkflow(workflowId);
        }
      }
      return `${result.enabled ? "✅" : "⏸️"} 工作流已${result.enabled ? "启用" : "禁用"}: ${workflowId}`;
    }

    return `❌ 操作失败，工作流不存在: ${workflowId}`;
  }

  // 立即执行工作流
  if (subCommand === "run") {
    const workflowId = subArgs.trim();
    if (!workflowId) {
      return "❌ 请提供工作流ID\n\n用法: `/workflow run <id>`";
    }

    const workflow = manager.getWorkflow(workflowId, fromUser);
    if (!workflow) {
      return `❌ 工作流不存在: ${workflowId}`;
    }

    // 异步执行，不等待结果
    manager.runWorkflow(workflowId, fromUser).then((execution) => {
      if (execution) {
        console.log(`[WorkflowCommand] 工作流 ${workflowId} 执行状态: ${execution.status}`);
      }
    });

    return `🚀 工作流执行已启动: **${workflow.name}**\n\n执行ID: \`${Date.now()}\`\n请稍后查看结果。`;
  }

  // 显示工作流详情
  if (subCommand === "show") {
    const workflowId = subArgs.trim();
    if (!workflowId) {
      return "❌ 请提供工作流ID\n\n用法: `/workflow show <id>`";
    }

    const workflow = manager.getWorkflow(workflowId, fromUser);
    if (!workflow) {
      return `❌ 工作流不存在: ${workflowId}`;
    }

    let response = `📋 **${workflow.name}**\n\n`;
    response += `ID: \`${workflow.id}\`\n`;
    response += `状态: ${workflow.enabled ? "✅ 启用" : "⏸️ 禁用"}\n`;
    response += `执行: ${formatCronDescription(workflow.cron)}\n`;
    response += `Crontab: \`${workflow.cron}\`\n`;
    response += `创建: ${new Date(workflow.createdAt).toLocaleString("zh-CN")}\n`;
    response += `执行次数: ${workflow.runCount}\n`;
    
    if (workflow.lastRunAt) {
      response += `上次执行: ${new Date(workflow.lastRunAt).toLocaleString("zh-CN")} ${workflow.lastRunStatus === "success" ? "✓" : workflow.lastRunStatus === "failed" ? "✗" : "○"}\n`;
    }

    return response;
  }

  // 帮助信息
  return `**工作流管理**

工作流支持复杂的自动化任务，可以将多个步骤编排在一起执行。

**可用命令:**
- \`/workflow list\` - 列出所有工作流
- \`/workflow create <描述>\` - 创建工作流
  - 示例: \`/workflow create 每天早上8点搜索AI新闻并生成晨报\`
- \`/workflow delete <id>\` - 删除工作流
- \`/workflow toggle <id>\` - 启用/禁用工作流
- \`/workflow run <id>\` - 立即执行工作流
- \`/workflow show <id>\` - 显示工作流详情

**支持的节点类型:**
🔍 search - 网络搜索
🤖 llm - AI生成内容
📤 send - 发送消息
🔄 transform - 数据转换
❓ condition - 条件判断`;
}

/**
 * 格式化 crontab 描述
 */
function formatCronDescription(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [min, hour, day, month, weekday] = parts;

  if (cron === "0 9 * * *") return "每天早上 9:00";
  if (cron === "0 8 * * *") return "每天早上 8:00";
  if (cron === "0 0 * * *") return "每天凌晨 0:00";
  if (cron === "0 */6 * * *") return "每 6 小时";
  if (cron === "0 * * * *") return "每小时";
  if (cron === "0 9 * * 1") return "每周一早上 9:00";
  if (cron === "0 9 * * 1-5") return "工作日早上 9:00";
  if (cron === "0 0 1 * *") return "每月 1 号凌晨 0:00";

  const timeStr = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  if (day === "*" && month === "*" && weekday === "*") {
    return `每天 ${timeStr}`;
  }
  return cron;
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
