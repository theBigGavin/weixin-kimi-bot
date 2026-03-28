/**
 * Task Scheduler - 支持多Agent的定时任务调度
 * 
 * 每个Agent拥有独立的定时任务
 */
import { spawn as spawnChild } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { ApiOptions } from "./ilink/api.js";
import { scheduledTasksPath } from "./store.js";
import { getNotificationManager, type NotificationMessage } from "./notifications/index.js";

export interface ScheduledTask {
  id: string;
  agentId: string;        // 所属Agent
  name: string;
  cron: string;
  command: string;
  chatId: string;
  contextToken: string;
  enabled: boolean;
  lastRun?: number;
  lastResult?: string;
  createdAt: number;
}

export interface ParsedTaskInfo {
  name: string;           // 任务名称
  cron: string;           // crontab 表达式
  command: string;        // 执行命令
  description: string;    // 执行时间描述
}

interface TaskState {
  task: ScheduledTask;
  nextRun: number;
}

// ============ Crontab 解析工具 ============

export function parseCron(cron: string): {
  minutes: number[];
  hours: number[];
  days: number[];
  months: number[];
  weekdays: number[];
} {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid crontab: ${cron}, expected 5 fields`);
  }

  return {
    minutes: parseCronField(parts[0], 0, 59),
    hours: parseCronField(parts[1], 0, 23),
    days: parseCronField(parts[2], 1, 31),
    months: parseCronField(parts[3], 1, 12),
    weekdays: parseCronField(parts[4], 0, 6),
  };
}

function parseCronField(field: string, min: number, max: number): number[] {
  const values: number[] = [];
  const parts = field.split(",");

  for (const part of parts) {
    if (part === "*") {
      for (let i = min; i <= max; i++) values.push(i);
    } else if (part.includes("/")) {
      const [range, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      let start = min, end = max;
      if (range !== "*") {
        if (range.includes("-")) {
          const [s, e] = range.split("-");
          start = parseInt(s, 10);
          end = parseInt(e, 10);
        } else {
          start = parseInt(range, 10);
        }
      }
      for (let i = start; i <= end; i += step) values.push(i);
    } else if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      for (let i = start; i <= end; i++) values.push(i);
    } else {
      values.push(parseInt(part, 10));
    }
  }

  return [...new Set(values)].sort((a, b) => a - b);
}

export function getNextRunTime(cron: string, fromTime: number = Date.now()): number {
  const parsed = parseCron(cron);
  const date = new Date(fromTime);
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);

  const maxTime = fromTime + 2 * 365 * 24 * 60 * 60 * 1000;

  while (date.getTime() < maxTime) {
    const min = date.getMinutes();
    const hour = date.getHours();
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const weekday = date.getDay();

    if (
      parsed.minutes.includes(min) &&
      parsed.hours.includes(hour) &&
      parsed.days.includes(day) &&
      parsed.months.includes(month) &&
      parsed.weekdays.includes(weekday)
    ) {
      return date.getTime();
    }
    date.setMinutes(date.getMinutes() + 1);
  }

  throw new Error(`Cannot calculate next run for: ${cron}`);
}

export function formatCronDescription(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [min, hour, day, month, weekday] = parts;
  
  if (cron === "0 9 * * *") return "每天早上 9:00";
  if (cron === "0 8 * * *") return "每天早上 8:00";
  if (cron === "0 0 * * *") return "每天凌晨 0:00";
  if (cron === "0 */6 * * *") return "每 6 小时";
  if (cron === "0 9 * * 1") return "每周一早上 9:00";
  if (cron === "0 9 * * 1-5") return "工作日早上 9:00";
  if (cron === "0 0 1 * *") return "每月 1 号凌晨 0:00";

  const timeStr = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  if (day === "*" && month === "*" && weekday === "*") {
    return `每天 ${timeStr}`;
  }
  return cron;
}

// ============ Agent任务调度器 ============

export class AgentTaskScheduler {
  private agentId: string;
  private tasks: Map<string, TaskState> = new Map();
  private intervalId: NodeJS.Timeout | null = null;
  private api: ApiOptions | null = null;
  private sendMessageFn: ((chatId: string, ctxToken: string, text: string) => Promise<void>) | null = null;
  private running = false;
  private tasksFile: string;

  constructor(agentId: string) {
    this.agentId = agentId;
    this.tasksFile = scheduledTasksPath(agentId);
    this.loadTasks();
  }

  setApi(
    api: ApiOptions,
    sendMessageFn: (chatId: string, contextToken: string, text: string) => Promise<void>
  ) {
    this.api = api;
    this.sendMessageFn = sendMessageFn;
  }

  private loadTasks(): void {
    try {
      if (!existsSync(this.tasksFile)) return;

      const data = readFileSync(this.tasksFile, "utf-8");
      const tasks: ScheduledTask[] = JSON.parse(data);

      // 只加载属于本Agent的任务
      for (const task of tasks) {
        if (task.agentId === this.agentId && task.enabled) {
          try {
            const nextRun = getNextRunTime(task.cron);
            this.tasks.set(task.id, { task, nextRun });
          } catch (e) {
            console.error(`[Scheduler:${this.agentId}] 任务 ${task.id} 的cron无效: ${task.cron}`);
          }
        }
      }

      console.log(`[Scheduler:${this.agentId}] 已加载 ${this.tasks.size} 个定时任务`);
    } catch (e) {
      console.error(`[Scheduler:${this.agentId}] 加载任务失败:`, e);
    }
  }

  private saveTasks(): void {
    try {
      // 读取所有任务（包括其他Agent的）
      let allTasks: ScheduledTask[] = [];
      if (existsSync(this.tasksFile)) {
        const data = readFileSync(this.tasksFile, "utf-8");
        allTasks = JSON.parse(data);
      }

      // 移除本Agent的旧任务
      allTasks = allTasks.filter(t => t.agentId !== this.agentId);

      // 添加当前任务
      for (const state of this.tasks.values()) {
        allTasks.push(state.task);
      }

      writeFileSync(this.tasksFile, JSON.stringify(allTasks, null, 2));
    } catch (e) {
      console.error(`[Scheduler:${this.agentId}] 保存任务失败:`, e);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log(`[Scheduler:${this.agentId}] 已启动`);
    this.intervalId = setInterval(() => this.checkTasks(), 60 * 1000);
    this.checkTasks();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log(`[Scheduler:${this.agentId}] 已停止`);
  }

  private checkTasks(): void {
    const now = Date.now();
    for (const [id, state] of this.tasks) {
      if (state.nextRun <= now) {
        this.executeTask(state.task);
        try {
          state.nextRun = getNextRunTime(state.task.cron, now);
          state.task.lastRun = now;
        } catch {
          this.tasks.delete(id);
        }
      }
    }
  }

  private async executeTask(task: ScheduledTask): Promise<void> {
    console.log(`[Scheduler:${this.agentId}] 执行任务: ${task.name}`);
    const startTime = Date.now();
    let success = false;
    let result = "";
    let errorMsg = "";

    try {
      result = await this.runCommand(task.command);
      task.lastResult = result;
      success = true;

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[Scheduler:${this.agentId}] 任务完成，耗时 ${duration}s`);

      // 发送到微信
      if (this.sendMessageFn) {
        const timeStr = new Date().toLocaleString("zh-CN");
        const message = `⏰ **定时任务执行结果**\n\n` +
          `任务: ${task.name}\n` +
          `时间: ${timeStr}\n` +
          `耗时: ${duration}s\n\n` +
          `---\n${result}`;
        await this.sendMessageFn(task.chatId, task.contextToken, message);
      }
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
      task.lastResult = `Error: ${errorMsg}`;
      console.error(`[Scheduler:${this.agentId}] 任务失败:`, errorMsg);

      if (this.sendMessageFn) {
        const timeStr = new Date().toLocaleString("zh-CN");
        const message = `❌ **定时任务执行失败**\n\n` +
          `任务: ${task.name}\n` +
          `时间: ${timeStr}\n` +
          `错误: ${errorMsg}`;
        await this.sendMessageFn(task.chatId, task.contextToken, message);
      }
    }

    // 发送到通知通道
    await this.sendToNotificationChannels(task, success, result, errorMsg, Date.now() - startTime);
    this.saveTasks();
  }

  private async sendToNotificationChannels(
    task: ScheduledTask,
    success: boolean,
    result: string,
    error: string,
    durationMs: number
  ): Promise<void> {
    try {
      const duration = (durationMs / 1000).toFixed(1);
      const timeStr = new Date().toLocaleString("zh-CN");
      
      const notificationMessage: NotificationMessage = {
        title: success ? `✅ 定时任务完成: ${task.name}` : `❌ 定时任务失败: ${task.name}`,
        content: success
          ? `任务: ${task.name}\nAgent: ${this.agentId}\n时间: ${timeStr}\n耗时: ${duration}s\n\n---\n${result.slice(0, 2000)}`
          : `任务: ${task.name}\nAgent: ${this.agentId}\n时间: ${timeStr}\n错误: ${error}`,
        timestamp: Date.now(),
        metadata: { taskId: task.id, agentId: this.agentId, success, duration: durationMs },
      };

      // 使用当前Agent的通知管理器
      const notificationManager = getNotificationManager(this.agentId);
      await notificationManager.sendToAll(notificationMessage);
    } catch (e) {
      console.error(`[Scheduler:${this.agentId}] 发送通知失败:`, e);
    }
  }

  private runCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawnChild(command, [], {
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      child.stdout.on("data", (data: Buffer) => stdout.push(data));
      child.stderr.on("data", (data: Buffer) => stderr.push(data));

      child.on("error", (err) => reject(new Error(`执行失败: ${err.message}`)));

      child.on("close", (code) => {
        const output = Buffer.concat(stdout).toString("utf-8");
        const errorOutput = Buffer.concat(stderr).toString("utf-8");

        if (code !== 0) {
          reject(new Error(`退出码 ${code}: ${errorOutput || output}`));
        } else {
          resolve(output || errorOutput || "(无输出)");
        }
      });
    });
  }

  // ============ 任务管理 API ============

  addTask(task: Omit<ScheduledTask, "id" | "createdAt" | "agentId">): ScheduledTask {
    const newTask: ScheduledTask = {
      ...task,
      id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      agentId: this.agentId,
      createdAt: Date.now(),
    };

    try {
      const nextRun = getNextRunTime(newTask.cron);
      if (newTask.enabled) {
        this.tasks.set(newTask.id, { task: newTask, nextRun });
      }

      // 保存到文件
      let allTasks: ScheduledTask[] = [];
      if (existsSync(this.tasksFile)) {
        allTasks = JSON.parse(readFileSync(this.tasksFile, "utf-8"));
      }
      allTasks.push(newTask);
      writeFileSync(this.tasksFile, JSON.stringify(allTasks, null, 2));

      console.log(`[Scheduler:${this.agentId}] 添加任务: ${newTask.name}`);
      return newTask;
    } catch (e) {
      throw new Error(`无效的crontab: ${newTask.cron}`);
    }
  }

  deleteTask(taskId: string): boolean {
    this.tasks.delete(taskId);
    
    try {
      if (existsSync(this.tasksFile)) {
        const allTasks: ScheduledTask[] = JSON.parse(readFileSync(this.tasksFile, "utf-8"));
        const filtered = allTasks.filter(t => t.id !== taskId || t.agentId !== this.agentId);
        writeFileSync(this.tasksFile, JSON.stringify(filtered, null, 2));
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  toggleTask(taskId: string, enabled: boolean): boolean {
    const state = this.tasks.get(taskId);
    if (state) {
      state.task.enabled = enabled;
      if (!enabled) this.tasks.delete(taskId);
    }

    try {
      if (existsSync(this.tasksFile)) {
        const allTasks: ScheduledTask[] = JSON.parse(readFileSync(this.tasksFile, "utf-8"));
        const task = allTasks.find(t => t.id === taskId && t.agentId === this.agentId);
        if (task) {
          task.enabled = enabled;
          writeFileSync(this.tasksFile, JSON.stringify(allTasks, null, 2));
          
          if (enabled && !state) {
            const nextRun = getNextRunTime(task.cron);
            this.tasks.set(taskId, { task, nextRun });
          }
          return true;
        }
      }
    } catch (e) {
      console.error(`[Scheduler:${this.agentId}] 切换任务状态失败:`, e);
    }
    return false;
  }

  getAllTasks(): ScheduledTask[] {
    try {
      if (existsSync(this.tasksFile)) {
        const allTasks: ScheduledTask[] = JSON.parse(readFileSync(this.tasksFile, "utf-8"));
        return allTasks.filter(t => t.agentId === this.agentId);
      }
    } catch (e) {
      console.error(`[Scheduler:${this.agentId}] 读取任务失败:`, e);
    }
    return [];
  }

  getTaskStatus(taskId: string): { task: ScheduledTask; nextRun: number | null } | null {
    const state = this.tasks.get(taskId);
    if (state) return { task: state.task, nextRun: state.nextRun };

    const allTasks = this.getAllTasks();
    const task = allTasks.find(t => t.id === taskId);
    if (task) return { task, nextRun: null };
    return null;
  }

  async runTaskNow(taskId: string): Promise<boolean> {
    const status = this.getTaskStatus(taskId);
    if (!status) return false;
    await this.executeTask(status.task);
    return true;
  }
}

// ============ 全局调度器管理 ============

const schedulers: Map<string, AgentTaskScheduler> = new Map();

/**
 * 获取或创建Agent的调度器
 */
export function getScheduler(agentId: string): AgentTaskScheduler {
  if (!schedulers.has(agentId)) {
    schedulers.set(agentId, new AgentTaskScheduler(agentId));
  }
  return schedulers.get(agentId)!;
}

/**
 * 启动所有调度器
 */
export function startAllSchedulers(): void {
  for (const scheduler of schedulers.values()) {
    scheduler.start();
  }
}

/**
 * 停止所有调度器
 */
export function stopAllSchedulers(): void {
  for (const scheduler of schedulers.values()) {
    scheduler.stop();
  }
}

/**
 * 删除Agent的调度器
 */
export function removeScheduler(agentId: string): void {
  const scheduler = schedulers.get(agentId);
  if (scheduler) {
    scheduler.stop();
    schedulers.delete(agentId);
  }
}

// 导出兼容旧代码的函数
export function parseCronExpression(cron: string) {
  return parseCron(cron);
}

// ============ 自然语言解析 ============

import { spawn } from "node:child_process";

/**
 * 使用 Kimi AI 解析自然语言描述为任务信息
 */
export async function parseNaturalLanguageToCron(
  description: string,
  model: string,
  cwd: string
): Promise<ParsedTaskInfo> {
  const systemPrompt = `你是一个定时任务解析助手。请将用户的自然语言描述解析为结构化的定时任务信息。

你需要输出一个 JSON 对象，包含以下字段：
- name: 任务名称（简短，不超过20字）
- cron: crontab 表达式（5个字段：分 时 日 月 周）
- command: 执行命令（使用 echo 输出提醒内容）
- description: 执行时间的友好描述

Crontab 格式说明：
- 分(0-59) 时(0-23) 日(1-31) 月(1-12) 周(0-6, 0=周日)
- * 表示任意值
- / 表示步长，如 */5 表示每5分钟
- - 表示范围，如 8-21 表示8点到21点
- , 表示列表，如 1,3,5 表示1、3、5

常见模式：
- 每小时: 0 * * * *
- 每天8点: 0 8 * * *
- 工作日9点: 0 9 * * 1-5
- 每周日20点: 0 20 * * 0
- 每月1日: 0 0 1 * *
- 每2小时: 0 */2 * * *
- 8点到21点每小时: 0 8-21/1 * * * 或 0 8-21 * * *

请只输出 JSON，不要输出其他内容。`;

  const fullPrompt = `${systemPrompt}\n\n用户描述: ${description}\n\n请解析为 JSON 格式:`;

  return new Promise((resolve, reject) => {
    const args = ["--quiet", "--model", model, "--prompt", fullPrompt];
    
    const child = spawn("kimi", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // 设置30秒超时
    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("解析超时，请重试"));
    }, 30000);

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (data: Buffer) => stdout.push(data));
    child.stderr.on("data", (data: Buffer) => stderr.push(data));

    child.on("error", (err) => {
      clearTimeout(timeoutId);
      reject(new Error(`调用 Kimi 失败: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timeoutId);
      const output = Buffer.concat(stdout).toString("utf-8").trim();
      const errorOutput = Buffer.concat(stderr).toString("utf-8").trim();

      if (code !== 0 && code !== null) {
        reject(new Error(`Kimi 执行失败: ${errorOutput || `退出码 ${code}`}`));
        return;
      }

      try {
        // 尝试从输出中提取 JSON
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          reject(new Error(`无法解析 Kimi 输出: ${output.substring(0, 200)}`));
          return;
        }

        const parsed = JSON.parse(jsonMatch[0]) as ParsedTaskInfo;
        
        // 验证必要字段
        if (!parsed.name || !parsed.cron || !parsed.command) {
          reject(new Error(`解析结果缺少必要字段: ${JSON.stringify(parsed)}`));
          return;
        }

        resolve(parsed);
      } catch (e) {
        reject(new Error(`解析 JSON 失败: ${e instanceof Error ? e.message : String(e)}\n输出: ${output.substring(0, 200)}`));
      }
    });
  });
}
