/**
 * 微信 Kimi Bot - 多Agent版本
 * 
 * 支持多个微信账号，每个账号有独立的Agent配置、工作目录和记忆
 */
import crypto from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  getUpdates,
  sendMessage,
  sendTyping,
  getConfig,
  type ApiOptions,
} from "./ilink/api.js";
import {
  MessageType,
  MessageItemType,
  MessageState,
  TypingStatus,
  type WeixinMessage,
} from "./ilink/types.js";
import { askKimi, checkKimiInstalled, ensureKimiAuthenticated, isLikelyLongTask } from "./kimi/handler.js";
import type { KimiOptions } from "./kimi/handler.js";
import {
  checkKimiSession,
  clearKimiSessions,
} from "./kimi/session.js";
import {
  loadSyncBuf,
  saveSyncBuf,
  getContextToken,
  setContextToken,
  loadUserSessionMeta,
  saveUserSessionMeta,
  incrementUserTurnCount,
  resetUserSessionMeta,
} from "./store.js";
import { getScheduler, formatCronDescription, parseNaturalLanguageToCron, type ParsedTaskInfo } from "./scheduler.js";
import { getNotificationManager } from "./notifications/index.js";
import { getVersionInfo, VERSION } from "./version.js";
import { getLongTaskManager, formatProgressMessage as formatLongTaskProgress } from "./longtask/manager.js";
import type { LongTask, ProgressInfo as LongTaskProgressInfo } from "./longtask/types.js";

// FlowTask 导入
import { getFlowTaskManager, formatProgressMessage as formatFlowTaskProgress, formatPlanForUserConfirmation } from "./flowtask/manager.js";
import type { FlowTask, ProgressInfo as FlowTaskProgressInfo, HumanApprovalRequest } from "./flowtask/types.js";

// Task Router 导入
import {
  getTaskRouter,
  routeTask,
  analyzeTask,
  type TaskSubmission,
  type ExecutionMode,
  type RoutedTask,
} from "./task-router/index.js";

// Agent 相关导入
import { agentManager } from "./agent/manager.js";
import { buildSystemPrompt, buildWelcomeMessage, buildHelpPrompt, buildStatusPrompt } from "./agent/prompt-builder.js";
import type { AgentConfig, AgentRuntime, AgentMemory } from "./agent/types.js";
import { extractMemoryFromConversation, mergeMemory, saveMemory } from "./memory/manager.js";

// ============ 上下文感知架构导入 ============
import {
  initializeContextSystem,
  getContextManager,
  getStateMachine,
  ConversationState,
  IntentType,
  translateState,
  type SessionContext,
  type Intent,
} from "./context/index.js";
import { createOutputParser } from "./context/output-parser.js";

// ============ 工具函数导入 ============
import {
  extractText,
  generateClientId,
  chunkMessage,
  MAX_MSG_LEN,
  parseCommand,
  sleep,
} from "./utils/index.js";

// ============ Handlers 导入 ============
import {
  sendTextReply,
  getUserWorkspace,
  buildFounderPrompt,
  showTyping,
} from "./handlers/index.js";

// ============ 服务导入 ============
import {
  saveRestartInfo,
  loadRestartInfo,
  clearRestartInfo,
  formatRestartNotification,
} from "./services/restart-notify.js";
import {
  pollMessages,
  startDynamicAgentLoader,
} from "./services/agent-poller.js";
import { createPromptBuilder } from "./prompt/index.js";

// 新架构开关（用于渐进式迁移）
const ENABLE_CONTEXT_AWARE = process.env.ENABLE_CONTEXT_AWARE !== "false"; // 默认启用

// 全局上下文系统实例
let contextSystem: ReturnType<typeof initializeContextSystem> | null = null;

// ============ 常量和配置 ============

const SESSION_PAUSE_MS = 60 * 60 * 1000;
const SESSION_EXPIRED_ERRCODE = -14;

// ============ Agent 运行时缓存 ============

interface AgentSession {
  runtime: AgentRuntime;
  config: AgentConfig;
  api: ApiOptions;
  credentials: {
    botToken: string;
    accountId: string;
    baseUrl: string;
  };
  conversationTurns: Map<string, number>; // userId -> turns
  lastMemoryExtract: Map<string, number>; // userId -> timestamp
  userWorkspaces: Map<string, string>; // userId -> 用户专属工作目录
}

const activeAgents: Map<string, AgentSession> = new Map();

// 待确认的定时任务 (userId -> { taskInfo, agentId, chatId, contextToken, expiresAt })
interface PendingTask {
  taskInfo: ParsedTaskInfo;
  agentId: string;
  chatId: string;
  contextToken: string;
  expiresAt: number;
}
const pendingTasks: Map<string, PendingTask> = new Map();

// 用户自动路由偏好 (userId -> boolean)
const userAutoRoute: Map<string, boolean> = new Map();

// ============ 命令处理 ============

const COMMANDS = {
  help: { desc: "显示帮助信息" },
  status: { desc: "查看 Agent 状态" },
  reset: { desc: "重置对话上下文" },
  template: { desc: "查看/切换能力模板" },
  memory: { desc: "查看长期记忆" },
  prompt: { desc: "预览系统提示词" },
  ver: { desc: "查看 Bot 版本信息" },
  task: { desc: "定时任务管理 (list/create/delete/toggle)" },
  longtask: { desc: "⏱️ 后台执行耗时任务，实时跟踪进度" },
  flowtask: { desc: "可靠任务流 - 结构化计划执行 (run/status/list/cancel/approve)" },
  deploy: { desc: "部署 Bot (patch/minor/major)" },
  route: { desc: "智能任务路由 (analyze/stats/auto)" },
  auto: { desc: "开关自动路由 (on/off/status)" },
};

async function handleAgentCommand(
  session: AgentSession,
  command: string,
  args: string,
  fromUser: string,
  contextToken: string
): Promise<string | null> {
  // 使用新的命令处理器
  const { handleCommand } = await import("./handlers/index.js");
  const ctx = {
    session,
    fromUser,
    contextToken,
  };
  return await handleCommand(command, args, ctx);
}


/**
 * 支持上下文的命令处理函数（新架构）
 */
async function handleAgentCommandWithContext(
  session: AgentSession,
  command: string,
  args: string,
  fromUser: string,
  contextToken: string,
  sessionContext: SessionContext
): Promise<string | null> {
  const { runtime, config } = session;
  const { contextManager } = contextSystem!;

  switch (command) {
    case "reset": {
      // 复用原有的reset逻辑
      const result = await handleAgentCommand(session, command, args, fromUser, contextToken);
      
      // 额外重置上下文
      await contextManager.reset(sessionContext);
      
      return result || "🔄 对话上下文已重置（包含新架构的会话状态）";
    }

    case "session": {
      const subCmd = args || "status";
      const userWorkspace = await getUserWorkspace(session, fromUser);
      const sessionMeta = loadUserSessionMeta(session.config.id, fromUser);
      const kimiSession = await checkKimiSession(userWorkspace.cwd);
      
      if (subCmd === "status") {
        let response = `
📊 Session 状态（上下文感知架构）

**Agent:** ${session.config.id}
**用户:** ${fromUser}
**工作目录:** \`${userWorkspace.cwd}\`

**对话统计:**
- 轮次: ${sessionMeta?.turnCount || 0}
- 当前状态: ${translateState(sessionContext.state.current)}
- 活跃选项: ${sessionContext.activeOptions.size}
- 消息历史: ${sessionContext.messages.length}
`;
        
        if (sessionContext.state.pendingDecision) {
          response += `- 待决策: ${sessionContext.state.pendingDecision.description}\n`;
        }
        
        if (sessionContext.currentTaskId) {
          response += `- 当前任务: ${sessionContext.currentTaskId}\n`;
        }
        
        const stats = contextManager.getStats(sessionContext);
        response += `- 会话时长: ${Math.floor(stats.duration / 60000)}分钟\n`;
        
        response += `
**Kimi Session:** ${kimiSession.exists ? "✅ 存在" : "❌ 不存在"}
${kimiSession.exists ? `- ID: \`${kimiSession.sessionId?.slice(0, 16)}...\`
- 最后修改: ${kimiSession.lastModified ? new Date(kimiSession.lastModified).toLocaleString("zh-CN") : "未知"}` : ""}

使用 \`/reset\` 重置 session
        `.trim();
        return response;
      }
      
      return "未知命令，可用: /session status";
    }

    case "context": {
      // 新架构专属命令：查看上下文详情
      const subCmd = args || "status";
      
      if (subCmd === "status" || subCmd === "") {
        let response = `**上下文状态**\n\n`;
        response += `状态: ${translateState(sessionContext.state.current)}\n`;
        response += `主题: ${sessionContext.state.topic || '无'}\n`;
        response += `消息数: ${sessionContext.messages.length}\n`;
        response += `活跃选项: ${sessionContext.activeOptions.size}\n`;
        
        if (sessionContext.state.pendingDecision) {
          response += `\n待决策: ${sessionContext.state.pendingDecision.description}\n`;
        }
        
        return response;
      }
      
      if (subCmd === "options") {
        if (sessionContext.activeOptions.size === 0) {
          return "当前没有活跃选项";
        }
        
        let response = `**活跃选项**\n\n`;
        for (const [id, option] of sessionContext.activeOptions) {
          response += `- [${id}] ${option.label}\n`;
        }
        return response;
      }
      
      if (subCmd === "history") {
        const recent = sessionContext.messages.slice(-5);
        if (recent.length === 0) {
          return "没有消息历史";
        }
        
        let response = `**近期消息**\n\n`;
        for (const msg of recent) {
          const role = msg.role === 'user' ? '用户' : 'AI';
          const preview = msg.content.substring(0, 50);
          response += `${role}: ${preview}${msg.content.length > 50 ? '...' : ''}\n`;
        }
        return response;
      }
      
      return `用法:\n/context status - 查看状态\n/context options - 查看活跃选项\n/context history - 查看消息历史`;
    }

    default:
      // 其他命令使用原有逻辑
      return handleAgentCommand(session, command, args, fromUser, contextToken);
  }
}

// ============ 核心消息处理 ============

/**
 * 带上下文感知的消息处理（新架构）
 */
async function handleMessageWithContext(
  session: AgentSession,
  msg: WeixinMessage,
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
  const { contextManager, stateMachine } = contextSystem!;
  const sessionContext = await contextManager.getOrCreate(fromUser, session.config.id);
  
  console.log(`  📊 会话状态: ${translateState(sessionContext.state.current)}, 消息数: ${sessionContext.messages.length}`);

  // ============ 命令处理 ============
  const commandInfo = parseCommand(text);
  if (commandInfo) {
    console.log(`  📝 检测到命令: /${commandInfo.command}`);
    const response = await handleAgentCommandWithContext(
      session,
      commandInfo.command,
      commandInfo.args,
      fromUser,
      contextToken,
      sessionContext
    );
    if (response) {
      await sendTextReply(session.api, fromUser, contextToken, response);
      console.log(`  📤 已发送命令回复`);
      return;
    }
  }

  // ============ 意图识别和指代消解 ============
  const intentResolver = contextSystem!.contextManager as any;
  const intent = await (await import('./context/intent-resolver.js')).createIntentResolver().identify(text, sessionContext);
  
  console.log(`  🎯 识别意图: ${intent.type} (置信度: ${(intent.confidence * 100).toFixed(1)}%)`);
  
  if (intent.references.length > 0) {
    console.log(`  🔗 指代消解: ${intent.references.map(r => `${r.type}=${r.targetId}`).join(', ')}`);
  }

  // ============ 状态机处理 ============
  const transitionResult = stateMachine.transition(sessionContext.state, intent);
  
  if (!transitionResult.success) {
    const clarificationMsg = transitionResult.message || '我不太理解您的意思，能否换个方式描述？';
    await sendTextReply(session.api, fromUser, contextToken, clarificationMsg);
    return;
  }
  
  if (transitionResult.requiresConfirmation) {
    const confirmMsg = `${transitionResult.message || '请确认此操作'}\n\n回复"确认"继续，或"取消"放弃。`;
    await sendTextReply(session.api, fromUser, contextToken, confirmMsg);
    return;
  }
  
  // 更新状态
  if (transitionResult.newState) {
    await contextManager.updateState(sessionContext, transitionResult.newState);
  }

  // 记录用户消息
  await contextManager.addMessage(sessionContext, 'user', text, undefined, intent);

  // ============ 智能任务路由（复用原有逻辑）============
  // ... 省略，继续到Kimi调用部分

  // 获取工作目录
  const userWorkspace = await getUserWorkspace(session, fromUser);
  
  // ============ 构建上下文感知的Prompt ============
  const promptBuilder = createPromptBuilder();
  const systemPrompt = promptBuilder.build(
    session.runtime,
    sessionContext,
    intent.resolvedText || text,
    {
      includeRecentMessages: 5,
      includeActiveOptions: true,
      includeState: true,
    }
  );

  // 检测Kimi session
  const sessionMeta = loadUserSessionMeta(session.config.id, fromUser);
  const kimiSession = await checkKimiSession(userWorkspace.cwd);
  const sessionValid = Boolean(kimiSession.exists && (
    (sessionMeta?.turnCount || 0) > 0 ||
    (kimiSession.lastModified && Date.now() - kimiSession.lastModified < 24 * 60 * 60 * 1000)
  ));
  
  console.log(`  📊 Session 状态: Kimi=${kimiSession.exists ? '✓' : '✗'}, turns=${sessionMeta?.turnCount || 0}, continue=${sessionValid}`);

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
      if (structuredContent.content?.type === 'options') {
        const options = structuredContent.content.data.options;
        await contextManager.addOptions(sessionContext, options);
        await contextManager.updateState(sessionContext, ConversationState.PROPOSING, {
          pendingDecision: {
            id: `decision_${Date.now()}`,
            type: 'select_option',
            description: '请从提供的方案中选择一个',
            options: options.map((o: any) => o.id),
            context: structuredContent.content.data.context,
            createdAt: Date.now(),
            expiresAt: Date.now() + 10 * 60 * 1000,
          },
        });
      }
      
      // 处理确认请求
      if (structuredContent.content?.type === 'confirmation') {
        await contextManager.updateState(sessionContext, ConversationState.CONFIRMING);
      }
    }

    // 发送回复
    await sendTextReply(session.api, fromUser, contextToken, response.text);
    console.log(`  📤 已发送回复 (${response.text.length} 字符)`);

    // 记录AI回复
    await contextManager.addMessage(sessionContext, 'assistant', response.text, 
      structuredContent.success ? structuredContent.content : undefined);

    // 更新轮次
    session.conversationTurns.set(fromUser, sessionContext.messages.length);
    incrementUserTurnCount(session.config.id, fromUser, kimiSession.sessionId);

    // 增强记忆提取
    if (session.config.memory.enabled && session.config.memory.autoExtract) {
      const lastExtract = session.lastMemoryExtract.get(fromUser) || 0;
      const shouldExtract = (sessionContext.messages.length > 0 && sessionContext.messages.length % 3 === 0) || 
                           Date.now() - lastExtract > 5 * 60 * 1000;
      
      if (shouldExtract) {
        console.log(`  🧠 提取记忆...`);
        const recentMessages = sessionContext.messages.slice(-6);
        const conversation = recentMessages
          .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content.substring(0, 500)}`)
          .join('\n\n');
        
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
      `处理消息时出错: ${err instanceof Error ? err.message : String(err)}`,
    ).catch(() => {});
  }
}

/**
 * 主消息处理函数（兼容层）
 */
async function handleMessage(
  session: AgentSession,
  msg: WeixinMessage,
): Promise<void> {
  // 如果启用了新架构，使用新处理函数
  if (ENABLE_CONTEXT_AWARE && contextSystem) {
    return handleMessageWithContext(session, msg);
  }
  
  // 否则使用传统处理流程
  return handleMessageLegacy(session, msg);
}

/**
 * 传统消息处理流程（保留作为fallback）
 */
async function handleMessageLegacy(
  session: AgentSession,
  msg: WeixinMessage,
): Promise<void> {
  if (msg.message_type !== MessageType.USER) return;

  const fromUser = msg.from_user_id;
  if (!fromUser) return;

  const text = extractText(msg);
  if (!text) {
    console.log(`  [skip] 非文本消息 from ${fromUser}`);
    return;
  }

  // 缓存 context_token（按Agent隔离）
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
    
    const response = await handleAgentCommand(session, commandInfo.command, commandInfo.args, fromUser, contextToken);
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
  
  // 如果是创始Agent，注入项目维护规范
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
  const sessionValid = Boolean(kimiSession.exists && (
    (sessionMeta?.turnCount || 0) > 0 ||
    (kimiSession.lastModified && Date.now() - kimiSession.lastModified < 24 * 60 * 60 * 1000)
  ));
  
  console.log(`  📊 Session 状态: Kimi=${kimiSession.exists ? '✓' : '✗'}, turns=${sessionMeta?.turnCount || 0}, continue=${sessionValid}`);

  const kimiOpts: KimiOptions & { systemPrompt?: string } = {
    model: session.config.ai.model,
    cwd: userWorkspace.cwd,  // CWD 在 session 目录（控制 session 存储位置）
    maxTurns: session.config.ai.maxTurns,
    planMode: false,
    systemPrompt: systemPrompt,
    continueSession: sessionValid,  // 基于真实的 Kimi session 状态
  };

  // 显示输入中
  showTyping(session.api, fromUser, contextToken);

  try {
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
      // 放宽提取条件：每3轮或超过5分钟提取一次
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
      `处理消息时出错: ${err instanceof Error ? err.message : String(err)}`,
    ).catch(() => {});
  }
}

// ============ 主程序 ============

async function main() {
  // 检查 Kimi CLI
  const kimiInstalled = await checkKimiInstalled();
  if (!kimiInstalled) {
    console.error("错误: 未找到 Kimi CLI。请先安装:");
    console.error("  uv tool install kimi-cli");
    process.exit(1);
  }

  const kimiAuthenticated = await ensureKimiAuthenticated();
  if (!kimiAuthenticated) {
    console.error("\n错误: Kimi CLI 登录失败");
    process.exit(1);
  }

  // 初始化 AgentManager
  await agentManager.initialize();
  const allAgents = agentManager.getAllAgents();

  if (allAgents.length === 0) {
    console.error("\n❌ 没有可用的 Agent");
    console.error("请先运行: npm run login");
    process.exit(1);
  }

  // 初始化上下文感知系统
  if (ENABLE_CONTEXT_AWARE) {
    contextSystem = initializeContextSystem();
    console.log("\n🧠 上下文感知系统已启用");
  } else {
    console.log("\n⚠️  上下文感知系统已禁用（使用传统模式）");
  }

  // 确定要启动的 Agent
  const activeAgentId = process.env.ACTIVE_AGENT_ID;
  let agentsToStart: AgentConfig[];

  if (activeAgentId) {
    const agent = agentManager.getAgent(activeAgentId);
    if (!agent) {
      console.error(`\n❌ 未找到 Agent: ${activeAgentId}`);
      console.error(`可用 Agent: ${allAgents.map(a => a.id).join(", ")}`);
      process.exit(1);
    }
    agentsToStart = [agent];
  } else {
    // 默认启动所有 Agent
    agentsToStart = allAgents;
  }

  // 初始化每个 Agent
  for (const agentConfig of agentsToStart) {
    console.log(`\n🚀 初始化 Agent: ${agentConfig.name}`);

    // 加载凭证
    const credsPath = join(agentManager.getAgentPath(agentConfig.id), "credentials.json");
    let creds;
    try {
      creds = JSON.parse(readFileSync(credsPath, "utf-8"));
    } catch {
      console.error(`  ❌ 无法加载 ${agentConfig.name} 的凭证，跳过`);
      continue;
    }

    // 构建运行时
    const runtime = await agentManager.buildRuntime(agentConfig.id);
    if (!runtime) {
      console.error(`  ❌ 无法构建 ${agentConfig.name} 的运行时，跳过`);
      continue;
    }

    // 创建 API 配置
    const api: ApiOptions = {
      baseUrl: creds.baseUrl,
      token: creds.botToken,
    };

    // 创建会话
    const session: AgentSession = {
      runtime,
      config: agentConfig,
      api,
      credentials: {
        botToken: creds.botToken,
        accountId: creds.accountId,
        baseUrl: creds.baseUrl,
      },
      conversationTurns: new Map(),
      lastMemoryExtract: new Map(),
      userWorkspaces: new Map(),
    };

    activeAgents.set(agentConfig.id, session);

    console.log(`  ✅ 已加载: ${agentConfig.name}`);
    console.log(`     角色: ${runtime.template.icon} ${runtime.template.name}`);
    console.log(`     工作目录: ${agentConfig.workspace.path}`);
    console.log(`     模型: ${agentConfig.ai.model}`);

    // 设置定时任务
    const scheduler = getScheduler(session.config.id);
    scheduler.setApi(api, async (chatId: string, ctxToken: string, text: string) => {
      await sendTextReply(api, chatId, ctxToken, text);
    });
    scheduler.start();

    // 初始化通知管理器（每个Agent独立的通知配置）
    const notificationManager = getNotificationManager(session.config.id);
    try {
      await notificationManager.initialize();
    } catch (e) {
      console.error(`[Notification:${session.config.id}] 初始化失败:`, e);
    }

    // 初始化耗时任务管理器
    const ltManager = getLongTaskManager(session.config.id, {
      maxConcurrency: 5,
      reportIntervalMs: 30_000,
      onProgress: async (task: LongTask, progress: LongTaskProgressInfo) => {
        const msg = formatLongTaskProgress(task, progress);
        await sendTextReply(api, task.chatId, task.contextToken, msg);
        console.log(`  [LongTask:${task.id}] 进度: ${progress.percent}% - ${progress.step}`);
      },
      onComplete: async (task: LongTask) => {
        // deploy 命令会自己处理完成通知和重启，跳过默认通知
        if (task.command?.startsWith("npm run version:")) {
          console.log(`  [LongTask:${task.id}] 部署任务完成，跳过默认通知（由 deploy 命令处理）`);
          return;
        }
        
        const statusEmoji = task.status === "completed" ? "✅" : "❌";
        const msg = `${statusEmoji} **耗时任务完成** \`${task.id}\`\n\n` +
          `状态: ${task.status === "completed" ? "成功" : "失败"}\n` +
          `耗时: ${((task.completedAt! - task.startedAt!) / 1000).toFixed(1)}s\n\n` +
          `---\n${task.result?.slice(0, 3000) || task.error || ""}${(task.result?.length || 0) > 3000 ? "\n... (已截断)" : ""}`;
        await sendTextReply(api, task.chatId, task.contextToken, msg);
        console.log(`  [LongTask:${task.id}] 完成: ${task.status}`);
      },
      onCancel: async (task: LongTask) => {
        const msg = `🚫 **耗时任务已取消** \`${task.id}\``;
        await sendTextReply(api, task.chatId, task.contextToken, msg);
        console.log(`  [LongTask:${task.id}] 已取消`);
      },
    });

    // 初始化 FlowTask 管理器（可靠自我迭代架构）
    const ftManager = getFlowTaskManager(session.config.id, {
      maxConcurrency: 4,
      reportIntervalMs: 30_000,
      autoApproveLowRisk: false,
      requireApprovalFor: ["write", "shell", "human"],
      onProgress: async (task: FlowTask, progress: FlowTaskProgressInfo) => {
        const msg = formatFlowTaskProgress(task, progress);
        await sendTextReply(api, task.chatId, task.contextToken, msg);
        console.log(`  [FlowTask:${task.id}] 进度: ${progress.percent}% - ${progress.step}`);
      },
      onComplete: async (task: FlowTask) => {
        const statusEmoji = task.status === "completed" ? "✅" : task.status === "cancelled" ? "🚫" : "❌";
        const audit = task.execution?.audit;
        const humanCount = audit?.filter(a => a.event === "human_approval_requested").length || 0;
        const msg = `${statusEmoji} **FlowTask 完成** \`${task.id}\`\n\n` +
          `状态: ${task.status === "completed" ? "成功" : task.status === "cancelled" ? "已取消" : "失败"}\n` +
          `步骤: ${task.plan?.steps.length || 0} | 人工介入: ${humanCount}次\n` +
          `风险等级: ${task.plan?.validation.riskLevel === "high" ? "🔴 高" : task.plan?.validation.riskLevel === "medium" ? "🟡 中" : "🟢 低"}\n` +
          `耗时: ${task.startedAt && task.completedAt ? ((task.completedAt - task.startedAt) / 1000).toFixed(1) : 0}s\n\n` +
          `---\n${task.result?.slice(0, 3000) || task.error || ""}${(task.result?.length || 0) > 3000 ? "\n... (已截断)" : ""}`;
        await sendTextReply(api, task.chatId, task.contextToken, msg);
        console.log(`  [FlowTask:${task.id}] 完成: ${task.status}`);
      },
      onCancel: async (task: FlowTask) => {
        const msg = `🚫 **FlowTask 已取消** \`${task.id}\``;
        await sendTextReply(api, task.chatId, task.contextToken, msg);
        console.log(`  [FlowTask:${task.id}] 已取消`);
      },
      onApprovalRequest: async (task: FlowTask, request: HumanApprovalRequest) => {
        let msg = `⏸️ **FlowTask 等待确认** \`${task.id}\`\n\n`;
        msg += `步骤 ${request.stepNumber}: ${request.description}\n`;
        msg += `风险等级: ${request.riskLevel === "high" ? "🔴 高" : request.riskLevel === "medium" ? "🟡 中" : "🟢 低"}\n\n`;
        if (request.preview) {
          msg += `*预览*:\n\`\`\`\n${request.preview.content.slice(0, 500)}${request.preview.content.length > 500 ? "\n..." : ""}\n\`\`\`\n\n`;
        }
        msg += `请在5分钟内回复:\n`;
        msg += `- \`/flowtask approve ${task.id}\` 确认继续\n`;
        msg += `- \`/flowtask reject ${task.id} [原因]\` 拒绝执行`;
        await sendTextReply(api, task.chatId, task.contextToken, msg);
        console.log(`  [FlowTask:${task.id}] 等待用户确认: ${request.description}`);
      },
    });
  }

  if (activeAgents.size === 0) {
    console.error("\n❌ 没有成功加载的 Agent");
    process.exit(1);
  }

  console.log("\n=== 微信 Kimi Bot 已启动 ===");
  console.log(`活跃 Agent 数: ${activeAgents.size}`);
  console.log("按 Ctrl+C 停止\n");

  // 检查是否有重启通知需要发送
  const restartInfo = loadRestartInfo();
  if (restartInfo) {
    console.log("[RestartNotify] 检测到重启信息，准备发送通知...");
    
    // 尝试发送通知到原始聊天（如果是部署触发的）
    if (restartInfo.chatId && restartInfo.contextToken) {
      const agentSession = restartInfo.agentId 
        ? activeAgents.get(restartInfo.agentId) 
        : Array.from(activeAgents.values())[0];
      
      if (agentSession) {
        try {
          const notifyMsg = formatRestartNotification(restartInfo);
          await sendTextReply(
            agentSession.api,
            restartInfo.chatId,
            restartInfo.contextToken,
            notifyMsg
          );
          console.log(`[RestartNotify] 已向用户 ${restartInfo.operator} 发送重启通知`);
        } catch (error) {
          console.error("[RestartNotify] 发送重启通知失败:", error);
        }
      }
    }
    
    // 同时通过通知通道发送（如果有配置）
    for (const session of activeAgents.values()) {
      const notificationManager = getNotificationManager(session.config.id);
      try {
        const notifyMsg = formatRestartNotification(restartInfo);
        await notificationManager.sendToAll({
          title: "服务器已重启",
          content: notifyMsg,
          timestamp: Date.now(),
          metadata: {
            type: "server_restart",
            agentId: session.config.id,
          },
        });
        console.log(`[RestartNotify] 已通过通知通道发送 (Agent: ${session.config.id})`);
      } catch (error) {
        console.error(`[RestartNotify] 通知通道发送失败 (Agent: ${session.config.id}):`, error);
      }
    }
    
    // 清除重启信息
    clearRestartInfo();
  }

  // 定时任务和通知管理器已在各Agent初始化时启动

  // 优雅关闭
  process.on("SIGINT", async () => {
    console.log("\n\n正在关闭...");
    // 停止所有调度器
    for (const s of activeAgents.values()) {
      const sched = getScheduler(s.config.id);
      sched.stop();
    }
    // 停止所有通知管理器
    for (const s of activeAgents.values()) {
      const manager = getNotificationManager(s.config.id);
      await manager.shutdown();
    }
    process.exit(0);
  });

  // 为每个 Agent 启动消息轮询
  const pollPromises = Array.from(activeAgents.values()).map(session => 
    pollMessages(session, handleMessage)
  );

  // 启动动态 Agent 加载器（定期检查新添加的 Agent）
  startDynamicAgentLoader(activeAgents, handleMessage);

  await Promise.all(pollPromises);
}


main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
