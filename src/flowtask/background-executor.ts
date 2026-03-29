/**
 * FlowTask 后台执行器
 * 
 * 将 FlowTask 的执行放到子进程中，继承 LongTask 的后台长时间执行能力：
 * - 不受 HTTP 超时限制
 * - 可长时间运行
 * - 可独立取消
 * - 支持进度报告
 * 
 * 方案2：任务执行器模式
 * 主进程负责任务管理和计划生成，子进程负责任务执行
 */

import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import type { FlowTask, ProgressInfo, ValidatedPlan } from "./types.js";

/**
 * 后台执行选项
 */
export interface BackgroundExecutionOptions {
  task: FlowTask;
  plan: ValidatedPlan;
  model: string;
  systemPrompt?: string;
  onProgress: (progress: ProgressInfo) => void;
  onComplete: (result: BackgroundExecutionResult) => void;
  onError: (error: string) => void;
}

/**
 * 后台执行结果
 */
export interface BackgroundExecutionResult {
  status: "completed" | "failed" | "cancelled";
  result?: string;
  error?: string;
  progressLogs: ProgressInfo[];
  audit: unknown[];
  changes: unknown[];
}

/**
 * 后台执行器
 * 管理 FlowTask 在子进程中的执行
 */
export class FlowTaskBackgroundExecutor {
  private childPid?: number;
  private abortController = new AbortController();
  private progressCallback: ((progress: ProgressInfo) => void) | null = null;
  private completeCallback: ((result: BackgroundExecutionResult) => void) | null = null;
  private errorCallback: ((error: string) => void) | null = null;
  private workDir: string;
  private taskId: string;

  constructor(agentId: string, taskId: string) {
    this.taskId = taskId;
    this.workDir = join(
      process.env.HOME || "/tmp",
      ".weixin-kimi-bot",
      "agents",
      agentId,
      "flowtask-work"
    );
    this.ensureWorkDir();
  }

  private ensureWorkDir(): void {
    if (!existsSync(this.workDir)) {
      mkdirSync(this.workDir, { recursive: true });
    }
  }

  /**
   * 开始后台执行
   */
  async execute(options: BackgroundExecutionOptions): Promise<void> {
    if (this.abortController.signal.aborted) {
      throw new Error("执行器已被取消");
    }

    this.progressCallback = options.onProgress;
    this.completeCallback = options.onComplete;
    this.errorCallback = options.onError;

    // 准备工作目录和输入文件
    const inputFile = join(this.workDir, `${this.taskId}-input.json`);
    const outputFile = join(this.workDir, `${this.taskId}-output.json`);
    const progressFile = join(this.workDir, `${this.taskId}-progress.jsonl`);

    // 清理旧文件
    [inputFile, outputFile, progressFile].forEach(f => {
      if (existsSync(f)) unlinkSync(f);
    });

    // 写入任务输入
    const taskInput = {
      task: {
        id: options.task.id,
        agentId: options.task.agentId,
        userId: options.task.userId,
        chatId: options.task.chatId,
        contextToken: options.task.contextToken,
        prompt: options.task.prompt,
        cwd: options.task.cwd,
        model: options.model,
        systemPrompt: options.systemPrompt,
      },
      plan: options.plan,
      outputFile,
      progressFile,
    };

    writeFileSync(inputFile, JSON.stringify(taskInput, null, 2), "utf-8");

    // 启动子进程执行
    return new Promise((resolve, reject) => {
      const scriptPath = join(dirname(new URL(import.meta.url).pathname), "worker.js");
      
      const child = spawn("node", [scriptPath, inputFile], {
        cwd: options.task.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });

      this.childPid = child.pid;

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      // 进度监控定时器
      const progressTimer = setInterval(() => {
        if (existsSync(progressFile)) {
          try {
            const lines = readFileSync(progressFile, "utf-8")
              .split("\n")
              .filter(line => line.trim());
            
            for (const line of lines) {
              try {
                const progress = JSON.parse(line) as ProgressInfo;
                this.progressCallback?.(progress);
              } catch {
                // 忽略解析错误
              }
            }
          } catch {
            // 文件可能被锁定，忽略
          }
        }
      }, 5000); // 每5秒检查一次进度

      child.stdout.on("data", (data: Buffer) => {
        stdout.push(data);
      });

      child.stderr.on("data", (data: Buffer) => {
        stderr.push(data);
      });

      child.on("error", (err) => {
        clearInterval(progressTimer);
        this.childPid = undefined;
        const errorMsg = `子进程启动失败: ${err.message}`;
        this.errorCallback?.(errorMsg);
        reject(new Error(errorMsg));
      });

      child.on("close", (code) => {
        clearInterval(progressTimer);
        this.childPid = undefined;

        const errorOutput = Buffer.concat(stderr).toString("utf-8");

        // 读取最终结果
        if (existsSync(outputFile)) {
          try {
            const result = JSON.parse(readFileSync(outputFile, "utf-8")) as BackgroundExecutionResult;
            this.completeCallback?.(result);
            resolve();
            return;
          } catch (e) {
            const errorMsg = `解析结果失败: ${e instanceof Error ? e.message : String(e)}`;
            this.errorCallback?.(errorMsg);
            reject(new Error(errorMsg));
            return;
          }
        }

        // 没有输出文件，说明执行失败
        if (code !== 0 && code !== null) {
          const errorMsg = errorOutput || `子进程退出码: ${code}`;
          this.errorCallback?.(errorMsg);
          reject(new Error(errorMsg));
        } else {
          // 正常退出但没有输出文件，可能是被取消了
          const result: BackgroundExecutionResult = {
            status: "cancelled",
            result: undefined,
            error: "任务被取消",
            progressLogs: [],
            audit: [],
            changes: [],
          };
          this.completeCallback?.(result);
          resolve();
        }
      });

      // 监听取消信号
      this.abortController.signal.addEventListener("abort", () => {
        if (child.pid) {
          try {
            process.kill(child.pid, "SIGTERM");
            // 5秒后强制杀死
            setTimeout(() => {
              try {
                if (child.pid) {
                  process.kill(child.pid, "SIGKILL");
                }
              } catch {
                // 可能已经退出
              }
            }, 5000);
          } catch {
            // 进程可能已经退出
          }
        }
      });
    });
  }

  /**
   * 取消执行
   */
  async cancel(): Promise<void> {
    this.abortController.abort();
    
    if (this.childPid) {
      try {
        process.kill(this.childPid, "SIGTERM");
      } catch {
        // 进程可能已经退出
      }
    }
  }

  /**
   * 获取子进程 PID
   */
  getChildPid(): number | undefined {
    return this.childPid;
  }
}

/**
 * 创建后台执行器
 */
export function createBackgroundExecutor(agentId: string, taskId: string): FlowTaskBackgroundExecutor {
  return new FlowTaskBackgroundExecutor(agentId, taskId);
}
