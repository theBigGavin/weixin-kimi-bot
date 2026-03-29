/**
 * SearXNG 搜索服务
 * 
 * 提供网络搜索功能，替代 Kimi CLI 内置的 SearchWeb 工具
 * 使用本地部署的 SearXNG 实例 (http://127.0.0.1:17890)
 */

export interface SearxngSearchOptions {
  /** 搜索查询 */
  query: string;
  /** 返回结果数量限制 */
  limit?: number;
  /** 搜索分类 (general, images, news, videos, etc.) */
  category?: string;
  /** 语言代码 (zh, en, etc.) */
  language?: string;
  /** 安全搜索级别 (0: 关闭, 1: 中等, 2: 严格) */
  safesearch?: number;
}

export interface SearxngSearchResult {
  /** 结果标题 */
  title: string;
  /** 结果链接 */
  url: string;
  /** 结果摘要 */
  content: string;
  /** 来源引擎 */
  engine?: string;
  /** 评分 */
  score?: number;
}

export interface SearxngSearchResponse {
  /** 搜索查询 */
  query: string;
  /** 搜索结果 */
  results: SearxngSearchResult[];
  /** 建议的查询修正 */
  suggestions?: string[];
  /** 总结果数 */
  totalResults?: number;
}

export interface SearxngConfig {
  /** SearXNG 服务地址 */
  baseUrl: string;
  /** 默认返回结果数量 */
  defaultLimit: number;
  /** 是否启用搜索 */
  enabled: boolean;
  /** 超时时间（毫秒） */
  timeout: number;
}

// 默认配置
const DEFAULT_CONFIG: SearxngConfig = {
  baseUrl: "http://127.0.0.1:17890",
  defaultLimit: 10,
  enabled: true,
  timeout: 30000,
};

// 当前配置
let currentConfig: SearxngConfig = { ...DEFAULT_CONFIG };

/**
 * 配置 SearXNG 服务
 */
export function configureSearxng(config: Partial<SearxngConfig>): void {
  currentConfig = { ...currentConfig, ...config };
}

/**
 * 获取当前配置
 */
export function getSearxngConfig(): SearxngConfig {
  return { ...currentConfig };
}

/**
 * 重置为默认配置
 */
export function resetSearxngConfig(): void {
  currentConfig = { ...DEFAULT_CONFIG };
}

/**
 * 检查 SearXNG 服务是否可用
 */
export async function checkSearxngHealth(): Promise<{
  available: boolean;
  message: string;
}> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${currentConfig.baseUrl}/healthz`, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      return {
        available: true,
        message: `SearXNG 服务正常 (${currentConfig.baseUrl})`,
      };
    } else {
      return {
        available: false,
        message: `SearXNG 服务返回错误: ${response.status}`,
      };
    }
  } catch (error) {
    return {
      available: false,
      message: `无法连接到 SearXNG 服务: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 执行网络搜索
 * 
 * @param options 搜索选项
 * @returns 搜索结果
 */
export async function searchWeb(
  options: SearxngSearchOptions
): Promise<SearxngSearchResponse> {
  if (!currentConfig.enabled) {
    throw new Error("SearXNG 搜索已禁用");
  }

  const {
    query,
    limit = currentConfig.defaultLimit,
    category = "general",
    language = "zh",
    safesearch = 0,
  } = options;

  if (!query.trim()) {
    throw new Error("搜索查询不能为空");
  }

  // 构建搜索 URL
  const params = new URLSearchParams({
    q: query,
    format: "json",
    language,
    category,
    safesearch: String(safesearch),
  });

  const searchUrl = `${currentConfig.baseUrl}/search?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      currentConfig.timeout
    );

    const response = await fetch(searchUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`SearXNG 请求失败: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // 解析 SearXNG 响应
    const results: SearxngSearchResult[] = (data.results || [])
      .slice(0, limit)
      .map((item: any) => ({
        title: item.title || "",
        url: item.url || "",
        content: item.content || item.abstract || "",
        engine: item.engine || "",
        score: item.score,
      }));

    return {
      query,
      results,
      suggestions: data.suggestions || [],
      totalResults: data.number_of_results || results.length,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new Error(`SearXNG 搜索超时 (${currentConfig.timeout}ms)`);
      }
      throw new Error(`SearXNG 搜索失败: ${error.message}`);
    }
    throw error;
  }
}

/**
 * 格式化搜索结果为文本
 * 
 * 用于将搜索结果注入到提示词中
 */
export function formatSearchResults(
  response: SearxngSearchResponse,
  maxLength: number = 4000
): string {
  if (response.results.length === 0) {
    return `搜索 "${response.query}" 未找到相关结果。`;
  }

  const lines: string[] = [
    `搜索结果 for "${response.query}":`,
    `共找到 ${response.totalResults || response.results.length} 条相关结果`,
    "",
  ];

  let currentLength = lines.join("\n").length;

  for (let i = 0; i < response.results.length; i++) {
    const result = response.results[i];
    const entry = [
      `[${i + 1}] ${result.title}`,
      `    URL: ${result.url}`,
      `    ${result.content}`,
      "",
    ].join("\n");

    // 检查是否超过最大长度
    if (currentLength + entry.length > maxLength) {
      lines.push(`... 还有 ${response.results.length - i} 条结果未显示`);
      break;
    }

    lines.push(entry);
    currentLength += entry.length;
  }

  // 添加建议的查询（如果有）
  if (response.suggestions && response.suggestions.length > 0) {
    lines.push("");
    lines.push(`相关建议: ${response.suggestions.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * 从提示词中提取搜索查询
 * 
 * 简单启发式提取：查找 "搜索"、"查找"、"查一下" 等关键词后的内容
 */
export function extractSearchQuery(prompt: string): string | null {
  // 常见的搜索意图模式
  const patterns = [
    /(?:搜索|查找|查询|搜一下|查一下|search for|look up|google)\s*[：:]\s*(.+?)(?:\s*$|[。！？\n])/i,
    /(?:搜索|查找|查询|搜一下|查一下|search for|look up)\s*[""'](.+?)[""']/i,
    /(?:帮我|请)?\s*(?:搜索|查找|查询|搜|查)\s+(.+?)(?:\s*$|[。！？\n]|(?:的信息|的相关|的资讯))/i,
    /(?:网上|网上有|网上说|网上查|网上搜索)\s*[：:]?\s*(.+?)(?:\s*$|[。！？\n])/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  // 如果没有匹配到特定模式，但包含明显的搜索关键词
  const searchKeywords = /^(?:搜索|查找|查询|搜一下|查一下|search|look up)\s+(.+)$/i;
  const simpleMatch = prompt.match(searchKeywords);
  if (simpleMatch && simpleMatch[1]) {
    return simpleMatch[1].trim();
  }

  return null;
}

/**
 * 判断是否需要网络搜索
 * 
 * 基于关键词和任务特征判断
 */
export function shouldSearchWeb(prompt: string): boolean {
  // 明显的搜索关键词
  const searchPatterns = [
    /(?:搜索|查找|查询|搜一下|查一下)\s*.+?的?(?:信息|资料|资讯|新闻|结果)/i,
    /网上\s*(?:搜索|查找|查一下)/i,
    /(?:最新|最近|今天|昨日)\s*(?:新闻|资讯|动态|消息)/i,
    /(?:查|搜|找).+?的?\s*(?:官网|官方网站|官方)/i,
    /(?:google|bing|百度|搜索)\s*[：:]?\s*.+/i,
    /(?:search|look up|google)\s+(?:for\s+)?["']?\w+/i,
  ];

  return searchPatterns.some((pattern) => pattern.test(prompt));
}

/**
 * 执行智能搜索
 * 
 * 1. 判断是否需要进行网络搜索
 * 2. 提取搜索查询
 * 3. 执行搜索并格式化结果
 */
export async function performSmartSearch(
  prompt: string,
  options?: Partial<SearxngSearchOptions>
): Promise<{ needed: boolean; query?: string; results?: string; response?: SearxngSearchResponse }> {
  if (!shouldSearchWeb(prompt)) {
    return { needed: false };
  }

  const query = extractSearchQuery(prompt) || prompt;
  
  try {
    const response = await searchWeb({
      query,
      limit: options?.limit || 5,
      category: options?.category,
      language: options?.language || "zh",
    });

    const formatted = formatSearchResults(response, 3000);

    return {
      needed: true,
      query,
      results: formatted,
      response,
    };
  } catch (error) {
    console.error("[SearXNG] 搜索失败:", error);
    return {
      needed: true,
      query,
      results: `搜索失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// 导出默认实例
export default {
  configure: configureSearxng,
  getConfig: getSearxngConfig,
  resetConfig: resetSearxngConfig,
  checkHealth: checkSearxngHealth,
  search: searchWeb,
  formatResults: formatSearchResults,
  extractQuery: extractSearchQuery,
  shouldSearch: shouldSearchWeb,
  smartSearch: performSmartSearch,
};
