/**
 * Workflow Scheduler Integration - 工作流调度集成
 * 
 * 将工作流集成到现有定时任务调度器
 */

import type { WorkflowInstance } from "./types.js";
import { getWorkflowManager, type SendMessageFunction } from "./manager.js";
import { parseCron, getNextRunTime } from "../scheduler.js";

export interface WorkflowSchedule {
  workflowId: string;
  cron: string;
  nextRun: number;
}

/**
 * 工作流调度器
 * 
 * 管理所有工作流的定时调度
 */
export class WorkflowScheduler {
  private agentId: string;
  private workspacePath: string;
  private scheduledWorkflows: Map<string, WorkflowSchedule> = new Map();
  private intervalId: NodeJS.Timeout | null = null;
  private running = false;
  private sendMessageFn?: SendMessageFunction;

  constructor(agentId: string, workspacePath: string) {
    this.agentId = agentId;
    this.workspacePath = workspacePath;
  }

  /**
   * 设置发送消息函数
   */
  setSendMessageFn(fn: SendMessageFunction): void {
    this.sendMessageFn = fn;
    getWorkflowManager(this.agentId, this.workspacePath).setSendMessageFn(fn);
  }

  /**
   * 启动调度器
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // 加载所有启用的工作流
    this.loadWorkflows();

    // 启动检查循环
    this.intervalId = setInterval(() => this.checkWorkflows(), 60 * 1000);
    
    // 立即检查一次
    this.checkWorkflows();

    console.log(`[WorkflowScheduler:${this.agentId}] 已启动，${this.scheduledWorkflows.size} 个工作流`);
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    console.log(`[WorkflowScheduler:${this.agentId}] 已停止`);
  }

  /**
   * 加载所有启用的工作流
   */
  private loadWorkflows(): void {
    const manager = getWorkflowManager(this.agentId, this.workspacePath);
    const workflows = manager.getEnabledWorkflows();

    this.scheduledWorkflows.clear();

    for (const workflow of workflows) {
      try {
        const nextRun = getNextRunTime(workflow.cron);
        this.scheduledWorkflows.set(workflow.id, {
          workflowId: workflow.id,
          cron: workflow.cron,
          nextRun,
        });
      } catch (e) {
        console.error(`[WorkflowScheduler] 无效的 cron: ${workflow.cron} for ${workflow.id}`);
      }
    }
  }

  /**
   * 检查并执行到期的工作流
   */
  private async checkWorkflows(): Promise<void> {
    const now = Date.now();
    const manager = getWorkflowManager(this.agentId, this.workspacePath);

    for (const [workflowId, schedule] of this.scheduledWorkflows) {
      if (schedule.nextRun <= now) {
        // 执行工作流
        const workflow = manager.getWorkflow(workflowId);
        if (workflow && workflow.enabled) {
          console.log(`[WorkflowScheduler] 执行工作流: ${workflow.name}`);
          
          try {
            await manager.runWorkflow(workflowId, workflow.userId);
          } catch (e) {
            console.error(`[WorkflowScheduler] 执行失败: ${workflowId}`, e);
          }
        }

        // 更新下次执行时间
        try {
          schedule.nextRun = getNextRunTime(schedule.cron, now);
        } catch {
          this.scheduledWorkflows.delete(workflowId);
        }
      }
    }
  }

  /**
   * 添加工作流到调度
   */
  scheduleWorkflow(workflow: WorkflowInstance): void {
    try {
      const nextRun = getNextRunTime(workflow.cron);
      this.scheduledWorkflows.set(workflow.id, {
        workflowId: workflow.id,
        cron: workflow.cron,
        nextRun,
      });
      console.log(`[WorkflowScheduler] 添加调度: ${workflow.name}`);
    } catch (e) {
      console.error(`[WorkflowScheduler] 无法调度: ${workflow.id}`, e);
    }
  }

  /**
   * 从调度中移除工作流
   */
  unscheduleWorkflow(workflowId: string): void {
    this.scheduledWorkflows.delete(workflowId);
    console.log(`[WorkflowScheduler] 移除调度: ${workflowId}`);
  }

  /**
   * 获取调度信息
   */
  getSchedule(workflowId: string): WorkflowSchedule | undefined {
    return this.scheduledWorkflows.get(workflowId);
  }

  /**
   * 获取所有调度
   */
  getAllSchedules(): WorkflowSchedule[] {
    return Array.from(this.scheduledWorkflows.values());
  }

  /**
   * 刷新调度（重新加载所有工作流）
   */
  refresh(): void {
    this.loadWorkflows();
    console.log(`[WorkflowScheduler] 已刷新，${this.scheduledWorkflows.size} 个工作流`);
  }
}

// 调度器实例映射
const schedulers: Map<string, WorkflowScheduler> = new Map();

/**
 * 获取或创建工作流调度器
 */
export function getWorkflowScheduler(
  agentId: string,
  workspacePath: string
): WorkflowScheduler {
  if (!schedulers.has(agentId)) {
    schedulers.set(agentId, new WorkflowScheduler(agentId, workspacePath));
  }
  return schedulers.get(agentId)!;
}

/**
 * 启动所有调度器
 */
export function startAllWorkflowSchedulers(): void {
  for (const scheduler of schedulers.values()) {
    scheduler.start();
  }
}

/**
 * 停止所有调度器
 */
export function stopAllWorkflowSchedulers(): void {
  for (const scheduler of schedulers.values()) {
    scheduler.stop();
  }
}

/**
 * 移除调度器
 */
export function removeWorkflowScheduler(agentId: string): void {
  const scheduler = schedulers.get(agentId);
  if (scheduler) {
    scheduler.stop();
    schedulers.delete(agentId);
  }
}
