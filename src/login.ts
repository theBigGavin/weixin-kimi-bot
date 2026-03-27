/**
 * 多Agent登录脚本
 * 
 * 支持多个微信账号扫码，每个账号创建独立的Agent
 */
import { loginWithQR } from "./ilink/auth.js";
import { agentManager } from "./agent/manager.js";
import { getTemplates, getDefaultTemplate } from "./templates/definitions.js";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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

async function selectTemplate(): Promise<string> {
  const templates = getTemplates();
  
  console.log("\n=== 选择 Agent 能力模板 ===\n");
  console.log("请为你的 AI 助手选择一个角色：\n");

  // 按分类分组
  const categories: Record<string, typeof templates> = {};
  for (const t of templates) {
    if (!categories[t.category]) categories[t.category] = [];
    categories[t.category].push(t);
  }

  const categoryNames: Record<string, string> = {
    development: "开发",
    writing: "写作",
    creative: "创意",
    business: "商业",
    lifestyle: "生活",
    other: "其他",
  };

  let index = 1;
  const options: Array<{ index: number; id: string; template: typeof templates[0] }> = [];

  for (const [catId, catTemplates] of Object.entries(categories)) {
    console.log(`${categoryNames[catId] || catId}:`);
    for (const t of catTemplates) {
      console.log(`  ${index}. ${t.icon} ${t.name} - ${t.description}`);
      options.push({ index, id: t.id, template: t });
      index++;
    }
    console.log();
  }

  const choice = await prompt(`请选择 (1-${index - 1}, 默认: 通用助手): `);
  const num = parseInt(choice, 10);

  if (isNaN(num) || num < 1 || num >= index) {
    return getDefaultTemplate().id;
  }

  return options.find(o => o.index === num)?.id || getDefaultTemplate().id;
}

async function setupWorkspace(agentName: string): Promise<string | undefined> {
  console.log("\n=== 工作目录设置 ===\n");
  
  const useDefault = await prompt("使用默认工作目录? (Y/n): ");
  
  if (useDefault.toLowerCase() === "n") {
    const customPath = await prompt("请输入工作目录路径: ");
    if (customPath && existsSync(customPath)) {
      return customPath;
    } else if (customPath) {
      console.log("目录不存在，将创建...");
      await mkdir(customPath, { recursive: true });
      return customPath;
    }
  }
  
  return undefined;
}

async function main() {
  console.log("=== 微信 Kimi Bot - Agent 创建 ===\n");
  console.log("请使用微信扫描下方二维码完成登录\n");

  // 扫码登录
  const result = await loginWithQR();

  console.log(`\n✅ 登录成功！`);
  console.log(`账号 ID: ${result.accountId}`);
  if (result.userId) console.log(`用户 ID: ${result.userId}`);

  // 初始化 AgentManager
  await agentManager.initialize();

  // 检查是否已存在此微信账号的Agent
  const existingAgent = agentManager.findAgentByWechat(result.accountId);
  if (existingAgent) {
    console.log(`\n⚠️ 此微信账号已绑定 Agent: ${existingAgent.name}`);
    const overwrite = await prompt("是否创建新的 Agent? (y/N): ");
    
    if (overwrite.toLowerCase() !== "y") {
      console.log(`\n使用现有 Agent: ${existingAgent.name}`);
      console.log(`工作目录: ${existingAgent.workspace.path}`);
      console.log("\n运行 npm start 启动 Bot");
      return;
    }
    
    // 备份并删除旧 Agent
    console.log(`\n📦 正在备份旧 Agent: ${existingAgent.name}...`);
    const backupPath = await agentManager.backupAndDeleteAgent(existingAgent.id);
    console.log(`  ✅ 已备份到: ${backupPath}`);
  }

  // 选择能力模板
  const templateId = await selectTemplate();
  const template = getTemplates().find(t => t.id === templateId);

  // 设置 Agent 名称
  const defaultName = `${template?.name || "Agent"}_${Date.now()}`;
  const nameInput = await prompt(`\nAgent 名称 (默认: ${defaultName}): `);
  const agentName = nameInput || defaultName;

  // 设置工作目录
  const workspacePath = await setupWorkspace(agentName);

  // 创建 Agent
  console.log("\n🚀 正在创建 Agent...");
  
  const agent = await agentManager.createAgent(result.accountId, {
    name: agentName,
    templateId,
    workspacePath,
  });

  console.log(`\n✅ Agent 创建成功！`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Agent ID: ${agent.id}`);
  console.log(`名称: ${agent.name}`);
  console.log(`角色: ${template?.icon} ${template?.name}`);
  console.log(`工作目录: ${agent.workspace.path}`);
  console.log(`模型: ${agent.ai.model}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  // 显示欢迎语
  if (template?.welcomeMessage) {
    console.log(`\n${template.welcomeMessage}`);
  }

  console.log("\n📚 常用命令：");
  console.log("  npm start          - 启动 Bot");
  console.log("  npm run agent:list - 列出所有 Agent");
  console.log("  npm run agent:switch - 切换 Agent");

  // 保存登录凭证到Agent目录
  const credentials = {
    botToken: result.botToken,
    accountId: result.accountId,
    baseUrl: result.baseUrl,
    userId: result.userId,
    savedAt: new Date().toISOString(),
  };

  const agentDir = agentManager.getAgentPath(agent.id);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    join(agentDir, "credentials.json"),
    JSON.stringify(credentials, null, 2),
    "utf-8"
  );

  console.log("\n✨ 配置已保存，运行 npm start 开始对话！");
}

main().catch((err) => {
  console.error("\n❌ 错误:", err.message);
  console.error(err.stack);
  process.exit(1);
});
