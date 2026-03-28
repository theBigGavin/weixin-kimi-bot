/**
 * 计划生成器
 * 
 * 将自然语言意图转换为结构化计划 (ValidatedPlan)
 * LLM 只负责生成计划，不直接执行操作
 */

import { spawn } from "node:child_process";
import type { 
  ValidatedPlan, 
  PlanStep, 
  StepType, 
  RiskLevel, 
  ErrorAction
} from "./types.js";

/**
 * 计划生成结果
 */
export interface PlanGenerationResult {
  success: boolean;
  plan?: ValidatedPlan;
  error?: string;
  rawOutput?: string;
}

/**
 * 验证结果
 */
interface ValidationResult_internal {
  syntaxValid: boolean;
  semanticValid: boolean;
  riskLevel: RiskLevel;
  requiredApproval: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * 生成结构化计划
 * 
 * 流程：
 * 1. 调用 LLM 分析用户意图并生成候选计划
 * 2. 多层验证（语法 + 语义）
 * 3. 风险评估
 * 4. 返回验证后的计划
 */
export async function generatePlan(
  prompt: string,
  options: {
    model: string;
    cwd: string;
    systemPrompt?: string;
    maxSteps?: number;
    timeout?: number;
  }
): Promise<PlanGenerationResult> {
  try {
    // 构建计划生成提示词
    const planPrompt = buildPlanGenerationPrompt(prompt, options.maxSteps || 20);
    
    // 调用 LLM 生成计划
    const llmResult = await callLLM(planPrompt, options);
    
    if (!llmResult.success) {
      return {
        success: false,
        error: `LLM 调用失败: ${llmResult.error || "未知错误"}`,
      };
    }
    
    // 解析 LLM 输出为结构化计划
    const parsedPlan = parsePlanFromLLMOutput(llmResult.output || "", prompt);
    
    if (!parsedPlan) {
      return {
        success: false,
        error: "无法解析 LLM 生成的计划",
        rawOutput: llmResult.output,
      };
    }
    
    // 多层验证
    const validation = validatePlan(parsedPlan);
    
    // 更新验证信息
    parsedPlan.validation = {
      syntaxValid: validation.syntaxValid,
      semanticValid: validation.semanticValid,
      riskLevel: validation.riskLevel,
      requiredApproval: validation.requiredApproval,
      warnings: validation.warnings,
    };
    
    if (validation.errors.length > 0) {
      return {
        success: false,
        error: `计划验证失败: ${validation.errors.join(", ")}`,
        rawOutput: llmResult.output,
      };
    }
    
    return {
      success: true,
      plan: parsedPlan,
    };
    
  } catch (error) {
    return {
      success: false,
      error: `计划生成异常: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 构建计划生成提示词
 */
function buildPlanGenerationPrompt(userPrompt: string, maxSteps: number): string {
  return `你是一个任务规划专家。请将用户的请求转换为结构化的执行计划。

## 用户请求
${userPrompt}

## 计划格式要求

请生成一个 JSON 格式的执行计划，遵循以下结构：

\`\`\`json
{
  "version": "1.0",
  "planId": "plan_xxx",
  "goal": "任务目标的简要描述",
  "reliability": {
    "minSteps": 1,
    "maxSteps": ${maxSteps},
    "timeout": 300000,
    "rollbackOnError": true,
    "checkpoints": [2, 5]  // 关键检查点步骤索引
  },
  "steps": [
    {
      "stepId": "step-1",
      "type": "read|write|shell|llm|decision|human",
      "description": "步骤描述",
      "inputs": {
        "paths": ["文件路径"],
        "command": "shell命令",
        "prompt": "LLM提示词",
        "options": {}
      },
      "expectedOutputs": {
        "type": "file|stdout|structured|none",
        "path": "输出文件路径",
        "assertions": []
      },
      "validators": [
        {"type": "file_exists", "path": "..."},
        {"type": "syntax_valid", "language": "typescript"}
      ],
      "onError": "abort|retry|fallback|human"
    }
  ]
}
\`\`\`

## 步骤类型说明

1. **read**: 读取文件内容
   - inputs.paths: 要读取的文件路径数组
   
2. **write**: 写入/修改文件
   - inputs.paths: 目标文件路径
   - 注意：write 操作前必须有 read 操作备份原文件
   
3. **shell**: 执行 shell 命令
   - inputs.command: 命令字符串
   - 只能使用白名单命令: cat, echo, grep, find, ls, mkdir, rm, mv, cp, npm, npx, node, git
   
4. **llm**: 调用 LLM 进行分析
   - inputs.prompt: 发送给 LLM 的提示词
   - 可以使用 {{step-N.output}} 引用之前步骤的输出
   
5. **decision**: 条件判断
   - inputs.condition: 判断条件表达式
   
6. **human**: 人工确认点
   - 在执行关键操作前请求用户确认

## 错误处理策略

- **abort**: 终止整个任务
- **retry**: 重试当前步骤（最多3次）
- **fallback**: 执行备选步骤
- **human**: 转人工处理

## 风险评估标准

高风险操作（需要用户确认）：
- 删除文件
- 修改配置文件
- 执行 git push
- 安装依赖

中风险操作：
- 修改源代码
- 执行 git commit

低风险操作：
- 读取文件
- 搜索代码
- 分析内容

## 输出要求

请只输出 JSON 格式的计划，不要包含其他解释文字。确保：
1. 步骤 ID 唯一
2. 文件路径使用相对路径
3. 命令使用绝对路径或已知的相对路径
4. 每个 write 操作前都有对应的 read 操作

请生成计划：

\`\`\`json`;
}

/**
 * 调用 LLM 生成计划
 */
async function callLLM(
  prompt: string,
  options: {
    model: string;
    cwd: string;
    systemPrompt?: string;
  }
): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const args: string[] = ["--quiet"];
    
    if (options.model) {
      args.push("--model", options.model);
    }
    
    let finalPrompt = prompt;
    if (options.systemPrompt) {
      finalPrompt = `${options.systemPrompt}\n\n=== 用户消息 ===\n\n${prompt}`;
    }
    args.push("--prompt", finalPrompt);
    
    const child = spawn("kimi", args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    
    // 设置 60 秒超时
    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({
        success: false,
        error: "计划生成超时（60秒）",
      });
    }, 60000);
    
    child.stdout.on("data", (data: Buffer) => {
      stdout.push(data);
    });
    
    child.stderr.on("data", (data: Buffer) => {
      stderr.push(data);
    });
    
    child.on("error", (err) => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        error: err.message,
      });
    });
    
    child.on("close", (code) => {
      clearTimeout(timeoutId);
      const output = Buffer.concat(stdout).toString("utf-8");
      const errorOutput = Buffer.concat(stderr).toString("utf-8");
      
      if (code !== 0 && code !== null) {
        resolve({
          success: false,
          error: errorOutput || `退出码: ${code}`,
        });
        return;
      }
      
      resolve({
        success: true,
        output,
      });
    });
  });
}

/**
 * 从 LLM 输出解析计划
 */
function parsePlanFromLLMOutput(output: string, originalPrompt: string): ValidatedPlan | null {
  try {
    // 提取 JSON 部分
    const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/) || 
                      output.match(/\{[\s\S]*\}/);
    
    const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : output;
    const cleanJson = jsonStr.trim();
    
    const parsed = JSON.parse(cleanJson);
    
    // 构建完整计划对象
    const plan: ValidatedPlan = {
      version: parsed.version || "1.0",
      planId: parsed.planId || `plan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      goal: parsed.goal || originalPrompt,
      reliability: {
        minSteps: parsed.reliability?.minSteps || 1,
        maxSteps: parsed.reliability?.maxSteps || 20,
        timeout: parsed.reliability?.timeout || 300000,
        rollbackOnError: parsed.reliability?.rollbackOnError ?? true,
        checkpoints: parsed.reliability?.checkpoints || [],
      },
      steps: (parsed.steps || []).map((step: unknown, index: number) => parseStep(step, index)),
      validation: {
        syntaxValid: false,
        semanticValid: false,
        riskLevel: "medium",
        requiredApproval: true,
        warnings: [],
      },
    };
    
    return plan;
    
  } catch (error) {
    console.error("[PlanGenerator] 解析计划失败:", error);
    return null;
  }
}

/**
 * 解析单个步骤
 */
function parseStep(step: unknown, index: number): PlanStep {
  const s = step as Record<string, unknown>;
  
  return {
    stepId: s.stepId as string || `step-${index + 1}`,
    type: (s.type as StepType) || "llm",
    description: s.description as string || `步骤 ${index + 1}`,
    inputs: s.inputs as Record<string, unknown> || {},
    expectedOutputs: s.expectedOutputs as PlanStep["expectedOutputs"] || undefined,
    validators: (s.validators as PlanStep["validators"]) || [],
    onError: (s.onError as ErrorAction) || "abort",
    fallback: s.fallback as string || undefined,
  };
}

/**
 * 验证计划
 */
function validatePlan(plan: ValidatedPlan): ValidationResult_internal {
  const result: ValidationResult_internal = {
    syntaxValid: true,
    semanticValid: true,
    riskLevel: "low",
    requiredApproval: false,
    warnings: [],
    errors: [],
  };
  
  // 语法验证
  const stepIds = new Set<string>();
  for (const step of plan.steps) {
    // 检查步骤 ID 唯一性
    if (stepIds.has(step.stepId)) {
      result.errors.push(`重复的步骤 ID: ${step.stepId}`);
      result.syntaxValid = false;
    }
    stepIds.add(step.stepId);
    
    // 检查 fallback 引用有效性
    if (step.fallback && !stepIds.has(step.fallback) && step.fallback !== step.stepId) {
      // fallback 可能是后续步骤，暂不报错
    }
  }
  
  // 语义验证和风险评估
  let hasWrite = false;
  let hasShell = false;
  let hasDelete = false;
  
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    
    // write 操作前必须有 read
    if (step.type === "write") {
      hasWrite = true;
      const hasPrevRead = plan.steps.slice(0, i).some(s => 
        s.type === "read" && 
        s.inputs?.paths?.some(p => step.inputs?.paths?.includes(p))
      );
      if (!hasPrevRead) {
        result.warnings.push(`步骤 ${step.stepId}: write 操作前没有对应的 read 操作，无法回滚`);
      }
    }
    
    // shell 命令检查
    if (step.type === "shell") {
      hasShell = true;
      const command = step.inputs?.command || "";
      
      // 检查危险命令
      const dangerousCommands = ["rm -rf", "> /dev", "mkfs", "dd if", "chmod -R 777 /"];
      for (const danger of dangerousCommands) {
        if (command.includes(danger)) {
          result.errors.push(`步骤 ${step.stepId}: 包含危险命令 "${danger}"`);
          result.semanticValid = false;
        }
      }
      
      // 检查删除操作
      if (command.includes("rm ") || command.includes("rm -rf") || command.includes("delete") || command.includes("remove")) {
        hasDelete = true;
      }
    }
  }
  
  // 风险评估
  if (hasDelete) {
    result.riskLevel = "high";
    result.requiredApproval = true;
  } else if (hasWrite || hasShell) {
    result.riskLevel = "medium";
    result.requiredApproval = true;
  }
  
  // 如果步骤数过多，警告
  if (plan.steps.length > 15) {
    result.warnings.push(`计划步骤较多(${plan.steps.length})，建议拆分为子任务`);
  }
  
  return result;
}

/**
 * 格式化计划为人类可读的文本
 */
export function formatPlanForDisplay(plan: ValidatedPlan): string {
  let output = `## 📋 执行计划\n\n`;
  output += `**目标**: ${plan.goal}\n`;
  output += `**步骤数**: ${plan.steps.length}\n`;
  output += `**风险等级**: ${plan.validation.riskLevel === "high" ? "🔴 高" : plan.validation.riskLevel === "medium" ? "🟡 中" : "🟢 低"}\n`;
  output += `**需要确认**: ${plan.validation.requiredApproval ? "是" : "否"}\n\n`;
  
  if (plan.validation.warnings.length > 0) {
    output += `**⚠️ 警告**:\n`;
    for (const warning of plan.validation.warnings) {
      output += `- ${warning}\n`;
    }
    output += "\n";
  }
  
  output += `### 执行步骤\n\n`;
  
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const isCheckpoint = plan.reliability.checkpoints.includes(i);
    const emoji = getStepEmoji(step.type);
    
    output += `${isCheckpoint ? "🔹" : "•"} **${i + 1}. ${step.description}**\n`;
    output += `  ${emoji} 类型: ${step.type}`;
    
    if (step.inputs?.paths) {
      output += ` | 文件: ${step.inputs.paths.join(", ")}`;
    }
    if (step.inputs?.command) {
      output += ` | 命令: ${step.inputs.command.slice(0, 30)}${step.inputs.command.length > 30 ? "..." : ""}`;
    }
    
    output += "\n";
    
    if (isCheckpoint) {
      output += `  ⏸️ 检查点: 执行到此会暂停等待确认\n`;
    }
  }
  
  return output;
}

function getStepEmoji(type: StepType): string {
  const emojis: Record<StepType, string> = {
    read: "📖",
    write: "✏️",
    shell: "⚡",
    llm: "🤖",
    decision: "🔀",
    human: "👤",
  };
  return emojis[type] || "•";
}
