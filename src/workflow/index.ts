/**
 * Workflow Engine - 可插拔工作流系统
 * 
 * 支持复杂的确定性工作流自动化执行
 */

// 导出类型
export type {
  WorkflowVariable,
  NodeConnection,
  NodeInput,
  NodeOutput,
  WorkflowNodeDefinition,
  WorkflowDefinition,
  WorkflowInstance,
  NodeContext,
  NodeResult,
  NodeHandler,
  WorkflowExecution,
  WorkflowExecutionStatus,
  NodeExecutionRecord,
  ParsedWorkflowInfo,
  JSONSchema,
  WorkflowManagerConfig,
  VariableTemplate,
} from "./types.js";

// 导出常量
export { BUILTIN_VARIABLE_TEMPLATES } from "./types.js";

// 导出注册表
export { nodeRegistry, registerNode, getNodeHandler, hasNodeHandler } from "./registry.js";

// 导出表达式求值
export { evaluateExpression, resolveInputs, validateExpression, extractReferencedNodes } from "./expression.js";
export type { ExpressionContext } from "./expression.js";

// 导出执行引擎
export { WorkflowEngine, defaultEngine } from "./engine.js";
export type { EngineConfig } from "./engine.js";

// 导出解析器
export {
  parseWorkflowFromNaturalLanguage,
  quickParse,
  smartParseWorkflow,
} from "./parser.js";
export type { ParseOptions } from "./parser.js";

// 导出管理器
export {
  WorkflowManager,
  getWorkflowManager,
  setWorkflowSendMessageFn,
} from "./manager.js";
export type { SendMessageFunction } from "./manager.js";

// 导出调度集成
export {
  WorkflowScheduler,
  getWorkflowScheduler,
  startAllWorkflowSchedulers,
  stopAllWorkflowSchedulers,
  removeWorkflowScheduler,
} from "./scheduler-integration.js";
export type { WorkflowSchedule } from "./scheduler-integration.js";

// 导出节点
export {
  registerBuiltinNodes,
  getBuiltinNodes,
  searchNode,
  llmNode,
  sendNode,
  transformNode,
  conditionNode,
} from "./nodes/index.js";

export type {
  SearchNodeConfig,
  SearchNodeInputs,
  SearchNodeOutputs,
  LLMNodeConfig,
  LLMNodeInputs,
  LLMNodeOutputs,
  SendNodeConfig,
  SendNodeInputs,
  SendNodeOutputs,
  SendMessageFn,
  TransformNodeConfig,
  TransformNodeInputs,
  TransformNodeOutputs,
  ConditionNodeConfig,
  ConditionNodeInputs,
  ConditionNodeOutputs,
} from "./nodes/index.js";

// 便捷初始化函数
import { registerBuiltinNodes } from "./nodes/index.js";

/**
 * 初始化工作流引擎
 * 
 * 注册所有内置节点
 */
export function initializeWorkflowEngine(): void {
  registerBuiltinNodes();
}
