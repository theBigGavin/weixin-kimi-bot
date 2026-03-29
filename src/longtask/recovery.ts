/**
 * LongTask 崩溃恢复模块
 * 
 * 提供功能：
 * - 系统崩溃后恢复未完成任务
 * - 智能判断任务恢复策略
 * - 清理僵尸进程
 * - 恢复任务队列状态
 */

import { spawn, exec } from "node:child_process";
import { promisify } from "node:util";
import type {
  TaskSnapshot,
  RecoveredTask,
  LongTask,
  LongTaskStatus,
} from "./types.js";

const execAsync = promisify(exec);

/**
 * 恢复策略
 */
export type RecoveryAction = "restart" | "resume" | "cleanup" | "skip";

export interface RecoveryStrategy {
  /** 策略名称 */
  name: string;
  /** 适用状态 */
  applicableStatuses: LongTaskStatus[];
  /** 判断函数 */
  canApply: (task: TaskSnapshot) => boolean | Promise<boolean>;
  /** 执行恢复 */
  execute: (task: TaskSnapshot) => Promise<RecoveryResult>;
}

export interface RecoveryResult {
  success: boolean;
  action: RecoveryAction;
  taskId: string;
  message?: string;
  newPid?: number;
  error?: string;
}

export interface RecoveryOptions {
  /** 是否自动重启可恢复的任务 */
  autoRestart?: boolean;
  /** 恢复时通知用户 */
  notifyOnRecovery?: boolean;
  /** 任务超时时间（毫秒） */
  taskTimeoutMs?: number;
  /** 自定义恢复策略 */
  customStrategies?: RecoveryStrategy[];
  /** 恢复回调 */
  onRecovered?: (result: RecoveryResult) => Promise<void>;
}

const DEFAULT_RECOVERY_OPTIONS: Required<RecoveryOptions> = {
  autoRestart: false,
  notifyOnRecovery: true,
  taskTimeoutMs: 30 * 60 * 1000, // 30分钟
  customStrategies: [],
  onRecovered: async () => {},
};

/**
 * 任务恢复管理器
 */
export class TaskRecoveryManager {
  private options: Required<RecoveryOptions>;
  private strategies: RecoveryStrategy[];

  constructor(options: RecoveryOptions = {}) {
    this.options = { ...DEFAULT_RECOVERY_OPTIONS, ...options };
    this.strategies = [
      ...this.getDefaultStrategies(),
      ...this.options.customStrategies,
    ];
  }

  /**
   * 分析可恢复的任务
   */
  async analyzeRecoverableTasks(snapshots: TaskSnapshot[]): Promise<RecoveredTask[]> {
    const recoveredTasks: RecoveredTask[] = [];

    for (const task of snapshots) {
      const recoveryInfo = await this.analyzeTask(task);
      recoveredTasks.push(recoveryInfo);
    }

    return recoveredTasks;
  }

  /**
   * 恢复单个任务
   */
  async recoverTask(task: TaskSnapshot): Promise<RecoveryResult> {
    // 找到适用的策略
    const strategy = await this.findApplicableStrategy(task);

    if (!strategy) {
      return {
        success: false,
        action: "skip",
        taskId: task.id,
        message: "没有适用的恢复策略",
      };
    }

    try {
      const result = await strategy.execute(task);
      await this.options.onRecovered(result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const result: RecoveryResult = {
        success: false,
        action: "skip",
        taskId: task.id,
        error: errorMessage,
      };
      await this.options.onRecovered(result);
      return result;
    }
  }

  /**
   * 批量恢复任务
   */
  async recoverTasks(snapshots: TaskSnapshot[]): Promise<RecoveryResult[]> {
    const results: RecoveryResult[] = [];

    // 按优先级排序：running > pending > others
    const sortedSnapshots = [...snapshots].sort((a, b) => {
      const priority: Record<LongTaskStatus, number> = { 
        running: 3, 
        pending: 2, 
        completed: 1, 
        failed: 1, 
        cancelled: 1 
      };
      return priority[b.status] - priority[a.status];
    });

    for (const task of sortedSnapshots) {
      const result = await this.recoverTask(task);
      results.push(result);

      // 如果不是自动重启模式，每个任务恢复后等待用户确认
      if (!this.options.autoRestart && result.action === "restart") {
        // 暂停，等待用户确认
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  /**
   * 检查进程是否存活
   */
  async isProcessAlive(pid: number): Promise<boolean> {
    try {
      // 使用 kill -0 检查进程是否存在
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 清理僵尸进程
   */
  async cleanupZombieProcesses(pids: number[]): Promise<number[]> {
    const cleanedPids: number[] = [];

    for (const pid of pids) {
      try {
        if (await this.isProcessAlive(pid)) {
          // 先尝试优雅终止
          process.kill(pid, "SIGTERM");

          // 等待5秒后检查
          await new Promise(resolve => setTimeout(resolve, 5000));

          // 如果还在，强制杀死
          if (await this.isProcessAlive(pid)) {
            process.kill(pid, "SIGKILL");
          }
        }
        cleanedPids.push(pid);
      } catch {
        // 进程可能已经被清理
        cleanedPids.push(pid);
      }
    }

    return cleanedPids;
  }

  /**
   * 构建恢复报告
   */
  buildRecoveryReport(results: RecoveryResult[]): string {
    const successCount = results.filter(r => r.success).length;
    const restartCount = results.filter(r => r.action === "restart").length;
    const cleanupCount = results.filter(r => r.action === "cleanup").length;
    const skipCount = results.filter(r => r.action === "skip").length;

    let report = `## 🔄 任务恢复报告\n\n`;
    report += `**总计**: ${results.length} 个任务\n`;
    report += `- ✅ 成功: ${successCount}\n`;
    report += `- 🔄 重启: ${restartCount}\n`;
    report += `- 🧹 清理: ${cleanupCount}\n`;
    report += `- ⏭️ 跳过: ${skipCount}\n\n`;

    if (results.length > 0) {
      report += `### 详细结果\n\n`;
      for (const result of results) {
        const icon = result.success ? "✅" : result.action === "skip" ? "⏭️" : "❌";
        report += `${icon} **${result.taskId}**: ${result.action}`;
        if (result.message) {
          report += ` - ${result.message}`;
        }
        if (result.error) {
          report += ` (错误: ${result.error})`;
        }
        if (result.newPid) {
          report += ` [新PID: ${result.newPid}]`;
        }
        report += `\n`;
      }
    }

    return report;
  }

  // ==================== 私有方法 ====================

  /**
   * 分析单个任务的恢复策略
   */
  private async analyzeTask(task: TaskSnapshot): Promise<RecoveredTask> {
    // 如果任务有子进程ID，检查进程是否还在运行
    let processAlive = false;
    if (task.childPid) {
      processAlive = await this.isProcessAlive(task.childPid);
    }

    // 根据状态和进程情况决定恢复策略
    switch (task.status) {
      case "running": {
        if (processAlive) {
          // 进程还在运行，可以尝试恢复监控
          return {
            task,
            recoverySuggestion: "resume",
            recoveryReason: `任务进程仍在运行 (PID: ${task.childPid})`,
          };
        } else {
          // 进程已退出，需要重启
          return {
            task,
            recoverySuggestion: "restart",
            recoveryReason: "任务进程已退出，但任务状态为运行中",
          };
        }
      }

      case "pending": {
        // 待处理任务可以直接重新排队
        return {
          task,
          recoverySuggestion: "restart",
          recoveryReason: "任务处于待处理状态",
        };
      }

      default: {
        // 其他状态（已完成/失败/已取消）通常不需要恢复
        return {
          task,
          recoverySuggestion: "cleanup",
          recoveryReason: `任务已处于 ${task.status} 状态`,
        };
      }
    }
  }

  /**
   * 查找适用的恢复策略
   */
  private async findApplicableStrategy(task: TaskSnapshot): Promise<RecoveryStrategy | null> {
    for (const strategy of this.strategies) {
      if (strategy.applicableStatuses.includes(task.status)) {
        const canApply = await strategy.canApply(task);
        if (canApply) {
          return strategy;
        }
      }
    }
    return null;
  }

  /**
   * 获取默认恢复策略
   */
  private getDefaultStrategies(): RecoveryStrategy[] {
    return [
      // 恢复运行中任务的监控
      {
        name: "resume-monitoring",
        applicableStatuses: ["running"],
        canApply: async (task) => {
          if (!task.childPid) return false;
          return await this.isProcessAlive(task.childPid);
        },
        execute: async (task) => ({
          success: true,
          action: "resume" as const,
          taskId: task.id,
          message: `恢复监控任务进程 (PID: ${task.childPid || "unknown"})`,
        }),
      },

      // 重启已退出的运行中任务
      {
        name: "restart-crashed",
        applicableStatuses: ["running"],
        canApply: async (task) => {
          return !task.childPid || !(await this.isProcessAlive(task.childPid));
        },
        execute: async (task) => {
          if (!this.options.autoRestart) {
            return {
              success: false,
              action: "restart" as const,
              taskId: task.id,
              message: "等待用户确认重启",
            };
          }

          // 启动新进程
          try {
            const child = this.spawnTask(task);
            return {
              success: true,
              action: "restart" as const,
              taskId: task.id,
              message: "任务已重启",
              newPid: child.pid,
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
              success: false,
              action: "restart" as const,
              taskId: task.id,
              error: errorMessage,
            };
          }
        },
      },

      // 重新排队待处理任务
      {
        name: "requeue-pending",
        applicableStatuses: ["pending"],
        canApply: async () => true,
        execute: async (task) => ({
          success: true,
          action: "restart" as const,
          taskId: task.id,
          message: "任务已重新加入队列",
        }),
      },

      // 清理已完成任务
      {
        name: "cleanup-completed",
        applicableStatuses: ["completed", "failed", "cancelled"],
        canApply: async () => true,
        execute: async (task) => ({
          success: true,
          action: "cleanup" as const,
          taskId: task.id,
          message: `清理 ${task.status} 状态的任务`,
        }),
      },
    ];
  }

  /**
   * 启动任务进程
   */
  private spawnTask(task: TaskSnapshot) {
    const args: string[] = ["--quiet"];
    if (task.model) {
      args.push("--model", task.model);
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

    if (!child.pid) {
      throw new Error("无法启动任务进程");
    }

    return child;
  }
}

/**
 * 从快照重建 LongTask 对象
 */
export function rebuildTaskFromSnapshot(snapshot: TaskSnapshot): LongTask {
  return {
    id: snapshot.id,
    agentId: snapshot.agentId,
    userId: snapshot.userId,
    chatId: snapshot.chatId,
    contextToken: snapshot.contextToken,
    prompt: snapshot.prompt,
    status: snapshot.status,
    createdAt: snapshot.createdAt,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
    result: snapshot.result,
    error: snapshot.error,
    progressLogs: snapshot.progressLogs,
    cwd: snapshot.cwd,
    model: snapshot.model,
    systemPrompt: snapshot.systemPrompt,
    maxTurns: snapshot.maxTurns,
  };
}

/**
 * 创建任务快照
 */
export function createTaskSnapshot(task: LongTask): TaskSnapshot {
  return {
    ...task,
    snapshotVersion: 1,
    lastUpdatedAt: Date.now(),
  };
}
