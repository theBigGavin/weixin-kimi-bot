/**
 * Agent 管理 CLI
 * 
 * 用法:
 *   npm run agent:list              # 列出所有 Agent
 *   npm run agent:switch            # 交互式切换 Agent
 *   npm run agent:config <id>       # 查看/修改 Agent 配置
 *   npm run agent:template <id>     # 切换能力模板
 *   npm run agent:memory <id>       # 管理记忆
 *   npm run agent:delete <id>       # 删除 Agent
 */
import { agentManager } from "./manager.js";
import { getTemplates } from "../templates/definitions.js";
import type { AgentConfig } from "./types.js";
import { loadMemory, saveMemory, formatMemoryForPrompt } from "../memory/manager.js";

async function prompt(question: string): Promise<string> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function showHelp() {
  console.log(`
Agent 管理工具

用法:
  npm run agent:list              列出所有 Agent
  npm run agent:switch            交互式切换当前 Agent
  npm run agent:config [id]       查看/修改 Agent 配置
  npm run agent:template [id]     切换能力模板
  npm run agent:memory [id]       管理长期记忆
  npm run agent:delete <id>       删除 Agent

环境变量:
  ACTIVE_AGENT_ID                 设置当前活动的 Agent ID
`);
}

async function listAgents() {
  await agentManager.initialize();
  const agents = agentManager.getAllAgents();

  if (agents.length === 0) {
    console.log("\n暂无 Agent\n");
    console.log("运行 npm run login 创建第一个 Agent");
    return;
  }

  console.log("\n=== Agent 列表 ===\n");

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const isActive = process.env.ACTIVE_AGENT_ID === agent.id;
    const marker = isActive ? "👉 " : "   ";

    console.log(`${marker}${i + 1}. ${agent.name}`);
    console.log(`      ID: ${agent.id}`);
    console.log(`      微信: ${agent.wechat.accountId}`);
    console.log(`      工作目录: ${agent.workspace.path}`);
    console.log(`      创建时间: ${new Date(agent.createdAt).toLocaleDateString("zh-CN")}`);
    console.log(`      消息数: ${agent.stats.totalMessages}`);
    console.log();
  }

  console.log(`共 ${agents.length} 个 Agent`);
  console.log("\n设置环境变量切换 Agent:");
  console.log(`  ACTIVE_AGENT_ID=${agents[0].id} npm start`);
}

async function switchAgent() {
  await agentManager.initialize();
  const agents = agentManager.getAllAgents();

  if (agents.length === 0) {
    console.log("\n暂无 Agent，请先运行 npm run login 创建");
    return;
  }

  if (agents.length === 1) {
    const agent = agents[0];
    console.log(`\n只有一个 Agent: ${agent.name}`);
    console.log(`\n使用: ACTIVE_AGENT_ID=${agent.id} npm start`);
    return;
  }

  console.log("\n=== 选择 Agent ===\n");
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const isActive = process.env.ACTIVE_AGENT_ID === agent.id;
    console.log(`${i + 1}. ${isActive ? "👉 " : ""}${agent.name} (${agent.id})`);
  }

  const choice = await prompt(`\n请选择 (1-${agents.length}): `);
  const num = parseInt(choice, 10);

  if (isNaN(num) || num < 1 || num > agents.length) {
    console.log("无效的选择");
    return;
  }

  const selected = agents[num - 1];
  console.log(`\n✅ 已选择: ${selected.name}`);
  console.log(`\n启动命令:`);
  console.log(`  ACTIVE_AGENT_ID=${selected.id} npm start`);
}

async function showConfig(agentId?: string) {
  await agentManager.initialize();

  let agent: AgentConfig | undefined;
  
  if (agentId) {
    agent = agentManager.getAgent(agentId);
  } else {
    const agents = agentManager.getAllAgents();
    if (agents.length === 1) {
      agent = agents[0];
    } else {
      console.log("有多个 Agent，请指定 ID");
      return;
    }
  }

  if (!agent) {
    console.log(`未找到 Agent: ${agentId}`);
    return;
  }

  const templates = getTemplates();
  const template = templates.find(t => t.id === agent.ai.templateId);

  console.log(`\n=== Agent 配置 ===\n`);
  console.log(`ID: ${agent.id}`);
  console.log(`名称: ${agent.name}`);
  console.log(`创建时间: ${new Date(agent.createdAt).toLocaleString("zh-CN")}`);
  console.log();
  console.log(`【微信绑定】`);
  console.log(`  账号 ID: ${agent.wechat.accountId}`);
  if (agent.wechat.nickname) console.log(`  昵称: ${agent.wechat.nickname}`);
  console.log();
  console.log(`【工作目录】`);
  console.log(`  路径: ${agent.workspace.path}`);
  console.log();
  console.log(`【AI 配置】`);
  console.log(`  模型: ${agent.ai.model}`);
  console.log(`  能力模板: ${template?.icon} ${template?.name} (${agent.ai.templateId})`);
  console.log(`  最大轮次: ${agent.ai.maxTurns}`);
  console.log(`  温度: ${agent.ai.temperature ?? "默认"}`);
  if (agent.templateOverride?.systemPromptAppend) {
    console.log(`  自定义提示词: ${agent.templateOverride.systemPromptAppend.substring(0, 50)}...`);
  }
  console.log();
  console.log(`【功能开关】`);
  console.log(`  文件操作: ${agent.features.fileAccess ? "✅" : "❌"}`);
  console.log(`  网络搜索: ${agent.features.webSearch ? "✅" : "❌"}`);
  console.log(`  定时任务: ${agent.features.scheduledTasks ? "✅" : "❌"}`);
  console.log(`  外部通知: ${agent.features.notifications ? "✅" : "❌"}`);
  console.log();
  console.log(`【统计】`);
  console.log(`  对话数: ${agent.stats.totalConversations}`);
  console.log(`  消息数: ${agent.stats.totalMessages}`);
  if (agent.stats.lastActiveAt) {
    console.log(`  最后活跃: ${new Date(agent.stats.lastActiveAt).toLocaleString("zh-CN")}`);
  }
}

async function switchTemplate(agentId?: string) {
  await agentManager.initialize();

  let agent: AgentConfig | undefined;
  
  if (agentId) {
    agent = agentManager.getAgent(agentId);
  } else {
    const agents = agentManager.getAllAgents();
    if (agents.length === 1) {
      agent = agents[0];
    } else {
      console.log("有多个 Agent，请指定 ID");
      return;
    }
  }

  if (!agent) {
    console.log(`未找到 Agent: ${agentId}`);
    return;
  }

  const templates = getTemplates();

  console.log(`\n=== 切换能力模板 (${agent.name}) ===\n`);
  console.log("当前模板:", templates.find(t => t.id === agent!.ai.templateId)?.name);
  console.log();

  for (let i = 0; i < templates.length; i++) {
    const t = templates[i];
    console.log(`${i + 1}. ${t.icon} ${t.name} - ${t.description}`);
  }

  const choice = await prompt(`\n请选择新模板 (1-${templates.length}): `);
  const num = parseInt(choice, 10);

  if (isNaN(num) || num < 1 || num > templates.length) {
    console.log("无效的选择");
    return;
  }

  const newTemplate = templates[num - 1];
  
  console.log(`\n正在切换到 ${newTemplate.name}...`);
  await agentManager.applyTemplate(agent.id, newTemplate.id);
  
  console.log(`✅ 已切换能力模板`);
  console.log(`新提示词预览: ${newTemplate.systemPrompt.substring(0, 100)}...`);
}

async function manageMemory(agentId?: string) {
  await agentManager.initialize();

  let agent: AgentConfig | undefined;
  
  if (agentId) {
    agent = agentManager.getAgent(agentId);
  } else {
    const agents = agentManager.getAllAgents();
    if (agents.length === 1) {
      agent = agents[0];
    } else {
      console.log("有多个 Agent，请指定 ID");
      return;
    }
  }

  if (!agent) {
    console.log(`未找到 Agent: ${agentId}`);
    return;
  }

  const memory = await loadMemory(agent.id);
  if (!memory) {
    console.log("暂无记忆");
    return;
  }

  console.log(`\n=== 记忆管理 (${agent.name}) ===\n`);
  console.log(`记忆版本: ${memory.version}`);
  console.log(`更新时间: ${new Date(memory.updatedAt).toLocaleString("zh-CN")}`);
  console.log();

  if (memory.userProfile.name || memory.userProfile.role) {
    console.log("【用户画像】");
    if (memory.userProfile.name) console.log(`  姓名: ${memory.userProfile.name}`);
    if (memory.userProfile.role) console.log(`  角色: ${memory.userProfile.role}`);
    if (memory.userProfile.company) console.log(`  公司: ${memory.userProfile.company}`);
    console.log();
  }

  console.log(`【重要事实】 (${memory.facts.length} 条)`);
  const sortedFacts = memory.facts
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 10);
  
  for (const fact of sortedFacts) {
    const importance = "⭐".repeat(fact.importance);
    console.log(`  ${importance} [${fact.category}] ${fact.content.substring(0, 60)}${fact.content.length > 60 ? "..." : ""}`);
  }
  if (memory.facts.length > 10) {
    console.log(`  ... 还有 ${memory.facts.length - 10} 条`);
  }
  console.log();

  console.log(`【项目】 (${memory.projects.length} 个)`);
  for (const project of memory.projects) {
    const status = project.status === "active" ? "🟢" : project.status === "paused" ? "⏸️" : "✅";
    console.log(`  ${status} ${project.name}: ${project.description.substring(0, 50)}${project.description.length > 50 ? "..." : ""}`);
  }

  console.log();
  console.log("操作:");
  console.log("  记忆会自动从对话中提取");
  console.log("  发送 /memory 命令可以查看详细记忆");
}

async function deleteAgent(agentId: string) {
  if (!agentId) {
    console.log("请指定 Agent ID");
    return;
  }

  await agentManager.initialize();
  const agent = agentManager.getAgent(agentId);

  if (!agent) {
    console.log(`未找到 Agent: ${agentId}`);
    return;
  }

  console.log(`\n⚠️  即将删除 Agent: ${agent.name}`);
  console.log(`ID: ${agent.id}`);
  console.log(`工作目录: ${agent.workspace.path}`);
  console.log();

  const confirm = await prompt("确认删除? 此操作不可恢复 (输入 DELETE 确认): ");
  
  if (confirm !== "DELETE") {
    console.log("已取消");
    return;
  }

  const success = await agentManager.deleteAgent(agentId);
  if (success) {
    console.log("✅ Agent 已删除");
  } else {
    console.log("❌ 删除失败");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "list":
    case "ls":
      await listAgents();
      break;

    case "switch":
    case "sw":
      await switchAgent();
      break;

    case "config":
    case "info":
      await showConfig(args[1]);
      break;

    case "template":
    case "tpl":
      await switchTemplate(args[1]);
      break;

    case "memory":
    case "mem":
      await manageMemory(args[1]);
      break;

    case "delete":
    case "rm":
      await deleteAgent(args[1]);
      break;

    case "help":
    case "-h":
    case "--help":
    default:
      showHelp();
      break;
  }
}

main().catch((err) => {
  console.error("错误:", err);
  process.exit(1);
});
