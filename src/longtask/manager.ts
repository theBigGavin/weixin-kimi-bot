/**
 * 耗时任务管理器
 * 
 * 负责：
 * - 任务队列管理
 * - 并发控制
 * - 进度跟踪与报告
 * - 历史记录持久化
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { LongTask, LongTaskStatus, ProgressInfo, LongTaskHistoryRecord, LongTaskManagerOptions } from "./types.js";
import { parseProgress, formatProgressMessage } from "./parser.js";

export class LongTaskManager {
  private tasks: Map<string, LongTask> = new Map();
  private queue: string[] = [];
  private runningCount = 0;
  private options: LongTaskManagerOptions;
  private reportTimers: Map<string, NodeJS.Timeout> = new Map();
  private historyFile: string;

  constructor(agentId: string, options: Partial<LongTaskManagerOptions> = {}) {
    const baseDir = join(process.env.HOME || "/tmp", ".weixin-kimi-bot", "agents", agentId);
    this.historyFile = join(baseDir, "longtask-history.jsonl");
    
    // 确保目录存在
    mkdir(baseDir, { recursive: true }).catch(() => {});

    this.options = {
      maxConcurrency: 5,
      reportIntervalMs: 30_000,
      onProgress: async () => {},
      onComplete: async () => {},
      onCancel: async () => {},
      ...options,
    };
  }

  /**
   * 提交新任务
   */
  submit(task: Omit<LongTask, "id" | "status" | "createdAt" | "progressLogs">): LongTask {
    const id = `lt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const fullTask: LongTask = {
      ...task,
      id,
      status: "pending",
      createdAt: Date.now(),
      progressLogs: [{
        step: "等待开始",
        percent: 0,
        timestamp: Date.now(),
      }],
    };

    this.tasks.set(id, fullTask);

    if (this.runningCount < this.options.maxConcurrency) {
      this.startTask(id);
    } else {
      this.queue.push(id);
      fullTask.progressLogs.push({
        step: `排队中 (前面还有 ${this.queue.length - 1} 个任务)`,
        percent: 0,
        timestamp: Date.now(),
      });
    }

    return fullTask;
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
        percent: 0,
        timestamp: Date.now(),
      });
      await this.options.onCancel(task);
      this.saveToHistory(task);
      return true;
    }

    // 终止运行中的进程
    if (task.status === "running" && task.childPid) {
      try {
        process.kill(task.childPid, "SIGTERM");
        // 5秒后强制杀死
        setTimeout(() => {
          try {
            process.kill(task.childPid!, "SIGKILL");
          } catch {
            // 可能已经退出了
          }
        }, 5000);
      } catch {
        // 进程可能已经退出
      }
      task.status = "cancelled";
      task.completedAt = Date.now();
      task.progressLogs.push({
        step: "已取消 (运行中)",
        percent: task.progressLogs[task.progressLogs.length - 1]?.percent || 0,
        timestamp: Date.now(),
      });
      this.clearReportTimer(taskId);
      this.runningCount--;
      await this.options.onCancel(task);
      this.saveToHistory(task);
      this.processQueue();
      return true;
    }

    return false;
  }

  /**
   * 获取任务状态
   */
  getTask(taskId: string): LongTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取用户的所有任务
   */
  getUserTasks(userId: string): LongTask[] {
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
   * 获取报告间隔（秒）
   */
  getReportIntervalSec(): number {
    return Math.round(this.options.reportIntervalMs / 1000);
  }

  /**
   * 启动任务
   */
  private startTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = "running";
    task.startedAt = Date.now();
    task.progressLogs.push({
      step: "开始执行",
      percent: 1,
      timestamp: Date.now(),
    });
    this.runningCount++;

    // 构建 Kimi 参数
    const args: string[] = ["--quiet"];
    if (task.model) {
      args.push("--model", task.model);
    }
    if (task.maxTurns) {
      args.push("--max-steps-per-turn", String(task.maxTurns));
    }

    let finalPrompt = task.prompt;
    if (task.systemPrompt) {
      finalPrompt = `${task.systemPrompt}\n\n=== 用户消息 ===\n\n${task.prompt}`;
    }
    args.push("--prompt", finalPrompt);

    const child = spawn("kimi", args, {
      cwd: task.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    task.childPid = child.pid;

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let turnEstimate = 1;

    // 进度报告定时器
    const reportTimer = setInterval(async () => {
      turnEstimate++;
      const combinedOutput = Buffer.concat(stdout).toString("utf-8") + "\n" + Buffer.concat(stderr).toString("utf-8");
      const progress = parseProgress(combinedOutput, task.maxTurns, turnEstimate);
      task.progressLogs.push(progress);
      
      if (task.status === "running") {
        await this.options.onProgress(task, progress);
      }
    }, this.options.reportIntervalMs);

    this.reportTimers.set(taskId, reportTimer);

    child.stdout.on("data", (data: Buffer) => {
      stdout.push(data);
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr.push(data);
    });

    child.on("error", async (err) => {
      this.clearReportTimer(taskId);
      task.status = "failed";
      task.error = `启动失败: ${err.message}`;
      task.completedAt = Date.now();
      this.runningCount--;
      await this.options.onComplete(task);
      this.saveToHistory(task);
      this.processQueue();
    });

    child.on("close", async (code) => {
      this.clearReportTimer(taskId);
      const output = Buffer.concat(stdout).toString("utf-8");
      const errorOutput = Buffer.concat(stderr).toString("utf-8");
      
      if (task.status === "cancelled") {
        this.runningCount--;
        this.processQueue();
        return;
      }

      if (code !== 0 && code !== null) {
        task.status = "failed";
        task.error = errorOutput || `进程退出码: ${code}`;
        task.result = output;
      } else {
        task.status = "completed";
        task.result = output || errorOutput || "(无输出)";
      }
      
      task.completedAt = Date.now();
      task.progressLogs.push({
        step: task.status === "completed" ? "已完成" : "执行失败",
        percent: 100,
        timestamp: Date.now(),
        detail: task.error,
      });
      
      this.runningCount--;
      await this.options.onComplete(task);
      this.saveToHistory(task);
      this.processQueue();
    });
  }

  /**
   * 处理队列中的下一个任务
   */
  private processQueue(): void {
    while (this.runningCount < this.options.maxConcurrency && this.queue.length > 0) {
      const nextId = this.queue.shift();
      if (nextId) {
        const task = this.tasks.get(nextId);
        if (task && task.status === "pending") {
          task.progressLogs.push({
            step: "开始执行 (排队结束)",
            percent: 1,
            timestamp: Date.now(),
          });
          this.startTask(nextId);
        }
      }
    }
  }

  private clearReportTimer(taskId: string): void {
    const timer = this.reportTimers.get(taskId);
    if (timer) {
      clearInterval(timer);
      this.reportTimers.delete(taskId);
    }
  }

  /**
   * 保存任务到历史记录
   */
  private saveToHistory(task: LongTask): void {
    try {
      const record: LongTaskHistoryRecord = {
        id: task.id,
        agentId: task.agentId,
        userId: task.userId,
        prompt: task.prompt,
        status: task.status,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        result: task.result,
        error: task.error,
        finalProgress: task.progressLogs[task.progressLogs.length - 1] || {
          step: "未知",
          percent: 0,
          timestamp: Date.now(),
        },
      };
      appendFileSync(this.historyFile, JSON.stringify(record) + "\n");
    } catch (e) {
      console.error(`[LongTask] 保存历史记录失败:`, e);
    }
  }

  /**
   * 读取历史记录
   */
  loadHistory(limit: number = 100): LongTaskHistoryRecord[] {
    try {
      if (!existsSync(this.historyFile)) return [];
      const lines = readFileSync(this.historyFile, "utf-8")
        .split("\n")
        .filter(line => line.trim())
        .slice(-limit);
      return lines.map(line => JSON.parse(line) as LongTaskHistoryRecord);
    } catch (e) {
      console.error(`[LongTask] 加载历史记录失败:`, e);
      return [];
    }
  }
}

// 全局管理器缓存：agentId -> LongTaskManager
const managers: Map<string, LongTaskManager> = new Map();

export function getLongTaskManager(agentId: string, options?: Partial<LongTaskManagerOptions>): LongTaskManager {
  if (!managers.has(agentId)) {
    managers.set(agentId, new LongTaskManager(agentId, options));
  }
  return managers.get(agentId)!;
}

export { formatProgressMessage };
