/**
 * Workflow Parser - 自然语言工作流解析器
 * 
 * 将用户的自然语言描述解析为结构化工作流
 */

import type { ParsedWorkflowInfo, WorkflowNodeDefinition, NodeConnection, WorkflowVariable } from "./types.js";
import { spawn } from "node:child_process";

export interface ParseOptions {
  model?: string;
  cwd?: string;
  timeout?: number;
}

/**
 * 解析自然语言描述为工作流
 */
export async function parseWorkflowFromNaturalLanguage(
  description: string,
  options: ParseOptions = {}
): Promise<ParsedWorkflowInfo> {
  const { model = "kimi", cwd = process.cwd(), timeout = 60000 } = options;

  const systemPrompt = buildSystemPrompt();
  const fullPrompt = `${systemPrompt}\n\n用户描述: ${description}\n\n请解析为 JSON 格式:`;

  return new Promise((resolve, reject) => {
    const args = ["--quiet", "--model", model, "--prompt", fullPrompt];

    const child = spawn("kimi", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      reject(new Error(`解析超时 (${timeout}ms)`));
    }, timeout);

    child.stdout.on("data", (data: Buffer) => stdout.push(data));
    child.stderr.on("data", (data: Buffer) => stderr.push(data));

    child.on("error", (err) => {
      clearTimeout(timeoutId);
      reject(new Error(`调用 Kimi 失败: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timeoutId);

      if (timedOut) return;

      const output = Buffer.concat(stdout).toString("utf-8").trim();
      const errorOutput = Buffer.concat(stderr).toString("utf-8").trim();

      if (code !== 0 && code !== null) {
        reject(new Error(`Kimi 执行失败: ${errorOutput || `退出码 ${code}`}`));
        return;
      }

      try {
        const result = parseLLMOutput(output);
        resolve(result);
      } catch (e) {
        reject(new Error(`解析结果失败: ${e instanceof Error ? e.message : String(e)}`));
      }
    });
  });
}

/**
 * 构建系统提示词
 */
function buildSystemPrompt(): string {
  return `你是一个工作流解析助手。请将用户的自然语言描述解析为结构化的工作流定义。

你需要输出一个 JSON 对象，包含以下字段：
- name: 工作流名称（简短，不超过20字）
- description: 工作流描述
- cron: crontab 表达式（5个字段：分 时 日 月 周）
- cronDescription: 执行时间的友好描述
- nodes: 节点数组
- connections: 节点连接数组
- variables: 工作流变量定义

Crontab 格式说明：
- 分(0-59) 时(0-23) 日(1-31) 月(1-12) 周(0-6, 0=周日)
- * 表示任意值
- / 表示步长
- - 表示范围
- , 表示列表

常见模式：
- 每小时: 0 * * * *
- 每天8点: 0 8 * * *
- 工作日9点: 0 9 * * 1-5
- 每周日20点: 0 20 * * 0
- 每月1日: 0 0 1 * *

可用节点类型：
1. search - 网络搜索
   - config: { limit?, category?, language? }
   - inputs: { query }
   - outputs: { results, formatted, totalResults }

2. llm - AI生成
   - config: { model?, temperature?, maxTokens? }
   - inputs: { prompt, context?, format? }
   - outputs: { content, raw }

3. send - 发送消息
   - config: { format?, prependTitle?, title? }
   - inputs: { message }
   - outputs: { sent, timestamp }

4. transform - 数据转换
   - config: { mode?, template?, expression? }
   - inputs: { data }
   - outputs: { result, original }

5. condition - 条件判断
   - config: { operator?, value? }
   - inputs: { value }
   - outputs: { result, branch }

输入表达式语法：
- 使用 \\\${nodeId.outputName} 引用其他节点的输出
- 使用 \\\${date:today} 表示今天日期
- 使用 \\\${date:yesterday} 表示昨天日期
- 使用 \\\${variableName} 引用变量

示例1：
用户描述: "每天早上8点，搜索前一天的AI新闻，生成每日晨报，发送给我。"
输出:
{\n  "name": "AI每日晨报",\n  "description": "每天早上搜索AI新闻并生成晨报",\n  "cron": "0 8 * * *",\n  "cronDescription": "每天早上 8:00",\n  "nodes": [\n    {\n      "id": "search",\n      "type": "search",\n      "name": "搜索AI新闻",\n      "config": { "limit": 10, "category": "news", "language": "zh" },\n      "inputs": { "query": "AI人工智能新闻 \\\${date:yesterday}" }\n    },\n    {\n      "id": "generate",\n      "type": "llm",\n      "name": "生成晨报",\n      "config": { "model": "kimi" },\n      "inputs": {\n        "prompt": "请根据以下搜索结果，生成一份简洁的AI每日晨报，包括主要新闻标题和一句话摘要。",\n        "context": "\\\${search.formatted}",\n        "format": "markdown"\n      }\n    },\n    {\n      "id": "send",\n      "type": "send",\n      "name": "发送晨报",\n      "config": { "prependTitle": true, "title": "📰 AI每日晨报" },\n      "inputs": { "message": "\\\${generate.content}" }\n    }\n  ],\n  "connections": [\n    { "from": "search", "to": "generate" },\n    { "from": "generate", "to": "send" }\n  ],\n  "variables": [\n    { "name": "topic", "type": "string", "description": "新闻主题", "defaultValue": "AI人工智能" }\n  ]\n}

示例2：
用户描述: "每小时检查一次服务器状态，如果CPU使用率超过80%就发警告。"
输出:
{\n  "name": "服务器监控",\n  "description": "每小时检查服务器CPU状态",\n  "cron": "0 * * * *",\n  "cronDescription": "每小时",\n  "nodes": [\n    {\n      "id": "check",\n      "type": "shell",\n      "name": "检查CPU",\n      "config": {},\n      "inputs": { "command": "cat /proc/loadavg" }\n    },\n    {\n      "id": "condition",\n      "type": "condition",\n      "name": "判断告警",\n      "config": { "operator": "gt", "value": 0.8 },\n      "inputs": { "value": "\\\${check.cpu}" }\n    },\n    {\n      "id": "alert",\n      "type": "send",\n      "name": "发送告警",\n      "config": { "title": "⚠️ 服务器告警" },\n      "inputs": { "message": "CPU使用率超过80%，请关注！" }\n    }\n  ],\n  "connections": [\n    { "from": "check", "to": "condition" },\n    { "from": "condition", "to": "alert" }\n  ],\n  "variables": []\n}

请只输出 JSON，不要输出其他内容。`;
}

/**
 * 解析 LLM 输出
 */
function parseLLMOutput(output: string): ParsedWorkflowInfo {
  // 尝试从输出中提取 JSON
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`无法从输出中提取 JSON: ${output.substring(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // 验证必要字段
  if (!parsed.name || !parsed.cron || !parsed.nodes) {
    throw new Error(`解析结果缺少必要字段: ${JSON.stringify(parsed)}`);
  }

  // 验证 cron 格式
  if (!isValidCron(parsed.cron)) {
    throw new Error(`无效的 crontab: ${parsed.cron}`);
  }

  // 规范化节点定义
  const nodes: WorkflowNodeDefinition[] = parsed.nodes.map((node: any, index: number) => ({
    id: node.id || `node_${index + 1}`,
    type: node.type,
    name: node.name || `${node.type}节点`,
    description: node.description,
    config: node.config || {},
    inputs: node.inputs || {},
  }));

  // 规范化连接
  const connections: NodeConnection[] = (parsed.connections || []).map((conn: any) => ({
    from: conn.from,
    to: conn.to,
    condition: conn.condition,
  }));

  // 规范化变量
  const variables: WorkflowVariable[] = (parsed.variables || []).map((v: any) => ({
    name: v.name,
    type: v.type || "string",
    description: v.description,
    defaultValue: v.defaultValue,
    required: v.required,
  }));

  return {
    name: parsed.name,
    description: parsed.description,
    cron: parsed.cron,
    cronDescription: parsed.cronDescription || parsed.cron,
    nodes,
    connections,
    variables,
  };
}

/**
 * 验证 crontab 格式
 */
function isValidCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }

  // 简单验证：每个部分应该只包含数字、*、/、-、,
  const validPattern = /^[\d*/,-]+$/;
  return parts.every((part) => validPattern.test(part));
}

/**
 * 快速解析简单任务
 * 
 * 对于简单的定时任务，使用规则直接解析，不调用 LLM
 */
export function quickParse(description: string): ParsedWorkflowInfo | null {
  const patterns = [
    {
      // 每天X点搜索某主题
      regex: /每天.*(\d{1,2})[点:：].*搜索(.*)(新闻|资讯|信息).*生成.*(报告|晨报|日报|汇总)/i,
      build: (match: RegExpMatchArray): ParsedWorkflowInfo => {
        const hour = match[1].padStart(2, "0");
        const topic = match[2].trim();
        return {
          name: `${topic}每日晨报`,
          description: `每天搜索${topic}新闻并生成晨报`,
          cron: `0 ${hour} * * *`,
          cronDescription: `每天 ${hour}:00`,
          nodes: [
            {
              id: "search",
              type: "search",
              name: `搜索${topic}新闻`,
              config: { limit: 10, category: "news", language: "zh" },
              inputs: { query: `${topic} \\\${date:yesterday}` },
            },
            {
              id: "generate",
              type: "llm",
              name: "生成晨报",
              config: { model: "kimi" },
              inputs: {
                prompt: `请根据以下搜索结果，生成一份简洁的${topic}每日晨报，包括主要新闻标题和一句话摘要。`,
                context: "\\${search.formatted}",
                format: "markdown",
              },
            },
            {
              id: "send",
              type: "send",
              name: "发送晨报",
              config: { prependTitle: true, title: `📰 ${topic}每日晨报` },
              inputs: { message: "\\${generate.content}" },
            },
          ],
          connections: [
            { from: "search", to: "generate" },
            { from: "generate", to: "send" },
          ],
          variables: [{ name: "topic", type: "string", description: "新闻主题", defaultValue: topic }],
        };
      },
    },
    {
      // 每小时搜索
      regex: /每.*小时.*搜索(.*)(新闻|资讯)/i,
      build: (match: RegExpMatchArray): ParsedWorkflowInfo => {
        const topic = match[1].trim();
        return {
          name: `${topic}定时搜索`,
          description: `每小时搜索${topic}最新信息`,
          cron: "0 * * * *",
          cronDescription: "每小时",
          nodes: [
            {
              id: "search",
              type: "search",
              name: `搜索${topic}`,
              config: { limit: 5, category: "news" },
              inputs: { query: topic },
            },
            {
              id: "send",
              type: "send",
              name: "发送结果",
              config: { title: `🔍 ${topic}最新资讯` },
              inputs: { message: "\\${search.formatted}" },
            },
          ],
          connections: [{ from: "search", to: "send" }],
          variables: [],
        };
      },
    },
    {
      // 每周X
      regex: /每周([一二三四五六日天]).*搜索/i,
      build: (match: RegExpMatchArray): ParsedWorkflowInfo => {
        const dayMap: Record<string, number> = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0 };
        const day = dayMap[match[1]];
        return {
          name: "每周定时搜索",
          description: `每周${match[1]}定时搜索`,
          cron: `0 9 * * ${day}`,
          cronDescription: `每周${match[1]} 9:00`,
          nodes: [
            {
              id: "search",
              type: "search",
              name: "搜索",
              config: { limit: 10 },
              inputs: { query: "热门新闻" },
            },
            {
              id: "send",
              type: "send",
              name: "发送",
              config: {},
              inputs: { message: "\\${search.formatted}" },
            },
          ],
          connections: [{ from: "search", to: "send" }],
          variables: [],
        };
      },
    },
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern.regex);
    if (match) {
      return pattern.build(match);
    }
  }

  return null;
}

/**
 * 智能解析（先尝试快速解析，失败则使用 LLM）
 */
export async function smartParseWorkflow(
  description: string,
  options: ParseOptions = {}
): Promise<ParsedWorkflowInfo> {
  // 先尝试快速解析
  const quickResult = quickParse(description);
  if (quickResult) {
    console.log("[WorkflowParser] 使用快速解析");
    return quickResult;
  }

  // 使用 LLM 解析
  console.log("[WorkflowParser] 使用 LLM 解析");
  return parseWorkflowFromNaturalLanguage(description, options);
}
