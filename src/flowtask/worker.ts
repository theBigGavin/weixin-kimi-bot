/**
 * FlowTask Worker
 * 
 * 在子进程中执行 FlowTask 的实际逻辑
 * 通过 stdin 接收任务输入，通过文件输出结果
 * 
 * 这是后台执行器的子进程实现
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { FlowTask, ValidatedPlan, ProgressInfo, PlanStep, StepResult, AuditRecord, ChangeLog } from "./types.js";

// Shell 命令白名单
const SHELL_WHITELIST = [
  "cat", "echo", "grep", "find", "ls", "mkdir", "rm", "mv", "cp",
  "npm", "npx", "node", "git", "tsc", "vitest", "jest", "python", "python3",
  "cd", "pwd", "touch", "head", "tail", "wc", "sort", "uniq",
  "curl", "wget", "tar", "zip", "unzip"
];

/**
 * 任务输入
 */
interface WorkerTaskInput {
  task: {
    id: string;
    agentId: string;
    userId: string;
    chatId: string;
    contextToken: string;
    prompt: string;
    cwd: string;
    model: string;
    systemPrompt?: string;
  };
  plan: ValidatedPlan;
  outputFile: string;
  progressFile: string;
}

/**
 * 执行上下文
 */
interface ExecutionContext {
  workingDir: string;
  env: Record<string, string>;
  stepResults: StepResult[];
}

/**
 * 执行任务
 */
async function executeTask(input: WorkerTaskInput): Promise<void> {
  const { task, plan, outputFile, progressFile } = input;
  
  // 确保输出目录存在
  await mkdir(dirname(outputFile), { recursive: true });

  const progressLogs: ProgressInfo[] = [];
  const audit: AuditRecord[] = [];
  const changes: ChangeLog[] = [];
  
  let currentStep = 0;
  let status: "completed" | "failed" | "cancelled" = "completed";
  let result: string | undefined;
  let error: string | undefined;

  const executionContext: ExecutionContext = {
    workingDir: task.cwd,
    env: {},
    stepResults: [],
  };

  /**
   * 报告进度
   */
  function reportProgress(progress: ProgressInfo): void {
    progressLogs.push(progress);
    appendFileSync(progressFile, JSON.stringify(progress) + "\n");
  }

  /**
   * 记录审计日志
   */
  function logAudit(record: AuditRecord): void {
    audit.push(record);
  }

  try {
    reportProgress({
      step: "开始执行计划",
      stepNumber: 0,
      totalSteps: plan.steps.length,
      percent: 5,
      timestamp: Date.now(),
    });

    logAudit({
      timestamp: Date.now(),
      event: "plan_validated",
      details: { stepCount: plan.steps.length },
    });

    // 执行所有步骤
    for (let i = 0; i < plan.steps.length; i++) {
      currentStep = i;
      const step = plan.steps[i];

      // 检查是否是检查点
      if (plan.reliability.checkpoints.includes(i) && i > 0) {
        reportProgress({
          step: `检查点: 即将执行 "${step.description}"`,
          stepNumber: i + 1,
          totalSteps: plan.steps.length,
          percent: Math.round((i / plan.steps.length) * 100),
          timestamp: Date.now(),
          waitingForApproval: true,
        });
        
        // Worker 模式下，检查点自动通过（人机协作在主进程处理）
        logAudit({
          timestamp: Date.now(),
          event: "human_approved",
          details: { stepId: step.stepId, auto: true },
        });
      }

      // 报告进度
      reportProgress({
        step: step.description,
        stepNumber: i + 1,
        totalSteps: plan.steps.length,
        fileName: step.inputs?.paths?.[0],
        percent: Math.round((i / plan.steps.length) * 100),
        timestamp: Date.now(),
      });

      // 执行步骤
      try {
        const output = await executeStep(step, executionContext, task, changes, logAudit);
        
        const stepResult: StepResult = {
          stepId: step.stepId,
          status: "success",
          output,
          startedAt: Date.now(),
          completedAt: Date.now(),
        };
        
        executionContext.stepResults.push(stepResult);
        
        logAudit({
          timestamp: Date.now(),
          event: "step_completed",
          details: { stepId: step.stepId, type: step.type },
        });

      } catch (stepError) {
        const errorMsg = stepError instanceof Error ? stepError.message : String(stepError);
        
        const stepResult: StepResult = {
          stepId: step.stepId,
          status: "failed",
          error: errorMsg,
          startedAt: Date.now(),
          completedAt: Date.now(),
        };
        
        executionContext.stepResults.push(stepResult);
        
        logAudit({
          timestamp: Date.now(),
          event: "step_failed",
          details: { stepId: step.stepId, error: errorMsg },
        });

        // 根据错误处理策略决定
        if (step.onError === "retry") {
          // 简单重试一次
          i--;
          continue;
        } else if (step.onError === "fallback" && step.fallback) {
          // 找到 fallback 步骤
          const fallbackIndex = plan.steps.findIndex(s => s.stepId === step.fallback);
          if (fallbackIndex !== -1) {
            i = fallbackIndex - 1; // 循环会 +1
            continue;
          }
        }
        
        // 中止或转人工
        throw stepError;
      }
    }

    // 任务完成
    const successCount = executionContext.stepResults.filter(r => r.status === "success").length;
    result = `任务完成\n\n成功步骤: ${successCount}/${plan.steps.length}\n变更数: ${changes.length}`;
    
    reportProgress({
      step: "已完成",
      stepNumber: plan.steps.length,
      totalSteps: plan.steps.length,
      percent: 100,
      timestamp: Date.now(),
    });

    logAudit({
      timestamp: Date.now(),
      event: "task_completed",
      details: { totalSteps: plan.steps.length, successSteps: successCount },
    });

  } catch (execError) {
    status = "failed";
    error = execError instanceof Error ? execError.message : String(execError);
    
    logAudit({
      timestamp: Date.now(),
      event: "task_failed",
      details: { error },
    });
  }

  // 写入最终结果
  const output = {
    status,
    result,
    error,
    progressLogs,
    audit,
    changes,
  };

  writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf-8");
}

/**
 * 执行单个步骤
 */
async function executeStep(
  step: PlanStep,
  context: ExecutionContext,
  task: WorkerTaskInput["task"],
  changes: ChangeLog[],
  logAudit: (record: AuditRecord) => void
): Promise<unknown> {
  switch (step.type) {
    case "read":
      return executeRead(step, task.cwd);
    case "write":
      return executeWrite(step, task.cwd, changes);
    case "shell":
      return executeShell(step, task.cwd, changes, logAudit);
    case "llm":
      return executeLLM(step, task, context);
    case "decision":
      return executeDecision(step, context);
    default:
      throw new Error(`未知的步骤类型: ${step.type}`);
  }
}

/**
 * 执行读取步骤
 */
async function executeRead(step: PlanStep, cwd: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const paths = step.inputs?.paths || [];
  const contents: Record<string, string> = {};

  for (const path of paths) {
    const fullPath = path.startsWith("/") ? path : join(cwd, path);
    const content = await readFile(fullPath, "utf-8");
    contents[path] = content;
  }

  return paths.length === 1 ? contents[paths[0]] : JSON.stringify(contents);
}

/**
 * 执行写入步骤
 */
async function executeWrite(step: PlanStep, cwd: string, changes: ChangeLog[]): Promise<string> {
  const { writeFile, copyFile, mkdir } = await import("node:fs/promises");
  const paths = step.inputs?.paths || [];

  for (const path of paths) {
    const fullPath = path.startsWith("/") ? path : join(cwd, path);
    
    // 备份原文件
    if (existsSync(fullPath)) {
      const backupPath = `${fullPath}.backup.${Date.now()}`;
      await copyFile(fullPath, backupPath);
      
      changes.push({
        stepId: step.stepId,
        type: "file_write",
        timestamp: Date.now(),
        before: fullPath,
        after: backupPath,
        reversible: true,
        snapshot: backupPath,
      });
    }

    await mkdir(dirname(fullPath), { recursive: true });
    const content = step.inputs?.content as string || "";
    await writeFile(fullPath, content, "utf-8");
  }

  return `写入 ${paths.length} 个文件`;
}

/**
 * 执行 Shell 步骤
 */
async function executeShell(
  step: PlanStep,
  cwd: string,
  changes: ChangeLog[],
  logAudit: (record: AuditRecord) => void
): Promise<string> {
  const { spawn } = await import("node:child_process");
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
      cwd,
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

      changes.push({
        stepId: step.stepId,
        type: "shell_exec",
        timestamp: Date.now(),
        after: { command, output },
        reversible: false,
      });

      logAudit({
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
async function executeLLM(
  step: PlanStep,
  task: WorkerTaskInput["task"],
  context: ExecutionContext
): Promise<string> {
  const { spawn } = await import("node:child_process");
  
  let prompt = step.inputs?.prompt as string || "";
  
  // 替换上下文变量
  prompt = prompt.replace(/\{\{step-(\d+)\.output\}\}/g, (match, stepNum) => {
    const index = parseInt(stepNum) - 1;
    const result = context.stepResults[index];
    return result?.output as string || "";
  });

  return new Promise((resolve, reject) => {
    const args: string[] = ["--quiet", "--model", task.model];
    
    if (task.systemPrompt) {
      args.push("--prompt", `${task.systemPrompt}\n\n=== 用户消息 ===\n\n${prompt}`);
    } else {
      args.push("--prompt", prompt);
    }

    const child = spawn("kimi", args, {
      cwd: task.cwd,
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

      resolve(output);
    });

    child.on("error", reject);
  });
}

/**
 * 执行决策步骤
 */
async function executeDecision(step: PlanStep, context: ExecutionContext): Promise<boolean> {
  // 简化的条件判断：返回 true
  // 实际可实现更复杂的表达式解析
  const condition = step.inputs?.condition as string || "";
  
  // 简单的条件评估
  if (condition.includes("exists") || condition.includes("存在")) {
    return true;
  }
  if (condition.includes("not") || condition.includes("不存在")) {
    return false;
  }
  
  return true;
}

/**
 * 主入口
 */
async function main(): Promise<void> {
  const inputFile = process.argv[2];
  
  if (!inputFile) {
    console.error("用法: node worker.js <input-file>");
    process.exit(1);
  }

  if (!existsSync(inputFile)) {
    console.error(`输入文件不存在: ${inputFile}`);
    process.exit(1);
  }

  try {
    const input = JSON.parse(readFileSync(inputFile, "utf-8")) as WorkerTaskInput;
    await executeTask(input);
    process.exit(0);
  } catch (error) {
    console.error("执行失败:", error);
    process.exit(1);
  }
}

// 运行
main();
