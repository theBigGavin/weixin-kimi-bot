/**
 * weixin-kimi-bot — Bridge WeChat messages to Kimi Code CLI via iLink protocol.
 *
 * Flow: WeChat → iLink getupdates → Kimi CLI subprocess → iLink sendmessage → WeChat
 */
import crypto from "node:crypto";
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
import { askKimi, checkKimiInstalled, ensureKimiAuthenticated, type KimiOptions } from "./kimi/handler.js";
import {
  loadCredentials,
  loadConfig,
  loadSyncBuf,
  saveSyncBuf,
  loadContextTokens,
  getContextToken,
  setContextToken,
} from "./store.js";

const SESSION_EXPIRED_ERRCODE = -14;
const SESSION_PAUSE_MS = 60 * 60 * 1000; // 1 hour

// --- Bot Commands ---

const COMMANDS = {
  help: {
    desc: "显示帮助信息",
    usage: "/help",
  },
  status: {
    desc: "查看 Bot 状态",
    usage: "/status",
  },
  plan: {
    desc: "开启规划模式（执行复杂任务前制定计划）",
    usage: "/plan <你的任务>",
  },
  yolo: {
    desc: "开启自动确认模式（⚠️ 自动批准所有操作，慎用！）",
    usage: "/yolo <你的任务>",
  },
  reset: {
    desc: "重置当前对话上下文",
    usage: "/reset",
  },
  config: {
    desc: "查看当前配置",
    usage: "/config",
  },
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

function handleBotCommand(command: string, args: string, kimiOpts: KimiOptions): { response: string; options?: KimiOptions } | null {
  switch (command) {
    case "help":
    case "h":
      return {
        response: `🤖 **微信 Kimi Bot 命令列表**\n\n${Object.entries(COMMANDS)
          .map(([name, info]) => `/${name} - ${info.desc}\n  用法: ${info.usage}`)
          .join("\n\n")}\n\n💡 直接发送消息即可与 Kimi 对话`,
      };
    
    case "status":
      return {
        response: `📊 **Bot 状态**\n\n` +
          `模型: ${kimiOpts.model}\n` +
          `工作目录: ${kimiOpts.cwd}\n` +
          `最大轮次: ${kimiOpts.maxTurns}\n` +
          `规划模式: ${kimiOpts.planMode ? "开启" : "关闭"}\n\n` +
          `✅ 服务运行正常`,
      };
    
    case "config":
      return {
        response: `⚙️ **当前配置**\n\n` +
          `模型: ${kimiOpts.model}\n` +
          `最大轮次: ${kimiOpts.maxTurns}\n` +
          `工作目录: ${kimiOpts.cwd}\n` +
          `规划模式: ${kimiOpts.planMode ? "开启" : "关闭"}\n` +
          `系统提示: ${kimiOpts.systemPrompt || "(无)"}\n\n` +
          `使用 npm run config 修改配置`,
      };
    
    case "reset":
      return {
        response: "🔄 对话上下文已重置（下次对话将使用新的上下文）",
      };
    
    case "plan":
      if (!args) {
        return {
          response: "❌ 请在 /plan 后输入你的任务\n\n用法: /plan 我要重构这个项目的代码结构",
        };
      }
      return {
        response: "",
        options: { ...kimiOpts, planMode: true },
      };
    
    case "yolo":
      if (!args) {
        return {
          response: "❌ 请在 /yolo 后输入你的任务\n\n用法: /yolo 自动修复所有 bug",
        };
      }
      return {
        response: "🚀 已开启自动确认模式（将自动批准所有操作）\n",
        options: { ...kimiOpts, yolo: true },
      };
    
    default:
      return null;
  }
}

// --- Message text extraction ---

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
    // Voice ASR transcript
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return "";
}

// --- Send text reply (split into chunks if needed) ---

const MAX_MSG_LEN = 4000; // WeChat has a ~4096 limit, leave some margin

function generateClientId(): string {
  return `wkb-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

async function sendTextReply(
  api: ApiOptions,
  toUserId: string,
  contextToken: string,
  text: string,
): Promise<void> {
  const chunks =
    text.length <= MAX_MSG_LEN
      ? [text]
      : text.match(new RegExp(`.{1,${MAX_MSG_LEN}}`, "gs")) || [text];

  for (const chunk of chunks) {
    const msg: WeixinMessage = {
      to_user_id: toUserId,
      from_user_id: "",          // iLink server fills this automatically
      client_id: generateClientId(), // unique per message, prevents dedup
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: contextToken,
      item_list: [
        {
          type: MessageItemType.TEXT,
          text_item: { text: chunk },
        },
      ],
    };
    await sendMessage(api, { msg });
  }
}

// --- Typing indicator ---

async function showTyping(
  api: ApiOptions,
  userId: string,
  contextToken?: string,
): Promise<void> {
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
    // Non-critical, ignore errors
  }
}

// --- Process a single inbound message ---

async function handleMessage(
  api: ApiOptions,
  msg: WeixinMessage,
  kimiOpts: KimiOptions,
): Promise<void> {
  // Only process user messages
  if (msg.message_type !== MessageType.USER) return;

  const fromUser = msg.from_user_id;
  if (!fromUser) return;

  const text = extractText(msg);
  if (!text) {
    console.log(`  [skip] 非文本消息 from ${fromUser}`);
    return;
  }

  // Cache context_token
  if (msg.context_token) {
    setContextToken(fromUser, msg.context_token);
  }
  const contextToken = msg.context_token || getContextToken(fromUser);
  if (!contextToken) {
    console.error(`  [error] 没有 context_token for ${fromUser}`);
    return;
  }

  console.log(`\n📩 收到消息 from ${fromUser}: ${text.substring(0, 80)}${text.length > 80 ? "..." : ""}`);

  // Check for bot commands
  const commandInfo = parseCommand(text);
  if (commandInfo) {
    console.log(`  📝 检测到命令: /${commandInfo.command}`);
    
    const result = handleBotCommand(commandInfo.command, commandInfo.args, kimiOpts);
    if (result) {
      // If there's a direct response (not empty), send it
      if (result.response) {
        try {
          await sendTextReply(api, fromUser, contextToken, result.response);
          console.log(`  📤 已发送命令回复`);
        } catch (err) {
          console.error(`  ❌ 发送回复失败:`, err);
        }
      }
      
      // If there are options (e.g., /plan with args), forward to Kimi with modified options
      if (result.options && commandInfo.args) {
        const effectiveOpts = result.options;
        showTyping(api, fromUser, contextToken);
        
        try {
          console.log(`  🤖 正在调用 Kimi CLI (${effectiveOpts.model}, 规划模式: ${effectiveOpts.planMode})...`);
          const response = await askKimi(commandInfo.args, effectiveOpts);
          console.log(`  ✅ Kimi 响应完成 (${(response.durationMs / 1000).toFixed(1)}s)`);
          
          await sendTextReply(api, fromUser, contextToken, response.text);
          console.log(`  📤 已发送回复 (${response.text.length} chars)`);
        } catch (err) {
          console.error(`  ❌ 处理失败:`, err);
          await sendTextReply(
            api,
            fromUser,
            contextToken,
            `处理消息时出错: ${err instanceof Error ? err.message : String(err)}`,
          ).catch(() => {});
        }
      }
      return;
    }
    // Unknown command, fall through to normal Kimi processing
    console.log(`  ⚠️ 未知命令，转发给 Kimi 处理`);
  }

  // Show typing indicator
  showTyping(api, fromUser, contextToken);

  try {
    // Send to Kimi CLI
    console.log(`  🤖 正在调用 Kimi CLI (${kimiOpts.model})...`);
    const response = await askKimi(text, kimiOpts);
    console.log(`  ✅ Kimi 响应完成 (${(response.durationMs / 1000).toFixed(1)}s)`);

    // Send response back to WeChat
    await sendTextReply(api, fromUser, contextToken, response.text);
    console.log(`  📤 已发送回复 (${response.text.length} chars)`);
  } catch (err) {
    console.error(`  ❌ 处理失败:`, err);
    // Send error message back to user
    await sendTextReply(
      api,
      fromUser,
      contextToken,
      `处理消息时出错: ${err instanceof Error ? err.message : String(err)}`,
    ).catch(() => {});
  }
}

// --- Main loop ---

async function main() {
  // Check if Kimi CLI is installed
  const kimiInstalled = await checkKimiInstalled();
  if (!kimiInstalled) {
    console.error("错误: 未找到 Kimi CLI。请先安装:");
    console.error("  uv tool install kimi-cli");
    console.error("或访问: https://github.com/MoonshotAI/kimi-cli");
    process.exit(1);
  }

  // Ensure Kimi CLI is authenticated (auto-login if needed)
  const kimiAuthenticated = await ensureKimiAuthenticated();
  if (!kimiAuthenticated) {
    console.error("\n错误: Kimi CLI 登录失败，无法启动 Bot。");
    process.exit(1);
  }

  const creds = loadCredentials();
  if (!creds) {
    console.error("未找到登录凭证。请先运行: npm run login");
    process.exit(1);
  }

  const api: ApiOptions = {
    baseUrl: creds.baseUrl,
    token: creds.botToken,
  };

  const config = loadConfig();
  const kimiOpts: KimiOptions = {
    model: config.model,
    systemPrompt: config.systemPrompt,
    cwd: config.cwd,
    maxTurns: config.maxTurns,
    planMode: config.planMode,
  };

  console.log("=== 微信 Kimi Bot 已启动 ===");
  console.log(`账号: ${creds.accountId}`);
  console.log(`Base URL: ${creds.baseUrl}`);
  console.log(`模型: ${config.model}`);
  console.log(`最大轮次: ${config.maxTurns}`);
  console.log(`工作目录: ${config.cwd}`);
  console.log(`规划模式: ${config.planMode ? "开启" : "关闭"}`);
  if (config.systemPrompt) console.log(`系统提示: ${config.systemPrompt.substring(0, 60)}...`);
  console.log("等待消息中...\n");

  // Restore state
  loadContextTokens();
  let syncBuf = loadSyncBuf();

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n\n正在关闭...");
    process.exit(0);
  });

  // Long-poll loop
  let consecutiveFailures = 0;

  while (true) {
    try {
      const resp = await getUpdates(api, { get_updates_buf: syncBuf });

      // Handle errors
      if ((resp.ret && resp.ret !== 0) || (resp.errcode && resp.errcode !== 0)) {
        if (resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE) {
          console.error(`⚠️  Session 过期，暂停 1 小时后重试...`);
          console.error("   提示：可能需要重新登录 (npm run login)");
          await sleep(SESSION_PAUSE_MS);
          continue;
        }

        consecutiveFailures++;
        console.error(
          `getUpdates 错误: ret=${resp.ret} errcode=${resp.errcode} (${consecutiveFailures}/3)`,
        );
        if (consecutiveFailures >= 3) {
          console.error("连续失败 3 次，等待 30 秒...");
          consecutiveFailures = 0;
          await sleep(30_000);
        } else {
          await sleep(2_000);
        }
        continue;
      }

      consecutiveFailures = 0;

      // Save sync cursor
      if (resp.get_updates_buf) {
        saveSyncBuf(resp.get_updates_buf);
        syncBuf = resp.get_updates_buf;
      }

      // Process messages
      const msgs = resp.msgs ?? [];
      for (const msg of msgs) {
        await handleMessage(api, msg, kimiOpts);
      }
    } catch (err) {
      consecutiveFailures++;
      console.error(`Poll 异常 (${consecutiveFailures}/3):`, err instanceof Error ? err.message : err);
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
