/**
 * 传统消息处理流程（保留作为 fallback）
 */
import {
  setContextToken,
  getContextToken,
  loadUserSessionMeta,
  incrementUserTurnCount,
} from "../store.js";
import { getScheduler, formatCronDescription } from "../scheduler.js";
import { getLongTaskManager, formatProgressMessage as formatLongTaskProgress } from "../longtask/manager.js";
import type { LongTask, ProgressInfo as LongTaskProgressInfo } from "../longtask/types.js";
import {
  getFlowTaskManager,
  formatProgressMessage as formatFlowTaskProgress,
} from "../flowtask/manager.js";
import type { FlowTask, ProgressInfo as FlowTaskProgressInfo } from "../flowtask/types.js";
import {
  getTaskRouter,
  routeTask,
  type TaskSubmission,
} from "../task-router/index.js";
import { agentManager } from "../agent/manager.js";
import { buildSystemPrompt } from "../agent/prompt-builder.js";
import { isLikelyLongTask } from "../kimi/handler.js";
import type { KimiOptions } from "../kimi/handler.js";
import { checkKimiSession } from "../kimi/session.js";
import { MessageType, type WeixinMessage } from "../ilink/types.js";
import { extractText, parseCommand } from "../utils/index.js";
import { sendTextReply, getUserWorkspace, buildFounderPrompt, showTyping } from "./message-utils.js";
import { handleCommand } from "./command-handler.js";
import type { AgentSession, PendingTask } from "./types.js";
import { extractMemoryFromConversation, mergeMemory, saveMemory } from "../memory/manager.js";

/**
 * 传统消息处理流程（保留作为 fallback）
 */
export async function handleMessageLegacy(
  session: AgentSession,
  msg: WeixinMessage,
  pendingTasks: Map<string, PendingTask>,
  userAutoRoute: Map<string, boolean>
): Promise<void> {
  if (msg.message_type !== MessageType.USER) return;

  const fromUser = msg.from_user_id;
  if (!fromUser) return;

  const text = extractText(msg);
  if (!text) {
    console.log(`  [skip] 非文本消息 from ${fromUser}`);
    return;
  }

  // 缓存 context_token（按 Agent 隔离）
  if (msg.context_token) {
    setContextToken(fromUser, msg.context_token, session.config.id);
  }
  const contextToken = msg.context_token || getContextToken(fromUser, session.config.id);
  if (!contextToken) {
    console.error(`  [error] 没有 context_token for ${fromUser}`);
    return;
  }

  console.log(`\n📩 [${session.config.name}] 收到消息 from ${fromUser}: ${text.substring(0, 80)}${text.length > 80 ? "..." : ""}`);

  // 更新统计
  await agentManager.updateStats(session.config.id, false);

  // 检查待确认的任务
  const pendingTask = pendingTasks.get(fromUser);
  if (pendingTask) {
    const trimmedText = text.trim();

    // 检查是否过期
    if (Date.now() > pendingTask.expiresAt) {
      pendingTasks.delete(fromUser);
    } else if (trimmedText === "确认" || trimmedText === "确定" || trimmedText === "yes") {
      // 创建任务
      const scheduler = getScheduler(pendingTask.agentId);
      try {
        const task = scheduler.addTask({
          name: pendingTask.taskInfo.name,
          cron: pendingTask.taskInfo.cron,
          command: pendingTask.taskInfo.command,
          chatId: pendingTask.chatId,
          contextToken: contextToken,
          enabled: true,
        });

        pendingTasks.delete(fromUser);

        const desc = formatCronDescription(task.cron);
        await sendTextReply(
          session.api,
          fromUser,
          contextToken,
          `✅ 任务创建成功！\n\n任务: ${task.name}\nID: \`${task.id}\`\n时间: ${desc}\n命令: ${task.command.substring(0, 50)}${task.command.length > 50 ? "..." : ""}`
        );
        console.log(`  📤 已确认创建任务: ${task.id}`);
      } catch (e) {
        pendingTasks.delete(fromUser);
        await sendTextReply(
          session.api,
          fromUser,
          contextToken,
          `❌ 创建任务失败: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      return;
    } else if (trimmedText === "取消" || trimmedText === "cancel" || trimmedText === "no") {
      pendingTasks.delete(fromUser);
      await sendTextReply(session.api, fromUser, contextToken, "❌ 已取消任务创建");
      console.log(`  📤 已取消任务创建`);
      return;
    }
  }

  // 检查命令
  const commandInfo = parseCommand(text);
  if (commandInfo) {
    console.log(`  📝 检测到命令: /${commandInfo.command}`);

    const response = await handleCommand(commandInfo.command, commandInfo.args, {
      session,
      fromUser,
      contextToken,
    });
    if (response) {
      await sendTextReply(session.api, fromUser, contextToken, response);
      console.log(`  📤 已发送命令回复`);
      return;
    }
  }

  // 构建 Kimi 选项
  const turns = session.conversationTurns.get(fromUser) || 0;

  // 获取用户专属工作目录配置
  const userWorkspace = await getUserWorkspace(session, fromUser);

  // 构建系统提示词（每轮都注入，确保记忆始终可用）
  let systemPrompt = buildSystemPrompt(session.runtime, {
    includeMemory: session.config.memory.enabled,
  });

  // 如果是创始 Agent，注入项目维护规范
  if (session.config.type === "founder" && session.config.projectSpace) {
    systemPrompt += buildFounderPrompt(session.config);
  }

  // ========== 智能任务路由 ==========
  const autoRouteEnabled = userAutoRoute.get(fromUser) ?? false;

  if (autoRouteEnabled) {
    console.log(`  🧭 自动路由已开启，分析任务...`);

    const submission: TaskSubmission = {
      prompt: text,
      userId: fromUser,
      chatId: fromUser,
      contextToken,
      cwd: userWorkspace.cwd,
      model: session.config.ai.model,
      systemPrompt,
    };

    try {
      const routedTask = await routeTask(session.config.id, submission, {
        useLLM: true,
        llmModel: session.config.ai.model,
        onProgress: async (report) => {
          console.log(`  [TaskRouter:${report.taskId}] ${report.percent}% - ${report.step}`);
        },
        onComplete: async (result) => {
          console.log(`  [TaskRouter:${result.taskId}] 完成: ${result.success ? "成功" : "失败"}`);
        },
      });

      console.log(`  🧭 路由决策: ${routedTask.mode} (置信度: ${(routedTask.decision.confidence * 100).toFixed(1)}%)`);

      // 根据路由结果处理
      switch (routedTask.mode) {
        case "longtask": {
          const ltManager = await getLongTaskManager(session.config.id);
          const queueLen = ltManager.getQueueLength();

          const modeEmoji = "⏱️";
          const reason = routedTask.decision.reason;

          let autoMsg = `${modeEmoji} **任务已智能路由到后台执行**\n\n`;
          autoMsg += `ID: \`${routedTask.taskId}\`\n`;
          autoMsg += `模式: LongTask\n`;
          autoMsg += `置信度: ${(routedTask.decision.confidence * 100).toFixed(0)}%\n\n`;
          autoMsg += `**分析**: ${reason}\n\n`;

          const task = ltManager.getTask(routedTask.taskId);
          if (task && task.status === "pending" && queueLen > 0) {
            autoMsg += `排队位置: 前面还有 ${queueLen} 个任务\n`;
          }
          autoMsg += `\n每 30 秒会收到进度报告。\n`;
          autoMsg += `使用 \`/longtask status ${routedTask.taskId}\` 查看进度\n`;
          autoMsg += `使用 \`/longtask cancel ${routedTask.taskId}\` 取消任务`;

          await sendTextReply(session.api, fromUser, contextToken, autoMsg);
          console.log(`  📤 任务已路由到 LongTask: ${routedTask.taskId}`);
          return;
        }

        case "flowtask": {
          const ftManager = getFlowTaskManager(session.config.id);
          const queueLen = ftManager.getQueueLength();

          const modeEmoji = "🔄";
          const reason = routedTask.decision.reason;

          let autoMsg = `${modeEmoji} **任务已智能路由到可靠任务流**\n\n`;
          autoMsg += `ID: \`${routedTask.taskId}\`\n`;
          autoMsg += `模式: FlowTask\n`;
          autoMsg += `置信度: ${(routedTask.decision.confidence * 100).toFixed(0)}%\n\n`;
          autoMsg += `**分析**: ${reason}\n\n`;

          const task = ftManager.getTask(routedTask.taskId);
          if (task && task.status === "pending" && queueLen > 0) {
            autoMsg += `排队位置: 前面还有 ${queueLen} 个任务\n`;
          }
          autoMsg += `\n系统将先生成执行计划，然后进行执行。\n`;
          autoMsg += `使用 \`/flowtask status ${routedTask.taskId}\` 查看进度\n`;
          autoMsg += `使用 \`/flowtask plan ${routedTask.taskId}\` 查看执行计划\n`;
          autoMsg += `使用 \`/flowtask cancel ${routedTask.taskId}\` 取消任务`;

          await sendTextReply(session.api, fromUser, contextToken, autoMsg);
          console.log(`  📤 任务已路由到 FlowTask: ${routedTask.taskId}`);
          return;
        }

        case "direct":
        default:
          // Direct 模式，继续执行原有逻辑
          console.log(`  🧭 任务复杂度较低，直接执行`);
          break;
      }
    } catch (error) {
      console.error(`  ❌ 任务路由失败:`, error);
      // 路由失败时回退到原有逻辑
      console.log(`  🔄 回退到原有耗时任务检测`);
    }
  } else if (isLikelyLongTask(text)) {
    // 原有的自动识别耗时任务逻辑（自动路由关闭时）
    console.log(`  ⏱️ 自动识别为耗时任务`);
    const ltManager = await getLongTaskManager(session.config.id);
    const task = ltManager.submit({
      agentId: session.config.id,
      userId: fromUser,
      chatId: fromUser,
      contextToken,
      prompt: text,
      cwd: userWorkspace.cwd,
      model: session.config.ai.model,
      systemPrompt,
      maxTurns: session.config.ai.maxTurns,
    });

    const queueLen = ltManager.getQueueLength();
    let autoMsg = `⏱️ 检测到耗时任务，已自动转为后台执行\n\nID: \`${task.id}\`\n状态: ${task.status === "pending" ? "排队中" : "运行中"}\n`;
    if (task.status === "pending" && queueLen > 0) {
      autoMsg += `排队位置: 前面还有 ${queueLen} 个任务\n`;
    }
    autoMsg += `\n每 30 秒会收到进度报告。\n`;
    autoMsg += `使用 \`/longtask status ${task.id}\` 查看进度\n`;
    autoMsg += `使用 \`/longtask cancel ${task.id}\` 取消任务`;

    await sendTextReply(session.api, fromUser, contextToken, autoMsg);
    console.log(`  📤 已自动提交耗时任务: ${task.id}`);
    return;
  }

  // 加载持久化的 session 元数据
  const sessionMeta = loadUserSessionMeta(session.config.id, fromUser);

  // 检测 Kimi CLI 是否存在有效的 session
  const kimiSession = await checkKimiSession(userWorkspace.cwd);

  // 判断是否应复用 session：
  // 1. Kimi CLI 有有效的 session 文件
  // 2. 并且有对话历史（turns > 0）或 session 是最近创建的（24小时内）
  const sessionValid = Boolean(
    kimiSession.exists &&
      ((sessionMeta?.turnCount || 0) > 0 ||
        (kimiSession.lastModified && Date.now() - kimiSession.lastModified < 24 * 60 * 60 * 1000))
  );

  console.log(`  📊 Session 状态: Kimi=${kimiSession.exists ? "✓" : "✗"}, turns=${sessionMeta?.turnCount || 0}, continue=${sessionValid}`);

  const kimiOpts: KimiOptions & { systemPrompt?: string } = {
    model: session.config.ai.model,
    cwd: userWorkspace.cwd, // CWD 在 session 目录（控制 session 存储位置）
    maxTurns: session.config.ai.maxTurns,
    planMode: false,
    systemPrompt: systemPrompt,
    continueSession: sessionValid, // 基于真实的 Kimi session 状态
  };

  // 显示输入中
  showTyping(session.api, fromUser, contextToken);

  try {
    const { askKimi } = await import("../kimi/handler.js");
    console.log(`  🤖 调用 Kimi (${session.config.ai.model}, 轮次: ${turns + 1})...`);
    const response = await askKimi(text, kimiOpts);
    console.log(`  ✅ 响应完成 (${(response.durationMs / 1000).toFixed(1)}s)`);

    // 发送回复
    await sendTextReply(session.api, fromUser, contextToken, response.text);
    console.log(`  📤 已发送回复 (${response.text.length} 字符)`);

    // 更新轮次
    session.conversationTurns.set(fromUser, turns + 1);

    // 持久化 session 元数据（用于进程重启后恢复）
    const newTurnCount = incrementUserTurnCount(session.config.id, fromUser, kimiSession.sessionId);
    console.log(`  💾 Session 元数据已保存 (turns: ${newTurnCount})`);

    // 提取记忆（如果启用）
    if (session.config.memory.enabled && session.config.memory.autoExtract) {
      const lastExtract = session.lastMemoryExtract.get(fromUser) || 0;
      // 放宽提取条件：每 3 轮或超过 5 分钟提取一次
      const shouldExtract = (turns > 0 && turns % 3 === 0) || Date.now() - lastExtract > 5 * 60 * 1000;

      if (shouldExtract) {
        console.log(`  🧠 提取记忆...`);
        // 使用更完整的对话上下文
        const conversation = `用户: ${text}\nAI: ${response.text}`;
        const extraction = await extractMemoryFromConversation(conversation, session.config.id);

        if (extraction && (extraction.facts?.length || extraction.projects?.length || extraction.userProfile)) {
          const updatedMemory = mergeMemory(session.runtime.memory, extraction, `conv_${Date.now()}`);
          await saveMemory(session.config.id, updatedMemory);
          session.runtime.memory = updatedMemory;
          session.lastMemoryExtract.set(fromUser, Date.now());
          console.log(`  ✅ 已提取 ${extraction.facts?.length || 0} 条事实, ${extraction.projects?.length || 0} 个项目`);
        }
      }
    }
  } catch (err) {
    console.error(`  ❌ 处理失败:`, err);
    await sendTextReply(
      session.api,
      fromUser,
      contextToken,
      `处理消息时出错: ${err instanceof Error ? err.message : String(err)}`
    ).catch(() => {});
  }
}
