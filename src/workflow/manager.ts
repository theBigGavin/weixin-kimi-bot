/**
 * Workflow Manager - 工作流管理器
 * 
 * 负责工作流实例的CRUD、执行调度和持久化
 */

import type {
  WorkflowInstance,
  WorkflowDefinition,
  WorkflowExecution,
  ParsedWorkflowInfo,
} from "./types.js";
import { WorkflowEngine } from "./engine.js";
import { nodeRegistry } from "./registry.js";
import { registerBuiltinNodes } from "./nodes/index.js";
import { smartParseWorkflow } from "./parser.js";
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { setSendMessageFn } from "./nodes/send.js";

export interface WorkflowManagerConfig {
  workspacePath: string;
  agentId: string;
  maxConcurrentExecutions?: number;
}

export type SendMessageFunction = (
  chatId: string,
  contextToken: string,
  text: string
) => Promise<{ success: boolean; messageId?: string }>;

/**
 * 工作流管理器
 */
export class WorkflowManager {
  private config: WorkflowManagerConfig;
  private engine: WorkflowEngine;
  private instancesDir: string;
  private executionsDir: string;
  private definitionsDir: string;
  private runningWorkflows: Map<string, WorkflowInstance> = new Map();
  private sendMessageFn?: SendMessageFunction;

  constructor(config: WorkflowManagerConfig) {
    this.config = config;
    
    // 初始化目录
    this.instancesDir = join(config.workspacePath, "workflows", "instances");
    this.executionsDir = join(config.workspacePath, "workflows", "executions");
    this.definitionsDir = join(config.workspacePath, "workflows", "definitions");
    
    this.ensureDirectories();

    // 初始化引擎
    this.engine = new WorkflowEngine({
      maxConcurrent: config.maxConcurrentExecutions || 3,
      defaultTimeout: 5 * 60 * 1000,
      onProgress: this.handleProgress.bind(this),
      onComplete: this.handleComplete.bind(this),
    });

    // 注册内置节点
    registerBuiltinNodes();

    // 加载已保存的工作流
    this.loadSavedWorkflows();
  }

  /**
   * 设置发送消息函数
   */
  setSendMessageFn(fn: SendMessageFunction): void {
    this.sendMessageFn = fn;
    setSendMessageFn(fn);
  }

  /**
   * 确保目录存在
   */
  private ensureDirectories(): void {
    for (const dir of [this.instancesDir, this.executionsDir, this.definitionsDir]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * 从自然语言创建工作流
   */
  async createFromNaturalLanguage(
    description: string,
    userId: string,
    chatId: string,
    contextToken: string,
    model?: string
  ): Promise<{ instance: WorkflowInstance; info: ParsedWorkflowInfo }> {
    // 解析自然语言
    const parsedInfo = await smartParseWorkflow(description, { model });

    // 创建工作流实例
    const instance = await this.createWorkflow(
      {
        name: parsedInfo.name,
        description: parsedInfo.description,
        cron: parsedInfo.cron,
        userId,
        chatId,
        contextToken,
        variables: {
          ...this.extractVariableDefaults(parsedInfo.variables),
          __definition: JSON.stringify({
            nodes: parsedInfo.nodes,
            connections: parsedInfo.connections,
          }),
        },
      },
      userId
    );

    return { instance, info: parsedInfo };
  }

  /**
   * 提取变量默认值
   */
  private extractVariableDefaults(
    variables: Array<{ name: string; defaultValue?: unknown }>
  ): Record<string, unknown> {
    const defaults: Record<string, unknown> = {};
    for (const v of variables) {
      if (v.defaultValue !== undefined) {
        defaults[v.name] = v.defaultValue;
      }
    }
    return defaults;
  }

  /**
   * 创建工作流实例
   */
  async createWorkflow(
    params: {
      name: string;
      description?: string;
      cron: string;
      userId: string;
      chatId: string;
      contextToken: string;
      variables?: Record<string, unknown>;
      definitionId?: string;
    },
    userId: string
  ): Promise<WorkflowInstance> {
    const instance: WorkflowInstance = {
      id: `wf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      userId,
      agentId: this.config.agentId,
      name: params.name,
      description: params.description,
      cron: params.cron,
      enabled: true,
      chatId: params.chatId,
      contextToken: params.contextToken,
      variables: params.variables || {},
      definitionId: params.definitionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      runCount: 0,
    };

    // 保存到文件
    this.saveInstance(instance);

    console.log(`[WorkflowManager] 创建工作流: ${instance.id} (${instance.name})`);

    return instance;
  }

  /**
   * 获取工作流实例
   */
  getWorkflow(workflowId: string, userId?: string): WorkflowInstance | null {
    const filePath = join(this.instancesDir, `${workflowId}.json`);
    
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const data = readFileSync(filePath, "utf-8");
      const instance: WorkflowInstance = JSON.parse(data);
      
      // 用户隔离检查
      if (userId && instance.userId !== userId) {
        return null;
      }

      return instance;
    } catch (e) {
      console.error(`[WorkflowManager] 读取工作流失败: ${workflowId}`, e);
      return null;
    }
  }

  /**
   * 获取用户的所有工作流
   */
  getUserWorkflows(userId: string): WorkflowInstance[] {
    const workflows: WorkflowInstance[] = [];

    try {
      const files = readdirSync(this.instancesDir);
      
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        
        const workflowId = file.replace(".json", "");
        const instance = this.getWorkflow(workflowId, userId);
        
        if (instance) {
          workflows.push(instance);
        }
      }
    } catch (e) {
      console.error("[WorkflowManager] 读取工作流列表失败:", e);
    }

    // 按创建时间排序
    return workflows.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 更新工作流
   */
  updateWorkflow(
    workflowId: string,
    updates: Partial<WorkflowInstance>,
    userId: string
  ): WorkflowInstance | null {
    const instance = this.getWorkflow(workflowId, userId);
    if (!instance) return null;

    // 更新字段
    Object.assign(instance, updates, { updatedAt: Date.now() });

    // 保存
    this.saveInstance(instance);

    console.log(`[WorkflowManager] 更新工作流: ${workflowId}`);

    return instance;
  }

  /**
   * 删除工作流
   */
  deleteWorkflow(workflowId: string, userId: string): boolean {
    const instance = this.getWorkflow(workflowId, userId);
    if (!instance) return false;

    const filePath = join(this.instancesDir, `${workflowId}.json`);
    
    try {
      unlinkSync(filePath);
      this.runningWorkflows.delete(workflowId);
      console.log(`[WorkflowManager] 删除工作流: ${workflowId}`);
      return true;
    } catch (e) {
      console.error(`[WorkflowManager] 删除工作流失败: ${workflowId}`, e);
      return false;
    }
  }

  /**
   * 启用/禁用工作流
   */
  toggleWorkflow(workflowId: string, userId: string): { success: boolean; enabled?: boolean } {
    const instance = this.getWorkflow(workflowId, userId);
    if (!instance) return { success: false };

    const newEnabled = !instance.enabled;
    this.updateWorkflow(workflowId, { enabled: newEnabled }, userId);

    return { success: true, enabled: newEnabled };
  }

  /**
   * 立即执行工作流
   */
  async runWorkflow(workflowId: string, userId: string): Promise<WorkflowExecution | null> {
    const instance = this.getWorkflow(workflowId, userId);
    if (!instance) return null;

    // 更新运行次数和最后运行时间
    instance.runCount++;
    instance.lastRunAt = Date.now();
    instance.lastRunStatus = "running";
    this.saveInstance(instance);

    // 执行
    const execution = await this.engine.execute(instance, "manual");

    return execution;
  }

  /**
   * 获取所有启用的工作流（用于定时调度）
   */
  getEnabledWorkflows(): WorkflowInstance[] {
    const workflows: WorkflowInstance[] = [];

    try {
      const files = readdirSync(this.instancesDir);
      
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        
        const workflowId = file.replace(".json", "");
        const instance = this.getWorkflow(workflowId);
        
        if (instance && instance.enabled) {
          workflows.push(instance);
        }
      }
    } catch (e) {
      console.error("[WorkflowManager] 读取工作流列表失败:", e);
    }

    return workflows;
  }

  /**
   * 保存实例到文件
   */
  private saveInstance(instance: WorkflowInstance): void {
    const filePath = join(this.instancesDir, `${instance.id}.json`);
    writeFileSync(filePath, JSON.stringify(instance, null, 2));
  }

  /**
   * 加载保存的工作流
   */
  private loadSavedWorkflows(): void {
    try {
      const files = readdirSync(this.instancesDir);
      console.log(`[WorkflowManager] 加载了 ${files.length} 个工作流`);
    } catch (e) {
      // 目录可能不存在
    }
  }

  /**
   * 处理进度回调
   */
  private async handleProgress(
    execution: WorkflowExecution,
    nodeRecord: { nodeId: string; status: string }
  ): Promise<void> {
    console.log(
      `[WorkflowManager] 工作流 ${execution.workflowId} 节点 ${nodeRecord.nodeId}: ${nodeRecord.status}`
    );
  }

  /**
   * 处理完成回调
   */
  private async handleComplete(execution: WorkflowExecution): Promise<void> {
    // 更新实例状态
    const instance = this.getWorkflow(execution.workflowId);
    if (instance) {
      instance.lastRunStatus = execution.status === "completed" ? "success" : "failed";
      if (execution.error) {
        instance.lastRunError = execution.error;
      }
      this.saveInstance(instance);
    }

    // 发送完成通知
    if (this.sendMessageFn && execution.triggeredBy === "cron") {
      const message = this.formatCompletionMessage(execution);
      await this.sendMessageFn(execution.workflowId, "", message);
    }

    console.log(
      `[WorkflowManager] 工作流 ${execution.workflowId} 执行完成: ${execution.status}`
    );
  }

  /**
   * 格式化完成消息
   */
  private formatCompletionMessage(execution: WorkflowExecution): string {
    const statusEmoji = execution.status === "completed" ? "✅" : "❌";
    const timeStr = new Date().toLocaleString("zh-CN");
    
    let message = `${statusEmoji} **工作流执行${execution.status === "completed" ? "完成" : "失败"}**\n\n`;
    message += `工作流: ${execution.workflowId}\n`;
    message += `时间: ${timeStr}\n`;
    message += `触发: ${execution.triggeredBy}\n`;
    
    if (execution.error) {
      message += `\n错误: ${execution.error}`;
    }

    return message;
  }

  /**
   * 获取引擎统计
   */
  getStats(): {
    totalWorkflows: number;
    runningExecutions: number;
    registeredNodeTypes: number;
  } {
    return {
      totalWorkflows: this.getEnabledWorkflows().length,
      runningExecutions: this.engine.getStats().running,
      registeredNodeTypes: nodeRegistry.getAllTypes().length,
    };
  }
}

// 管理器实例映射
const managers: Map<string, WorkflowManager> = new Map();

/**
 * 获取或创建工作流管理器
 */
export function getWorkflowManager(
  agentId: string,
  workspacePath: string
): WorkflowManager {
  if (!managers.has(agentId)) {
    managers.set(
      agentId,
      new WorkflowManager({ agentId, workspacePath })
    );
  }
  return managers.get(agentId)!;
}

/**
 * 设置发送消息函数
 */
export function setWorkflowSendMessageFn(
  agentId: string,
  fn: SendMessageFunction
): void {
  const manager = managers.get(agentId);
  if (manager) {
    manager.setSendMessageFn(fn);
  }
}
