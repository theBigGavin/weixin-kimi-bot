/**
 * 耗时任务管理器 v2
 * 
 * 增强功能：
 * - 任务队列管理
 * - 并发控制
 * - 进度跟踪与报告
 * - 历史记录持久化
 * - 实时状态快照
 * - 崩溃恢复机制
 * - WAL数据一致性保证
 * - 数据压缩与轮转
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  LongTask,
  LongTaskStatus,
  ProgressInfo,
  LongTaskHistoryRecord,
  LongTaskManagerOptions,
  PersistenceOptions,
  HistoryQueryFilter,
  QueryResult,
  TaskSnapshot,
  RecoveredTask,
} from "./types.js";
import { parseProgress, parseCommandProgress, formatProgressMessage } from "./parser.js";
import { TaskPersistenceManager } from "./persistence.js";
import { TaskRecoveryManager, RecoveryResult, rebuildTaskFromSnapshot } from "./recovery.js";

export class LongTaskManager {
  private tasks: Map<string, LongTask> = new Map();
  private queue: string[] = [];
  private runningCount = 0;
  private options: LongTaskManagerOptions;
  private reportTimers: Map<string, NodeJS.Timeout> = new Map();
  private dataDir: string;
  private persistence: TaskPersistenceManager;
  private recovery: TaskRecoveryManager;
  private initialized = false;

  constructor(agentId: string, options: Partial<LongTaskManagerOptions> = {}) {
    this.dataDir = join(process.env.HOME || "/tmp", ".weixin-kimi-bot", "agents", agentId, "longtask");
    
    // 确保目录存在
    mkdir(this.dataDir, { recursive: true }).catch(() => {});

    this.options = {
      maxConcurrency: 4,
      reportIntervalMs: 30_000,
      onProgress: async () => {},
      onComplete: async () => {},
      onCancel: async () => {},
      persistence: {
        strategy: "jsonl",
        snapshotIntervalMs: 30_000,
        enableWAL: true,
        historyRetentionDays: 30,
        enableCompression: true,
        maxFileSizeMB: 100,
        enableRecovery: true,
      },
      ...options,
    };

    // 初始化持久化管理器
    this.persistence = new TaskPersistenceManager(
      agentId,
      this.dataDir,
      this.options.persistence
    );

    // 初始化恢复管理器
    this.recovery = new TaskRecoveryManager({
      autoRestart: false,
      notifyOnRecovery: true,
      onRecovered: async (result) => {
        console.log(`[LongTask] 任务恢复: ${result.taskId} - ${result.action}`);
      },
    });
  }

  /**
   * 初始化管理器（包含崩溃恢复）
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 初始化持久化层
    await this.persistence.initialize();

    // 执行崩溃恢复
    if (this.options.persistence?.enableRecovery !== false) {
      await this.performRecovery();
    }

    this.initialized = true;
    console.log(`[LongTaskManager] 初始化完成，数据目录: ${this.dataDir}`);
  }

  /**
   * 关闭管理器
   */
  async close(): Promise<void> {
    // 停止所有定时器
    for (const [taskId, timer] of this.reportTimers.entries()) {
      clearInterval(timer);
      this.reportTimers.delete(taskId);
    }

    // 关闭持久化管理器
    await this.persistence.close();
    this.initialized = false;
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

    // 保存快照
    this.persistence.saveSnapshot(fullTask).catch(err => {
      console.error(`[LongTask] 保存快照失败:`, err);
    });

    if (this.runningCount < this.options.maxConcurrency) {
      this.startTask(id);
    } else {
      this.queue.push(id);
      fullTask.progressLogs.push({
        step: `排队中 (前面还有 ${this.queue.length - 1} 个任务)`,
        percent: 0,
        timestamp: Date.now(),
      });
      // 保存排队状态
      this.persistence.saveSnapshot(fullTask).catch(() => {});
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
      await this.finalizeTask(task);
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
      await this.finalizeTask(task);
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
   * 获取所有活跃任务
   */
  getActiveTasks(): LongTask[] {
    return Array.from(this.tasks.values())
      .filter(t => t.status === "running" || t.status === "pending")
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
   * 查询历史记录
   */
  async queryHistory(
    filter?: HistoryQueryFilter,
    limit?: number,
    cursor?: string
  ): Promise<QueryResult<LongTaskHistoryRecord>> {
    return this.persistence.queryHistory(filter, limit, cursor);
  }

  /**
   * 获取持久化元数据
   */
  async getPersistenceMetadata() {
    return this.persistence.getMetadata();
  }

  /**
   * 执行数据维护
   */
  async performMaintenance(): Promise<void> {
    return this.persistence.performMaintenance();
  }

  /**
   * 获取恢复报告（如果有未恢复的任务）
   */
  async getRecoveryReport(): Promise<string | null> {
    const snapshots = await this.persistence.loadActiveSnapshots();
    if (snapshots.length === 0) return null;

    const recoveredTasks = await this.recovery.analyzeRecoverableTasks(snapshots);
    const results: RecoveryResult[] = recoveredTasks.map(t => ({
      success: true,
      action: t.recoverySuggestion,
      taskId: t.task.id,
      message: t.recoveryReason,
    }));

    return this.recovery.buildRecoveryReport(results);
  }

  // ==================== 私有方法 ====================

  /**
   * 执行崩溃恢复
   */
  private async performRecovery(): Promise<void> {
    try {
      const snapshots = await this.persistence.loadActiveSnapshots();
      if (snapshots.length === 0) return;

      console.log(`[LongTaskManager] 发现 ${snapshots.length} 个未完成任务，执行恢复...`);

      const recoveredTasks = await this.recovery.analyzeRecoverableTasks(snapshots);

      // 恢复任务到内存
      for (const { task, recoverySuggestion } of recoveredTasks) {
        if (recoverySuggestion === "restart" || recoverySuggestion === "resume") {
          const fullTask = rebuildTaskFromSnapshot(task);
          this.tasks.set(fullTask.id, fullTask);

          if (task.status === "pending") {
            this.queue.push(fullTask.id);
          } else if (task.status === "running") {
            // 如果进程已死，标记为失败
            if (task.childPid && !(await this.recovery.isProcessAlive(task.childPid))) {
              fullTask.status = "failed";
              fullTask.error = "进程在系统重启后丢失";
              fullTask.completedAt = Date.now();
              await this.finalizeTask(fullTask);
            }
          }
        }
      }

      // 重新处理队列
      this.processQueue();

      console.log(`[LongTaskManager] 恢复完成，恢复了 ${this.tasks.size} 个任务`);
    } catch (error) {
      console.error(`[LongTaskManager] 恢复失败:`, error);
    }
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

    // 保存快照
    this.persistence.saveSnapshot(task).catch(() => {});

    let child: ReturnType<typeof spawn>;
    let turnEstimate = 1;
    let isCommandTask = false;

    if (task.command) {
      // 自定义命令任务
      isCommandTask = true;
      const shell = process.platform === "win32";
      const [cmd, ...cmdArgs] = task.command.split(" ");
      child = spawn(cmd, cmdArgs, {
        cwd: task.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        shell,
      });
    } else {
      // Kimi 任务
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

      child = spawn("kimi", args, {
        cwd: task.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }

    task.childPid = child.pid;

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    // 进度报告定时器
    const reportTimer = setInterval(async () => {
      try {
        turnEstimate++;
        const combinedOutput = Buffer.concat(stdout).toString("utf-8") + "\n" + Buffer.concat(stderr).toString("utf-8");
        let progress: ProgressInfo;
        if (isCommandTask) {
          progress = parseCommandProgress(combinedOutput, task.command || "", turnEstimate);
        } else {
          progress = parseProgress(combinedOutput, task.maxTurns, turnEstimate);
        }
        task.progressLogs.push(progress);
        
        // 保存进度快照
        await this.persistence.saveSnapshot(task);
        
        if (task.status === "running") {
          await this.options.onProgress(task, progress);
        }
      } catch (err) {
        // 捕获异常，避免未处理的 Promise rejection 导致定时器停止
        console.error(`[LongTask:${taskId}] 进度报告失败:`, err);
      }
    }, this.options.reportIntervalMs);

    this.reportTimers.set(taskId, reportTimer);

    child.stdout?.on("data", (data: Buffer) => {
      stdout.push(data);
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr.push(data);
    });

    child.on("error", async (err) => {
      this.clearReportTimer(taskId);
      task.status = "failed";
      task.error = `启动失败: ${err.message}`;
      task.completedAt = Date.now();
      this.runningCount--;
      await this.options.onComplete(task);
      await this.finalizeTask(task);
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
      await this.finalizeTask(task);
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
   * 完成任务处理（保存历史记录和清理）
   */
  private async finalizeTask(task: LongTask): Promise<void> {
    try {
      // 构建历史记录
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

      // 保存到历史记录
      await this.persistence.saveHistory(record);

      // 删除任务快照
      await this.persistence.deleteSnapshot(task.id);

      // 从内存中移除（可选，根据需求可以保留）
      // this.tasks.delete(task.id);
    } catch (e) {
      console.error(`[LongTask] 完成任务处理失败:`, e);
    }
  }
}

// 全局管理器缓存：agentId -> LongTaskManager
const managers: Map<string, LongTaskManager> = new Map();

export async function getLongTaskManager(
  agentId: string,
  options?: Partial<LongTaskManagerOptions>
): Promise<LongTaskManager> {
  if (!managers.has(agentId)) {
    const manager = new LongTaskManager(agentId, options);
    await manager.initialize();
    managers.set(agentId, manager);
  }
  return managers.get(agentId)!;
}

// 兼容旧版同步接口（首次调用需要初始化）
export function getLongTaskManagerSync(agentId: string, options?: Partial<LongTaskManagerOptions>): LongTaskManager {
  if (!managers.has(agentId)) {
    const manager = new LongTaskManager(agentId, options);
    // 异步初始化
    manager.initialize().catch(err => {
      console.error(`[LongTaskManager] 初始化失败:`, err);
    });
    managers.set(agentId, manager);
  }
  return managers.get(agentId)!;
}

export { formatProgressMessage };
