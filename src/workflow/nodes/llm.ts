/**
 * LLM Node - LLM生成节点
 * 
 * 调用 Kimi 生成内容
 */

import type { NodeHandler, NodeContext, NodeResult } from "../types.js";
import { spawn } from "node:child_process";

export interface LLMNodeConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  systemPrompt?: string;
}

export interface LLMNodeInputs {
  prompt: string;
  context?: string;
  format?: "text" | "json" | "markdown";
}

export interface LLMNodeOutputs extends Record<string, unknown> {
  content: string;
  raw: string;
  tokens?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
}

const llmNodeHandler: NodeHandler = {
  type: "llm",
  name: "AI生成",
  description: "使用 Kimi AI 生成内容",
  category: "process",

  configSchema: {
    type: "object",
    title: "LLM配置",
    properties: {
      model: {
        type: "string",
        title: "模型",
        description: "使用的AI模型",
        default: "kimi",
      },
      temperature: {
        type: "number",
        title: "温度",
        description: "生成随机性（0-2）",
        default: 0.7,
        minimum: 0,
        maximum: 2,
      },
      maxTokens: {
        type: "number",
        title: "最大Token",
        description: "生成的最大token数",
        default: 4096,
      },
      timeout: {
        type: "number",
        title: "超时时间",
        description: "生成超时时间（毫秒）",
        default: 120000,
      },
      systemPrompt: {
        type: "string",
        title: "系统提示词",
        description: "系统级提示词",
        default: "你是一个专业的助手。",
      },
    },
  },

  inputSchema: {
    type: "object",
    title: "输入",
    required: ["prompt"],
    properties: {
      prompt: {
        type: "string",
        title: "提示词",
        description: "发送给AI的提示词",
      },
      context: {
        type: "string",
        title: "上下文",
        description: "额外的上下文信息",
      },
      format: {
        type: "string",
        title: "输出格式",
        enum: ["text", "json", "markdown"],
        default: "text",
      },
    },
  },

  outputSchema: {
    type: "object",
    title: "输出",
    properties: {
      content: {
        type: "string",
        title: "生成内容",
      },
      raw: {
        type: "string",
        title: "原始输出",
      },
      tokens: {
        type: "object",
        title: "Token统计",
        properties: {
          prompt: { type: "number" },
          completion: { type: "number" },
          total: { type: "number" },
        },
      },
    },
  },

  async execute(context: NodeContext): Promise<NodeResult> {
    const { inputs, config } = context;
    const prompt = inputs.prompt as string;
    const contextStr = inputs.context as string | undefined;
    const format = (inputs.format as string) || "text";

    if (!prompt || typeof prompt !== "string") {
      return {
        success: false,
        outputs: {},
        error: "缺少必需的输入: prompt",
      };
    }

    // 构建完整提示词
    let fullPrompt = "";
    
    // 添加系统提示词
    const systemPrompt = (config.systemPrompt as string) || "你是一个专业的助手。";
    fullPrompt += systemPrompt + "\n\n";
    
    // 添加上下文
    if (contextStr) {
      fullPrompt += `## 上下文信息\n\n${contextStr}\n\n`;
    }
    
    // 添加格式要求
    if (format === "json") {
      fullPrompt += "## 要求\n\n请以JSON格式输出。\n\n";
    } else if (format === "markdown") {
      fullPrompt += "## 要求\n\n请以Markdown格式输出。\n\n";
    }
    
    // 添加用户提示词
    fullPrompt += `## 任务\n\n${prompt}`;

    try {
      const timeout = (config.timeout as number) || 120000;
      
      console.log(`[LLMNode] 开始生成，提示词长度: ${fullPrompt.length}`);

      const result = await callKimi(fullPrompt, timeout);

      const outputs: LLMNodeOutputs = {
        content: result.trim(),
        raw: result,
      };

      console.log(`[LLMNode] 生成完成，长度: ${result.length}`);

      return {
        success: true,
        outputs,
        logs: [`提示词长度: ${fullPrompt.length}`, `输出长度: ${result.length}`],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[LLMNode] 生成失败: ${errorMsg}`);
      
      return {
        success: false,
        outputs: {},
        error: `AI生成失败: ${errorMsg}`,
        logs: [`生成失败: ${errorMsg}`],
      };
    }
  },
};

/**
 * 调用 Kimi CLI
 */
function callKimi(prompt: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["--quiet", "--prompt", prompt];
    
    const child = spawn("kimi", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      reject(new Error(`生成超时 (${timeout}ms)`));
    }, timeout);

    child.stdout.on("data", (data: Buffer) => {
      stdout.push(data);
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr.push(data);
    });

    child.on("error", (err) => {
      clearTimeout(timeoutId);
      reject(new Error(`调用 Kimi 失败: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timeoutId);
      
      if (timedOut) return;

      const output = Buffer.concat(stdout).toString("utf-8");
      const errorOutput = Buffer.concat(stderr).toString("utf-8");

      if (code !== 0 && code !== null) {
        reject(new Error(`Kimi 退出码 ${code}: ${errorOutput || output}`));
      } else {
        resolve(output.trim());
      }
    });
  });
}

export default llmNodeHandler;
