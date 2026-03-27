/**
 * Agent 类型定义
 * 
 * 多Agent架构的核心数据模型
 */

// ============ Agent 配置 ============

export interface AgentConfig {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;

  /** 微信绑定信息 */
  wechat: {
    accountId: string;
    nickname?: string;
    avatar?: string;
  };

  /** 工作目录配置 */
  workspace: {
    path: string;
    createdAt: number;
  };

  /** AI 能力配置 */
  ai: {
    model: string;
    templateId: string;
    customSystemPrompt?: string;
    maxTurns: number;
    temperature?: number;
  };

  /** 记忆配置 */
  memory: {
    enabled: boolean;
    maxItems: number;
    autoExtract: boolean;
  };

  /** 功能开关 */
  features: {
    scheduledTasks: boolean;
    notifications: boolean;
    fileAccess: boolean;
    webSearch: boolean;
  };

  /** 统计信息 */
  stats: {
    totalConversations: number;
    totalMessages: number;
    lastActiveAt?: number;
  };
}

// ============ 能力模板 ============

export interface CapabilityTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: "development" | "writing" | "creative" | "business" | "lifestyle" | "other";
  
  /** 系统提示词（核心） */
  systemPrompt: string;
  
  /** 首次欢迎语 */
  welcomeMessage?: string;
  
  /** 建议的命令 */
  suggestions?: string[];
  
  /** 默认配置 */
  defaults: {
    model: string;
    maxTurns: number;
    temperature: number;
  };
  
  /** 工具权限 */
  tools: {
    fileOperations: boolean;
    codeExecution: boolean;
    webSearch: boolean;
    gitOperations: boolean;
  };
  
  /** 行为模式 */
  behavior: {
    proactive: boolean;
    verbose: boolean;
    confirmDestructive: boolean;
  };
}

// ============ 长期记忆 ============

export interface MemoryFact {
  id: string;
  content: string;
  category: "personal" | "work" | "project" | "tech" | "preference" | "other";
  importance: number; // 1-5
  confidence: number; // 0-1
  createdAt: number;
  updatedAt: number;
  source?: string; // 来源对话ID
  context?: string; // 上下文摘要
}

export interface MemoryProject {
  id: string;
  name: string;
  description: string;
  status: "active" | "paused" | "completed" | "archived";
  techStack?: string[];
  keyFiles?: string[];
  milestones?: Array<{
    description: string;
    date: number;
  }>;
  createdAt: number;
  updatedAt: number;
}

export interface AgentMemory {
  version: number;
  updatedAt: number;

  /** 用户画像 */
  userProfile: {
    name?: string;
    role?: string;
    company?: string;
    preferences: string[];
    expertise: string[];
    habits: string[];
    goals?: string[];
  };

  /** 重要事实 */
  facts: MemoryFact[];

  /** 项目上下文 */
  projects: MemoryProject[];

  /** 学习记录 */
  learning: Array<{
    topic: string;
    level: "beginner" | "intermediate" | "advanced" | "expert";
    notes: string;
    date: number;
  }>;

  /** 关系网络（人物/组织） */
  relations?: Array<{
    name: string;
    relation: string;
    notes?: string;
  }>;
}

// ============ Agent 运行时状态 ============

export interface AgentRuntime {
  config: AgentConfig;
  memory: AgentMemory;
  template: CapabilityTemplate;
  
  /** 当前上下文 */
  context: {
    currentProjectId?: string;
    recentTopics: string[];
    lastExtractedMemoryAt?: number;
  };
}

// ============ Agent 操作结果 ============

export interface AgentOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============ 提示词构建选项 ============

export interface PromptBuildOptions {
  includeMemory: boolean;
  includeProjects: boolean;
  includeRecentContext: boolean;
  memoryLimit?: number;
  projectStatusFilter?: ("active" | "paused" | "completed")[];
}

// ============ 记忆提取结果 ============

export interface MemoryExtraction {
  facts: Array<{
    content: string;
    category: MemoryFact["category"];
    importance: number;
  }>;
  projects: Array<{
    name: string;
    description: string;
    status: MemoryProject["status"];
    techStack?: string[];
  }>;
  userProfile?: {
    name?: string;
    role?: string;
    preferences?: string[];
  };
}
