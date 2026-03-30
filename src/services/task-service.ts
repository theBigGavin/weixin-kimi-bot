/**
 * TaskService - 定时任务管理服务
 * 
 * 管理定时任务的创建、确认和取消流程
 * 将任务状态持久化到 Session 上下文中，而非内存
 */

import type { ScheduledTask, ParsedTaskInfo } from '../scheduler.js';
import type { SessionContext, PendingScheduledTask } from '../context/types.js';

export type { PendingScheduledTask };
import { getScheduler } from '../scheduler.js';
import { getContextManager } from '../context/index.js';

/** 确认关键词 */
const CONFIRM_KEYWORDS = ['确认', 'confirm', 'yes', '是', '好', 'ok', '确定'];
/** 取消关键词 */
const CANCEL_KEYWORDS = ['取消', 'cancel', 'no', '否', '不', '算了', '放弃'];

/**
 * TaskService - 定时任务服务
 */
export class TaskService {
  private agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  /**
   * 准备创建定时任务
   * 
   * 将任务信息存入 Session 状态，等待用户确认
   * 
   * @param sessionContext - 会话上下文
   * @param taskInfo - 解析后的任务信息
   * @param userId - 用户ID
   * @param chatId - 聊天ID
   * @param contextToken - 上下文Token
   * @returns 待确认的任务ID
   */
  async prepareCreate(
    sessionContext: SessionContext,
    taskInfo: ParsedTaskInfo,
    userId: string,
    chatId: string,
    contextToken: string
  ): Promise<string> {
    const pendingTask: PendingScheduledTask = {
      id: `pending_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: taskInfo.name,
      cron: taskInfo.cron,
      command: taskInfo.command,
      description: taskInfo.description,
      agentId: this.agentId,
      userId,
      chatId,
      contextToken,
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000, // 5分钟有效期
    };

    // 保存到 Session 状态
    sessionContext.state.data = {
      ...sessionContext.state.data,
      pendingScheduledTask: pendingTask,
    };

    // 持久化
    const contextManager = getContextManager();
    await contextManager.save(sessionContext);

    console.log(`[TaskService] 任务待确认: ${pendingTask.id}, 用户: ${userId}`);
    return pendingTask.id;
  }

  /**
   * 确认创建定时任务
   * 
   * 从 Session 状态中读取挂起任务，创建正式任务
   * 
   * @param sessionContext - 会话上下文
   * @returns 创建的任务信息，如果没有待确认任务则返回 null
   */
  async finalizeCreate(
    sessionContext: SessionContext
  ): Promise<{ success: boolean; task?: ScheduledTask; message: string }> {
    const pendingTask = this.getPendingTask(sessionContext);

    if (!pendingTask) {
      return { success: false, message: '没有待确认的任务' };
    }

    // 检查是否过期
    if (Date.now() > pendingTask.expiresAt) {
      await this.clearPendingTask(sessionContext);
      return { success: false, message: '任务确认已过期，请重新创建' };
    }

    try {
      const scheduler = getScheduler(this.agentId);
      const task = scheduler.addTask({
        name: pendingTask.name,
        cron: pendingTask.cron,
        command: pendingTask.command,
        chatId: pendingTask.chatId,
        contextToken: pendingTask.contextToken,
        enabled: true,
      });

      // 清除待确认状态
      await this.clearPendingTask(sessionContext);

      console.log(`[TaskService] 任务创建成功: ${task.id}`);
      return {
        success: true,
        task,
        message: `✅ 定时任务已创建！\n\n任务: ${task.name}\nID: \`${task.id}\``,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[TaskService] 任务创建失败:`, error);
      return { success: false, message: `创建任务失败: ${errorMsg}` };
    }
  }

  /**
   * 取消创建定时任务
   * 
   * 清除 Session 状态中的待确认任务
   * 
   * @param sessionContext - 会话上下文
   * @returns 是否成功取消
   */
  async cancelCreate(sessionContext: SessionContext): Promise<{ success: boolean; message: string }> {
    const pendingTask = this.getPendingTask(sessionContext);

    if (!pendingTask) {
      return { success: false, message: '没有待取消的任务' };
    }

    await this.clearPendingTask(sessionContext);

    console.log(`[TaskService] 任务创建已取消: ${pendingTask.id}`);
    return {
      success: true,
      message: '❌ 已取消任务创建',
    };
  }

  /**
   * 检查是否有待确认的任务
   * 
   * @param sessionContext - 会话上下文
   * @returns 是否有待确认任务
   */
  hasPendingTask(sessionContext: SessionContext): boolean {
    const pendingTask = this.getPendingTask(sessionContext);
    if (!pendingTask) return false;
    
    // 检查是否过期
    if (Date.now() > pendingTask.expiresAt) {
      // 过期了，异步清理
      this.clearPendingTask(sessionContext).catch(console.error);
      return false;
    }
    
    return true;
  }

  /**
   * 获取待确认任务信息
   * 
   * @param sessionContext - 会话上下文
   * @returns 待确认任务信息，如果没有则返回 null
   */
  getPendingTask(sessionContext: SessionContext): PendingScheduledTask | null {
    return sessionContext.state.data?.pendingScheduledTask || null;
  }

  /**
   * 检查文本是否是确认指令
   * 
   * @param text - 用户输入文本
   * @returns 是否是确认
   */
  isConfirmation(text: string): boolean {
    return isTaskConfirmation(text);
  }

  /**
   * 检查文本是否是取消指令
   * 
   * @param text - 用户输入文本
   * @returns 是否是取消
   */
  isCancellation(text: string): boolean {
    return isTaskCancellation(text);
  }

  /**
   * 检查输入是否是任务确认/取消指令
   * 
   * 使用智能匹配：优先精确匹配，其次检查关键词是否作为主要意图
   * 
   * @param text - 用户输入文本
   * @returns 指令类型: 'confirm' | 'cancel' | null
   */
  checkConfirmationIntent(text: string): 'confirm' | 'cancel' | null {
    const normalized = text.trim().toLowerCase();
    
    // 1. 首先检查精确匹配（完整短语）
    const exactConfirm = ['确认', 'confirm', 'yes', 'ok', '确定', '好的', '是的', '没问题'];
    const exactCancel = ['取消', 'cancel', 'no', '否', '不', '算了', '放弃', '不要'];
    
    if (exactConfirm.includes(normalized)) return 'confirm';
    if (exactCancel.includes(normalized)) return 'cancel';
    
    // 2. 检查是否只包含确认/取消关键词（排除其他词）
    // 例如 "好" 是确认，但 "你好" 不是
    const confirmOnly = ['好', '是', 'ok'];
    const cancelOnly = ['不', '否'];
    
    if (confirmOnly.includes(normalized)) return 'confirm';
    if (cancelOnly.includes(normalized)) return 'cancel';
    
    // 3. 检查是否以确认/取消关键词开头（如"确认创建"）
    for (const keyword of ['确认', 'confirm', '确定']) {
      if (normalized.startsWith(keyword)) return 'confirm';
    }
    for (const keyword of ['取消', 'cancel', '放弃']) {
      if (normalized.startsWith(keyword)) return 'cancel';
    }
    
    return null;
  }

  /**
   * 获取待确认任务的预览信息
   * 
   * @param sessionContext - 会话上下文
   * @returns 预览信息，如果没有待确认任务则返回 null
   */
  getPreviewInfo(sessionContext: SessionContext): { name: string; description: string; cron: string; command: string } | null {
    const pendingTask = this.getPendingTask(sessionContext);
    if (!pendingTask) return null;

    return {
      name: pendingTask.name,
      description: pendingTask.description,
      cron: pendingTask.cron,
      command: pendingTask.command,
    };
  }

  /**
   * 清理待确认任务
   * 
   * @param sessionContext - 会话上下文
   */
  private async clearPendingTask(sessionContext: SessionContext): Promise<void> {
    if (sessionContext.state.data) {
      delete sessionContext.state.data.pendingScheduledTask;
    }

    const contextManager = getContextManager();
    await contextManager.save(sessionContext);
  }
}

/**
 * 获取 TaskService 实例
 * 
 * @param agentId - Agent ID
 * @returns TaskService 实例
 */
export function getTaskService(agentId: string): TaskService {
  return new TaskService(agentId);
}

// ============ 便捷函数 ============

/**
 * 快速检查用户输入是否是任务确认指令
 * 
 * 用于在消息处理器中优先拦截确认指令
 * 
 * @param text - 用户输入
 * @returns 是否是确认指令
 */
export function isTaskConfirmation(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return CONFIRM_KEYWORDS.some(keyword => normalized === keyword.toLowerCase());
}

/**
 * 快速检查用户输入是否是任务取消指令
 * 
 * @param text - 用户输入
 * @returns 是否是取消指令
 */
export function isTaskCancellation(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return CANCEL_KEYWORDS.some(keyword => normalized === keyword.toLowerCase());
}
