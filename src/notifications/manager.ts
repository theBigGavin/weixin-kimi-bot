/**
 * 通知通道管理器
 * 
 * 管理所有通知通道的生命周期和消息发送
 * 
 * 支持多Agent隔离：每个Agent有独立的通知通道配置
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import {
  type NotificationChannel,
  type NotificationMessage,
  type NotificationResult,
  type ChannelConfig,
  type ChannelStatus,
  type NotificationChannelType,
} from "./types.js";
import { createEmailChannel, createTelegramChannel } from "./channels/index.js";

const BASE_DIR = join(homedir(), ".weixin-kimi-bot");

/**
 * 获取通知通道文件路径
 * 支持全局或Agent级别
 */
function getChannelsFilePath(agentId?: string): string {
  if (agentId) {
    return join(BASE_DIR, "agents", agentId, "notification-channels.json");
  }
  // 默认使用全局路径（向后兼容）
  return process.env.NOTIFICATION_CHANNELS_FILE || 
    join(BASE_DIR, "notification-channels.json");
}

/**
 * 通道工厂注册表
 */
const channelFactories: Record<NotificationChannelType, (config: any) => NotificationChannel> = {
  email: createEmailChannel,
  telegram: createTelegramChannel,
  wechat: () => { throw new Error("微信通道尚未实现"); },
  webhook: () => { throw new Error("Webhook 通道尚未实现"); },
  slack: () => { throw new Error("Slack 通道尚未实现"); },
  dingtalk: () => { throw new Error("钉钉通道尚未实现"); },
};

/**
 * 注册新的通道类型（用于扩展）
 */
export function registerChannelType(
  type: NotificationChannelType,
  factory: (config: ChannelConfig) => NotificationChannel
): void {
  channelFactories[type] = factory;
  console.log(`[NotificationManager] 已注册通道类型: ${type}`);
}

/**
 * 通知通道管理器
 * 
 * 每个Agent应该使用独立的NotificationManager实例
 */
export class NotificationManager {
  private channels: Map<string, NotificationChannel> = new Map();
  private initialized = false;
  private channelsFile: string;
  private agentId?: string;

  constructor(agentId?: string, channelsFile?: string) {
    this.agentId = agentId;
    this.channelsFile = channelsFile || getChannelsFilePath(agentId);
  }

  /**
   * 获取当前Agent ID
   */
  getAgentId(): string | undefined {
    return this.agentId;
  }

  /**
   * 初始化管理器，加载所有通道
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 确保目录存在
    const dir = dirname(this.channelsFile);
    await mkdir(dir, { recursive: true });

    // 加载通道配置
    await this.loadChannels();
    
    this.initialized = true;
    
    const agentInfo = this.agentId ? ` (Agent: ${this.agentId})` : "";
    console.log(`[NotificationManager${agentInfo}] 已初始化，加载了 ${this.channels.size} 个通道`);
  }

  /**
   * 加载通道配置
   */
  private async loadChannels(): Promise<void> {
    if (!existsSync(this.channelsFile)) {
      // 兼容旧版本：如果全局文件存在，先读取它
      const globalFile = getChannelsFilePath();
      if (existsSync(globalFile) && this.agentId) {
        console.log(`[NotificationManager] 迁移全局通知配置到 Agent ${this.agentId}`);
        await this.migrateFromGlobal(globalFile);
      }
      return;
    }

    try {
      const data = readFileSync(this.channelsFile, "utf-8");
      const configs: ChannelConfig[] = JSON.parse(data);

      for (const config of configs) {
        await this.addChannelFromConfig(config, false);
      }
    } catch (error) {
      console.error("[NotificationManager] 加载通道配置失败:", error);
    }
  }

  /**
   * 从全局配置迁移
   */
  private async migrateFromGlobal(globalFile: string): Promise<void> {
    try {
      const data = readFileSync(globalFile, "utf-8");
      const configs: ChannelConfig[] = JSON.parse(data);
      
      for (const config of configs) {
        await this.addChannelFromConfig(config, true);
      }
      
      console.log(`[NotificationManager] 已迁移 ${configs.length} 个通道`);
    } catch (error) {
      console.error("[NotificationManager] 迁移全局配置失败:", error);
    }
  }

  /**
   * 保存通道配置
   */
  private async saveChannels(): Promise<void> {
    try {
      const configs: ChannelConfig[] = [];
      
      for (const channel of this.channels.values()) {
        // 这里应该存储原始配置，但为了简化，我们假设配置在创建时已经保存
      }
      
      // 从文件读取现有配置并更新
      let existingConfigs: ChannelConfig[] = [];
      if (existsSync(this.channelsFile)) {
        const data = readFileSync(this.channelsFile, "utf-8");
        existingConfigs = JSON.parse(data);
      }

      writeFileSync(this.channelsFile, JSON.stringify(existingConfigs, null, 2));
    } catch (error) {
      console.error("[NotificationManager] 保存通道配置失败:", error);
    }
  }

  /**
   * 添加新通道
   */
  async addChannel(config: ChannelConfig): Promise<NotificationChannel> {
    return this.addChannelFromConfig(config, true);
  }

  private async addChannelFromConfig(config: ChannelConfig, save: boolean): Promise<NotificationChannel> {
    const factory = channelFactories[config.type];
    if (!factory) {
      throw new Error(`未知的通道类型: ${config.type}`);
    }

    const channel = factory(config);
    
    // 初始化通道
    if (config.enabled) {
      try {
        await channel.initialize(config);
      } catch (error) {
        console.error(`[NotificationManager] 初始化通道 ${config.id} 失败:`, error);
        // 继续添加，但标记为未启用
        config.enabled = false;
      }
    }

    this.channels.set(config.id, channel);

    if (save) {
      await this.appendChannelConfig(config);
    }

    return channel;
  }

  /**
   * 添加通道配置到文件
   */
  private async appendChannelConfig(config: ChannelConfig): Promise<void> {
    try {
      let configs: ChannelConfig[] = [];
      if (existsSync(this.channelsFile)) {
        const data = readFileSync(this.channelsFile, "utf-8");
        configs = JSON.parse(data);
      }

      // 检查是否已存在
      const index = configs.findIndex(c => c.id === config.id);
      if (index >= 0) {
        configs[index] = config;
      } else {
        configs.push(config);
      }

      // 确保目录存在
      await mkdir(dirname(this.channelsFile), { recursive: true });
      writeFileSync(this.channelsFile, JSON.stringify(configs, null, 2));
    } catch (error) {
      console.error("[NotificationManager] 保存通道配置失败:", error);
    }
  }

  /**
   * 删除通道
   */
  async removeChannel(channelId: string): Promise<boolean> {
    const channel = this.channels.get(channelId);
    if (!channel) return false;

    // 销毁通道资源
    if (channel.destroy) {
      await channel.destroy();
    }

    this.channels.delete(channelId);

    // 更新配置文件
    try {
      if (existsSync(this.channelsFile)) {
        const data = readFileSync(this.channelsFile, "utf-8");
        const allConfigs: ChannelConfig[] = JSON.parse(data);
        const filtered = allConfigs.filter(c => c.id !== channelId);
        writeFileSync(this.channelsFile, JSON.stringify(filtered, null, 2));
      }
    } catch (error) {
      console.error("[NotificationManager] 更新通道配置失败:", error);
    }

    return true;
  }

  /**
   * 获取通道
   */
  getChannel(channelId: string): NotificationChannel | undefined {
    return this.channels.get(channelId);
  }

  /**
   * 获取所有通道
   */
  getAllChannels(): NotificationChannel[] {
    return Array.from(this.channels.values());
  }

  /**
   * 获取所有通道状态
   */
  getAllStatuses(): ChannelStatus[] {
    return this.getAllChannels().map(c => c.getStatus());
  }

  /**
   * 启用/禁用通道
   */
  async toggleChannel(channelId: string, enabled: boolean): Promise<boolean> {
    const channel = this.channels.get(channelId);
    if (!channel) return false;

    // 重新加载配置并初始化
    try {
      if (existsSync(this.channelsFile)) {
        const data = readFileSync(this.channelsFile, "utf-8");
        const allConfigs: ChannelConfig[] = JSON.parse(data);
        const config = allConfigs.find(c => c.id === channelId);
        
        if (config) {
          config.enabled = enabled;
          
          // 重新初始化
          (channel as any).enabled = enabled;
          if (enabled) {
            await channel.initialize(config);
          } else if (channel.destroy) {
            await channel.destroy();
          }

          // 保存配置
          writeFileSync(this.channelsFile, JSON.stringify(allConfigs, null, 2));
          return true;
        }
      }
    } catch (error) {
      console.error("[NotificationManager] 切换通道状态失败:", error);
    }

    return false;
  }

  /**
   * 发送通知到指定通道
   */
  async sendToChannel(channelId: string, message: NotificationMessage): Promise<NotificationResult> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return {
        success: false,
        channelId,
        error: "通道不存在",
        timestamp: Date.now(),
      };
    }

    if (!channel.enabled) {
      return {
        success: false,
        channelId,
        error: "通道已禁用",
        timestamp: Date.now(),
      };
    }

    return channel.send(message);
  }

  /**
   * 发送通知到所有启用的通道
   */
  async sendToAll(message: NotificationMessage): Promise<NotificationResult[]> {
    const enabledChannels = this.getAllChannels().filter(c => c.enabled);
    
    if (enabledChannels.length === 0) {
      return [{
        success: false,
        channelId: "all",
        error: "没有启用的通知通道",
        timestamp: Date.now(),
      }];
    }

    const results = await Promise.all(
      enabledChannels.map(channel => channel.send(message))
    );

    return results;
  }

  /**
   * 关闭管理器
   */
  async shutdown(): Promise<void> {
    for (const channel of this.channels.values()) {
      if (channel.destroy) {
        await channel.destroy();
      }
    }
    this.channels.clear();
    this.initialized = false;
  }
}

// ============ Agent隔离的通知管理器 ============

const managers: Map<string, NotificationManager> = new Map();

/**
 * 获取或创建Agent的通知管理器
 * 
 * 如果没有指定agentId，返回全局管理器（向后兼容）
 */
export function getNotificationManager(agentId?: string): NotificationManager {
  if (!agentId) {
    // 尝试从环境变量获取
    agentId = process.env.ACTIVE_AGENT_ID;
  }
  
  const key = agentId || "global";
  
  if (!managers.has(key)) {
    managers.set(key, new NotificationManager(agentId));
  }
  
  return managers.get(key)!;
}

/**
 * 移除Agent的通知管理器
 */
export function removeNotificationManager(agentId: string): void {
  const manager = managers.get(agentId);
  if (manager) {
    manager.shutdown();
    managers.delete(agentId);
  }
}

// 导出单例（向后兼容，使用全局管理器）
export const notificationManager = getNotificationManager();
