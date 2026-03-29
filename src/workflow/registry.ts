/**
 * Workflow Node Registry - 节点注册表
 * 
 * 管理所有可插拔的节点处理器
 */

import type { NodeHandler, JSONSchema } from "./types.js";

/** 节点注册表 */
class NodeRegistry {
  private handlers: Map<string, NodeHandler> = new Map();
  private categories: Map<string, string[]> = new Map();

  /**
   * 注册节点处理器
   */
  register(handler: NodeHandler): void {
    if (this.handlers.has(handler.type)) {
      console.warn(`[WorkflowRegistry] 节点类型 '${handler.type}' 已存在，将被覆盖`);
    }
    
    this.handlers.set(handler.type, handler);
    
    // 按分类组织
    const category = handler.category || "other";
    if (!this.categories.has(category)) {
      this.categories.set(category, []);
    }
    const types = this.categories.get(category)!;
    if (!types.includes(handler.type)) {
      types.push(handler.type);
    }
    
    console.log(`[WorkflowRegistry] 注册节点: ${handler.type} (${handler.name})`);
  }

  /**
   * 取消注册节点处理器
   */
  unregister(type: string): boolean {
    const handler = this.handlers.get(type);
    if (!handler) return false;
    
    this.handlers.delete(type);
    
    // 从分类中移除
    const category = handler.category || "other";
    const types = this.categories.get(category);
    if (types) {
      const idx = types.indexOf(type);
      if (idx !== -1) types.splice(idx, 1);
    }
    
    return true;
  }

  /**
   * 获取节点处理器
   */
  get(type: string): NodeHandler | undefined {
    return this.handlers.get(type);
  }

  /**
   * 检查节点类型是否存在
   */
  has(type: string): boolean {
    return this.handlers.has(type);
  }

  /**
   * 获取所有节点类型
   */
  getAllTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * 获取所有节点处理器
   */
  getAllHandlers(): NodeHandler[] {
    return Array.from(this.handlers.values());
  }

  /**
   * 获取分类列表
   */
  getCategories(): string[] {
    return Array.from(this.categories.keys());
  }

  /**
   * 获取指定分类的节点类型
   */
  getTypesByCategory(category: string): string[] {
    return this.categories.get(category) || [];
  }

  /**
   * 获取节点元数据（用于UI展示）
   */
  getNodeMetadata(type: string): {
    type: string;
    name: string;
    description: string;
    category?: string;
    configSchema?: JSONSchema;
    inputSchema?: JSONSchema;
    outputSchema?: JSONSchema;
  } | null {
    const handler = this.handlers.get(type);
    if (!handler) return null;
    
    return {
      type: handler.type,
      name: handler.name,
      description: handler.description,
      category: handler.category,
      configSchema: handler.configSchema,
      inputSchema: handler.inputSchema,
      outputSchema: handler.outputSchema,
    };
  }

  /**
   * 清空所有注册
   */
  clear(): void {
    this.handlers.clear();
    this.categories.clear();
  }

  /**
   * 获取注册统计
   */
  getStats(): {
    total: number;
    byCategory: Record<string, number>;
  } {
    const byCategory: Record<string, number> = {};
    for (const [category, types] of this.categories) {
      byCategory[category] = types.length;
    }
    
    return {
      total: this.handlers.size,
      byCategory,
    };
  }
}

// 全局单例注册表
export const nodeRegistry = new NodeRegistry();

// 导出便捷函数
export function registerNode(handler: NodeHandler): void {
  nodeRegistry.register(handler);
}

export function getNodeHandler(type: string): NodeHandler | undefined {
  return nodeRegistry.get(type);
}

export function hasNodeHandler(type: string): boolean {
  return nodeRegistry.has(type);
}
