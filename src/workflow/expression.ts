/**
 * Workflow Expression Evaluator - 表达式求值器
 * 
 * 支持模板语法：${nodeId.outputName}, ${variableName}, ${date:today}
 */

import type { WorkflowInstance } from "./types.js";

/** 表达式求值上下文 */
export interface ExpressionContext {
  nodeOutputs: Record<string, Record<string, unknown>>;  // nodeId -> outputs
  variables: Record<string, unknown>;
  userId: string;
  agentId: string;
  workflow: WorkflowInstance;
}

/**
 * 求值表达式
 * 
 * 支持的语法：
 * - ${nodeId.outputName} - 引用节点输出
 * - ${variableName} - 引用变量
 * - ${date:today} - 今天的日期
 * - ${date:yesterday} - 昨天的日期
 * - ${date:tomorrow} - 明天的日期
 * - ${date:now} - 当前时间
 * - ${date:now:format} - 格式化当前时间
 * - ${user.id} - 用户ID
 * - ${workflow.id} - 工作流ID
 * - ${workflow.name} - 工作流名称
 */
export function evaluateExpression(
  expression: string,
  context: ExpressionContext
): unknown {
  // 如果不是模板表达式，直接返回原值
  if (typeof expression !== "string") {
    return expression;
  }

  // 处理纯模板 ${...}
  const pureMatch = expression.match(/^\$\{([^}]+)\}$/);
  if (pureMatch) {
    return evaluateSingleExpression(pureMatch[1], context);
  }

  // 处理混合文本 "prefix${...}suffix"
  return expression.replace(/\$\{([^}]+)\}/g, (match, inner) => {
    const value = evaluateSingleExpression(inner, context);
    return value !== undefined ? String(value) : match;
  });
}

/**
 * 求值单个表达式（不包含 ${}）
 */
function evaluateSingleExpression(
  expr: string,
  context: ExpressionContext
): unknown {
  expr = expr.trim();

  // 处理日期表达式
  if (expr.startsWith("date:")) {
    return evaluateDateExpression(expr.slice(5));
  }

  // 处理用户变量
  if (expr.startsWith("user.")) {
    return evaluateUserExpression(expr.slice(5), context);
  }

  // 处理工作流变量
  if (expr.startsWith("workflow.")) {
    return evaluateWorkflowExpression(expr.slice(9), context);
  }

  // 处理节点输出引用 nodeId.outputName
  if (expr.includes(".")) {
    const parts = expr.split(".");
    if (parts.length >= 2) {
      const [nodeId, ...outputParts] = parts;
      const outputName = outputParts.join(".");
      const nodeOutput = context.nodeOutputs[nodeId];
      if (nodeOutput) {
        return getNestedValue(nodeOutput, outputName);
      }
    }
  }

  // 处理普通变量
  return context.variables[expr];
}

/**
 * 求值日期表达式
 */
function evaluateDateExpression(expr: string): string {
  const now = new Date();
  const parts = expr.split(":");
  const dateType = parts[0];
  const format = parts[1] || "yyyy-MM-dd";

  let targetDate: Date;

  switch (dateType) {
    case "today":
      targetDate = now;
      break;
    case "yesterday":
      targetDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case "tomorrow":
      targetDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      break;
    case "now":
      targetDate = now;
      break;
    case "last-week":
      targetDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "last-month":
      targetDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      break;
    default:
      // 尝试解析为日期偏移，如 "-1d", "+3h"
      targetDate = parseDateOffset(dateType, now);
  }

  return formatDate(targetDate, format);
}

/**
 * 解析日期偏移表达式
 */
function parseDateOffset(offset: string, baseDate: Date): Date {
  const match = offset.match(/^([+-])(\d+)([dhm])$/);
  if (!match) return baseDate;

  const sign = match[1] === "-" ? -1 : 1;
  const amount = parseInt(match[2], 10);
  const unit = match[3];

  const ms = baseDate.getTime();
  const multipliers: Record<string, number> = {
    m: 60 * 1000,      // 分钟
    h: 60 * 60 * 1000, // 小时
    d: 24 * 60 * 60 * 1000, // 天
  };

  return new Date(ms + sign * amount * (multipliers[unit] || 0));
}

/**
 * 格式化日期
 */
function formatDate(date: Date, format: string): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return format
    .replace("yyyy", String(year))
    .replace("MM", month)
    .replace("dd", day)
    .replace("HH", hours)
    .replace("mm", minutes)
    .replace("ss", seconds);
}

/**
 * 求值用户表达式
 */
function evaluateUserExpression(expr: string, context: ExpressionContext): unknown {
  switch (expr) {
    case "id":
      return context.userId;
    case "name":
      // 可以从用户信息中获取，目前返回ID
      return context.userId;
    default:
      return undefined;
  }
}

/**
 * 求值工作流表达式
 */
function evaluateWorkflowExpression(expr: string, context: ExpressionContext): unknown {
  switch (expr) {
    case "id":
      return context.workflow.id;
    case "name":
      return context.workflow.name;
    case "description":
      return context.workflow.description;
    case "cron":
      return context.workflow.cron;
    default:
      return undefined;
  }
}

/**
 * 获取嵌套对象的值
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
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
 * 解析输入映射
 * 
 * 将输入映射定义（包含表达式）解析为实际值
 */
export function resolveInputs(
  inputs: Record<string, string>,
  context: ExpressionContext
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(inputs)) {
    if (typeof value === "string") {
      resolved[key] = evaluateExpression(value, context);
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

/**
 * 验证表达式是否有效
 */
export function validateExpression(expr: string): { valid: boolean; error?: string } {
  if (typeof expr !== "string") {
    return { valid: true };
  }

  // 检查括号匹配
  let depth = 0;
  for (const char of expr) {
    if (char === "{") depth++;
    if (char === "}") depth--;
    if (depth < 0) {
      return { valid: false, error: "不匹配的括号" };
    }
  }

  if (depth !== 0) {
    return { valid: false, error: "不匹配的括号" };
  }

  // 检查模板语法
  const templatePattern = /\$\{([^}]*)\}/g;
  let match;
  while ((match = templatePattern.exec(expr)) !== null) {
    const inner = match[1].trim();
    if (!inner) {
      return { valid: false, error: "空的表达式" };
    }
  }

  return { valid: true };
}

/**
 * 提取表达式中引用的节点ID
 */
export function extractReferencedNodes(expression: string): string[] {
  const nodeIds: string[] = [];
  const templatePattern = /\$\{([^}]+)\}/g;
  
  let match;
  while ((match = templatePattern.exec(expression)) !== null) {
    const inner = match[1].trim();
    
    // 跳过内置变量
    if (inner.startsWith("date:")) continue;
    if (inner.startsWith("user.")) continue;
    if (inner.startsWith("workflow.")) continue;
    
    // 提取节点ID (nodeId.outputName)
    const parts = inner.split(".");
    if (parts.length >= 2) {
      nodeIds.push(parts[0]);
    }
  }
  
  return [...new Set(nodeIds)]; // 去重
}
