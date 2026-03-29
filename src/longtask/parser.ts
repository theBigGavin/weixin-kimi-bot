/**
 * 从 Kimi CLI 的输出中解析进度信息
 *
 * Kimi CLI --print --output-format stream-json 输出格式:
 * 每行一个 JSON 对象，包含 role/assistant 的 tool_calls 和 content
 */
import type { ProgressInfo, ToolPrediction } from "./types.js";
import { calculateProgressPercent, TOOL_STEP_MAP } from "./tool-predictor.js";



interface ParsedToolCall {
  name: string;
  arguments?: string;
}

interface ParsedStreamEntry {
  toolCalls: ParsedToolCall[];
  think?: string;
  text?: string;
}

/**
 * 解析 Kimi stream-json 输出流
 */
function parseStreamJson(output: string): ParsedStreamEntry {
  const lines = output.split("\n").filter((l) => l.trim());
  const toolCalls: ParsedToolCall[] = [];
  let lastThink = "";
  let lastText = "";

  for (const line of lines) {
    try {
      const json = JSON.parse(line.trim());
      if (json.role === "assistant") {
        // 提取 tool_calls
        if (Array.isArray(json.tool_calls)) {
          for (const tc of json.tool_calls) {
            if (tc.type === "function" && tc.function) {
              toolCalls.push({
                name: tc.function.name,
                arguments: tc.function.arguments,
              });
            }
          }
        }
        // 提取 content (think / text)
        if (Array.isArray(json.content)) {
          for (const c of json.content) {
            if (c.type === "think" && c.think) {
              lastThink = c.think;
            } else if (c.type === "text" && c.text) {
              lastText = c.text;
            }
          }
        }
      }
    } catch {
      // 非 JSON 行，忽略
    }
  }

  return { toolCalls, think: lastThink, text: lastText };
}

/**
 * 解析 Kimi 的输出缓冲区，提取最新的进度信息
 *
 * 当前使用 --print --output-format stream-json 模式，
 * 从 JSON 流中解析 tool_calls 来跟踪实际执行进度。
 */
export function parseProgress(
  output: string,
  prediction: ToolPrediction | undefined,
  maxTurns: number,
  _currentTurnEstimate: number
): ProgressInfo {
  const { toolCalls, think, text } = parseStreamJson(output);

  // 基于实际工具调用次数和预测结果估算百分比
  const actualSteps = toolCalls.length;
  const { percent, predictedTotal } = calculateProgressPercent(actualSteps, prediction, maxTurns);

  let step = "处理中";
  let fileName: string | undefined;
  let detail: string | undefined;

  if (toolCalls.length > 0) {
    const lastTool = toolCalls[toolCalls.length - 1];
    step = TOOL_STEP_MAP[lastTool.name] || `执行 ${lastTool.name}`;

    // 尝试从参数中提取文件名/路径/详情
    if (lastTool.arguments) {
      try {
        const args = JSON.parse(lastTool.arguments);
        fileName = args.path || args.cwd || args.pattern;
        detail = args.description || args.command || lastTool.arguments.slice(0, 120);
      } catch {
        detail = lastTool.arguments.slice(0, 120);
      }
    }

    // 添加进度详情
    const progressDetail = `已完成 ${actualSteps}/${predictedTotal} 步`;
    detail = detail ? `${progressDetail} | ${detail}` : progressDetail;
  } else if (think) {
    step = "思考中";
    detail = think.slice(0, 120);
  } else if (text) {
    step = "生成回复中";
    detail = text.slice(0, 120);
  }

  return {
    step,
    fileName,
    percent,
    detail,
    timestamp: Date.now(),
    predictedTotalSteps: predictedTotal,
    completedSteps: actualSteps,
  };
}

/**
 * 解析命令执行输出的进度信息
 */
export function parseCommandProgress(output: string, command: string, currentTick: number): ProgressInfo {
  const lines = output.split("\n").filter((l) => l.trim());
  const lastLine = lines[lines.length - 1]?.trim() || "";

  // 根据输出内容推断步骤
  let step = "执行命令中";
  if (lastLine.match(/npm|node|tsc|build/i)) {
    step = "构建/打包中";
  } else if (lastLine.match(/git|version|tag/i)) {
    step = "版本更新中";
  } else if (lastLine.match(/test|spec/i)) {
    step = "运行测试中";
  } else if (lastLine.match(/install|download/i)) {
    step = "安装依赖中";
  }

  // 命令任务通常很快，按时间估算进度（最多2分钟）
  const estimatedTotalTicks = 4; // 4 * 30s = 2分钟
  const percent = Math.min(95, Math.round((currentTick / estimatedTotalTicks) * 100));

  return {
    step,
    percent,
    detail: lastLine.slice(0, 100) || command,
    timestamp: Date.now(),
  };
}

/**
 * 从 Kimi stream-json 输出中提取最终文本结果
 */
export function extractFinalResult(output: string): string {
  const lines = output.split("\n").filter((l) => l.trim());
  // 从后往前找最后一个 assistant 的 text 内容
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const json = JSON.parse(lines[i]);
      if (json.role === "assistant" && Array.isArray(json.content)) {
        for (const c of json.content) {
          if (c.type === "text" && c.text) {
            return c.text;
          }
        }
      }
    } catch {
      // 忽略解析错误
    }
  }
  // 回退：返回原始输出
  return output;
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
