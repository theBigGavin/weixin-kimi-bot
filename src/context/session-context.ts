/**
 * 会话上下文管理器
 * 
 * 管理用户会话的创建、获取、更新和持久化
 */

import {
  SessionContext,
  ContextMessage,
  Option,
  ConversationState,
  StateContext,
  PendingDecision,
  StructuredContent,
  SessionMetadata,
  Intent,
} from './types.js';
import { ContextPersistence } from './persistence.js';

/** 最大消息历史长度 */
const MAX_MESSAGES = 20;
/** 最大活跃选项数 */
const MAX_ACTIVE_OPTIONS = 10;
/** 选项过期时间（毫秒） */
const OPTION_EXPIRY_MS = 30 * 60 * 1000; // 30分钟

/**
 * 会话上下文管理器
 */
export class SessionContextManager {
  /** 内存缓存 */
  private contexts: Map<string, SessionContext> = new Map();
  /** 持久化层 */
  private persistence: ContextPersistence;

  constructor(persistence: ContextPersistence) {
    this.persistence = persistence;
  }

  /**
   * 获取或创建会话上下文
   * 
   * 1. 先查内存缓存
   * 2. 再查持久化存储
   * 3. 创建新的上下文
   */
  async getOrCreate(userId: string, agentId: string): Promise<SessionContext> {
    const key = this.makeKey(userId, agentId);

    // 1. 查内存缓存
    let context = this.contexts.get(key);
    if (context) {
      context.metadata.lastActiveAt = Date.now();
      return context;
    }

    // 2. 查持久化存储
    const persistedContext = await this.persistence.load(userId, agentId);
    if (persistedContext) {
      // 恢复Map对象（JSON反序列化后变成普通对象）
      persistedContext.activeOptions = this.restoreMap(persistedContext.activeOptions);
      this.contexts.set(key, persistedContext);
      console.log(`[Context] 从持久化加载会话: ${key}`);
      return persistedContext;
    }

    // 3. 创建新的上下文
    const newContext = this.createNew(userId, agentId);
    this.contexts.set(key, newContext);
    console.log(`[Context] 创建新会话: ${key}`);
    return newContext;
  }

  /**
   * 保存上下文
   * 
   * 同时更新内存缓存和持久化存储
   */
  async save(context: SessionContext): Promise<void> {
    context.updatedAt = Date.now();
    context.metadata.lastActiveAt = Date.now();

    // 内存缓存
    const key = this.makeKey(context.userId, context.agentId);
    this.contexts.set(key, context);

    // 持久化（异步，不阻塞）
    this.persistence.save(context).catch((err) => {
      console.error(`[Context] 持久化失败: ${key}`, err);
    });
  }

  /**
   * 添加用户或AI消息
   */
  async addMessage(
    context: SessionContext,
    role: 'user' | 'assistant',
    content: string,
    structuredContent?: StructuredContent,
    intent?: Intent
  ): Promise<ContextMessage> {
    const message: ContextMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      role,
      content,
      timestamp: Date.now(),
      structuredContent,
      intent,
    };

    context.messages.push(message);
    context.metadata.totalMessages++;

    // 限制历史长度
    if (context.messages.length > MAX_MESSAGES) {
      context.messages = context.messages.slice(-MAX_MESSAGES);
    }

    await this.save(context);
    return message;
  }

  /**
   * 添加活跃选项
   * 
   * 用于存储AI提供的选项，便于后续指代消解
   */
  async addOptions(context: SessionContext, options: Option[]): Promise<void> {
    for (const option of options) {
      context.activeOptions.set(option.id, option);
    }

    // 限制数量，删除最旧的
    if (context.activeOptions.size > MAX_ACTIVE_OPTIONS) {
      const entries = Array.from(context.activeOptions.entries());
      // 按创建时间排序
      entries.sort((a, b) => a[1].createdAt - b[1].createdAt);
      // 删除超出的
      const toRemove = entries.slice(0, entries.length - MAX_ACTIVE_OPTIONS);
      for (const [key] of toRemove) {
        context.activeOptions.delete(key);
      }
    }

    await this.save(context);
  }

  /**
   * 获取活跃选项
   */
  getOptions(context: SessionContext): Option[] {
    return Array.from(context.activeOptions.values());
  }

  /**
   * 获取指定选项
   */
  getOption(context: SessionContext, optionId: string): Option | undefined {
    return context.activeOptions.get(optionId);
  }

  /**
   * 清除所有活跃选项
   */
  async clearOptions(context: SessionContext): Promise<void> {
    context.activeOptions.clear();
    await this.save(context);
  }

  /**
   * 更新对话状态
   */
  async updateState(
    context: SessionContext,
    newState: ConversationState,
    data?: Record<string, any>
  ): Promise<void> {
    context.state.previous = context.state.current;
    context.state.current = newState;

    if (data) {
      context.state.data = { ...context.state.data, ...data };
    }

    // 更新期望输入类型
    context.state.expectedInput = this.inferExpectedInput(newState);

    console.log(`[Context] 状态转移: ${context.state.previous} -> ${newState}`);
    await this.save(context);
  }

  /**
   * 设置当前主题
   */
  async setTopic(context: SessionContext, topic: string): Promise<void> {
    context.state.topic = topic;
    await this.save(context);
  }

  /**
   * 设置待决策事项
   */
  async setPendingDecision(
    context: SessionContext,
    decision: PendingDecision
  ): Promise<void> {
    context.state.pendingDecision = decision;
    context.state.expectedInput = {
      type: decision.type === 'select_option' ? 'select_option' :
            decision.type === 'confirm_action' ? 'confirm' : 'provide_info',
      description: decision.description,
      options: decision.options,
    };
    await this.save(context);
  }

  /**
   * 清除待决策事项
   */
  async clearPendingDecision(context: SessionContext): Promise<void> {
    context.state.pendingDecision = undefined;
    context.state.expectedInput = this.inferExpectedInput(context.state.current);
    await this.save(context);
  }

  /**
   * 设置当前任务
   */
  async setCurrentTask(
    context: SessionContext,
    taskId: string,
    taskType: 'longtask' | 'flowtask' = 'longtask'
  ): Promise<void> {
    if (taskType === 'longtask') {
      context.currentTaskId = taskId;
    } else {
      context.currentFlowTaskId = taskId;
    }
    await this.save(context);
  }

  /**
   * 清除当前任务
   */
  async clearCurrentTask(
    context: SessionContext,
    taskType: 'longtask' | 'flowtask' = 'longtask'
  ): Promise<void> {
    if (taskType === 'longtask') {
      context.currentTaskId = undefined;
    } else {
      context.currentFlowTaskId = undefined;
    }
    await this.save(context);
  }

  /**
   * 压入话题栈
   */
  async pushTopic(
    context: SessionContext,
    topic: { id: string; label: string; description: string }
  ): Promise<void> {
    context.topicStack.push({
      ...topic,
      createdAt: Date.now(),
    });
    await this.save(context);
  }

  /**
   * 弹出话题栈
   */
  async popTopic(context: SessionContext): Promise<void> {
    context.topicStack.pop();
    await this.save(context);
  }

  /**
   * 获取当前话题
   */
  getCurrentTopic(context: SessionContext): string {
    return context.state.topic;
  }

  /**
   * 清理过期选项
   * 
   * 选项超过30分钟未使用则自动清理
   */
  async cleanupExpiredOptions(context: SessionContext): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, option] of context.activeOptions) {
      if (now - option.createdAt > OPTION_EXPIRY_MS) {
        context.activeOptions.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      await this.save(context);
    }

    return cleaned;
  }

  /**
   * 获取会话统计信息
   */
  getStats(context: SessionContext): {
    messageCount: number;
    optionCount: number;
    topicDepth: number;
    duration: number;
  } {
    return {
      messageCount: context.metadata.totalMessages,
      optionCount: context.activeOptions.size,
      topicDepth: context.topicStack.length,
      duration: Date.now() - context.createdAt,
    };
  }

  /**
   * 重置会话
   * 
   * 保留基本结构，清除所有状态和数据
   */
  async reset(context: SessionContext): Promise<void> {
    context.state = {
      current: ConversationState.IDLE,
      topic: '',
    };
    context.messages = [];
    context.activeOptions.clear();
    context.currentTaskId = undefined;
    context.currentFlowTaskId = undefined;
    context.topicStack = [];
    context.metadata.totalMessages = 0;
    context.metadata.isNewSession = true;

    await this.save(context);
    console.log(`[Context] 会话已重置: ${this.makeKey(context.userId, context.agentId)}`);
  }

  /**
   * 删除会话
   */
  async delete(userId: string, agentId: string): Promise<void> {
    const key = this.makeKey(userId, agentId);
    this.contexts.delete(key);
    await this.persistence.delete(userId, agentId);
    console.log(`[Context] 会话已删除: ${key}`);
  }

  // ============ 私有方法 ============

  /**
   * 创建新的会话上下文
   */
  private createNew(userId: string, agentId: string): SessionContext {
    const now = Date.now();
    return {
      id: `ctx_${now}_${Math.random().toString(36).slice(2, 7)}`,
      userId,
      agentId,
      createdAt: now,
      updatedAt: now,
      state: {
        current: ConversationState.IDLE,
        topic: '',
      },
      messages: [],
      activeOptions: new Map(),
      topicStack: [],
      metadata: {
        totalMessages: 0,
        lastActiveAt: now,
        isNewSession: true,
        version: '1.0',
      },
    };
  }

  /**
   * 生成缓存键
   */
  private makeKey(userId: string, agentId: string): string {
    return `${agentId}:${userId}`;
  }

  /**
   * 恢复Map对象
   * 
   * JSON反序列化后Map变成普通对象，需要恢复
   */
  private restoreMap(mapData: any): Map<string, Option> {
    if (mapData instanceof Map) {
      return mapData;
    }
    if (typeof mapData === 'object' && mapData !== null) {
      return new Map(Object.entries(mapData));
    }
    return new Map();
  }

  /**
   * 推断期望的输入类型
   */
  private inferExpectedInput(state: ConversationState): ExpectedInputType {
    switch (state) {
      case ConversationState.PROPOSING:
        return {
          type: 'select_option',
          description: '请从提供的选项中选择一个',
        };
      case ConversationState.CONFIRMING:
        return {
          type: 'confirm',
          description: '请确认或拒绝',
        };
      case ConversationState.CLARIFYING:
        return {
          type: 'provide_info',
          description: '请提供更多信息',
        };
      case ConversationState.PLANNING:
        return {
          type: 'confirm',
          description: '请确认执行计划',
        };
      default:
        return {
          type: 'free_text',
          description: '请输入您想说的',
        };
    }
  }
}

// 导入ExpectedInputType
import { ExpectedInputType } from './types.js';
