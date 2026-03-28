/**
 * 从 Kimi CLI 的输出中解析进度信息
 */
import type { ProgressInfo } from "./types.js";

// 步骤关键词映射
const STEP_PATTERNS: { pattern: RegExp; step: string; extractFile?: (m: RegExpMatchArray) => string | undefined }[] = [
  { pattern: /ReadFile|Reading file|read_file/i, step: "读取文件", extractFile: extractFileFromArgs },
  { pattern: /WriteFile|Writing file|write_file/i, step: "写入文件", extractFile: extractFileFromArgs },
  { pattern: /StrReplaceFile|Replacing in file|str_replace_file/i, step: "修改文件", extractFile: extractFileFromArgs },
  { pattern: /Shell|Running shell|execute_shell|run_command/i, step: "执行命令", extractFile: extractCwdFromArgs },
  { pattern: /Grep|Searching|grep/i, step: "搜索代码", extractFile: extractPathFromArgs },
  { pattern: /Glob|Finding files|glob/i, step: "查找文件", extractFile: extractPathFromArgs },
  { pattern: /Agent|Starting subagent|agent/i, step: "启动子代理", extractFile: undefined },
  { pattern: /TaskList|Listing tasks|task/i, step: "任务管理", extractFile: undefined },
  { pattern: /TaskOutput|Fetching output|task_output/i, step: "获取任务输出", extractFile: undefined },
  { pattern: /SearchWeb|Searching web|search_web/i, step: "搜索网络", extractFile: undefined },
  { pattern: /FetchURL|Fetching URL|fetch_url/i, step: "获取网页", extractFile: undefined },
  { pattern: /AskUserQuestion|Asking user|ask_user/i, step: "询问用户", extractFile: undefined },
  { pattern: /EnterPlanMode|Plan mode|plan_mode/i, step: "计划模式", extractFile: undefined },
  { pattern: /ExitPlanMode|Exiting plan|exit_plan/i, step: "退出计划", extractFile: undefined },
];

function extractFileFromArgs(match: RegExpMatchArray): string | undefined {
  // 尝试从 JSON 或文本中提取 path 参数
  const text = match.input || "";
  const pathMatch = text.match(/"path"\s*:\s*"([^"]+)"/);
  if (pathMatch) return pathMatch[1];
  const simplePath = text.match(/path[=:]\s*([^\s,}\]]+)/i);
  if (simplePath) return simplePath[1];
  return undefined;
}

function extractCwdFromArgs(match: RegExpMatchArray): string | undefined {
  const text = match.input || "";
  const cwdMatch = text.match(/"cwd"\s*:\s*"([^"]+)"/);
  if (cwdMatch) return cwdMatch[1];
  return undefined;
}

function extractPathFromArgs(match: RegExpMatchArray): string | undefined {
  const text = match.input || "";
  const pathMatch = text.match(/"path"\s*:\s*"([^"]+)"/);
  if (pathMatch) return pathMatch[1];
  const patternMatch = text.match(/"pattern"\s*:\s*"([^"]+)"/);
  if (patternMatch) return patternMatch[1];
  return undefined;
}

/**
 * 解析 Kimi 的输出缓冲区，提取最新的进度信息
 */
export function parseProgress(output: string, maxTurns: number, currentTurnEstimate: number): ProgressInfo {
  const lines = output.split("\n").filter(l => l.trim());
  const lastLines = lines.slice(-20); // 只看最后20行

  let bestMatch: { step: string; fileName?: string; detail?: string } | null = null;

  // 从后往前找最新的工具调用或步骤
  for (let i = lastLines.length - 1; i >= 0; i--) {
    const line = lastLines[i];
    for (const { pattern, step, extractFile } of STEP_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        bestMatch = {
          step,
          fileName: extractFile ? extractFile(match) : undefined,
          detail: line.trim().slice(0, 100),
        };
        break;
      }
    }
    if (bestMatch) break;
  }

  // 如果没有匹配到工具调用，尝试从一般输出推断
  if (!bestMatch && lines.length > 0) {
    const lastLine = lines[lines.length - 1].trim();
    if (lastLine.length > 0) {
      bestMatch = {
        step: "思考中",
        detail: lastLine.slice(0, 100),
      };
    }
  }

  // 估算百分比
  let percent = Math.min(95, Math.round((currentTurnEstimate / Math.max(1, maxTurns)) * 100));
  if (bestMatch?.step === "思考中") {
    percent = Math.min(percent, 30);
  }

  const step = bestMatch?.step || "处理中";
  const fileName = bestMatch?.fileName;
  const detail = bestMatch?.detail;

  return {
    step,
    fileName,
    percent,
    detail,
    timestamp: Date.now(),
  };
}

/**
 * 格式化进度信息为用户友好的文本
 */
export function formatProgressMessage(task: { id: string; prompt: string }, progress: ProgressInfo): string {
  const percentBar = renderPercentBar(progress.percent);
  let msg = `⏳ **耗时任务进度** \`${task.id}\`\n\n`;
  msg += `${percentBar} ${progress.percent}%\n`;
  msg += `步骤: ${progress.step}\n`;
  if (progress.fileName) {
    msg += `文件: \`${progress.fileName}\`\n`;
  }
  if (progress.detail && progress.detail !== progress.step) {
    msg += `详情: ${progress.detail}\n`;
  }
  msg += `\n_任务: ${task.prompt.slice(0, 40)}${task.prompt.length > 40 ? "..." : ""}_`;
  return msg;
}

function renderPercentBar(percent: number, width = 10): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}
