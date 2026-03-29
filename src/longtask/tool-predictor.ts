/**
 * 工具调用预测器
 *
 * 基于用户 prompt 快速预测 Kimi 在执行任务时可能调用的工具序列。
 * 使用规则引擎进行快速推断，不依赖 LLM，保证任务提交时的响应速度。
 */

import type { PredictedToolCall, ToolPrediction } from "./types.js";

// 工具名到步骤描述的映射（与 parser.ts 保持一致）
export const TOOL_STEP_MAP: Record<string, string> = {
  Shell: "执行命令",
  ReadFile: "读取文件",
  WriteFile: "写入文件",
  StrReplaceFile: "修改文件",
  Grep: "搜索代码",
  Glob: "查找文件",
  Agent: "启动子代理",
  TaskList: "任务管理",
  TaskOutput: "获取任务输出",
  SearchWeb: "搜索网络",
  FetchURL: "获取网页",
  AskUserQuestion: "询问用户",
  EnterPlanMode: "计划模式",
  ExitPlanMode: "退出计划",
  SetTodoList: "更新待办",
};

// 规则定义：关键词/模式 -> 预测工具序列
interface PredictionRule {
  patterns: RegExp[];
  tools: PredictedToolCall[];
  priority: number; // 优先级，高优先级覆盖低优先级
}

const DEFAULT_RULES: PredictionRule[] = [
  {
    patterns: [/重构|refactor|rewrite/i],
    tools: [
      { name: "Glob", reason: "定位相关文件" },
      { name: "ReadFile", reason: "读取现有代码" },
      { name: "Grep", reason: "搜索引用和调用点" },
      { name: "StrReplaceFile", reason: "修改代码" },
      { name: "Shell", reason: "运行测试验证" },
    ],
    priority: 10,
  },
  {
    patterns: [/分析.*项目|analyze.*project|codebase|分析.*代码/i],
    tools: [
      { name: "Glob", reason: "扫描项目结构" },
      { name: "ReadFile", reason: "读取关键文件" },
      { name: "Grep", reason: "搜索相关代码" },
      { name: "Agent", reason: "分配子代理深入分析" },
    ],
    priority: 9,
  },
  {
    patterns: [/搜索|search|find all|grep/i],
    tools: [
      { name: "Grep", reason: "搜索匹配内容" },
      { name: "Glob", reason: "确定搜索范围" },
      { name: "ReadFile", reason: "查看搜索结果" },
    ],
    priority: 8,
  },
  {
    patterns: [/创建.*文件|生成.*文件|write.*file|new file/i],
    tools: [
      { name: "Glob", reason: "检查现有文件" },
      { name: "ReadFile", reason: "参考相关文件" },
      { name: "WriteFile", reason: "创建新文件" },
      { name: "Shell", reason: "验证文件创建" },
    ],
    priority: 8,
  },
  {
    patterns: [/测试|test|spec|jest|mocha|vitest/i],
    tools: [
      { name: "Shell", reason: "运行测试命令" },
      { name: "ReadFile", reason: "查看测试文件" },
      { name: "StrReplaceFile", reason: "修复测试代码" },
    ],
    priority: 8,
  },
  {
    patterns: [/构建|build|compile|打包|webpack|vite|tsc/i],
    tools: [
      { name: "Shell", reason: "执行构建命令" },
      { name: "ReadFile", reason: "查看构建配置" },
      { name: "StrReplaceFile", reason: "修复构建问题" },
    ],
    priority: 8,
  },
  {
    patterns: [/安装依赖|npm install|pip install|yarn add/i],
    tools: [
      { name: "Shell", reason: "执行安装命令" },
      { name: "ReadFile", reason: "查看依赖配置" },
    ],
    priority: 7,
  },
  {
    patterns: [/网络搜索|搜索.*网上|search.*web|latest|news/i],
    tools: [
      { name: "SearchWeb", reason: "搜索网络信息" },
      { name: "FetchURL", reason: "获取网页详情" },
    ],
    priority: 8,
  },
  {
    patterns: [/子代理|subagent|多.*agent|并行.*分析/i],
    tools: [
      { name: "Agent", reason: "启动子代理" },
      { name: "TaskList", reason: "管理子任务" },
      { name: "TaskOutput", reason: "获取子代理结果" },
    ],
    priority: 8,
  },
  {
    patterns: [/计划|plan|规划|设计.*方案/i],
    tools: [
      { name: "EnterPlanMode", reason: "进入计划模式" },
      { name: "ReadFile", reason: "收集计划所需信息" },
      { name: "ExitPlanMode", reason: "完成计划" },
    ],
    priority: 7,
  },
  {
    patterns: [/迁移|migrate|migration/i],
    tools: [
      { name: "Glob", reason: "定位迁移范围" },
      { name: "ReadFile", reason: "读取旧代码" },
      { name: "WriteFile", reason: "写入新代码" },
      { name: "StrReplaceFile", reason: "修改引用" },
      { name: "Shell", reason: "验证迁移结果" },
    ],
    priority: 9,
  },
  {
    patterns: [/批量|batch|bulk|所有文件|all files/i],
    tools: [
      { name: "Glob", reason: "批量定位文件" },
      { name: "ReadFile", reason: "读取样本文件" },
      { name: "StrReplaceFile", reason: "批量修改" },
      { name: "Shell", reason: "验证批量操作" },
    ],
    priority: 8,
  },
  {
    patterns: [/统计|count|statistics|汇总/i],
    tools: [
      { name: "Grep", reason: "统计匹配项" },
      { name: "Glob", reason: "确定统计范围" },
      { name: "Shell", reason: "执行统计命令" },
    ],
    priority: 6,
  },
  {
    patterns: [/比较|diff|对比/i],
    tools: [
      { name: "ReadFile", reason: "读取对比文件" },
      { name: "Shell", reason: "执行 diff 命令" },
    ],
    priority: 6,
  },
  {
    patterns: [/删除|remove|delete|清理/i],
    tools: [
      { name: "Glob", reason: "定位删除目标" },
      { name: "Shell", reason: "执行删除命令" },
      { name: "ReadFile", reason: "确认删除内容" },
    ],
    priority: 7,
  },
  {
    patterns: [/git|版本|commit|push|tag/i],
    tools: [
      { name: "Shell", reason: "执行 git 命令" },
      { name: "ReadFile", reason: "查看变更文件" },
    ],
    priority: 6,
  },
  {
    patterns: [/部署|deploy|发布|release/i],
    tools: [
      { name: "Shell", reason: "执行部署命令" },
      { name: "ReadFile", reason: "查看部署配置" },
    ],
    priority: 7,
  },
];

// 默认兜底预测：通用任务
const DEFAULT_PREDICTION: PredictedToolCall[] = [
  { name: "ReadFile", reason: "了解上下文" },
  { name: "Shell", reason: "执行相关命令" },
];

/**
 * 工具调用预测器
 */
export class ToolPredictor {
  private rules: PredictionRule[];

  constructor(rules: PredictionRule[] = DEFAULT_RULES) {
    this.rules = [...rules].sort((a, b) => b.priority - a.priority);
  }

  /**
   * 预测工具调用序列
   */
  predict(prompt: string): ToolPrediction {
    const lowerPrompt = prompt.toLowerCase();
    let matchedTools: PredictedToolCall[] = [];
    let matchedRules = 0;
    const reasoningParts: string[] = [];

    for (const rule of this.rules) {
      const isMatch = rule.patterns.some((p) => p.test(lowerPrompt));
      if (isMatch) {
        matchedTools = matchedTools.concat(rule.tools);
        matchedRules++;
        reasoningParts.push(`匹配规则: ${rule.tools.map((t) => t.name).join(", ")}`);
      }
    }

    // 去重：相同工具只保留第一次出现
    const seen = new Set<string>();
    const dedupedTools: PredictedToolCall[] = [];
    for (const tool of matchedTools) {
      if (!seen.has(tool.name)) {
        seen.add(tool.name);
        dedupedTools.push(tool);
      }
    }

    // 如果没有匹配到任何规则，使用默认预测
    const finalTools = dedupedTools.length > 0 ? dedupedTools : DEFAULT_PREDICTION;
    if (dedupedTools.length === 0) {
      reasoningParts.push("未匹配特定规则，使用默认预测");
    }

    // 置信度计算
    // 匹配规则越多，置信度越高，但上限 0.9（规则预测不是 100% 准确）
    const confidence = Math.min(0.9, 0.5 + matchedRules * 0.15);

    return {
      predictedTools: finalTools,
      confidence,
      reasoning: reasoningParts.join("; "),
    };
  }

  /**
   * 快速预测：只返回预测的工具数量
   */
  predictCount(prompt: string): number {
    return this.predict(prompt).predictedTools.length;
  }
}

// 默认预测器实例
export const defaultToolPredictor = new ToolPredictor();

/**
 * 基于预测和实际工具调用计算进度百分比
 */
export function calculateProgressPercent(
  completedSteps: number,
  prediction: ToolPrediction | undefined,
  maxTurns: number
): { percent: number; predictedTotal: number; completedSteps: number } {
  // 基础预测总数
  let predictedTotal = prediction?.predictedTools.length || Math.max(3, Math.min(maxTurns, 5));

  // 如果实际步骤已经超过预测，动态调整分母（预留 2 步缓冲）
  predictedTotal = Math.max(predictedTotal, completedSteps + 2);

  // 计算百分比，上限 95%（留到完成时跳到 100%）
  const percent = Math.min(95, Math.round((completedSteps / predictedTotal) * 100));

  return { percent, predictedTotal, completedSteps };
}

/**
 * 格式化预测摘要
 */
export function formatPredictionSummary(prediction: ToolPrediction | undefined): string {
  if (!prediction || prediction.predictedTools.length === 0) {
    return "未预测";
  }
  const tools = prediction.predictedTools.map((t) => TOOL_STEP_MAP[t.name] || t.name).join(" → ");
  return `预计步骤: ${tools} (置信度 ${Math.round(prediction.confidence * 100)}%)`;
}
