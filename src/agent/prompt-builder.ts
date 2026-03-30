/**
 * 提示词构建器
 * 
 * 负责构建完整的系统提示词，确保在上下文压缩后正确注入
 */
import type { AgentRuntime, PromptBuildOptions } from "./types.js";
import { formatMemoryForPrompt } from "../memory/manager.js";
import { getTDDInstruction } from "../prompt/tdd-instruction.js";

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

  // 2. TDD 指令（如果是编程相关角色）
  const tddInstruction = getTDDInstruction(runtime);
  if (tddInstruction) {
    parts.push(tddInstruction);
  }

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
  if (runtime.config.templateOverride?.systemPromptAppend) {
    parts.push("## 额外指令\n" + runtime.config.templateOverride.systemPromptAppend);
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
/session status - 查看当前 session 状态
/status - 查看Agent状态
/template - 查看/切换能力模板
/memory - 管理长期记忆
/task - 定时任务管理
/longtask - 耗时任务管理(支持进度报告、后台执行)
/flowtask - 可靠任务流(结构化计划执行)
/route - 智能任务路由(分析任务并选择执行模式)
/auto - 开关自动路由(on/off)
/deploy - 部署Bot (patch/minor/major)
/ver - 查看Bot版本信息

**/longtask 详细说明：**
- /longtask <描述> - 提交耗时任务(如重构、批量处理)
- /longtask list - 查看所有任务及状态
- /longtask status <id> - 查看指定任务进度
- /longtask cancel <id> - 取消运行中的任务
- 自动识别: 包含"重构/迁移/批量/构建"等关键词自动转为后台任务
- 进度报告: 每30秒自动推送进度(步骤+文件+百分比)
- 并发控制: 最多5个任务并行，超出自动排队
- 历史记录: 任务完成后长期保存，可随时查看

**/flowtask 详细说明：**
- /flowtask run <描述> - 启动可靠任务流
- /flowtask list - 查看任务列表
- /flowtask status <id> - 查看任务进度
- /flowtask plan <id> - 查看执行计划
- /flowtask cancel <id> - 取消任务
- /flowtask approve <id> - 确认继续执行
- /flowtask reject <id> [原因] - 拒绝执行
- 特点: 结构化计划 | 状态机执行 | 人机协作 | 自动回滚

**/route 详细说明(智能任务路由)：**
- /route analyze <任务描述> - 分析任务复杂度并显示路由决策
- /route stats - 查看路由统计信息
- /route auto on/off - 开关自动路由
- 自动分析任务复杂度，智能选择执行模式:
  • direct: 直接执行(简单任务)
  • longtask: 后台执行(中等复杂度)
  • flowtask: 结构化执行(复杂任务)

**/auto 详细说明：**
- /auto on - 开启自动路由(系统智能选择执行模式)
- /auto off - 关闭自动路由(所有任务直接执行)
- /auto status - 查看当前状态
- 开启后，系统会自动分析任务并路由到合适的执行模式

**/deploy 详细说明：**
- /deploy 或 /deploy patch - 部署补丁版本
- /deploy minor - 部署次版本
- /deploy major - 部署主版本
- 自动执行版本更新和PM2重启
- 部署完成后会推送通知

**当前角色:** ${template.name} ${template.icon}
${template.description}

**工作目录:** \`${runtime.config.workspace.path}\`

**功能开关:**
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
  const isFounder = config.type === "founder";

  // ProjectSpace 信息（仅创始Agent显示）
  const projectSpaceInfo = isFounder && config.projectSpace ? `

**项目空间 (ProjectSpace)：**
类型: 🏗️ 创始Agent
项目路径: \`${config.projectSpace.path}\`
${config.projectSpace.repository ? `代码仓库: ${config.projectSpace.repository}` : ""}
${config.projectSpace.description ? `项目描述: ${config.projectSpace.description}` : ""}
${config.projectSpace.rules ? `维护规则:
${config.projectSpace.rules.gitRequired ? "  - ✅ 必须使用 Git" : ""}
${config.projectSpace.rules.noTemporaryFiles ? "  - ✅ 禁止临时文件" : ""}
${config.projectSpace.rules.ciCdEnabled ? "  - ✅ 启用 CI/CD" : ""}` : ""}` : "";

  return `📊 **Agent状态**

**基本信息：**
名称: ${config.name}
ID: \`${config.id}\`
角色: ${runtime.template.name} ${runtime.template.icon}
类型: ${isFounder ? "🏗️ 创始Agent" : "🤖 普通助手"}
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
\`${config.workspace.path}\`${projectSpaceInfo}`;
}
