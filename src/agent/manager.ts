/**
 * Agent 管理器
 * 
 * 管理多Agent的生命周期、配置和隔离
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { AgentConfig, AgentRuntime, CapabilityTemplate, AgentMemory } from "./types.js";
import { getTemplateById, getDefaultTemplate } from "../templates/definitions.js";

const BASE_DIR = join(homedir(), ".weixin-kimi-bot", "agents");

/**
 * 生成Agent ID
 */
function generateAgentId(): string {
  return `agent_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * 创建工作目录
 */
async function createWorkspace(agentId: string): Promise<string> {
  const workspacePath = join(BASE_DIR, agentId, "workspace");
  await mkdir(workspacePath, { recursive: true });
  
  // 创建README
  const readme = `# Agent ${agentId} 工作目录

此目录是AI助手的工作空间，包含：
- 代码项目
- 数据文件
- 生成的文档
- 临时文件

注意：此目录内容由AI管理，请谨慎手动修改。
`;
  await writeFile(join(workspacePath, "README.md"), readme, "utf-8");
  
  return workspacePath;
}

/**
 * 初始化Agent内存
 */
function initializeMemory(): AgentMemory {
  return {
    version: 1,
    updatedAt: Date.now(),
    userProfile: {
      preferences: [],
      expertise: [],
      habits: [],
    },
    facts: [],
    projects: [],
    learning: [],
  };
}

/**
 * Agent 管理器类
 */
export class AgentManager {
  private agents: Map<string, AgentConfig> = new Map();
  private initialized = false;

  /**
   * 初始化管理器
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 确保基础目录存在
    await mkdir(BASE_DIR, { recursive: true });

    // 加载所有Agent配置
    await this.loadAllAgents();

    this.initialized = true;
    console.log(`[AgentManager] 已初始化，加载了 ${this.agents.size} 个Agent`);
  }

  /**
   * 加载所有Agent配置
   */
  private async loadAllAgents(): Promise<void> {
    try {
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(BASE_DIR, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith("agent_")) {
          try {
            const config = await this.loadAgentConfig(entry.name);
            if (config) {
              this.agents.set(config.id, config);
            }
          } catch (e) {
            console.error(`[AgentManager] 加载Agent ${entry.name} 失败:`, e);
          }
        }
      }
    } catch {
      // 目录可能不存在，忽略
    }
  }

  /**
   * 加载单个Agent配置
   */
  private async loadAgentConfig(agentId: string): Promise<AgentConfig | null> {
    const configPath = join(BASE_DIR, agentId, "config.json");
    
    if (!existsSync(configPath)) {
      return null;
    }

    const data = await readFile(configPath, "utf-8");
    return JSON.parse(data) as AgentConfig;
  }

  /**
   * 保存Agent配置
   */
  private async saveAgentConfig(config: AgentConfig): Promise<void> {
    const configPath = join(BASE_DIR, config.id, "config.json");
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  /**
   * 创建新Agent
   */
  async createAgent(
    wechatAccountId: string,
    options: {
      name?: string;
      templateId?: string;
      workspacePath?: string;
    } = {}
  ): Promise<AgentConfig> {
    const template = getTemplateById(options.templateId || "general") || getDefaultTemplate();
    const agentId = generateAgentId();
    
    // 创建Agent目录结构
    const agentDir = join(BASE_DIR, agentId);
    await mkdir(agentDir, { recursive: true });
    await mkdir(join(agentDir, "context"), { recursive: true });
    
    // 创建工作目录
    const workspacePath = options.workspacePath || await createWorkspace(agentId);

    const config: AgentConfig = {
      id: agentId,
      name: options.name || `${template.name}_${Date.now()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      wechat: {
        accountId: wechatAccountId,
      },
      workspace: {
        path: workspacePath,
        createdAt: Date.now(),
      },
      ai: {
        model: template.defaults.model,
        templateId: template.id,
        maxTurns: template.defaults.maxTurns,
        temperature: template.defaults.temperature,
      },
      memory: {
        enabled: true,
        maxItems: 100,
        autoExtract: true,
      },
      features: {
        scheduledTasks: true,
        notifications: true,
        fileAccess: template.tools.fileOperations,
        webSearch: template.tools.webSearch,
      },
      stats: {
        totalConversations: 0,
        totalMessages: 0,
      },
    };

    // 保存配置
    await this.saveAgentConfig(config);
    
    // 初始化内存
    await this.saveAgentMemory(agentId, initializeMemory());

    // 添加到缓存
    this.agents.set(agentId, config);

    console.log(`[AgentManager] 创建Agent: ${agentId}`);
    return config;
  }

  /**
   * 根据微信账号ID查找Agent
   */
  findAgentByWechat(wechatAccountId: string): AgentConfig | undefined {
    for (const agent of this.agents.values()) {
      if (agent.wechat.accountId === wechatAccountId) {
        return agent;
      }
    }
    return undefined;
  }

  /**
   * 根据ID获取Agent
   */
  getAgent(agentId: string): AgentConfig | undefined {
    return this.agents.get(agentId);
  }

  /**
   * 获取所有Agent
   */
  getAllAgents(): AgentConfig[] {
    return Array.from(this.agents.values());
  }

  /**
   * 更新Agent配置
   */
  async updateAgent(
    agentId: string,
    updates: Partial<AgentConfig>
  ): Promise<AgentConfig | null> {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    const updated = {
      ...agent,
      ...updates,
      id: agent.id, // 保护ID
      updatedAt: Date.now(),
    };

    await this.saveAgentConfig(updated);
    this.agents.set(agentId, updated);

    return updated;
  }

  /**
   * 更新Agent能力模板
   */
  async applyTemplate(agentId: string, templateId: string): Promise<AgentConfig | null> {
    const template = getTemplateById(templateId);
    if (!template) return null;

    const agent = this.agents.get(agentId);
    if (!agent) return null;

    const updated: AgentConfig = {
      ...agent,
      ai: {
        ...agent.ai,
        templateId: template.id,
        model: template.defaults.model,
        maxTurns: template.defaults.maxTurns,
        temperature: template.defaults.temperature,
      },
      features: {
        ...agent.features,
        fileAccess: template.tools.fileOperations,
        webSearch: template.tools.webSearch,
      },
      updatedAt: Date.now(),
    };

    await this.saveAgentConfig(updated);
    this.agents.set(agentId, updated);

    return updated;
  }

  /**
   * 删除Agent
   */
  async deleteAgent(agentId: string): Promise<boolean> {
    if (!this.agents.has(agentId)) return false;

    // 这里可以选择是否删除工作目录
    // 暂时保留数据，仅标记删除

    this.agents.delete(agentId);
    console.log(`[AgentManager] 删除Agent: ${agentId}`);
    return true;
  }

  /**
   * 加载Agent内存
   */
  async loadAgentMemory(agentId: string): Promise<AgentMemory | null> {
    const memoryPath = join(BASE_DIR, agentId, "memory.json");
    
    if (!existsSync(memoryPath)) {
      return null;
    }

    try {
      const data = await readFile(memoryPath, "utf-8");
      return JSON.parse(data) as AgentMemory;
    } catch (e) {
      console.error(`[AgentManager] 加载内存失败:`, e);
      return null;
    }
  }

  /**
   * 保存Agent内存
   */
  async saveAgentMemory(agentId: string, memory: AgentMemory): Promise<void> {
    const memoryPath = join(BASE_DIR, agentId, "memory.json");
    memory.updatedAt = Date.now();
    await writeFile(memoryPath, JSON.stringify(memory, null, 2), "utf-8");
  }

  /**
   * 构建运行时环境
   */
  async buildRuntime(agentId: string): Promise<AgentRuntime | null> {
    const config = this.agents.get(agentId);
    if (!config) return null;

    const template = getTemplateById(config.ai.templateId) || getDefaultTemplate();
    const memory = await this.loadAgentMemory(agentId) || initializeMemory();

    return {
      config,
      memory,
      template,
      context: {
        recentTopics: [],
      },
    };
  }

  /**
   * 更新Agent统计
   */
  async updateStats(agentId: string, isNewConversation = false): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.stats.totalMessages++;
    if (isNewConversation) {
      agent.stats.totalConversations++;
    }
    agent.stats.lastActiveAt = Date.now();
    agent.updatedAt = Date.now();

    await this.saveAgentConfig(agent);
  }

  /**
   * 检查Agent是否存在
   */
  hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * 获取Agent目录路径
   */
  getAgentPath(agentId: string): string {
    return join(BASE_DIR, agentId);
  }
}

// 导出单例
export const agentManager = new AgentManager();
