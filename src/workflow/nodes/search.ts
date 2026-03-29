/**
 * Search Node - 搜索节点
 * 
 * 使用 SearXNG 执行网络搜索
 */

import type { NodeHandler, NodeContext, NodeResult } from "../types.js";
import { searchWeb, formatSearchResults } from "../../services/searxng.js";

export interface SearchNodeConfig {
  limit?: number;
  category?: string;
  language?: string;
  safesearch?: number;
  timeout?: number;
}

export interface SearchNodeInputs {
  query: string;
}

export interface SearchNodeOutputs extends Record<string, unknown> {
  results: Array<{
    title: string;
    url: string;
    content: string;
    engine?: string;
    score?: number;
  }>;
  formatted: string;
  totalResults: number;
  query: string;
}

const searchNodeHandler: NodeHandler = {
  type: "search",
  name: "网络搜索",
  description: "使用 SearXNG 搜索网络信息",
  category: "input",

  configSchema: {
    type: "object",
    title: "搜索配置",
    properties: {
      limit: {
        type: "number",
        title: "结果数量",
        description: "返回的搜索结果数量",
        default: 10,
        minimum: 1,
        maximum: 50,
      },
      category: {
        type: "string",
        title: "搜索分类",
        description: "搜索内容分类",
        enum: ["general", "news", "images", "videos", "science"],
        default: "general",
      },
      language: {
        type: "string",
        title: "语言",
        description: "搜索结果语言",
        default: "zh",
        enum: ["zh", "en", "ja", "ko", "de", "fr"],
      },
      safesearch: {
        type: "number",
        title: "安全搜索",
        description: "安全搜索级别",
        default: 0,
        enum: [0, 1, 2],
        enumNames: ["关闭", "中等", "严格"],
      },
      timeout: {
        type: "number",
        title: "超时时间",
        description: "搜索超时时间（毫秒）",
        default: 30000,
      },
    },
  },

  inputSchema: {
    type: "object",
    title: "输入",
    required: ["query"],
    properties: {
      query: {
        type: "string",
        title: "搜索关键词",
        description: "要搜索的内容",
      },
    },
  },

  outputSchema: {
    type: "object",
    title: "输出",
    properties: {
      results: {
        type: "array",
        title: "搜索结果",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            url: { type: "string" },
            content: { type: "string" },
            engine: { type: "string" },
            score: { type: "number" },
          },
        },
      },
      formatted: {
        type: "string",
        title: "格式化结果",
        description: "用于注入提示词的格式化文本",
      },
      totalResults: {
        type: "number",
        title: "总数",
      },
      query: {
        type: "string",
        title: "实际查询",
      },
    },
  },

  validateConfig(config: Record<string, unknown>): string | null {
    if (config.limit !== undefined) {
      const limit = config.limit as number;
      if (limit < 1 || limit > 50) {
        return "limit 必须在 1-50 之间";
      }
    }
    return null;
  },

  async execute(context: NodeContext): Promise<NodeResult> {
    const { inputs, config } = context;
    const query = inputs.query as string;

    if (!query || typeof query !== "string") {
      return {
        success: false,
        outputs: {},
        error: "缺少必需的输入: query",
      };
    }

    try {
      const searchConfig: SearchNodeConfig = {
        limit: (config.limit as number) || 10,
        category: (config.category as string) || "general",
        language: (config.language as string) || "zh",
        safesearch: (config.safesearch as number) || 0,
        timeout: (config.timeout as number) || 30000,
      };

      console.log(`[SearchNode] 执行搜索: "${query}" (${searchConfig.category})`);

      const response = await searchWeb({
        query,
        limit: searchConfig.limit,
        category: searchConfig.category,
        language: searchConfig.language,
        safesearch: searchConfig.safesearch,
      });

      const formatted = formatSearchResults(response, 4000);

      const outputs: SearchNodeOutputs = {
        results: response.results,
        formatted,
        totalResults: response.totalResults || response.results.length,
        query: response.query,
      };

      console.log(`[SearchNode] 搜索完成: ${outputs.totalResults} 条结果`);

      return {
        success: true,
        outputs,
        logs: [`搜索: "${query}"`, `找到 ${outputs.totalResults} 条结果`],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[SearchNode] 搜索失败: ${errorMsg}`);
      
      return {
        success: false,
        outputs: {},
        error: `搜索失败: ${errorMsg}`,
        logs: [`搜索失败: ${errorMsg}`],
      };
    }
  },
};

export default searchNodeHandler;
