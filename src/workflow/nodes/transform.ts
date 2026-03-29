/**
 * Transform Node - 数据转换节点
 * 
 * 对数据进行转换和格式化
 */

import type { NodeHandler, NodeContext, NodeResult } from "../types.js";

export interface TransformNodeConfig {
  mode?: "template" | "json" | "javascript" | "filter" | "merge";
  template?: string;
  expression?: string;
  filter?: string;
  pick?: string[];
  omit?: string[];
}

export interface TransformNodeInputs {
  data: unknown;
  extra?: Record<string, unknown>;
}

export interface TransformNodeOutputs extends Record<string, unknown> {
  result: unknown;
  original: unknown;
}

const transformNodeHandler: NodeHandler = {
  type: "transform",
  name: "数据转换",
  description: "转换和格式化数据",
  category: "process",

  configSchema: {
    type: "object",
    title: "转换配置",
    properties: {
      mode: {
        type: "string",
        title: "转换模式",
        enum: ["template", "json", "javascript", "filter", "merge"],
        default: "template",
        description: "template: 字符串模板, json: JSON操作, javascript: JS表达式, filter: 过滤, merge: 合并",
      },
      template: {
        type: "string",
        title: "字符串模板",
        description: "使用 ${data.key} 引用数据",
      },
      expression: {
        type: "string",
        title: "JS表达式",
        description: "JavaScript表达式，data 变量可用",
      },
      pick: {
        type: "array",
        title: "选择字段",
        description: "只保留指定的字段",
        items: { type: "string" },
      },
      omit: {
        type: "array",
        title: "排除字段",
        description: "排除指定的字段",
        items: { type: "string" },
      },
    },
  },

  inputSchema: {
    type: "object",
    title: "输入",
    required: ["data"],
    properties: {
      data: {
        title: "输入数据",
        description: "要转换的数据",
      },
      extra: {
        type: "object",
        title: "额外数据",
        description: "额外的数据用于合并",
      },
    },
  },

  outputSchema: {
    type: "object",
    title: "输出",
    properties: {
      result: {
        title: "转换结果",
      },
      original: {
        title: "原始数据",
      },
    },
  },

  validateConfig(config: Record<string, unknown>): string | null {
    const mode = (config.mode as string) || "template";
    
    switch (mode) {
      case "template":
        if (!config.template) {
          return "template 模式需要配置 template";
        }
        break;
      case "javascript":
        if (!config.expression) {
          return "javascript 模式需要配置 expression";
        }
        break;
      case "filter":
        if (!config.pick && !config.omit) {
          return "filter 模式需要配置 pick 或 omit";
        }
        break;
    }
    
    return null;
  },

  async execute(context: NodeContext): Promise<NodeResult> {
    const { inputs, config } = context;
    const data = inputs.data;
    const extra = inputs.extra as Record<string, unknown> | undefined;
    const mode = (config.mode as string) || "template";

    if (data === undefined) {
      return {
        success: false,
        outputs: {},
        error: "缺少必需的输入: data",
      };
    }

    try {
      let result: unknown;

      switch (mode) {
        case "template": {
          const template = config.template as string;
          result = applyTemplate(template, data as Record<string, unknown>);
          break;
        }

        case "json": {
          if (typeof data === "string") {
            result = JSON.parse(data);
          } else {
            result = JSON.stringify(data, null, 2);
          }
          break;
        }

        case "javascript": {
          const expression = config.expression as string;
          result = evaluateExpression(expression, data);
          break;
        }

        case "filter": {
          if (typeof data === "object" && data !== null) {
            result = filterObject(
              data as Record<string, unknown>,
              config.pick as string[] | undefined,
              config.omit as string[] | undefined
            );
          } else {
            result = data;
          }
          break;
        }

        case "merge": {
          result = { ...(data as object), ...(extra || {}) };
          break;
        }

        default:
          return {
            success: false,
            outputs: {},
            error: `未知的转换模式: ${mode}`,
          };
      }

      const outputs: TransformNodeOutputs = {
        result,
        original: data,
      };

      return {
        success: true,
        outputs,
        logs: [`模式: ${mode}`, `结果类型: ${typeof result}`],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        outputs: {},
        error: `转换失败: ${errorMsg}`,
        logs: [`转换失败: ${errorMsg}`],
      };
    }
  },
};

/**
 * 应用字符串模板
 */
function applyTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\$\{([^}]+)\}/g, (match, path) => {
    const value = getValueByPath(data, path.trim());
    return value !== undefined ? String(value) : match;
  });
}

/**
 * 根据路径获取值
 */
function getValueByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * 求值表达式
 * 
 * 注意：这里使用 Function 构造函数，有一定安全风险
 * 在生产环境中应该使用更安全的表达式引擎
 */
function evaluateExpression(expression: string, data: unknown): unknown {
  try {
    // 创建安全的求值环境
    const fn = new Function("data", `return (${expression});`);
    return fn(data);
  } catch (error) {
    throw new Error(`表达式求值失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 过滤对象
 */
function filterObject(
  obj: Record<string, unknown>,
  pick?: string[],
  omit?: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (pick && pick.length > 0) {
    // 只选择指定字段
    for (const key of pick) {
      if (key in obj) {
        result[key] = obj[key];
      }
    }
  } else if (omit && omit.length > 0) {
    // 排除指定字段
    for (const [key, value] of Object.entries(obj)) {
      if (!omit.includes(key)) {
        result[key] = value;
      }
    }
  } else {
    // 无过滤，返回原对象
    return { ...obj };
  }

  return result;
}

export default transformNodeHandler;
