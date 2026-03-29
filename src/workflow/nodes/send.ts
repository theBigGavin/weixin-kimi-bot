/**
 * Send Node - 发送消息节点
 * 
 * 将消息发送给用户
 */

import type { NodeHandler, NodeContext, NodeResult } from "../types.js";
import type { ApiOptions } from "../../ilink/api.js";

export interface SendNodeConfig {
  format?: "markdown" | "plain" | "html";
  prependTitle?: boolean;
  title?: string;
}

export interface SendNodeInputs {
  message: string;
  attachments?: Array<{
    type: string;
    name: string;
    content: string;
  }>;
}

export interface SendNodeOutputs extends Record<string, unknown> {
  sent: boolean;
  messageId?: string;
  timestamp: number;
}

// 发送函数类型
export type SendMessageFn = (
  chatId: string,
  contextToken: string,
  text: string
) => Promise<{ success: boolean; messageId?: string }>;

// 全局发送函数（由外部注入）
let globalSendMessageFn: SendMessageFn | null = null;

export function setSendMessageFn(fn: SendMessageFn): void {
  globalSendMessageFn = fn;
}

const sendNodeHandler: NodeHandler = {
  type: "send",
  name: "发送消息",
  description: "将消息发送给用户",
  category: "output",

  configSchema: {
    type: "object",
    title: "发送配置",
    properties: {
      format: {
        type: "string",
        title: "格式",
        enum: ["markdown", "plain", "html"],
        default: "markdown",
      },
      prependTitle: {
        type: "boolean",
        title: "添加标题",
        description: "是否在消息前添加标题",
        default: true,
      },
      title: {
        type: "string",
        title: "标题",
        description: "消息标题（可选）",
      },
    },
  },

  inputSchema: {
    type: "object",
    title: "输入",
    required: ["message"],
    properties: {
      message: {
        type: "string",
        title: "消息内容",
        description: "要发送的消息",
      },
      attachments: {
        type: "array",
        title: "附件",
        description: "附件列表（可选）",
        items: {
          type: "object",
          properties: {
            type: { type: "string" },
            name: { type: "string" },
            content: { type: "string" },
          },
        },
      },
    },
  },

  outputSchema: {
    type: "object",
    title: "输出",
    properties: {
      sent: {
        type: "boolean",
        title: "是否成功",
      },
      messageId: {
        type: "string",
        title: "消息ID",
      },
      timestamp: {
        type: "number",
        title: "时间戳",
      },
    },
  },

  async execute(context: NodeContext): Promise<NodeResult> {
    const { inputs, config, chatId, contextToken } = context;
    const message = inputs.message as string;

    if (!message || typeof message !== "string") {
      return {
        success: false,
        outputs: {},
        error: "缺少必需的输入: message",
      };
    }

    if (!globalSendMessageFn) {
      return {
        success: false,
        outputs: {},
        error: "发送函数未初始化",
      };
    }

    try {
      // 格式化消息
      let formattedMessage = message;
      
      // 添加标题
      if (config.prependTitle !== false) {
        const title = (config.title as string) || "📋 工作流执行结果";
        const timestamp = new Date().toLocaleString("zh-CN");
        formattedMessage = `${title}\n\n时间: ${timestamp}\n\n---\n\n${message}`;
      }

      console.log(`[SendNode] 发送消息到 ${chatId}, 长度: ${formattedMessage.length}`);

      // 发送消息
      const result = await globalSendMessageFn(chatId, contextToken, formattedMessage);

      const outputs: SendNodeOutputs = {
        sent: result.success,
        messageId: result.messageId,
        timestamp: Date.now(),
      };

      console.log(`[SendNode] 发送${result.success ? "成功" : "失败"}`);

      return {
        success: result.success,
        outputs,
        logs: [`发送到: ${chatId}`, `长度: ${formattedMessage.length}`, `结果: ${result.success ? "成功" : "失败"}`],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[SendNode] 发送失败: ${errorMsg}`);
      
      return {
        success: false,
        outputs: { sent: false, timestamp: Date.now() },
        error: `发送失败: ${errorMsg}`,
        logs: [`发送失败: ${errorMsg}`],
      };
    }
  },
};

export default sendNodeHandler;
