/**
 * 通知通道类型定义
 */

export type NotificationChannelType = "email" | "telegram" | "wechat" | "webhook" | "slack" | "dingtalk";

export interface NotificationMessage {
  title: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface BaseChannelConfig {
  id: string;
  name: string;
  type: NotificationChannelType;
  enabled: boolean;
  createdAt: number;
}

export interface EmailChannelConfig extends BaseChannelConfig {
  type: "email";
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  from: string;
  to: string[];
  secure: boolean;
}

export interface TelegramChannelConfig extends BaseChannelConfig {
  type: "telegram";
  botToken: string;
  chatIds: string[];
}

export interface WechatChannelConfig extends BaseChannelConfig {
  type: "wechat";
  webhookUrl: string;
}

export interface WebhookChannelConfig extends BaseChannelConfig {
  type: "webhook";
  url: string;
  method: "GET" | "POST" | "PUT";
  headers?: Record<string, string>;
}

export type ChannelConfig = 
  | EmailChannelConfig 
  | TelegramChannelConfig 
  | WechatChannelConfig 
  | WebhookChannelConfig;

/**
 * 通知通道接口 - 所有通道必须实现
 */
export interface NotificationChannel {
  readonly id: string;
  readonly name: string;
  readonly type: NotificationChannelType;
  readonly enabled: boolean;
  
  /**
   * 初始化通道
   */
  initialize(config: ChannelConfig): Promise<void>;
  
  /**
   * 发送通知
   */
  send(message: NotificationMessage): Promise<NotificationResult>;
  
  /**
   * 验证配置是否有效
   */
  validate(): Promise<boolean>;
  
  /**
   * 获取通道状态
   */
  getStatus(): ChannelStatus;
  
  /**
   * 销毁/清理资源
   */
  destroy?(): Promise<void>;
}

export interface NotificationResult {
  success: boolean;
  channelId: string;
  messageId?: string;
  error?: string;
  timestamp: number;
}

export interface ChannelStatus {
  id: string;
  name: string;
  type: NotificationChannelType;
  enabled: boolean;
  connected: boolean;
  lastError?: string;
  lastUsed?: number;
}

/**
 * 通道工厂函数类型
 */
export type ChannelFactory = (config: ChannelConfig) => NotificationChannel;
