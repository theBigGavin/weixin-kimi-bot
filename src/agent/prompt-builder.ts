/**
 * 提示词构建器
 * 
 * 负责构建完整的系统提示词，确保在上下文压缩后正确注入
 */
import type { AgentRuntime, PromptBuildOptions } from "./types.js";
import { formatMemoryForPrompt } from "../memory/manager.js";

/**
 * 构建系统提示词
 */
export function buildSystemPrompt(
  runtime: AgentRuntime,
  options: Partial<PromptBuildOptions> = {}
): string {
  const opts: PromptBuildOptions = {
    includeMemory: true,
    includeProjects: true,
    includeRecentContext: true,
    memoryLimit: 10,
    ...options,
  };

  const parts: string[] = [];

  // 1. 基础能力模板（必须，放在最前面）
  parts.push(runtime.template.systemPrompt);

  // 2. 长期记忆（如果启用）
  if (opts.includeMemory && runtime.config.memory.enabled) {
    const memoryContext = formatMemoryForPrompt(
      runtime.memory,
      runtime.context.recentTopics
    );
    
    if (memoryContext) {
      parts.push("## 关于用户的记忆\n以下是我对你的了解和记忆，请在回复时参考：\n\n" + memoryContext);
    }
  }

  // 3. 当前项目上下文
  if (opts.includeProjects) {
    const activeProject = runtime.memory.projects.find(
      p => p.id === runtime.context.currentProjectId && p.status === "active"
    );

    if (activeProject) {
      parts.push(
        `## 当前项目: ${activeProject.name}\n` +
        `${activeProject.description}\n` +
        (activeProject.techStack?.length
          ? `技术栈: ${activeProject.techStack.join(", ")}\n`
          : "")
      );
    }
  }

  // 4. 用户自定义提示词（追加）
  if (runtime.config.ai.customSystemPrompt) {
    parts.push("## 额外指令\n" + runtime.config.ai.customSystemPrompt);
  }

  // 5. 工作目录信息
  parts.push(`## 工作目录\n当前工作目录: ${runtime.config.workspace.path}\n请在此目录下进行文件操作。`);

  // 6. 当前状态提示（确保AI知道上下文可能不完整）
  parts.push(`## 注意\n` +
    `- 当前日期: ${new Date().toLocaleDateString("zh-CN")}\n` +
    `- 如果上下文看起来不完整，请询问用户确认\n` +
    `- 重要决策前请先确认用户意图`
  );

  return parts.join("\n\n---\n\n");
}

/**
 * 构建简化的系统提示词（用于上下文受限的情况）
 */
export function buildCompactSystemPrompt(runtime: AgentRuntime): string {
  const parts: string[] = [];

  // 核心身份提示词（简化版）
  parts.push(runtime.template.systemPrompt.slice(0, 500) + "...");

  // 关键记忆（只取最重要的）
  if (runtime.config.memory.enabled) {
    const criticalFacts = runtime.memory.facts
      .filter(f => f.importance >= 4)
      .slice(0, 3);

    if (criticalFacts.length > 0) {
      parts.push(
        "【关键信息】\n" +
        criticalFacts.map(f => `- ${f.content}`).join("\n")
      );
    }
  }

  // 工作目录
  parts.push(`工作目录: ${runtime.config.workspace.path}`);

  return parts.join("\n\n");
}

/**
 * 检测是否需要重新注入系统提示词
 * 
 * 当检测到以下情况时，需要重新注入：
 * 1. 对话轮次超过阈值
 * 2. 上下文可能被压缩/重置
 * 3. 用户明确请求重置
 */
export function shouldReinjectPrompt(
  runtime: AgentRuntime,
  conversationTurns: number
): boolean {
  // 达到轮次阈值
  if (conversationTurns >= runtime.config.ai.maxTurns * 0.8) {
    return true;
  }

  // 距离上次记忆提取时间太长（可能上下文已丢失）
  const lastExtract = runtime.context.lastExtractedMemoryAt;
  if (lastExtract && Date.now() - lastExtract > 30 * 60 * 1000) {
    return true;
  }

  return false;
}

/**
 * 构建欢迎消息
 */
export function buildWelcomeMessage(runtime: AgentRuntime): string {
  const template = runtime.template;
  
  let message = template.welcomeMessage || `你好！我是你的${template.name}。`;

  // 添加个性化称呼
  if (runtime.memory.userProfile.name) {
    message = message.replace("你好！", `你好 ${runtime.memory.userProfile.name}！`);
  }

  // 添加建议命令
  if (template.suggestions && template.suggestions.length > 0) {
    message += "\n\n你可以这样开始：\n";
    message += template.suggestions.map(s => `• ${s}`).join("\n");
  }

  // 添加能力说明
  message += `\n\n💡 提示：发送 /help 查看所有命令`;

  return message;
}

/**
 * 构建记忆提取提示词
 */
export function buildMemoryExtractionPrompt(conversation: string): string {
  return `请从以下对话中提取需要长期记忆的重要信息。

对话内容：
${conversation}

请提取：
1. 用户明确的偏好设置
2. 用户的身份信息（姓名、职业等）
3. 用户正在进行的项目
4. 重要的技术决策或事实
5. 用户的专长领域

以JSON格式返回：
{
  "facts": [
    {"content": "事实内容", "category": "personal|work|project|tech", "importance": 1-5}
  ],
  "projects": [
    {"name": "项目名称", "description": "描述", "status": "active|paused|completed"}
  ],
  "userProfile": {
    "name": "姓名",
    "role": "角色",
    "preferences": ["偏好1", "偏好2"]
  }
}

如果没有提取到信息，返回空对象 {}`;
}

/**
 * 构建命令帮助提示词
 */
export function buildHelpPrompt(runtime: AgentRuntime): string {
  const template = runtime.template;
  
  return `🤖 **命令帮助**

**基础命令：**
/help - 显示此帮助
/reset - 重置对话上下文
/status - 查看Agent状态
/template - 查看/切换能力模板
/memory - 管理长期记忆
/ver - 查看Bot版本信息

**当前角色：** ${template.name} ${template.icon}
${template.description}

**工作目录：** \`${runtime.config.workspace.path}\`

**功能开关：**
${runtime.config.features.fileAccess ? "✅" : "❌"} 文件操作
${runtime.config.features.webSearch ? "✅" : "❌"} 网络搜索
${runtime.config.features.scheduledTasks ? "✅" : "❌"} 定时任务

💡 直接发送消息即可开始对话`;
}

/**
 * 构建状态提示词
 */
export function buildStatusPrompt(runtime: AgentRuntime): string {
  const config = runtime.config;
  const stats = config.stats;

  return `📊 **Agent状态**

**基本信息：**
名称: ${config.name}
ID: \`${config.id}\`
角色: ${runtime.template.name} ${runtime.template.icon}
创建时间: ${new Date(config.createdAt).toLocaleDateString("zh-CN")}

**AI配置：**
模型: ${config.ai.model}
能力模板: ${runtime.template.name}
最大轮次: ${config.ai.maxTurns}
温度: ${config.ai.temperature || "默认"}

**统计：**
对话数: ${stats.totalConversations}
消息数: ${stats.totalMessages}
${stats.lastActiveAt ? `最后活跃: ${new Date(stats.lastActiveAt).toLocaleString("zh-CN")}` : ""}

**记忆：**
记忆条目: ${runtime.memory.facts.length}
活跃项目: ${runtime.memory.projects.filter(p => p.status === "active").length}
记忆功能: ${config.memory.enabled ? "✅ 启用" : "❌ 禁用"}

**工作目录：**
\`${config.workspace.path}\``;
}
