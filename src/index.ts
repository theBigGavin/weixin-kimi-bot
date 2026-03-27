/**
 * 微信 Kimi Bot - 多Agent版本
 * 
 * 支持多个微信账号，每个账号有独立的Agent配置、工作目录和记忆
 */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
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
import { askKimi, checkKimiInstalled, ensureKimiAuthenticated } from "./kimi/handler.js";
import type { KimiOptions } from "./kimi/handler.js";
import {
  loadSyncBuf,
  saveSyncBuf,
  getContextToken,
  setContextToken,
} from "./store.js";
import { getScheduler, formatCronDescription } from "./scheduler.js";
import { notificationManager } from "./notifications/index.js";

// Agent 相关导入
import { agentManager } from "./agent/manager.js";
import { buildSystemPrompt, buildWelcomeMessage, buildHelpPrompt, buildStatusPrompt } from "./agent/prompt-builder.js";
import type { AgentConfig, AgentRuntime, AgentMemory } from "./agent/types.js";
import { extractMemoryFromConversation, mergeMemory, saveMemory } from "./memory/manager.js";

const SESSION_EXPIRED_ERRCODE = -14;
const SESSION_PAUSE_MS = 60 * 60 * 1000;

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
}

const activeAgents: Map<string, AgentSession> = new Map();

// ============ 命令处理 ============

const COMMANDS = {
  help: { desc: "显示帮助信息" },
  status: { desc: "查看 Agent 状态" },
  reset: { desc: "重置对话上下文" },
  template: { desc: "查看/切换能力模板" },
  memory: { desc: "查看长期记忆" },
  prompt: { desc: "预览系统提示词" },
};

function parseCommand(text: string): { command: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return { command: trimmed.slice(1).toLowerCase(), args: "" };
  }
  
  return {
    command: trimmed.slice(1, spaceIndex).toLowerCase(),
    args: trimmed.slice(spaceIndex + 1).trim(),
  };
}

async function handleAgentCommand(
  session: AgentSession,
  command: string,
  args: string,
  fromUser: string
): Promise<string | null> {
  const { runtime, config } = session;

  switch (command) {
    case "help":
    case "h":
      return buildHelpPrompt(runtime);

    case "status":
      return buildStatusPrompt(runtime);

    case "reset":
      // 重置对话轮次
      session.conversationTurns.delete(fromUser);
      session.lastMemoryExtract.delete(fromUser);
      return "🔄 对话上下文已重置。系统提示词将在下一条消息重新注入。";

    case "template":
      if (args === "list") {
        const { getTemplates } = await import("./templates/definitions.js");
        const templates = getTemplates();
        let response = "**可用能力模板**\n\n";
        for (const t of templates) {
          response += `${t.icon} **${t.name}** (${t.id})\n${t.description}\n\n`;
        }
        return response;
      }
      return `**当前能力模板**\n\n${runtime.template.icon} **${runtime.template.name}**\n${runtime.template.description}\n\n发送 \`/template list\` 查看所有可用模板`;

    case "memory":
      const { formatMemoryForPrompt } = await import("./memory/manager.js");
      const memoryContext = formatMemoryForPrompt(runtime.memory);
      if (!memoryContext) {
        return "📭 暂无长期记忆\n\n记忆会在对话过程中自动提取和积累。";
      }
      return `**长期记忆**\n\n${memoryContext}\n\n_共 ${runtime.memory.facts.length} 条事实，${runtime.memory.projects.length} 个项目_`;

    case "prompt":
      const prompt = buildSystemPrompt(runtime);
      return `**当前系统提示词**\n\n\`\`\`\n${prompt.substring(0, 2000)}${prompt.length > 2000 ? "\n... (已截断)" : ""}\n\`\`\``;

    default:
      return null;
  }
}

// ============ 消息处理 ============

function extractText(msg: WeixinMessage): string {
  if (!msg.item_list?.length) return "";
  for (const item of msg.item_list) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      const ref = item.ref_msg;
      if (ref?.title) {
        return `[引用: ${ref.title}]\n${item.text_item.text}`;
      }
      return item.text_item.text;
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return "";
}

const MAX_MSG_LEN = 4000;

function generateClientId(): string {
  return `wkb-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

async function sendTextReply(
  api: ApiOptions,
  toUserId: string,
  contextToken: string,
  text: string,
): Promise<void> {
  const chunks = text.length <= MAX_MSG_LEN
    ? [text]
    : text.match(new RegExp(`.{1,${MAX_MSG_LEN}}`, "gs")) || [text];

  for (const chunk of chunks) {
    const msg: WeixinMessage = {
      to_user_id: toUserId,
      from_user_id: "",
      client_id: generateClientId(),
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: contextToken,
      item_list: [{
        type: MessageItemType.TEXT,
        text_item: { text: chunk },
      }],
    };
    await sendMessage(api, { msg });
  }
}

async function showTyping(api: ApiOptions, userId: string, contextToken?: string): Promise<void> {
  try {
    const config = await getConfig(api, userId, contextToken);
    if (config.typing_ticket) {
      await sendTyping(api, {
        ilink_user_id: userId,
        typing_ticket: config.typing_ticket,
        status: TypingStatus.TYPING,
      });
    }
  } catch {
    // 忽略错误
  }
}

// ============ 核心消息处理 ============

async function handleMessage(
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

  // 检查命令
  const commandInfo = parseCommand(text);
  if (commandInfo) {
    console.log(`  📝 检测到命令: /${commandInfo.command}`);
    
    const response = await handleAgentCommand(session, commandInfo.command, commandInfo.args, fromUser);
    if (response !== null) {
      await sendTextReply(session.api, fromUser, contextToken, response);
      console.log(`  📤 已发送命令回复`);
      return;
    }
    // 未知命令，继续处理
  }

  // 构建 Kimi 选项
  const turns = session.conversationTurns.get(fromUser) || 0;
  const shouldReinject = turns === 0 || turns >= session.config.ai.maxTurns * 0.8;

  // 构建系统提示词
  const systemPrompt = buildSystemPrompt(session.runtime, {
    includeMemory: session.config.memory.enabled,
  });

  const kimiOpts: KimiOptions & { systemPrompt?: string } = {
    model: session.config.ai.model,
    cwd: session.config.workspace.path,
    maxTurns: session.config.ai.maxTurns,
    planMode: false,
  };
  
  if (shouldReinject) {
    kimiOpts.systemPrompt = systemPrompt;
  }

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

    // 提取记忆（如果启用）
    if (session.config.memory.enabled && session.config.memory.autoExtract) {
      const lastExtract = session.lastMemoryExtract.get(fromUser) || 0;
      const shouldExtract = turns > 0 && turns % 5 === 0 && Date.now() - lastExtract > 60000;
      
      if (shouldExtract) {
        console.log(`  🧠 提取记忆...`);
        const conversation = `用户: ${text}\nAI: ${response.text}`;
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
  }

  if (activeAgents.size === 0) {
    console.error("\n❌ 没有成功加载的 Agent");
    process.exit(1);
  }

  console.log("\n=== 微信 Kimi Bot 已启动 ===");
  console.log(`活跃 Agent 数: ${activeAgents.size}`);
  console.log("按 Ctrl+C 停止\n");

  // 定时任务已在各Agent初始化时启动

  // 初始化通知管理器
  try {
    await notificationManager.initialize();
  } catch (e) {
    console.error("[Notification] 初始化失败:", e);
  }

  // 优雅关闭
  process.on("SIGINT", async () => {
    console.log("\n\n正在关闭...");
    // 停止所有调度器
    for (const s of activeAgents.values()) {
      const sched = getScheduler(s.config.id);
      sched.stop();
    }
    await notificationManager.shutdown();
    process.exit(0);
  });

  // 为每个 Agent 启动消息轮询
  const pollPromises = Array.from(activeAgents.values()).map(session => 
    pollMessages(session)
  );

  await Promise.all(pollPromises);
}

// 消息轮询循环
async function pollMessages(session: AgentSession): Promise<void> {
  let syncBuf = loadSyncBuf();
  let consecutiveFailures = 0;

  while (true) {
    try {
      const resp = await getUpdates(session.api, { get_updates_buf: syncBuf });

      if ((resp.ret && resp.ret !== 0) || (resp.errcode && resp.errcode !== 0)) {
        if (resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE) {
          console.error(`[${session.config.name}] ⚠️ Session 过期，暂停 1 小时...`);
          await sleep(SESSION_PAUSE_MS);
          continue;
        }

        consecutiveFailures++;
        console.error(
          `[${session.config.name}] getUpdates 错误: ret=${resp.ret} errcode=${resp.errcode} (${consecutiveFailures}/3)`,
        );
        
        if (consecutiveFailures >= 3) {
          consecutiveFailures = 0;
          await sleep(30_000);
        } else {
          await sleep(2_000);
        }
        continue;
      }

      consecutiveFailures = 0;

      if (resp.get_updates_buf) {
        saveSyncBuf(resp.get_updates_buf);
        syncBuf = resp.get_updates_buf;
      }

      const msgs = resp.msgs ?? [];
      for (const msg of msgs) {
        await handleMessage(session, msg);
      }
    } catch (err) {
      consecutiveFailures++;
      console.error(`[${session.config.name}] Poll 异常 (${consecutiveFailures}/3):`, err);
      
      if (consecutiveFailures >= 3) {
        consecutiveFailures = 0;
        await sleep(30_000);
      } else {
        await sleep(2_000);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
