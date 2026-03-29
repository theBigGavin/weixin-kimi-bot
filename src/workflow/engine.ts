/**
 * Workflow Engine - 工作流执行引擎
 * 
 * 负责任务调度和节点执行
 */

import type {
  WorkflowInstance,
  WorkflowExecution,
  WorkflowExecutionStatus,
  NodeExecutionRecord,
  NodeContext,
  NodeResult,
} from "./types.js";
import { nodeRegistry } from "./registry.js";
import { evaluateExpression, resolveInputs, ExpressionContext } from "./expression.js";

/** 执行引擎配置 */
export interface EngineConfig {
  maxConcurrent: number;
  defaultTimeout: number;
  onProgress?: (execution: WorkflowExecution, nodeRecord: NodeExecutionRecord) => Promise<void>;
  onComplete?: (execution: WorkflowExecution) => Promise<void>;
}

/** 工作流执行引擎 */
export class WorkflowEngine {
  private config: EngineConfig;
  private runningExecutions: Map<string, WorkflowExecution> = new Map();
  private executionQueue: string[] = [];

  constructor(config: Partial<EngineConfig> = {}) {
    this.config = {
      maxConcurrent: 3,
      defaultTimeout: 5 * 60 * 1000, // 5分钟
      ...config,
    };
  }

  /**
   * 执行工作流
   */
  async execute(
    workflow: WorkflowInstance,
    triggerBy: "cron" | "manual" | "api" = "manual"
  ): Promise<WorkflowExecution> {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    
    // 创建工作流定义（从实例中恢复）
    const definition = this.recoverDefinition(workflow);
    if (!definition) {
      throw new Error(`无法恢复工作流定义: ${workflow.id}`);
    }

    // 初始化执行记录
    const execution: WorkflowExecution = {
      id: executionId,
      workflowId: workflow.id,
      userId: workflow.userId,
      agentId: workflow.agentId,
      status: "pending",
      triggeredBy: triggerBy,
      startedAt: Date.now(),
      nodeExecutions: definition.nodes.map((node) => ({
        nodeId: node.id,
        nodeType: node.type,
        nodeName: node.name,
        status: "pending",
      })),
    };

    // 检查并发限制
    if (this.runningExecutions.size >= this.config.maxConcurrent) {
      this.executionQueue.push(executionId);
      console.log(`[WorkflowEngine] 执行 ${executionId} 已加入队列`);
      return execution;
    }

    // 开始执行
    this.runningExecutions.set(executionId, execution);
    execution.status = "running";

    try {
      await this.runExecution(execution, workflow, definition);
    } catch (error) {
      execution.status = "failed";
      execution.error = error instanceof Error ? error.message : String(error);
      console.error(`[WorkflowEngine] 执行失败: ${execution.error}`);
    } finally {
      this.runningExecutions.delete(executionId);
      
      // 处理队列
      this.processQueue();
      
      // 回调
      if (this.config.onComplete) {
        await this.config.onComplete(execution);
      }
    }

    return execution;
  }

  /**
   * 恢复工作流定义
   * 
   * 从实例中恢复完整的工作流定义
   * 实际实现中应该从存储中加载
   */
  private recoverDefinition(workflow: WorkflowInstance): {
    nodes: Array<{
      id: string;
      type: string;
      name: string;
      config: Record<string, unknown>;
      inputs?: Record<string, string>;
    }>;
    connections: Array<{ from: string; to: string }>;
  } | null {
    // 从实例的变量中恢复（简化实现）
    // 实际应该持久化存储完整的定义
    const definitionData = workflow.variables.__definition as string;
    if (!definitionData) {
      return null;
    }

    try {
      return JSON.parse(definitionData);
    } catch {
      return null;
    }
  }

  /**
   * 运行执行
   */
  private async runExecution(
    execution: WorkflowExecution,
    workflow: WorkflowInstance,
    definition: {
      nodes: Array<{
        id: string;
        type: string;
        name: string;
        config: Record<string, unknown>;
        inputs?: Record<string, string>;
      }>;
      connections: Array<{ from: string; to: string }>;
    }
  ): Promise<void> {
    // 构建执行顺序（拓扑排序）
    const executionOrder = this.topologicalSort(definition.nodes, definition.connections);
    
    // 全局状态（节点间共享）
    const globalState: Record<string, unknown> = {};
    
    // 节点输出记录
    const nodeOutputs: Record<string, Record<string, unknown>> = {};

    // 创建表达式上下文
    const exprContext: ExpressionContext = {
      nodeOutputs,
      variables: workflow.variables,
      userId: workflow.userId,
      agentId: workflow.agentId,
      workflow,
    };

    // 按顺序执行节点
    for (const nodeId of executionOrder) {
      const nodeDef = definition.nodes.find((n) => n.id === nodeId);
      if (!nodeDef) continue;

      const nodeRecord = execution.nodeExecutions.find((n) => n.nodeId === nodeId)!;
      
      // 检查是否可以执行（依赖节点是否完成）
      const canExecute = this.checkDependencies(nodeId, definition.connections, execution);
      if (!canExecute) {
        nodeRecord.status = "skipped";
        nodeRecord.error = "依赖节点未完成";
        continue;
      }

      // 执行节点
      const result = await this.executeNode(
        nodeDef,
        workflow,
        exprContext,
        execution
      );

      // 更新节点记录
      nodeRecord.status = result.success ? "completed" : "failed";
      nodeRecord.outputs = result.outputs;
      nodeRecord.error = result.error;
      nodeRecord.logs = result.logs;

      // 存储输出到全局状态
      nodeOutputs[nodeId] = result.outputs;
      globalState[nodeId] = result.outputs;

      // 更新表达式上下文
      exprContext.nodeOutputs = nodeOutputs;

      // 进度回调
      if (this.config.onProgress) {
        await this.config.onProgress(execution, nodeRecord);
      }

      // 如果节点失败，停止执行
      if (!result.success) {
        execution.status = "failed";
        execution.error = `节点 '${nodeDef.name}' 执行失败: ${result.error}`;
        return;
      }
    }

    // 执行完成
    execution.status = "completed";
    execution.completedAt = Date.now();
    
    // 收集最终输出（最后一个节点的输出）
    const lastNodeId = executionOrder[executionOrder.length - 1];
    if (lastNodeId && nodeOutputs[lastNodeId]) {
      execution.finalOutputs = nodeOutputs[lastNodeId];
    }
  }

  /**
   * 执行单个节点
   */
  private async executeNode(
    nodeDef: {
      id: string;
      type: string;
      name: string;
      config: Record<string, unknown>;
      inputs?: Record<string, string>;
    },
    workflow: WorkflowInstance,
    exprContext: ExpressionContext,
    execution: WorkflowExecution
  ): Promise<NodeResult> {
    const handler = nodeRegistry.get(nodeDef.type);
    if (!handler) {
      return {
        success: false,
        outputs: {},
        error: `未知的节点类型: ${nodeDef.type}`,
      };
    }

    // 解析输入
    const resolvedInputs = nodeDef.inputs 
      ? resolveInputs(nodeDef.inputs, exprContext)
      : {};

    // 创建节点上下文
    const nodeContext: NodeContext = {
      workflowId: workflow.id,
      nodeId: nodeDef.id,
      userId: workflow.userId,
      agentId: workflow.agentId,
      chatId: workflow.chatId,
      contextToken: workflow.contextToken,
      inputs: resolvedInputs,
      state: exprContext.nodeOutputs,
      variables: workflow.variables,
      config: nodeDef.config,
    };

    // 更新节点状态
    const nodeRecord = execution.nodeExecutions.find((n) => n.nodeId === nodeDef.id)!;
    nodeRecord.status = "running";
    nodeRecord.startedAt = Date.now();
    nodeRecord.inputs = resolvedInputs;

    try {
      // 设置超时
      const timeout = (nodeDef.config.timeout as number) || this.config.defaultTimeout;
      
      const result = await Promise.race([
        handler.execute(nodeContext),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error(`执行超时 (${timeout}ms)`)), timeout)
        ),
      ]);

      nodeRecord.completedAt = Date.now();
      return result;
    } catch (error) {
      nodeRecord.completedAt = Date.now();
      return {
        success: false,
        outputs: {},
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 检查依赖是否满足
   */
  private checkDependencies(
    nodeId: string,
    connections: Array<{ from: string; to: string }>,
    execution: WorkflowExecution
  ): boolean {
    // 找到所有指向当前节点的连接
    const incomingConnections = connections.filter((c) => c.to === nodeId);
    
    // 如果没有入边，说明是起始节点
    if (incomingConnections.length === 0) {
      return true;
    }

    // 检查所有前置节点是否完成
    for (const conn of incomingConnections) {
      const fromNode = execution.nodeExecutions.find((n) => n.nodeId === conn.from);
      if (!fromNode || fromNode.status !== "completed") {
        return false;
      }
    }

    return true;
  }

  /**
   * 拓扑排序
   */
  private topologicalSort(
    nodes: Array<{ id: string }>,
    connections: Array<{ from: string; to: string }>
  ): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    // 构建邻接表
    const graph = new Map<string, string[]>();
    for (const node of nodes) {
      graph.set(node.id, []);
    }
    for (const conn of connections) {
      const neighbors = graph.get(conn.from) || [];
      neighbors.push(conn.to);
      graph.set(conn.from, neighbors);
    }

    // DFS
    const visit = (nodeId: string): void => {
      if (visited.has(nodeId)) return;
      if (visiting.has(nodeId)) {
        throw new Error(`检测到循环依赖: ${nodeId}`);
      }

      visiting.add(nodeId);
      const neighbors = graph.get(nodeId) || [];
      for (const neighbor of neighbors) {
        visit(neighbor);
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
      result.push(nodeId);
    };

    // 对所有节点执行DFS
    for (const node of nodes) {
      if (!visited.has(node.id)) {
        visit(node.id);
      }
    }

    // 反转得到正确的执行顺序
    return result.reverse();
  }

  /**
   * 处理执行队列
   */
  private processQueue(): void {
    if (this.executionQueue.length === 0) return;
    if (this.runningExecutions.size >= this.config.maxConcurrent) return;

    const nextId = this.executionQueue.shift();
    if (nextId) {
      console.log(`[WorkflowEngine] 从队列开始执行: ${nextId}`);
      // 实际应该重新加载并执行
    }
  }

  /**
   * 取消执行
   */
  cancelExecution(executionId: string): boolean {
    const execution = this.runningExecutions.get(executionId);
    if (!execution) return false;

    execution.status = "cancelled";
    this.runningExecutions.delete(executionId);
    return true;
  }

  /**
   * 获取执行状态
   */
  getExecution(executionId: string): WorkflowExecution | undefined {
    return this.runningExecutions.get(executionId);
  }

  /**
   * 获取所有运行中的执行
   */
  getRunningExecutions(): WorkflowExecution[] {
    return Array.from(this.runningExecutions.values());
  }

  /**
   * 获取引擎统计
   */
  getStats(): {
    running: number;
    queued: number;
    maxConcurrent: number;
  } {
    return {
      running: this.runningExecutions.size,
      queued: this.executionQueue.length,
      maxConcurrent: this.config.maxConcurrent,
    };
  }
}

// 默认引擎实例
export const defaultEngine = new WorkflowEngine();
