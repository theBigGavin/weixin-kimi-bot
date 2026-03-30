/**
 * 上下文感知消息处理器 (新架构)
 */
import {
  setContextToken,
  getContextToken,
  loadUserSessionMeta,
  incrementUserTurnCount,
} from "../store.js";
import {
  getScheduler,
  formatCronDescription,
  parseNaturalLanguageToCron,
  type ParsedTaskInfo,
} from "../scheduler.js";
import { getLongTaskManager, formatProgressMessage as formatLongTaskProgress } from "../longtask/manager.js";
import type { LongTask, ProgressInfo as LongTaskProgressInfo } from "../longtask/types.js";
import {
  getFlowTaskManager,
  formatProgressMessage as formatFlowTaskProgress,
  formatPlanForUserConfirmation,
} from "../flowtask/manager.js";
import type { FlowTask, ProgressInfo as FlowTaskProgressInfo, HumanApprovalRequest } from "../flowtask/types.js";
import {
  getTaskRouter,
  routeTask,
  analyzeTask,
  type TaskSubmission,
  type ExecutionMode,
  type RoutedTask,
} from "../task-router/index.js";
import { agentManager } from "../agent/manager.js";
import { buildSystemPrompt, buildWelcomeMessage, buildHelpPrompt, buildStatusPrompt } from "../agent/prompt-builder.js";
import type { AgentConfig, AgentRuntime, AgentMemory } from "../agent/types.js";
import { extractMemoryFromConversation, mergeMemory, saveMemory } from "../memory/manager.js";
import {
  initializeContextSystem,
  getContextManager,
  getStateMachine,
  ConversationState,
  IntentType,
  translateState,
  type SessionContext,
  type Intent,
} from "../context/index.js";
import { createOutputParser } from "../context/output-parser.js";
import {
  askKimi,
  checkKimiInstalled,
  ensureKimiAuthenticated,
  isLikelyLongTask,
} from "../kimi/handler.js";
import type { KimiOptions } from "../kimi/handler.js";
import { checkKimiSession } from "../kimi/session.js";
import { MessageType, type WeixinMessage } from "../ilink/types.js";
import { extractText, parseCommand } from "../utils/index.js";
import { sendTextReply, getUserWorkspace, showTyping } from "./message-utils.js";
import { handleAgentCommandWithContext } from "./command-context.js";
import type { AgentSession, PendingTask } from "./types.js";
import { performSmartSearch, checkSearxngHealth } from "../services/searxng.js";
import { getTaskService, isTaskConfirmation, isTaskCancellation } from "../services/task-service.js";

// 外部传入的 contextSystem
interface ContextSystem {
  contextManager: ReturnType<typeof getContextManager>;
  stateMachine: ReturnType<typeof getStateMachine>;
}

/**
 * 带上下文感知的消息处理（新架构）
 */
export async function handleMessageWithContext(
  session: AgentSession,
  msg: WeixinMessage,
  contextSystem: ContextSystem,
  pendingTasks: Map<string, PendingTask>,
  userAutoRoute: Map<string, boolean>,
): Promise<void> {
  if (msg.message_type !== MessageType.USER) return;

  const fromUser = msg.from_user_id;
  if (!fromUser) return;

  const text = extractText(msg);
  if (!text) {
    console.log(`  [skip] 非文本消息 from ${fromUser}`);
    return;
  }

  // 缓存 context_token
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

  // ============ 新架构：获取会话上下文 ============
  const { contextManager, stateMachine } = contextSystem;
  const sessionContext = await contextManager.getOrCreate(fromUser, session.config.id);

  console.log(`  📊 会话状态: ${translateState(sessionContext.state.current)}, 消息数: ${sessionContext.messages.length}`);

  // ============ 阶段 1: 检查待确认的定时任务（最高优先级）============
  const taskService = getTaskService(session.config.id);
  const hasPendingTask = taskService.hasPendingTask(sessionContext);
  
  if (hasPendingTask) {
    const confirmationIntent = taskService.checkConfirmationIntent(text);
    
    if (confirmationIntent === 'confirm') {
      console.log(`  ✅ 用户确认创建定时任务`);
      const result = await taskService.finalizeCreate(sessionContext);
      await sendTextReply(session.api, fromUser, contextToken, result.message);
      console.log(`  📤 任务创建结果已发送: ${result.success ? '成功' : '失败'}`);
      return;
    }
    
    if (confirmationIntent === 'cancel') {
      console.log(`  ❌ 用户取消创建定时任务`);
      const result = await taskService.cancelCreate(sessionContext);
      await sendTextReply(session.api, fromUser, contextToken, result.message);
      console.log(`  📤 取消结果已发送`);
      return;
    }
    
    // 有待确认任务，但输入不是确认/取消，提示用户
    const preview = taskService.getPreviewInfo(sessionContext);
    if (preview) {
      const reminderMsg = `⏳ 您有一个待确认的定时任务：\n\n` +
        `**${preview.name}**\n` +
        `执行时间: ${preview.description}\n` +
        `Crontab: \`${preview.cron}\`\n\n` +
        `请回复 **确认** 或 **取消**，或发送其他命令继续。`;
      await sendTextReply(session.api, fromUser, contextToken, reminderMsg);
      console.log(`  📤 任务确认提醒已发送`);
      return;
    }
  }

  // ============ 阶段 2: 命令处理 ============
  const commandInfo = parseCommand(text);
  if (commandInfo) {
    console.log(`  📝 检测到命令: /${commandInfo.command}`);
    const response = await handleAgentCommandWithContext(
      session,
      commandInfo.command,
      commandInfo.args,
      fromUser,
      contextToken,
      sessionContext,
      contextSystem
    );
    if (response) {
      await sendTextReply(session.api, fromUser, contextToken, response);
      console.log(`  📤 已发送命令回复`);
      return;
    }
  }

  // ============ 意图识别和指代消解 ============
  const intentResolver = contextManager as any;
  const intent = await (await import("../context/intent-resolver.js")).createIntentResolver().identify(text, sessionContext);

  console.log(`  🎯 识别意图: ${intent.type} (置信度: ${(intent.confidence * 100).toFixed(1)}%)`);

  if (intent.references.length > 0) {
    console.log(`  🔗 指代消解: ${intent.references.map((r) => `${r.type}=${r.targetId}`).join(", ")}`);
  }

  // ============ 状态机处理 ============
  const transitionResult = stateMachine.transition(sessionContext.state, intent);

  if (!transitionResult.success) {
    const clarificationMsg = transitionResult.message || "我不太理解您的意思，能否换个方式描述？";
    await sendTextReply(session.api, fromUser, contextToken, clarificationMsg);
    return;
  }

  if (transitionResult.requiresConfirmation) {
    const confirmMsg = `${transitionResult.message || "请确认此操作"}\n\n回复"确认"继续，或"取消"放弃。`;
    await sendTextReply(session.api, fromUser, contextToken, confirmMsg);
    return;
  }

  // 更新状态
  if (transitionResult.newState) {
    await contextManager.updateState(sessionContext, transitionResult.newState);
  }

  // 记录用户消息
  await contextManager.addMessage(sessionContext, "user", text, undefined, intent);

  // ============ 智能任务路由 ============
  // 获取工作目录
  const userWorkspace = await getUserWorkspace(session, fromUser);

  // 提前初始化 promptBuilder（后续还会用到）
  const { createPromptBuilder } = await import("../prompt/index.js");
  const promptBuilder = createPromptBuilder();

  // 判断是否需要进行任务路由
  const autoRouteEnabled = userAutoRoute.get(fromUser);
  const shouldAutoRoute = autoRouteEnabled !== false; // 默认开启，除非用户明确关闭
  const isExecutableIntent = intent.type === IntentType.EXECUTE || 
                             intent.type === IntentType.ASK_INFO ||
                             (intent.entities.some(e => e.type === 'file' || e.type === 'code'));

  if (shouldAutoRoute && isExecutableIntent) {
    console.log(`  🧭 智能任务路由分析中...`);

    const submission: TaskSubmission = {
      prompt: intent.resolvedText || text,
      userId: fromUser,
      chatId: fromUser,
      contextToken,
      cwd: userWorkspace.cwd,
      model: session.config.ai.model,
      systemPrompt: promptBuilder.build(session.runtime, sessionContext, intent.resolvedText || text, {
        includeRecentMessages: 3,
        includeActiveOptions: false,
        includeState: false,
      }),
    };

    try {
      const taskRouter = await getTaskRouter({
        agentId: session.config.id,
        useLLM: true,
        llmModel: session.config.ai.model,
        onProgress: async (report) => {
          console.log(`  [TaskRouter:${report.taskId}] ${report.percent}% - ${report.step}`);
        },
        onComplete: async (result) => {
          console.log(`  [TaskRouter:${result.taskId}] 完成: ${result.success ? "成功" : "失败"}`);
        },
      });

      const routedTask = await taskRouter.analyzeAndExecute(submission);

      console.log(`  🧭 路由决策: ${routedTask.mode} (置信度: ${(routedTask.decision.confidence * 100).toFixed(1)}%)`);
      console.log(`  📝 分析: ${routedTask.decision.reason}`);

      // 根据路由结果处理
      switch (routedTask.mode) {
        case "longtask": {
          // 更新会话状态
          await contextManager.updateState(sessionContext, ConversationState.EXECUTING, {
            currentTaskId: routedTask.taskId,
          });

          const ltManager = await getLongTaskManager(session.config.id);
          const queueLen = ltManager.getQueueLength();

          let autoMsg = `⏱️ **任务已路由到后台执行**\n\n`;
          autoMsg += `ID: \`${routedTask.taskId}\`\n`;
          autoMsg += `复杂度: ${routedTask.analysis.complexity}/10\n`;
          autoMsg += `预估耗时: ${routedTask.analysis.estimatedDuration}秒\n`;
          autoMsg += `置信度: ${(routedTask.decision.confidence * 100).toFixed(0)}%\n\n`;
          autoMsg += `**分析**: ${routedTask.decision.reason}\n\n`;

          if (queueLen > 0) {
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
          // 更新会话状态
          await contextManager.updateState(sessionContext, ConversationState.PLANNING, {
            currentFlowTaskId: routedTask.taskId,
          });

          const ftManager = getFlowTaskManager(session.config.id);
          const queueLen = ftManager.getQueueLength();

          let autoMsg = `🔄 **任务已路由到可靠任务流**\n\n`;
          autoMsg += `ID: \`${routedTask.taskId}\`\n`;
          autoMsg += `复杂度: ${routedTask.analysis.complexity}/10\n`;
          autoMsg += `风险等级: ${routedTask.analysis.riskLevel === "high" ? "🔴 高" : routedTask.analysis.riskLevel === "medium" ? "🟡 中" : "🟢 低"}\n`;
          autoMsg += `置信度: ${(routedTask.decision.confidence * 100).toFixed(0)}%\n\n`;
          autoMsg += `**分析**: ${routedTask.decision.reason}\n\n`;

          if (queueLen > 0) {
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
          console.log(`  🧭 任务复杂度较低，使用直接执行模式`);
          break;
      }
    } catch (error) {
      console.error(`  ❌ 任务路由失败:`, error);
      // 路由失败时回退到原有逻辑
      console.log(`  🔄 回退到原有执行逻辑`);
    }
  }

  // ============ 智能搜索（如果需要）============
  let searchResults: string | undefined;
  try {
    const searchCheck = await performSmartSearch(intent.resolvedText || text);
    if (searchCheck.needed && searchCheck.results) {
      console.log(`  🔍 搜索查询: "${searchCheck.query}"`);
      searchResults = searchCheck.results;
    }
  } catch (error) {
    console.warn(`  ⚠️ 搜索失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  // ============ 构建上下文感知的Prompt ============
  let systemPrompt = promptBuilder.build(session.runtime, sessionContext, intent.resolvedText || text, {
    includeRecentMessages: 5,
    includeActiveOptions: true,
    includeState: true,
  });

  // 将搜索结果注入到 systemPrompt 中
  if (searchResults) {
    systemPrompt = `${systemPrompt}\n\n## 网络搜索结果\n\n${searchResults}\n\n请基于以上搜索结果回答用户问题。`;
  }

  // 检测Kimi session
  const sessionMeta = loadUserSessionMeta(session.config.id, fromUser);
  const kimiSession = await checkKimiSession(userWorkspace.cwd);
  const sessionValid = Boolean(
    kimiSession.exists &&
      ((sessionMeta?.turnCount || 0) > 0 ||
        (kimiSession.lastModified && Date.now() - kimiSession.lastModified < 24 * 60 * 60 * 1000))
  );

  console.log(`  📊 Session 状态: Kimi=${kimiSession.exists ? "✓" : "✗"}, turns=${sessionMeta?.turnCount || 0}, continue=${sessionValid}`);

  const kimiOpts: KimiOptions = {
    model: session.config.ai.model,
    cwd: userWorkspace.cwd,
    maxTurns: session.config.ai.maxTurns,
    planMode: false,
    systemPrompt: systemPrompt,
    continueSession: sessionValid,
  };

  showTyping(session.api, fromUser, contextToken);

  try {
    console.log(`  🤖 调用 Kimi (${session.config.ai.model}, 上下文感知模式)...`);
    const response = await askKimi(intent.resolvedText || text, kimiOpts);
    console.log(`  ✅ 响应完成 (${(response.durationMs / 1000).toFixed(1)}s)`);

    // ============ 解析结构化输出 ============
    const outputParser = createOutputParser();
    const structuredContent = outputParser.parse(response.text);

    if (structuredContent.success) {
      console.log(`  📝 解析到结构化内容: ${structuredContent.content?.type}`);

      // 处理选项
      if (structuredContent.content?.type === "options") {
        const options = structuredContent.content.data.options;
        await contextManager.addOptions(sessionContext, options);
        await contextManager.updateState(sessionContext, ConversationState.PROPOSING, {
          pendingDecision: {
            id: `decision_${Date.now()}`,
            type: "select_option",
            description: "请从提供的方案中选择一个",
            options: options.map((o: any) => o.id),
            context: structuredContent.content.data.context,
            createdAt: Date.now(),
            expiresAt: Date.now() + 10 * 60 * 1000,
          },
        });
      }

      // 处理确认请求
      if (structuredContent.content?.type === "confirmation") {
        await contextManager.updateState(sessionContext, ConversationState.CONFIRMING);
      }
    }

    // 发送回复
    await sendTextReply(session.api, fromUser, contextToken, response.text);
    console.log(`  📤 已发送回复 (${response.text.length} 字符)`);

    // 记录AI回复
    await contextManager.addMessage(sessionContext, "assistant", response.text, structuredContent.success ? structuredContent.content : undefined);

    // 更新轮次
    session.conversationTurns.set(fromUser, sessionContext.messages.length);
    incrementUserTurnCount(session.config.id, fromUser, kimiSession.sessionId);

    // 增强记忆提取
    if (session.config.memory.enabled && session.config.memory.autoExtract) {
      const lastExtract = session.lastMemoryExtract.get(fromUser) || 0;
      const shouldExtract =
        (sessionContext.messages.length > 0 && sessionContext.messages.length % 3 === 0) ||
        Date.now() - lastExtract > 5 * 60 * 1000;

      if (shouldExtract) {
        console.log(`  🧠 提取记忆...`);
        const recentMessages = sessionContext.messages.slice(-6);
        const conversation = recentMessages
          .map((m) => `${m.role === "user" ? "用户" : "AI"}: ${m.content.substring(0, 500)}`)
          .join("\n\n");

        const extraction = await extractMemoryFromConversation(conversation, session.config.id);

        if (extraction && (extraction.facts?.length || extraction.projects?.length)) {
          const updatedMemory = mergeMemory(session.runtime.memory, extraction, `conv_${Date.now()}`);
          await saveMemory(session.config.id, updatedMemory);
          session.runtime.memory = updatedMemory;
          session.lastMemoryExtract.set(fromUser, Date.now());
          console.log(`  ✅ 已提取 ${extraction.facts?.length || 0} 条事实`);
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
