/**
 * Agent 轮询服务
 * 
 * 管理消息轮询和动态 Agent 加载
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getUpdates,
  type ApiOptions,
} from "../ilink/api.js";
import {
  loadSyncBuf,
  saveSyncBuf,
} from "../store.js";
import { getScheduler } from "../scheduler.js";
import { getNotificationManager } from "../notifications/index.js";
import { getFlowTaskManager } from "../flowtask/manager.js";
import type { FlowTask, ProgressInfo as FlowTaskProgressInfo, HumanApprovalRequest } from "../flowtask/types.js";
import { agentManager } from "../agent/manager.js";
import { sendTextReply } from "../handlers/index.js";
import { sleep } from "../utils/index.js";
import type { AgentConfig, AgentRuntime } from "../agent/types.js";
import type { WeixinMessage } from "../ilink/types.js";

// 常量
const SESSION_PAUSE_MS = 60 * 60 * 1000;
const SESSION_EXPIRED_ERRCODE = -14;

/**
 * Agent 会话接口（与 index.ts 中的 AgentSession 保持一致）
 */
interface AgentSession {
  runtime: AgentRuntime;
  config: AgentConfig;
  api: ApiOptions;
  credentials: {
    botToken: string;
    accountId: string;
    baseUrl: string;
  };
  conversationTurns: Map<string, number>;
  lastMemoryExtract: Map<string, number>;
  userWorkspaces: Map<string, string>;
}

/**
 * 消息处理器类型
 */
export type MessageHandler = (session: AgentSession, msg: WeixinMessage) => Promise<void>;

/**
 * 消息轮询循环
 */
export async function pollMessages(
  session: AgentSession,
  handleMessage: MessageHandler
): Promise<void> {
  let syncBuf = loadSyncBuf(session.config.id);
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
        saveSyncBuf(resp.get_updates_buf, session.config.id);
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

/**
 * 动态加载新添加的 Agent
 */
export function startDynamicAgentLoader(
  activeAgents: Map<string, AgentSession>,
  handleMessage: MessageHandler
): void {
  const CHECK_INTERVAL = 30_000; // 每30秒检查一次

  setInterval(async () => {
    // 重新加载所有 Agent 列表
    await agentManager.reload();
    const allAgents = agentManager.getAllAgents();

    for (const agentConfig of allAgents) {
      // 如果 Agent 已经在运行中，跳过
      if (activeAgents.has(agentConfig.id)) continue;

      console.log(`\n🆕 发现新 Agent: ${agentConfig.name}，正在加载...`);

      try {
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

        // 设置定时任务
        const scheduler = getScheduler(session.config.id);
        scheduler.setApi(api, async (chatId: string, ctxToken: string, text: string) => {
          await sendTextReply(api, chatId, ctxToken, text);
        });
        scheduler.start();

        // 初始化通知管理器
        const notificationManager = getNotificationManager(session.config.id);
        try {
          await notificationManager.initialize();
        } catch (e) {
          console.error(`[Notification:${session.config.id}] 初始化失败:`, e);
        }

        // 初始化 FlowTask 管理器
        getFlowTaskManager(session.config.id, {
          maxConcurrency: 4,
          reportIntervalMs: 30_000,
          onProgress: async (task: FlowTask, progress: FlowTaskProgressInfo) => {
            console.log(`  [FlowTask:${task.id}] 进度: ${progress.percent}% - ${progress.step}`);
          },
          onComplete: async (task: FlowTask) => {
            console.log(`  [FlowTask:${task.id}] 完成: ${task.status}`);
          },
          onCancel: async (task: FlowTask) => {
            console.log(`  [FlowTask:${task.id}] 已取消`);
          },
          onApprovalRequest: async (task: FlowTask, request: HumanApprovalRequest) => {
            console.log(`  [FlowTask:${task.id}] 等待确认: ${request.description}`);
          },
        });

        // 启动消息轮询
        pollMessages(session, handleMessage);

      } catch (error) {
        console.error(`  ❌ 加载新 Agent ${agentConfig.name} 失败:`, error);
      }
    }
  }, CHECK_INTERVAL);

  console.log("\n🔄 动态 Agent 加载器已启动（每30秒检查新Agent）");
}
