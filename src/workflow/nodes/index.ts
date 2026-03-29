/**
 * Workflow Nodes - 内置节点集合
 */

import type { NodeHandler } from "../types.js";
import { nodeRegistry } from "../registry.js";

// 导入节点
import searchNode from "./search.js";
import llmNode from "./llm.js";
import sendNode from "./send.js";
import transformNode from "./transform.js";
import conditionNode from "./condition.js";

// 节点列表
const builtinNodes: NodeHandler[] = [
  searchNode,
  llmNode,
  sendNode,
  transformNode,
  conditionNode,
];

/**
 * 注册所有内置节点
 */
export function registerBuiltinNodes(): void {
  for (const node of builtinNodes) {
    nodeRegistry.register(node);
  }
  console.log(`[WorkflowNodes] 已注册 ${builtinNodes.length} 个内置节点`);
}

/**
 * 获取所有内置节点
 */
export function getBuiltinNodes(): NodeHandler[] {
  return [...builtinNodes];
}

// 导出节点
export { searchNode, llmNode, sendNode, transformNode, conditionNode };

// 重新导出类型
export type { SearchNodeConfig, SearchNodeInputs, SearchNodeOutputs } from "./search.js";
export type { LLMNodeConfig, LLMNodeInputs, LLMNodeOutputs } from "./llm.js";
export type { SendNodeConfig, SendNodeInputs, SendNodeOutputs, SendMessageFn } from "./send.js";
export type { TransformNodeConfig, TransformNodeInputs, TransformNodeOutputs } from "./transform.js";
export type { ConditionNodeConfig, ConditionNodeInputs, ConditionNodeOutputs } from "./condition.js";
