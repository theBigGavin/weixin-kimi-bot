/**
 * 通知通道模块
 * 
 * 提供可扩展的通知通道管理能力
 * 
 * 使用示例：
 * ```typescript
 * import { notificationManager, createEmailChannel, createTelegramChannel } from './notifications/index.js';
 * 
 * // 初始化
 * await notificationManager.initialize();
 * 
 * // 添加邮件通道
 * await notificationManager.addChannel({
 *   id: "email-1",
 *   name: "我的邮箱",
 *   type: "email",
 *   enabled: true,
 *   smtpHost: "smtp.gmail.com",
 *   smtpPort: 587,
 *   smtpUser: "user@gmail.com",
 *   smtpPass: "password",
 *   from: "user@gmail.com",
 *   to: ["recipient@example.com"],
 *   secure: false,
 * });
 * 
 * // 添加 Telegram 通道
 * await notificationManager.addChannel({
 *   id: "telegram-1",
 *   name: "我的 Telegram",
 *   type: "telegram",
 *   enabled: true,
 *   botToken: "YOUR_BOT_TOKEN",
 *   chatIds: ["YOUR_CHAT_ID"],
 * });
 * 
 * // 发送通知
 * await notificationManager.sendToAll({
 *   title: "定时任务执行完成",
 *   content: "任务执行结果...",
 *   timestamp: Date.now(),
 * });
 * ```
 */

// 类型导出
export type {
  NotificationChannel,
  NotificationMessage,
  NotificationResult,
  ChannelStatus,
  ChannelConfig,
  EmailChannelConfig,
  TelegramChannelConfig,
  WechatChannelConfig,
  WebhookChannelConfig,
  NotificationChannelType,
  ChannelFactory,
} from "./types.js";

// 通道导出
export { EmailChannel, createEmailChannel } from "./channels/email.js";
export { TelegramChannel, createTelegramChannel } from "./channels/telegram.js";

// 管理器导出
export { 
  NotificationManager, 
  notificationManager,
  getNotificationManager,
  removeNotificationManager,
  registerChannelType 
} from "./manager.js";
