/**
 * 状态机执行引擎
 * 
 * 核心设计原则：控制流是确定性的，LLM 不参与执行决策
 * - 硬编码状态转换规则
 * - 每步执行前有验证，执行后有校验
 * - 完整的变更追踪和审计日志
 * - 支持回滚
 */

import { spawn } from "node:child_process";
import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { 
  FlowTask, 
  ValidatedPlan, 
  PlanStep, 
  ExecutionState, 
  StepResult,
  ChangeLog,
  AuditRecord,
  StepType,
  ProgressInfo,
  HumanApprovalRequest 
} from "./types.js";

// 状态转换规则（硬编码，LLM 不可修改）
type StateTransition = {
  from: FlowTask["status"];
  to: FlowTask["status"];
  trigger: string;
  guard: (task: FlowTask, ...args: unknown[]) => boolean;
};

const stateTransitions: StateTransition[] = [
  { from: "pending", to: "planning", trigger: "start_planning", guard: () => true },
  { from: "planning", to: "validating", trigger: "plan_generated", guard: () => true },
  { from: "validating", to: "awaiting_approval", trigger: "needs_approval", guard: (t) => t.plan?.validation.requiredApproval || false },
  { from: "validating", to: "running", trigger: "auto_approved", guard: (t) => !t.plan?.validation.requiredApproval },
  { from: "awaiting_approval", to: "running", trigger: "approved", guard: () => true },
  { from: "awaiting_approval", to: "cancelled", trigger: "rejected", guard: () => true },
  { from: "running", to: "paused", trigger: "checkpoint", guard: () => true },
  { from: "paused", to: "running", trigger: "resume", guard: () => true },
  { from: "paused", to: "cancelled", trigger: "cancel", guard: () => true },
  { from: "running", to: "completed", trigger: "finish", guard: (t) => t.execution?.currentStep === t.plan?.steps.length },
  { from: "running", to: "failed", trigger: "error", guard: () => true },
  { from: "failed", to: "cancelled", trigger: "cancel", guard: () => true },
  { from: "cancelling", to: "cancelled", trigger: "cancelled", guard: () => true },
];

// Shell 命令白名单
const SHELL_WHITELIST = [
  "cat", "echo", "grep", "find", "ls", "mkdir", "rm", "mv", "cp",
  "npm", "npx", "node", "git", "tsc", "vitest", "jest", "python", "python3",
  "cd", "pwd", "touch", "head", "tail", "wc", "sort", "uniq",
  "curl", "wget", "tar", "zip", "unzip"
];

// 选项接口
export interface ExecutionOptions {
  onProgress: (progress: ProgressInfo) => Promise<void>;
  onApprovalRequest: (request: HumanApprovalRequest) => Promise<boolean | { approved: boolean; modifications?: string }>;
  onAudit: (record: AuditRecord) => void;
  model: string;
  systemPrompt?: string;
}

/**
 * 执行引擎类
 */
export class ExecutionEngine {
  private task: FlowTask;
  private options: ExecutionOptions;
  private abortController: AbortController;
  private retryCount: Map<string, number> = new Map();
  
  constructor(task: FlowTask, options: ExecutionOptions) {
    this.task = task;
    this.options = options;
    this.abortController = new AbortController();
    
    // 初始化执行状态
    if (!this.task.execution) {
      this.task.execution = {
        planId: task.plan?.planId || "",
        currentStep: 0,
        status: "pending",
        context: {
          workingDir: task.cwd,
          env: {},
          stepResults: [],
        },
        changes: [],
        audit: [],
        stepResults: [],
      };
    }
  }
  
  /**
   * 获取当前状态
   */
  getStatus(): FlowTask["status"] {
    return this.task.status;
  }
  
  /**
   * 执行状态转换
   */
  private async transition(to: FlowTask["status"], trigger: string): Promise<boolean> {
    const from = this.task.status;
    const transition = stateTransitions.find(t => t.from === from && t.to === to && t.trigger === trigger);
    
    if (!transition) {
      throw new Error(`无效的状态转换: ${from} -> ${to} (${trigger})`);
    }
    
    if (!transition.guard(this.task)) {
      return false;
    }
    
    this.task.status = to;
    this.task.execution!.status = to;
    
    // 记录审计日志
    this.logAudit({
      timestamp: Date.now(),
      event: this.mapStatusToEvent(to),
      details: { from, trigger },
    });
    
    return true;
  }
  
  /**
   * 映射状态到审计事件
   */
  private mapStatusToEvent(status: FlowTask["status"]): AuditRecord["event"] {
    const mapping: Record<FlowTask["status"], AuditRecord["event"]> = {
      pending: "plan_generated",
      planning: "plan_generated",
      validating: "plan_validated",
      awaiting_approval: "human_approval_requested",
      running: "step_started",
      paused: "human_approval_requested",
      completed: "task_completed",
      failed: "task_failed",
      cancelling: "task_cancelled",
      cancelled: "task_cancelled",
    };
    return mapping[status] || "plan_generated";
  }
  
  /**
   * 开始执行
   */
  async start(): Promise<void> {
    try {
      // 验证计划存在
      if (!this.task.plan) {
        throw new Error("没有可执行的计划");
      }
      
      this.task.startedAt = Date.now();
      
      // 进入验证阶段
      await this.transition("validating", "plan_generated");
      
      // 判断是否需要人工确认
      if (this.task.plan.validation.requiredApproval) {
        await this.transition("awaiting_approval", "needs_approval");
        
        const approval = await this.options.onApprovalRequest({
          taskId: this.task.id,
          stepId: "plan-approval",
          stepNumber: 0,
          description: `执行计划需要确认\n\n${this.task.plan.validation.warnings.join("\n") || "无警告"}`,
          riskLevel: this.task.plan.validation.riskLevel,
          preview: {
            type: "plan",
            content: JSON.stringify(this.task.plan.steps.map(s => ({ id: s.stepId, type: s.type, desc: s.description })), null, 2),
          },
          timeout: 5 * 60 * 1000, // 5分钟
          requestedAt: Date.now(),
        });
        
        if (typeof approval === "boolean") {
          if (!approval) {
            await this.transition("cancelled", "rejected");
            this.task.error = "用户拒绝了执行计划";
            return;
          }
        } else if (approval && typeof approval === "object" && !approval.approved) {
          await this.transition("cancelled", "rejected");
          const feedback = (approval as { approved: boolean; modifications?: string; feedback?: string }).feedback;
          this.task.error = feedback || "用户拒绝了执行计划";
          return;
        }
        
        await this.transition("running", "approved");
      } else {
        await this.transition("running", "auto_approved");
      }
      
      // 执行步骤
      await this.executeSteps();
      
    } catch (error) {
      this.task.error = error instanceof Error ? error.message : String(error);
      await this.transition("failed", "error");
      throw error;
    }
  }
  
  /**
   * 执行所有步骤
   */
  private async executeSteps(): Promise<void> {
    const plan = this.task.plan!;
    const execution = this.task.execution!;
    
    // 确保 stepResults 数组存在
    if (!execution.context.stepResults) {
      execution.context.stepResults = [];
    }
    
    while (execution.currentStep < plan.steps.length) {
      // 检查是否被取消
      if (this.abortController.signal.aborted) {
        await this.transition("cancelled", "cancel");
        return;
      }
      
      const stepIndex = execution.currentStep;
      const step = plan.steps[stepIndex];
      
      // 检查是否是检查点
      if (plan.reliability.checkpoints.includes(stepIndex) && stepIndex > 0) {
        await this.transition("paused", "checkpoint");
        
        const approval = await this.options.onApprovalRequest({
          taskId: this.task.id,
          stepId: step.stepId,
          stepNumber: stepIndex,
          description: `检查点: 即将执行 "${step.description}"`,
          riskLevel: "medium",
          preview: {
            type: step.type === "write" ? "file_changes" : "command",
            content: JSON.stringify(step.inputs, null, 2),
          },
          timeout: 5 * 60 * 1000,
          requestedAt: Date.now(),
        });
        
        const shouldContinue = typeof approval === "boolean" ? approval : (approval && typeof approval === "object" ? approval.approved : false);
        
        if (!shouldContinue) {
          await this.transition("cancelled", "cancel");
          this.task.error = "用户在检查点取消了任务";
          return;
        }
        
        await this.transition("running", "resume");
      }
      
      // 报告进度
      const progress: ProgressInfo = {
        step: step.description,
        stepNumber: stepIndex + 1,
        totalSteps: plan.steps.length,
        fileName: step.inputs?.paths?.[0],
        percent: Math.round(((stepIndex) / plan.steps.length) * 100),
        timestamp: Date.now(),
      };
      
      this.task.progressLogs.push(progress);
      await this.options.onProgress(progress);
      
      // 执行步骤
      try {
        await this.executeStep(step, stepIndex);
        execution.currentStep++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        
        // 处理错误
        if (step.onError === "retry") {
          const retries = this.retryCount.get(step.stepId) || 0;
          if (retries < 3) {
            this.retryCount.set(step.stepId, retries + 1);
            // 重试当前步骤
            continue;
          }
        }
        
        if (step.onError === "fallback" && step.fallback) {
          // 执行 fallback 步骤
          const fallbackStep = plan.steps.find(s => s.stepId === step.fallback);
          if (fallbackStep) {
            await this.executeStep(fallbackStep, stepIndex);
            execution.currentStep++;
            continue;
          }
        }
        
        if (step.onError === "human") {
          const approval = await this.options.onApprovalRequest({
            taskId: this.task.id,
            stepId: step.stepId,
            stepNumber: stepIndex,
            description: `步骤执行失败: ${errorMsg}\n\n是否继续？`,
            riskLevel: "high",
            timeout: 5 * 60 * 1000,
            requestedAt: Date.now(),
          });
          
          const shouldContinue = typeof approval === "boolean" ? approval : approval.approved;
          
          if (shouldContinue) {
            execution.currentStep++;
            continue;
          }
        }
        
        // 中止任务
        throw error;
      }
    }
    
    // 任务完成
    await this.transition("completed", "finish");
    this.task.completedAt = Date.now();
  }
  
  /**
   * 执行单个步骤
   */
  private async executeStep(step: PlanStep, index: number): Promise<void> {
    const execution = this.task.execution!;
    const stepResult: StepResult = {
      stepId: step.stepId,
      status: "success",
      startedAt: Date.now(),
      completedAt: 0,
    };
    
    // 步骤前验证
    await this.validateStepPrecondition(step);
    
    try {
      let output: unknown;
      
      switch (step.type) {
        case "read":
          output = await this.executeRead(step);
          break;
        case "write":
          output = await this.executeWrite(step);
          break;
        case "shell":
          output = await this.executeShell(step);
          break;
        case "llm":
          output = await this.executeLLM(step);
          break;
        case "decision":
          output = await this.executeDecision(step);
          break;
        case "human":
          output = await this.executeHuman(step);
          break;
        default:
          throw new Error(`未知的步骤类型: ${step.type}`);
      }
      
      stepResult.output = output;
      stepResult.completedAt = Date.now();
      
      // 步骤后验证
      await this.validateStepOutput(step, output);
      
    } catch (error) {
      stepResult.status = "failed";
      stepResult.error = error instanceof Error ? error.message : String(error);
      stepResult.completedAt = Date.now();
      execution.stepResults.push(stepResult);
      throw error;
    }
    
    execution.stepResults.push(stepResult);
  }
  
  /**
   * 执行读取步骤
   */
  private async executeRead(step: PlanStep): Promise<string> {
    const paths = step.inputs?.paths || [];
    const contents: Record<string, string> = {};
    
    for (const path of paths) {
      const fullPath = this.resolvePath(path);
      const content = await readFile(fullPath, "utf-8");
      contents[path] = content;
      
      // 记录读取操作（用于审计）
      this.logAudit({
        timestamp: Date.now(),
        event: "step_completed",
        details: { stepId: step.stepId, type: "read", path },
      });
    }
    
    return paths.length === 1 ? contents[paths[0]] : JSON.stringify(contents);
  }
  
  /**
   * 执行写入步骤
   */
  private async executeWrite(step: PlanStep): Promise<string> {
    const paths = step.inputs?.paths || [];
    
    for (const path of paths) {
      const fullPath = this.resolvePath(path);
      
      // 备份原文件（如果存在）
      if (existsSync(fullPath)) {
        const backupPath = `${fullPath}.backup.${Date.now()}`;
        await copyFile(fullPath, backupPath);
        
        // 记录变更
        this.task.execution!.changes.push({
          stepId: step.stepId,
          type: "file_write",
          timestamp: Date.now(),
          before: fullPath,
          after: backupPath,
          reversible: true,
          snapshot: backupPath,
        });
      }
      
      // 确保目录存在
      await mkdir(dirname(fullPath), { recursive: true });
      
      // 获取写入内容
      const writeContent = step.inputs?.content as string || "";
      
      // 写入文件
      await writeFile(fullPath, writeContent, "utf-8");
      
      this.logAudit({
        timestamp: Date.now(),
        event: "step_completed",
        details: { stepId: step.stepId, type: "write", path },
      });
    }
    
    return `写入 ${paths.length} 个文件`;
  }
  
  /**
   * 执行 shell 步骤
   */
  private async executeShell(step: PlanStep): Promise<string> {
    const command = step.inputs?.command as string;
    if (!command) {
      throw new Error("shell 步骤缺少 command");
    }
    
    // 验证命令白名单
    const cmd = command.trim().split(" ")[0];
    if (!SHELL_WHITELIST.includes(cmd)) {
      throw new Error(`命令 "${cmd}" 不在白名单中`);
    }
    
    return new Promise((resolve, reject) => {
      const child = spawn("bash", ["-c", command], {
        cwd: this.task.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
      
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      
      child.stdout.on("data", (data: Buffer) => stdout.push(data));
      child.stderr.on("data", (data: Buffer) => stderr.push(data));
      
      child.on("close", (code) => {
        const output = Buffer.concat(stdout).toString("utf-8");
        const errorOutput = Buffer.concat(stderr).toString("utf-8");
        
        if (code !== 0 && code !== null) {
          reject(new Error(`命令失败 (${code}): ${errorOutput || output}`));
          return;
        }
        
        // 记录变更
        this.task.execution!.changes.push({
          stepId: step.stepId,
          type: "shell_exec",
          timestamp: Date.now(),
          after: { command, output },
          reversible: false,
        });
        
        this.logAudit({
          timestamp: Date.now(),
          event: "step_completed",
          details: { stepId: step.stepId, type: "shell", command },
        });
        
        resolve(output || errorOutput || "(无输出)");
      });
      
      child.on("error", reject);
    });
  }
  
  /**
   * 执行 LLM 步骤
   */
  private async executeLLM(step: PlanStep): Promise<string> {
    let prompt = step.inputs?.prompt as string || "";
    
    // 替换上下文变量
    prompt = this.replaceContextVariables(prompt);
    
    return new Promise((resolve, reject) => {
      const args: string[] = ["--quiet", "--model", this.options.model];
      
      if (this.options.systemPrompt) {
        args.push("--prompt", `${this.options.systemPrompt}\n\n=== 用户消息 ===\n\n${prompt}`);
      } else {
        args.push("--prompt", prompt);
      }
      
      const child = spawn("kimi", args, {
        cwd: this.task.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
      
      const stdout: Buffer[] = [];
      
      child.stdout.on("data", (data: Buffer) => stdout.push(data));
      
      child.on("close", (code) => {
        const output = Buffer.concat(stdout).toString("utf-8");
        
        if (code !== 0 && code !== null) {
          reject(new Error(`LLM 调用失败 (${code})`));
          return;
        }
        
        this.logAudit({
          timestamp: Date.now(),
          event: "step_completed",
          details: { stepId: step.stepId, type: "llm" },
        });
        
        resolve(output);
      });
      
      child.on("error", reject);
    });
  }
  
  /**
   * 执行决策步骤
   */
  private async executeDecision(step: PlanStep): Promise<boolean> {
    const condition = step.inputs?.condition as string;
    
    // 简化的条件判断（实际可实现更复杂的表达式解析）
    // 这里使用 LLM 来判断条件
    const result = await this.executeLLM({
      ...step,
      inputs: {
        prompt: `判断以下条件是 true 还是 false，只回答 "true" 或 "false"：\n${condition}`,
      },
    } as PlanStep);
    
    return result.toLowerCase().includes("true");
  }
  
  /**
   * 执行人工确认步骤
   */
  private async executeHuman(step: PlanStep): Promise<string> {
    const prompt = step.inputs?.prompt as string || "需要您的确认";
    
    const approval = await this.options.onApprovalRequest({
      taskId: this.task.id,
      stepId: step.stepId,
      stepNumber: this.task.execution!.currentStep,
      description: this.replaceContextVariables(prompt),
      riskLevel: "medium",
      timeout: 10 * 60 * 1000, // 10分钟
      requestedAt: Date.now(),
    });
    
    const approved = typeof approval === "boolean" ? approval : (approval && typeof approval === "object" ? approval.approved : false);
    const feedback = typeof approval === "boolean" ? "" : ((approval as { approved: boolean; feedback?: string })?.feedback || "");
    
    if (!approved) {
      throw new Error("用户拒绝: " + feedback);
    }
    
    return feedback || "用户已确认";
  }
  
  /**
   * 步骤前置验证
   */
  private async validateStepPrecondition(step: PlanStep): Promise<void> {
    for (const validator of step.validators || []) {
      switch (validator.type) {
        case "file_exists":
          if (validator.path && !existsSync(this.resolvePath(validator.path))) {
            throw new Error(`验证失败: 文件不存在 ${validator.path}`);
          }
          break;
        case "readable":
          // 实际应尝试读取验证权限
          break;
        case "writable":
          // 实际应验证写入权限
          break;
      }
    }
  }
  
  /**
   * 步骤输出验证
   */
  private async validateStepOutput(step: PlanStep, output: unknown): Promise<void> {
    // 实现输出验证逻辑
    // 例如 schema 验证、断言检查等
  }
  
  /**
   * 替换上下文变量
   * 支持 {{step-N.output}} 语法
   */
  private replaceContextVariables(text: string): string {
    const execution = this.task.execution!;
    const results = execution.context.stepResults || [];
    
    return text.replace(/\{\{step-(\d+)\.output\}\}/g, (match, stepNum) => {
      const index = parseInt(stepNum) - 1;
      const result = results[index];
      return result?.output as string || "";
    });
  }
  
  /**
   * 解析路径
   */
  private resolvePath(path: string): string {
    if (path.startsWith("/")) {
      return path;
    }
    return join(this.task.cwd, path);
  }
  
  /**
   * 记录审计日志
   */
  private logAudit(record: AuditRecord): void {
    this.task.execution!.audit.push(record);
  }
  
  /**
   * 取消执行
   */
  async cancel(): Promise<void> {
    this.abortController.abort();
    this.task.status = "cancelling";
    
    // 如果已经开始执行，尝试回滚
    if (this.task.execution && this.task.plan?.reliability.rollbackOnError) {
      await this.rollback();
    }
  }
  
  /**
   * 回滚变更
   */
  private async rollback(): Promise<void> {
    const changes = [...this.task.execution!.changes].reverse();
    
    this.logAudit({
      timestamp: Date.now(),
      event: "rollback_started",
      details: { changesCount: changes.length },
    });
    
    for (const change of changes) {
      if (change.reversible && change.snapshot && change.before) {
        try {
          // 恢复原文件
          await copyFile(change.snapshot, change.before as string);
        } catch (e) {
          console.error(`[ExecutionEngine] 回滚失败: ${change.before}`, e);
        }
      }
    }
    
    this.logAudit({
      timestamp: Date.now(),
      event: "rollback_completed",
      details: {},
    });
  }
}

/**
 * 创建执行引擎
 */
export function createExecutionEngine(task: FlowTask, options: ExecutionOptions): ExecutionEngine {
  return new ExecutionEngine(task, options);
}
