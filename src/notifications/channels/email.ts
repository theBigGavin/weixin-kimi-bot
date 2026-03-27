/**
 * 邮件通知通道
 * 
 * 使用 nodemailer 发送邮件通知
 */
import { createTransport, Transporter, type SentMessageInfo } from "nodemailer";
import {
  type NotificationChannel,
  type NotificationMessage,
  type NotificationResult,
  type ChannelStatus,
  type EmailChannelConfig,
} from "../types.js";

export class EmailChannel implements NotificationChannel {
  readonly type = "email" as const;
  readonly id: string;
  readonly name: string;
  enabled: boolean;
  
  private config?: EmailChannelConfig;
  private transporter?: Transporter<SentMessageInfo>;
  private lastError?: string;
  private lastUsed?: number;

  constructor(config: EmailChannelConfig) {
    this.id = config.id;
    this.name = config.name;
    this.enabled = config.enabled;
    this.config = config;
  }

  async initialize(config: EmailChannelConfig): Promise<void> {
    this.config = config;
    this.enabled = config.enabled;
    
    if (!this.enabled) return;

    try {
      this.transporter = createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.secure,
        auth: {
          user: config.smtpUser,
          pass: config.smtpPass,
        },
        // 增加超时设置
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
      });

      // 验证连接
      await this.transporter.verify();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw new Error(`邮件通道初始化失败: ${this.lastError}`);
    }
  }

  async send(message: NotificationMessage): Promise<NotificationResult> {
    this.lastUsed = Date.now();
    
    if (!this.enabled || !this.transporter || !this.config) {
      return {
        success: false,
        channelId: this.id,
        error: "通道未启用或未初始化",
        timestamp: Date.now(),
      };
    }

    try {
      const result = await this.transporter.sendMail({
        from: this.config.from,
        to: this.config.to.join(", "),
        subject: message.title,
        text: message.content,
        html: `<pre style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333;">${message.content.replace(/\n/g, "<br>")}</pre>`,
      });

      return {
        success: true,
        channelId: this.id,
        messageId: result.messageId,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        channelId: this.id,
        error: this.lastError,
        timestamp: Date.now(),
      };
    }
  }

  async validate(): Promise<boolean> {
    if (!this.config) return false;
    
    // 基本字段验证
    if (!this.config.smtpHost || !this.config.smtpUser || !this.config.smtpPass) {
      return false;
    }
    if (!this.config.to || this.config.to.length === 0) {
      return false;
    }

    // 如果已初始化，验证连接
    if (this.transporter) {
      try {
        await this.transporter.verify();
        return true;
      } catch {
        return false;
      }
    }

    return true;
  }

  getStatus(): ChannelStatus {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      enabled: this.enabled,
      connected: !!this.transporter,
      lastError: this.lastError,
      lastUsed: this.lastUsed,
    };
  }

  async destroy(): Promise<void> {
    if (this.transporter) {
      this.transporter.close();
      this.transporter = undefined;
    }
  }
}

/**
 * 创建邮件通道的工厂函数
 */
export function createEmailChannel(config: EmailChannelConfig): EmailChannel {
  return new EmailChannel(config);
}
