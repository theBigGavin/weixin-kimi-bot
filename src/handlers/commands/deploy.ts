/**
 * /deploy 命令处理器
 */

import type { CommandContext } from "../types.js";
import { spawn } from "node:child_process";
import { getLongTaskManager } from "../../longtask/manager.js";
import { saveRestartInfo } from "../../services/restart-notify.js";
import { sendTextReply } from "../message-utils.js";

export async function deployHandler(args: string, context: CommandContext): Promise<string> {
  const { session, fromUser, contextToken } = context;

  const versionType = args.trim() || "patch";
  if (!["patch", "minor", "major"].includes(versionType)) {
    return `❌ 无效的版本类型: ${versionType}\n\n用法:\n- \`/deploy\` 或 \`/deploy patch\` - 补丁版本\n- \`/deploy minor\` - 次版本\n- \`/deploy major\` - 主版本`;
  }

  const projectPath = session.config.projectSpace?.path || process.cwd();

  const ltManager = await getLongTaskManager(session.config.id);
  const task = ltManager.submit({
    agentId: session.config.id,
    userId: fromUser,
    chatId: fromUser,
    contextToken,
    prompt: `部署 Bot: ${versionType}`,
    command: `npm run version:${versionType}`,
    cwd: projectPath,
    model: session.config.ai.model,
    maxTurns: 1,
  });

  // 监听部署任务完成
  const checkInterval = setInterval(async () => {
    const currentTask = ltManager.getTask(task.id);
    if (!currentTask || currentTask.status === "pending" || currentTask.status === "running") {
      return;
    }

    clearInterval(checkInterval);

    if (currentTask.status === "completed") {
      const result = currentTask.result || "";
      const releaseMatch = result.match(/🎉 版本 v(\d+\.\d+\.\d+)/);
      const version = releaseMatch ? releaseMatch[1] : "未知";

      const deployMessage =
        `✅ **部署成功**\n\n` +
        `版本: ${version}\n` +
        `类型: ${versionType}\n` +
        `时间: ${new Date().toLocaleString("zh-CN")}\n\n` +
        `🔄 服务将在 3 秒后重启以应用新版本...`;

      await sendTextReply(session.api, fromUser, contextToken, deployMessage);
      console.log(`[Deploy] 已发送部署成功通知，3秒后重启服务...`);

      saveRestartInfo({
        timestamp: Date.now(),
        reason: "deploy",
        operator: fromUser,
        version: version,
        agentId: process.env.ACTIVE_AGENT_ID,
        chatId: fromUser,
        contextToken: contextToken,
      });
      console.log(`[Deploy] 已保存重启信息`);

      setTimeout(() => {
        console.log(`[Deploy] 执行服务重启...`);
        const restartChild = spawn("pm2", ["restart", "weixin-kimi-bot"], {
          cwd: projectPath,
          stdio: "ignore",
          detached: true,
        });
        restartChild.unref();
      }, 3000);
    } else {
      const errorMsg = currentTask.error || "未知错误";
      await sendTextReply(session.api, fromUser, contextToken, `❌ **部署失败**\n\n错误: ${errorMsg}`);
      console.error(`[Deploy] 部署失败: ${errorMsg}`);
    }
  }, 5000);

  const queueLen = ltManager.getQueueLength();
  let response = `🚀 部署任务已提交为耗时任务\n\nID: \`${task.id}\`\n类型: ${versionType}\n路径: ${projectPath}\n`;
  if (task.status === "pending" && queueLen > 0) {
    response += `排队位置: 前面还有 ${queueLen} 个任务\n`;
  }
  response += `\n每 ${ltManager.getReportIntervalSec()} 秒会收到进度报告。\n`;
  response += `使用 \`/longtask status ${task.id}\` 查看进度\n`;
  response += `使用 \`/longtask cancel ${task.id}\` 取消任务`;

  return response;
}
