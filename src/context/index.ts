/**
 * 上下文感知架构 - 统一导出
 * 
 * 提供会话上下文管理、状态机、意图识别等核心功能
 */

// ============ 类型导出 ============
export {
  // 状态
  ConversationState,
  StateContext,
  PendingDecision,
  ExpectedInputType,
  // 意图
  IntentType,
  Intent,
  Entity,
  Reference,
  // 消息和选项
  ContextMessage,
  StructuredContent,
  Option,
  // 话题
  TopicFrame,
  // 会话
  SessionContext,
  SessionMetadata,
  // 状态机
  StateTransition,
  StateTransitionResult,
  // 指代消解
  ResolutionResult,
  ReferencePattern,
  // 对话图谱
  ConversationGraph,
  TopicNode,
  TopicEdge,
  // 工具函数
  translateState,
  translateIntent,
} from './types.js';

// ============ 类导出 ============
export { SessionContextManager } from './session-context.js';
export { ConversationStateMachine } from './state-machine.js';
export { ContextPersistence } from './persistence.js';
export { ReferenceResolver } from './reference-resolver.js';
export { IntentResolver } from './intent-resolver.js';
export { OutputParser, ParseResult } from './output-parser.js';

// ============ 便捷初始化函数 ============

import { SessionContextManager } from './session-context.js';
import { ContextPersistence } from './persistence.js';
import { ConversationStateMachine } from './state-machine.js';

/**
 * 上下文管理器实例
 * 全局单例，在应用启动时初始化
 */
let contextManagerInstance: SessionContextManager | null = null;
let stateMachineInstance: ConversationStateMachine | null = null;

/**
 * 初始化上下文系统
 * 
 * 在应用启动时调用一次
 */
export function initializeContextSystem(): {
  contextManager: SessionContextManager;
  stateMachine: ConversationStateMachine;
} {
  if (contextManagerInstance && stateMachineInstance) {
    return {
      contextManager: contextManagerInstance,
      stateMachine: stateMachineInstance,
    };
  }

  const persistence = new ContextPersistence();
  contextManagerInstance = new SessionContextManager(persistence);
  stateMachineInstance = new ConversationStateMachine();

  console.log('[Context] 上下文系统已初始化');

  return {
    contextManager: contextManagerInstance,
    stateMachine: stateMachineInstance,
  };
}

/**
 * 获取上下文管理器
 * 
 * 需要先调用 initializeContextSystem()
 */
export function getContextManager(): SessionContextManager {
  if (!contextManagerInstance) {
    throw new Error('上下文系统未初始化，请先调用 initializeContextSystem()');
  }
  return contextManagerInstance;
}

/**
 * 获取状态机
 * 
 * 需要先调用 initializeContextSystem()
 */
export function getStateMachine(): ConversationStateMachine {
  if (!stateMachineInstance) {
    throw new Error('上下文系统未初始化，请先调用 initializeContextSystem()');
  }
  return stateMachineInstance;
}

/**
 * 重置上下文系统
 * 
 * 用于测试或重置
 */
export function resetContextSystem(): void {
  contextManagerInstance = null;
  stateMachineInstance = null;
  console.log('[Context] 上下文系统已重置');
}
