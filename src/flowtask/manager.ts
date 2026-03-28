/**
 * FlowTask 管理器
 * 
 * 整合计划生成、状态机执行、人机协作确认
 * 提供任务队列管理、进度报告、历史记录等功能
 */

import { mkdir } from "node:fs/promises";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { 
  FlowTask, 
  FlowTaskStatus, 
  ProgressInfo, 
  FlowTaskHistoryRecord, 
  FlowTaskManagerOptions,
  HumanApprovalRequest,
  HumanApprovalResponse,
  ValidatedPlan 
} from "./types.js";
import { generatePlan, formatPlanForDisplay } from "./plan-generator.js";
import { createExecutionEngine, ExecutionEngine } from "./state-machine.js";

/**
 * FlowTask 管理器类
 */
export class FlowTaskManager {
  private tasks: Map<string, FlowTask> = new Map();
  private queue: string[] = [];
  private runningCount = 0;
  private options: FlowTaskManagerOptions;
  private historyFile: string;
  private approvalCallbacks: Map<string, (response: HumanApprovalResponse) => void> = new Map();
  private activeEngines: Map<string, ExecutionEngine> = new Map();

  constructor(agentId: string, options: Partial<FlowTaskManagerOptions> = {}) {
    const baseDir = join(homedir(), ".weixin-kimi-bot", "agents", agentId);
    this.historyFile = join(baseDir, "flowtask-history.jsonl");
    
    // 确保目录存在
    mkdir(baseDir, { recursive: true }).catch(() => {});

    this.options = {
      maxConcurrency: 4,
      reportIntervalMs: 30_000,
      defaultTimeout: 10 * 60 * 1000, // 10分钟
      onProgress: async () => {},
      onComplete: async () => {},
      onCancel: async () => {},
      onApprovalRequest: async () => true,
      autoApproveLowRisk: false,
      requireApprovalFor: ["write", "shell", "human"],
      ...options,
    };
  }

  /**
   * 提交新任务
   * 
   * 流程：
   * 1. 创建任务
   * 2. 生成计划
   * 3. 验证计划
   * 4. 进入队列或开始执行
   */
  async submit(
    taskInput: Omit<FlowTask, "id" | "status" | "createdAt" | "progressLogs" | "plan" | "execution">
  ): Promise<FlowTask> {
    const id = `ft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    
    const task: FlowTask = {
      ...taskInput,
      id,
      status: "pending",
      createdAt: Date.now(),
      progressLogs: [{
        step: "等待开始",
        stepNumber: 0,
        totalSteps: 0,
        percent: 0,
        timestamp: Date.now(),
      }],
    };

    this.tasks.set(id, task);
    
    // 开始生成计划
    this.startPlanning(task);
    
    return task;
  }

  /**
   * 开始计划生成阶段
   */
  private async startPlanning(task: FlowTask): Promise<void> {
    task.status = "planning";
    task.progressLogs.push({
      step: "生成执行计划",
      stepNumber: 0,
      totalSteps: 0,
      percent: 5,
      timestamp: Date.now(),
    });

    try {
      const result = await generatePlan(task.prompt, {
        model: task.model,
        cwd: task.cwd,
        systemPrompt: task.systemPrompt,
        maxSteps: 20,
      });

      if (!result.success || !result.plan) {
        task.status = "failed";
        task.error = result.error || "计划生成失败";
        task.progressLogs.push({
          step: "计划生成失败",
          stepNumber: 0,
          totalSteps: 0,
          percent: 0,
          timestamp: Date.now(),
          detail: task.error,
        });
        await this.options.onComplete(task);
        this.saveToHistory(task);
        return;
      }

      task.plan = result.plan;
      
      // 更新进度
      task.progressLogs.push({
        step: `计划生成完成 (${result.plan.steps.length} 步骤)`,
        stepNumber: 0,
        totalSteps: result.plan.steps.length,
        percent: 10,
        timestamp: Date.now(),
        detail: `风险等级: ${result.plan.validation.riskLevel}`,
      });

      // 检查并发限制
      if (this.runningCount < this.options.maxConcurrency) {
        await this.startExecution(task);
      } else {
        this.queue.push(task.id);
        task.status = "pending";
        task.progressLogs.push({
          step: `排队中 (前面还有 ${this.queue.length - 1} 个任务)`,
          stepNumber: 0,
          totalSteps: task.plan.steps.length,
          percent: 10,
          timestamp: Date.now(),
        });
      }

    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      await this.options.onComplete(task);
      this.saveToHistory(task);
    }
  }

  /**
   * 开始执行任务
   */
  private async startExecution(task: FlowTask): Promise<void> {
    if (!task.plan) return;

    task.status = "running";
    task.startedAt = Date.now();
    this.runningCount++;

    // 创建执行引擎
    const engine = createExecutionEngine(task, {
      onProgress: async (progress) => {
        task.progressLogs.push(progress);
        await this.options.onProgress(task, progress);
      },
      onApprovalRequest: async (request) => {
        return this.handleApprovalRequest(task, request);
      },
      onAudit: (record) => {
        // 审计记录可以持久化到文件
        console.log(`[FlowTask:${task.id}] ${record.event}`);
      },
      model: task.model,
      systemPrompt: task.systemPrompt,
    });

    this.activeEngines.set(task.id, engine);

    try {
      await engine.start();
      
      // 执行完成
      task.completedAt = Date.now();
      
      // 构建结果摘要
      const execution = task.execution;
      if (execution) {
        const results = execution.stepResults;
        const successCount = results.filter(r => r.status === "success").length;
        task.result = `任务完成\n\n成功步骤: ${successCount}/${results.length}\n变更数: ${execution.changes.length}`;
      }

    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.activeEngines.delete(task.id);
      this.runningCount--;
      await this.options.onComplete(task);
      this.saveToHistory(task);
      this.processQueue();
    }
  }

  /**
   * 处理人工确认请求
   */
  private async handleApprovalRequest(
    task: FlowTask, 
    request: HumanApprovalRequest
  ): Promise<boolean | { approved: boolean; modifications?: string; feedback?: string }> {
    // 存储回调，等待用户响应
    return new Promise((resolve) => {
      // 设置超时
      const timeoutId = setTimeout(() => {
        this.approvalCallbacks.delete(request.taskId);
        resolve({ approved: false, feedback: "确认超时" });
      }, request.timeout);

      // 存储回调
      this.approvalCallbacks.set(request.taskId, (response) => {
        clearTimeout(timeoutId);
        this.approvalCallbacks.delete(request.taskId);
        resolve(response);
      });

      // 通知用户
      this.options.onApprovalRequest(task, request);
    });
  }

  /**
   * 提交人工确认响应
   */
  submitApprovalResponse(taskId: string, response: HumanApprovalResponse): boolean {
    const callback = this.approvalCallbacks.get(taskId);
    if (!callback) return false;
    
    callback(response);
    return true;
  }

  /**
   * 取消任务
   */
  async cancel(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // 从队列中移除
    const queueIndex = this.queue.indexOf(taskId);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
      task.status = "cancelled";
      task.completedAt = Date.now();
      task.progressLogs.push({
        step: "已取消 (排队中)",
        stepNumber: 0,
        totalSteps: task.plan?.steps.length || 0,
        percent: task.progressLogs[task.progressLogs.length - 1]?.percent || 0,
        timestamp: Date.now(),
      });
      await this.options.onCancel(task);
      this.saveToHistory(task);
      return true;
    }

    // 取消运行中的任务
    if (task.status === "running") {
      const engine = this.activeEngines.get(taskId);
      if (engine) {
        await engine.cancel();
      }
      task.status = "cancelled";
      task.completedAt = Date.now();
      task.progressLogs.push({
        step: "已取消 (运行中)",
        stepNumber: task.execution?.currentStep || 0,
        totalSteps: task.plan?.steps.length || 0,
        percent: task.progressLogs[task.progressLogs.length - 1]?.percent || 0,
        timestamp: Date.now(),
      });
      await this.options.onCancel(task);
      this.saveToHistory(task);
      this.runningCount--;
      this.processQueue();
      return true;
    }

    return false;
  }

  /**
   * 获取任务状态
   */
  getTask(taskId: string): FlowTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取用户的所有任务
   */
  getUserTasks(userId: string): FlowTask[] {
    return Array.from(this.tasks.values())
      .filter(t => t.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 获取运行中的任务数
   */
  getRunningCount(): number {
    return this.runningCount;
  }

  /**
   * 获取排队中的任务数
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * 处理队列中的下一个任务
   */
  private processQueue(): void {
    while (this.runningCount < this.options.maxConcurrency && this.queue.length > 0) {
      const nextId = this.queue.shift();
      if (nextId) {
        const task = this.tasks.get(nextId);
        if (task && task.status === "pending" && task.plan) {
          task.progressLogs.push({
            step: "开始执行 (排队结束)",
            stepNumber: 0,
            totalSteps: task.plan.steps.length,
            percent: 10,
            timestamp: Date.now(),
          });
          this.startExecution(task);
        }
      }
    }
  }

  /**
   * 保存任务到历史记录
   */
  private saveToHistory(task: FlowTask): void {
    try {
      const record: FlowTaskHistoryRecord = {
        id: task.id,
        agentId: task.agentId,
        userId: task.userId,
        prompt: task.prompt,
        status: task.status,
        goal: task.plan?.goal || task.prompt,
        stepsCount: task.plan?.steps.length || 0,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        result: task.result,
        error: task.error,
        riskLevel: task.plan?.validation.riskLevel || "medium",
        humanInterventions: task.execution?.audit.filter(a => 
          a.event === "human_approval_requested"
        ).length || 0,
      };
      appendFileSync(this.historyFile, JSON.stringify(record) + "\n");
    } catch (e) {
      console.error(`[FlowTask] 保存历史记录失败:`, e);
    }
  }

  /**
   * 读取历史记录
   */
  loadHistory(limit: number = 100): FlowTaskHistoryRecord[] {
    try {
      if (!existsSync(this.historyFile)) return [];
      const lines = readFileSync(this.historyFile, "utf-8")
        .split("\n")
        .filter(line => line.trim())
        .slice(-limit);
      return lines.map(line => JSON.parse(line) as FlowTaskHistoryRecord);
    } catch (e) {
      console.error(`[FlowTask] 加载历史记录失败:`, e);
      return [];
    }
  }

  /**
   * 获取任务审计日志
   */
  getAuditLog(taskId: string): unknown[] | undefined {
    const task = this.tasks.get(taskId);
    return task?.execution?.audit;
  }
}

/**
 * 格式化进度信息为用户友好的文本
 */
export function formatProgressMessage(task: FlowTask, progress: ProgressInfo): string {
  const percentBar = renderPercentBar(progress.percent);
  let msg = `🔄 **FlowTask 进度** \`${task.id}\`\n\n`;
  msg += `${percentBar} ${progress.percent}%\n`;
  msg += `步骤 ${progress.stepNumber}/${progress.totalSteps}: ${progress.step}\n`;
  
  if (progress.fileName) {
    msg += `文件: \`${progress.fileName}\`\n`;
  }
  
  if (progress.waitingForApproval) {
    msg += `\n⏸️ **等待您的确认**\n`;
  }
  
  if (progress.detail) {
    msg += `详情: ${progress.detail}\n`;
  }
  
  if (task.plan) {
    msg += `\n风险等级: ${task.plan.validation.riskLevel === "high" ? "🔴 高" : task.plan.validation.riskLevel === "medium" ? "🟡 中" : "🟢 低"}\n`;
  }
  
  msg += `\n_任务: ${task.prompt.slice(0, 40)}${task.prompt.length > 40 ? "..." : ""}_`;
  
  return msg;
}

/**
 * 格式化计划为文本（用于用户确认）
 */
export function formatPlanForUserConfirmation(task: FlowTask): string {
  if (!task.plan) {
    return `任务 \`${task.id}\` 暂无计划\n\n原始请求: ${task.prompt}`;
  }
  
  return formatPlanForDisplay(task.plan);
}

function renderPercentBar(percent: number, width = 10): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

// 全局管理器缓存：agentId -> FlowTaskManager
const managers: Map<string, FlowTaskManager> = new Map();

export function getFlowTaskManager(agentId: string, options?: Partial<FlowTaskManagerOptions>): FlowTaskManager {
  if (!managers.has(agentId)) {
    managers.set(agentId, new FlowTaskManager(agentId, options));
  }
  return managers.get(agentId)!;
}
