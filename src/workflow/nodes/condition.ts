/**
 * Condition Node - 条件分支节点
 * 
 * 根据条件决定执行路径
 */

import type { NodeHandler, NodeContext, NodeResult } from "../types.js";

export interface ConditionNodeConfig {
  operator?: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "startsWith" | "endsWith" | "regex" | "exists" | "javascript";
  value?: unknown;
  path?: string;
  expression?: string;
  caseSensitive?: boolean;
}

export interface ConditionNodeInputs {
  value: unknown;
  compareTo?: unknown;
}

export interface ConditionNodeOutputs extends Record<string, unknown> {
  result: boolean;
  branch: "true" | "false";
  value: unknown;
}

const conditionNodeHandler: NodeHandler = {
  type: "condition",
  name: "条件判断",
  description: "根据条件决定执行路径",
  category: "control",

  configSchema: {
    type: "object",
    title: "条件配置",
    properties: {
      operator: {
        type: "string",
        title: "比较操作符",
        description: "比较方式",
        enum: ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "startsWith", "endsWith", "regex", "exists", "javascript"],
        enumNames: [
          "等于",
          "不等于",
          "大于",
          "大于等于",
          "小于",
          "小于等于",
          "包含",
          "开头是",
          "结尾是",
          "正则匹配",
          "存在",
          "JS表达式",
        ],
        default: "eq",
      },
      value: {
        title: "比较值",
        description: "用于比较的值",
      },
      path: {
        type: "string",
        title: "字段路径",
        description: "当输入是对象时，比较的字段路径，如 'data.count'",
      },
      expression: {
        type: "string",
        title: "JS表达式",
        description: "javascript 模式下的表达式，value 变量可用",
      },
      caseSensitive: {
        type: "boolean",
        title: "区分大小写",
        default: true,
      },
    },
  },

  inputSchema: {
    type: "object",
    title: "输入",
    required: ["value"],
    properties: {
      value: {
        title: "输入值",
        description: "要判断的值",
      },
      compareTo: {
        title: "比较对象",
        description: "可选的自定义比较值（覆盖配置中的 value）",
      },
    },
  },

  outputSchema: {
    type: "object",
    title: "输出",
    properties: {
      result: {
        type: "boolean",
        title: "判断结果",
      },
      branch: {
        type: "string",
        title: "分支",
        enum: ["true", "false"],
      },
      value: {
        title: "原始值",
      },
    },
  },

  validateConfig(config: Record<string, unknown>): string | null {
    const operator = (config.operator as string) || "eq";
    
    if (operator === "javascript" && !config.expression) {
      return "javascript 操作符需要配置 expression";
    }
    
    return null;
  },

  async execute(context: NodeContext): Promise<NodeResult> {
    const { inputs, config } = context;
    let value = inputs.value;
    const compareTo = inputs.compareTo !== undefined ? inputs.compareTo : config.value;
    const operator = (config.operator as string) || "eq";
    const path = config.path as string | undefined;
    const caseSensitive = config.caseSensitive !== false;

    // 如果指定了路径，从对象中提取值
    if (path && typeof value === "object" && value !== null) {
      value = getValueByPath(value as Record<string, unknown>, path);
    }

    try {
      let result: boolean;

      switch (operator) {
        case "eq":
          result = caseSensitive 
            ? String(value) === String(compareTo)
            : String(value).toLowerCase() === String(compareTo).toLowerCase();
          break;

        case "ne":
          result = caseSensitive
            ? String(value) !== String(compareTo)
            : String(value).toLowerCase() !== String(compareTo).toLowerCase();
          break;

        case "gt":
          result = Number(value) > Number(compareTo);
          break;

        case "gte":
          result = Number(value) >= Number(compareTo);
          break;

        case "lt":
          result = Number(value) < Number(compareTo);
          break;

        case "lte":
          result = Number(value) <= Number(compareTo);
          break;

        case "contains":
          result = String(value).includes(String(compareTo));
          break;

        case "startsWith":
          result = String(value).startsWith(String(compareTo));
          break;

        case "endsWith":
          result = String(value).endsWith(String(compareTo));
          break;

        case "regex": {
          const pattern = new RegExp(String(compareTo), caseSensitive ? "" : "i");
          result = pattern.test(String(value));
          break;
        }

        case "exists":
          result = value !== undefined && value !== null;
          break;

        case "javascript": {
          const expression = config.expression as string;
          result = evaluateCondition(expression, value, compareTo);
          break;
        }

        default:
          return {
            success: false,
            outputs: {},
            error: `未知的操作符: ${operator}`,
          };
      }

      const outputs: ConditionNodeOutputs = {
        result,
        branch: result ? "true" : "false",
        value,
      };

      return {
        success: true,
        outputs,
        logs: [`操作符: ${operator}`, `值: ${JSON.stringify(value)}`, `比较值: ${JSON.stringify(compareTo)}`, `结果: ${result}`],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        outputs: {},
        error: `条件判断失败: ${errorMsg}`,
        logs: [`判断失败: ${errorMsg}`],
      };
    }
  },
};

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
 * 求值条件表达式
 */
function evaluateCondition(expression: string, value: unknown, compareTo: unknown): boolean {
  try {
    const fn = new Function("value", "compareTo", `return (${expression});`);
    return Boolean(fn(value, compareTo));
  } catch (error) {
    throw new Error(`表达式求值失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export default conditionNodeHandler;
