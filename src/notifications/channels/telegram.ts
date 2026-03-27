/**
 * Telegram Bot 通知通道
 * 
 * 使用 Telegram Bot API 发送消息
 */
import {
  type NotificationChannel,
  type NotificationMessage,
  type NotificationResult,
  type ChannelStatus,
  type TelegramChannelConfig,
} from "../types.js";

export class TelegramChannel implements NotificationChannel {
  readonly type = "telegram" as const;
  readonly id: string;
  readonly name: string;
  enabled: boolean;
  
  private config?: TelegramChannelConfig;
  private lastError?: string;
  private lastUsed?: number;
  private apiBaseUrl = "https://api.telegram.org/bot";

  constructor(config: TelegramChannelConfig) {
    this.id = config.id;
    this.name = config.name;
    this.enabled = config.enabled;
    this.config = config;
  }

  async initialize(config: TelegramChannelConfig): Promise<void> {
    this.config = config;
    this.enabled = config.enabled;
    
    if (!this.enabled) return;

    // 验证配置
    if (!config.botToken || !config.chatIds || config.chatIds.length === 0) {
      throw new Error("Telegram 通道配置不完整: 需要 botToken 和 chatIds");
    }

    // 测试连接
    try {
      const isValid = await this.validate();
      if (!isValid) {
        throw new Error("无法连接到 Telegram API，请检查 botToken");
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw new Error(`Telegram 通道初始化失败: ${this.lastError}`);
    }
  }

  async send(message: NotificationMessage): Promise<NotificationResult> {
    this.lastUsed = Date.now();
    
    if (!this.enabled || !this.config) {
      return {
        success: false,
        channelId: this.id,
        error: "通道未启用或未初始化",
        timestamp: Date.now(),
      };
    }

    const results: { chatId: string; success: boolean; error?: string }[] = [];

    // 发送给所有配置的 chat
    for (const chatId of this.config.chatIds) {
      try {
        const success = await this.sendMessage(chatId, message);
        results.push({ chatId, success });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        results.push({ chatId, success: false, error: errorMsg });
      }
    }

    // 检查是否有至少一个成功
    const hasSuccess = results.some(r => r.success);
    const errors = results.filter(r => !r.success).map(r => `Chat ${r.chatId}: ${r.error}`).join("; ");

    if (hasSuccess) {
      return {
        success: true,
        channelId: this.id,
        timestamp: Date.now(),
      };
    } else {
      this.lastError = errors;
      return {
        success: false,
        channelId: this.id,
        error: errors,
        timestamp: Date.now(),
      };
    }
  }

  private async sendMessage(chatId: string, message: NotificationMessage): Promise<boolean> {
    if (!this.config) return false;

    const url = `${this.apiBaseUrl}${this.config.botToken}/sendMessage`;
    
    // 格式化消息内容
    const text = `*${this.escapeMarkdown(message.title)}*\n\n${this.escapeMarkdown(message.content)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.description || `HTTP ${response.status}`);
    }

    return true;
  }

  /**
   * 转义 MarkdownV2 特殊字符
   */
  private escapeMarkdown(text: string): string {
    // Telegram MarkdownV2 需要转义的字符: _ * [ ] ( ) ~ ` > # + - = | { } . !
    return text.replace(/([_\*\[\]\(\)~`>#\+\-=|{}\.!])/g, "\\$1");
  }

  async validate(): Promise<boolean> {
    if (!this.config?.botToken) return false;

    try {
      const url = `${this.apiBaseUrl}${this.config.botToken}/getMe`;
      const response = await fetch(url, { method: "GET" });
      
      if (!response.ok) return false;
      
      const data = await response.json();
      return data.ok === true;
    } catch {
      return false;
    }
  }

  getStatus(): ChannelStatus {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      enabled: this.enabled,
      connected: !!this.config?.botToken,
      lastError: this.lastError,
      lastUsed: this.lastUsed,
    };
  }

  /**
   * 获取 bot 信息
   */
  async getBotInfo(): Promise<{ id: number; username: string; first_name: string } | null> {
    if (!this.config?.botToken) return null;

    try {
      const url = `${this.apiBaseUrl}${this.config.botToken}/getMe`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.ok) {
        return data.result;
      }
      return null;
    } catch {
      return null;
    }
  }
}

/**
 * 创建 Telegram 通道的工厂函数
 */
export function createTelegramChannel(config: TelegramChannelConfig): TelegramChannel {
  return new TelegramChannel(config);
}
