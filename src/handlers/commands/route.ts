/**
 * /route 命令处理器
 */

import type { CommandContext } from "../types.js";
import { getTaskRouter } from "../../task-router/index.js";
import { getUserWorkspace } from "../message-utils.js";
import { sendTextReply } from "../message-utils.js";

export async function routeHandler(
  args: string,
  context: CommandContext,
  userAutoRoute: Map<string, boolean>,
): Promise<string> {
  const { session, fromUser, contextToken } = context;

  const trimmedArgs = args.trim();
  const subCommandEnd = trimmedArgs.indexOf(" ");
  const subCommand = subCommandEnd === -1 ? trimmedArgs : trimmedArgs.slice(0, subCommandEnd);
  const subArgs = subCommandEnd === -1 ? "" : trimmedArgs.slice(subCommandEnd + 1).trim();

  const taskRouter = await getTaskRouter({
    agentId: session.config.id,
    useLLM: true,
    llmModel: session.config.ai.model,
    onProgress: async () => {},
    onComplete: async () => {},
  });

  if (subCommand === "" || subCommand === "analyze") {
    const prompt = subArgs.trim();
    if (!prompt) {
      return `**🧭 智能任务路由**

用法:
- \`/route analyze <任务描述>\` - 分析任务并显示路由决策
- \`/route stats\` - 显示路由统计
- \`/route auto on/off\` - 开关自动路由

自动路由会根据任务复杂度智能选择执行模式:
- **direct**: 直接执行（简单任务）
- **longtask**: 后台执行（中等复杂度）
- **flowtask**: 结构化执行（复杂任务）`;
    }

    const userWorkspace = await getUserWorkspace(session, fromUser);

    await sendTextReply(session.api, fromUser, contextToken, "🤖 正在分析任务，请稍候...");

    const submission = {
      prompt,
      userId: fromUser,
      chatId: fromUser,
      contextToken,
      cwd: userWorkspace.cwd,
      model: session.config.ai.model,
    };

    try {
      const decision = await taskRouter.analyzeOnly(submission);
      const analysis = decision.analysis;

      let response = `**🧭 任务分析结果**\n\n`;
      response += `**建议模式**: ${decision.mode.toUpperCase()}\n`;
      response += `**置信度**: ${(decision.confidence * 100).toFixed(1)}%\n`;
      response += `**决策理由**: ${decision.reason}\n\n`;

      response += `**任务特征**:\n`;
      response += `- 复杂度: ${analysis.complexity}/10\n`;
      response += `- 预估耗时: ${analysis.estimatedDuration}秒\n`;
      response += `- 预估步骤: ${analysis.stepCount}步\n`;
      response += `- 风险等级: ${analysis.riskLevel === "high" ? "🔴 高" : analysis.riskLevel === "medium" ? "🟡 中" : "🟢 低"}\n`;
      response += `- 领域: ${analysis.domain}\n`;
      response += `- 需要规划: ${analysis.requiresPlanning ? "是" : "否"}\n`;
      response += `- 涉及写操作: ${analysis.involvesWrite ? "是" : "否"}\n`;
      response += `- 涉及多文件: ${analysis.involvesMultipleFiles ? "是" : "否"}\n`;
      response += `- 分析来源: ${analysis.analysisSource}\n`;

      if (analysis.suggestedSubtasks && analysis.suggestedSubtasks.length > 0) {
        response += `\n**建议子任务**:\n`;
        for (const subtask of analysis.suggestedSubtasks.slice(0, 5)) {
          response += `- ${subtask}\n`;
        }
      }

      response += `\n💡 发送 \`/auto on\` 开启自动路由，系统将根据分析结果自动选择执行模式`;

      return response;
    } catch (error) {
      return `❌ 分析失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  if (subCommand === "stats") {
    const stats = taskRouter.getStats();
    let response = `**📊 路由统计**\n\n`;
    response += `总分析次数: ${stats.totalAnalyzed}\n`;
    response += `Direct 模式: ${stats.directCount}\n`;
    response += `LongTask 模式: ${stats.longtaskCount}\n`;
    response += `FlowTask 模式: ${stats.flowtaskCount}\n`;
    response += `深度分析次数: ${stats.deepAnalysisCount}\n`;
    response += `平均分析时间: ${stats.averageAnalysisTime}ms\n`;
    response += `缓存命中率: ${(stats.cacheHitRate * 100).toFixed(1)}%\n`;
    return response;
  }

  if (subCommand === "auto") {
    const value = subArgs.trim().toLowerCase();
    if (value === "on" || value === "true" || value === "1") {
      userAutoRoute.set(fromUser, true);
      return `✅ 自动路由已开启\n\n系统将根据任务复杂度自动选择执行模式。`;
    } else if (value === "off" || value === "false" || value === "0") {
      userAutoRoute.set(fromUser, false);
      return `✅ 自动路由已关闭\n\n所有任务将直接执行，不再自动路由到 LongTask 或 FlowTask。`;
    } else {
      const current = userAutoRoute.get(fromUser) ?? false;
      return `**自动路由状态**: ${current ? "✅ 开启" : "❌ 关闭"}\n\n用法: \`/route auto on/off\``;
    }
  }

  return `❓ 未知子命令: ${subCommand}\n\n可用: analyze, stats, auto`;
}
