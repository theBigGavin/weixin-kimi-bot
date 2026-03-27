/**
 * 记忆管理器
 * 
 * 管理长期记忆的提取、存储和检索
 */
import { spawn } from "node:child_process";
import type { AgentMemory, MemoryFact, MemoryProject, MemoryExtraction } from "../agent/types.js";
import { agentManager } from "../agent/manager.js";

/**
 * 从对话中提取记忆
 */
export async function extractMemoryFromConversation(
  conversation: string,
  agentId: string
): Promise<MemoryExtraction | null> {
  const systemPrompt = `你是一个记忆提取专家。请从以下对话中提取有价值的信息，用于构建用户的长期记忆。

请提取以下类型的信息：

1. **重要事实（facts）**
   - 用户的身份信息（姓名、职业、公司等）
   - 用户的偏好和习惯
   - 用户提到的关键信息
   - 重要的时间、地点、人物

2. **项目信息（projects）**
   - 用户正在进行的项目
   - 项目的技术栈
   - 项目的状态和进展

3. **用户画像更新（userProfile）**
   - 用户的角色/职位
   - 用户的目标和计划
   - 用户的专长领域

输出要求：
- 只提取确定的信息，不要推测
- 为每个事实分配重要程度（1-5）
- 为每个事实分配类别（personal/work/project/tech/preference/other）

以JSON格式返回：
{
  "facts": [
    {
      "content": "具体事实内容",
      "category": "personal|work|project|tech|preference|other",
      "importance": 1-5
    }
  ],
  "projects": [
    {
      "name": "项目名称",
      "description": "项目描述",
      "status": "active|paused|completed",
      "techStack": ["技术1", "技术2"]
    }
  ],
  "userProfile": {
    "name": "姓名（如果有）",
    "role": "角色/职位（如果有）",
    "preferences": ["偏好1", "偏好2"]
  }
}

如果没有提取到有价值的信息，返回空对象：{}`;

  return new Promise((resolve, reject) => {
    const child = spawn("kimi", [
      "--quiet",
      "--system-prompt", systemPrompt,
      "--prompt", conversation,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (data: Buffer) => {
      stdout.push(data);
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr.push(data);
    });

    child.on("error", (err) => {
      reject(new Error(`Kimi CLI 错误: ${err.message}`));
    });

    child.on("close", (code) => {
      const output = Buffer.concat(stdout).toString("utf-8").trim();

      if (code !== 0 && !output) {
        const error = Buffer.concat(stderr).toString("utf-8");
        reject(new Error(`Kimi CLI 退出码 ${code}: ${error}`));
        return;
      }

      try {
        // 尝试从输出中提取JSON
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          resolve(null);
          return;
        }

        const result = JSON.parse(jsonMatch[0]);
        
        // 验证结果结构
        const extraction: MemoryExtraction = {
          facts: result.facts || [],
          projects: result.projects || [],
        };

        if (result.userProfile) {
          extraction.userProfile = result.userProfile;
        }

        resolve(extraction);
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * 合并提取的记忆到现有记忆
 */
export function mergeMemory(
  existing: AgentMemory,
  extraction: MemoryExtraction,
  source?: string
): AgentMemory {
  const now = Date.now();
  const updated: AgentMemory = {
    ...existing,
    updatedAt: now,
  };

  // 合并事实
  if (extraction.facts) {
    for (const fact of extraction.facts) {
      // 检查是否已存在相似事实
      const existingFact = updated.facts.find(
        f => f.content.toLowerCase() === fact.content.toLowerCase()
      );

      if (existingFact) {
        // 更新已有事实
        existingFact.importance = Math.max(existingFact.importance, fact.importance);
        existingFact.updatedAt = now;
        if (source) existingFact.source = source;
      } else {
        // 添加新事实
        const newFact: MemoryFact = {
          id: `fact_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          content: fact.content,
          category: fact.category,
          importance: fact.importance,
          confidence: 0.8,
          createdAt: now,
          updatedAt: now,
          source,
        };
        updated.facts.push(newFact);
      }
    }
  }

  // 合并项目
  if (extraction.projects) {
    for (const project of extraction.projects) {
      const existingProject = updated.projects.find(
        p => p.name.toLowerCase() === project.name.toLowerCase()
      );

      if (existingProject) {
        // 更新已有项目
        existingProject.description = project.description || existingProject.description;
        existingProject.status = project.status || existingProject.status;
        if (project.techStack) {
          existingProject.techStack = [...new Set([...(existingProject.techStack || []), ...project.techStack])];
        }
        existingProject.updatedAt = now;
      } else {
        // 添加新项目
        const newProject: MemoryProject = {
          id: `project_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: project.name,
          description: project.description || "",
          status: project.status || "active",
          techStack: project.techStack || [],
          createdAt: now,
          updatedAt: now,
        };
        updated.projects.push(newProject);
      }
    }
  }

  // 更新用户画像
  if (extraction.userProfile) {
    if (extraction.userProfile.name) {
      updated.userProfile.name = extraction.userProfile.name;
    }
    if (extraction.userProfile.role) {
      updated.userProfile.role = extraction.userProfile.role;
    }
    if (extraction.userProfile.preferences) {
      updated.userProfile.preferences = [
        ...new Set([...updated.userProfile.preferences, ...extraction.userProfile.preferences]),
      ];
    }
  }

  // 限制记忆数量
  if (updated.facts.length > 100) {
    // 按重要性和时间排序，保留最重要的
    updated.facts.sort((a, b) => {
      if (b.importance !== a.importance) {
        return b.importance - a.importance;
      }
      return b.updatedAt - a.updatedAt;
    });
    updated.facts = updated.facts.slice(0, 100);
  }

  return updated;
}

/**
 * 获取相关的记忆
 */
export function getRelevantMemory(
  memory: AgentMemory,
  topics: string[],
  limit = 10
): MemoryFact[] {
  if (!memory.facts.length) return [];

  // 简单的相关性评分
  const scored = memory.facts.map(fact => {
    let score = 0;
    
    // 类别匹配加分
    for (const topic of topics) {
      if (fact.content.toLowerCase().includes(topic.toLowerCase())) {
        score += 3;
      }
      if (fact.category.toLowerCase().includes(topic.toLowerCase())) {
        score += 2;
      }
    }
    
    // 重要度加权
    score += fact.importance;
    
    // 时间衰减
    const age = Date.now() - fact.updatedAt;
    const days = age / (1000 * 60 * 60 * 24);
    score -= days * 0.1; // 每天衰减0.1分
    
    return { fact, score };
  });

  // 排序并返回
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.fact);
}

/**
 * 获取活跃项目
 */
export function getActiveProjects(memory: AgentMemory, limit = 3): MemoryProject[] {
  return memory.projects
    .filter(p => p.status === "active")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

/**
 * 格式化记忆为文本
 */
export function formatMemoryForPrompt(memory: AgentMemory, topics: string[] = []): string {
  const parts: string[] = [];

  // 用户画像
  if (memory.userProfile.name || memory.userProfile.role) {
    const profile: string[] = [];
    if (memory.userProfile.name) profile.push(`姓名: ${memory.userProfile.name}`);
    if (memory.userProfile.role) profile.push(`角色: ${memory.userProfile.role}`);
    if (memory.userProfile.company) profile.push(`公司: ${memory.userProfile.company}`);
    
    if (profile.length > 0) {
      parts.push("## 用户信息\n" + profile.join("\n"));
    }
  }

  // 相关记忆
  const relevantFacts = getRelevantMemory(memory, topics);
  if (relevantFacts.length > 0) {
    parts.push(
      "## 相关背景\n" +
      relevantFacts.map(f => `- ${f.content}`).join("\n")
    );
  }

  // 活跃项目
  const activeProjects = getActiveProjects(memory);
  if (activeProjects.length > 0) {
    parts.push(
      "## 当前项目\n" +
      activeProjects.map(p => `- ${p.name}: ${p.description}`).join("\n")
    );
  }

  // 偏好
  if (memory.userProfile.preferences.length > 0) {
    parts.push(
      "## 用户偏好\n" +
      memory.userProfile.preferences.map(pref => `- ${pref}`).join("\n")
    );
  }

  return parts.join("\n\n");
}

/**
 * 保存记忆
 */
export async function saveMemory(agentId: string, memory: AgentMemory): Promise<void> {
  await agentManager.saveAgentMemory(agentId, memory);
}

/**
 * 加载记忆
 */
export async function loadMemory(agentId: string): Promise<AgentMemory | null> {
  return await agentManager.loadAgentMemory(agentId);
}
