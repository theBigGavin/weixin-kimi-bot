#!/usr/bin/env node
/**
 * 数据迁移脚本：从单Agent版本迁移到多Agent版本
 * 
 * 使用方法：
 *   node scripts/migrate-to-multi-agent.js
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

const BASE_DIR = join(homedir(), ".weixin-kimi-bot");
const BACKUP_DIR = join(BASE_DIR, `backup-${Date.now()}`);

function generateAgentId() {
  return `agent_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

async function main() {
  console.log("=== 微信 Kimi Bot 数据迁移工具 ===\n");

  // 检查旧数据
  const oldCredsPath = join(BASE_DIR, "credentials.json");
  if (!existsSync(oldCredsPath)) {
    console.log("未找到旧版本数据，无需迁移。\n");
    console.log("直接运行 npm run login 创建新Agent即可。");
    return;
  }

  console.log("发现旧版本数据，开始迁移...\n");

  // 创建备份
  console.log("1. 创建数据备份...");
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  
  const filesToBackup = [
    "credentials.json",
    "config.json",
    "sync-buf.txt",
    "context-tokens.json",
    "scheduled-tasks.json",
    "notification-channels.json",
  ];

  for (const file of filesToBackup) {
    const src = join(BASE_DIR, file);
    if (existsSync(src)) {
      await fs.copyFile(src, join(BACKUP_DIR, file));
    }
  }
  console.log(`   ✓ 备份已保存到: ${BACKUP_DIR}\n`);

  // 创建Agent目录
  console.log("2. 创建Agent目录结构...");
  const agentId = generateAgentId();
  const agentDir = join(BASE_DIR, "agents", agentId);
  await fs.mkdir(agentDir, { recursive: true });
  await fs.mkdir(join(agentDir, "workspace"), { recursive: true });
  console.log(`   Agent ID: ${agentId}`);
  console.log(`   Agent目录: ${agentDir}\n`);

  // 读取旧数据
  const oldCreds = JSON.parse(await fs.readFile(oldCredsPath, "utf-8"));
  let oldConfig = {};
  try {
    oldConfig = JSON.parse(await fs.readFile(join(BASE_DIR, "config.json"), "utf-8"));
  } catch {
    // 忽略
  }

  // 创建新配置
  console.log("3. 创建Agent配置...");
  const newConfig = {
    id: agentId,
    name: "迁移的Agent",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    wechat: {
      accountId: oldCreds.accountId,
    },
    workspace: {
      path: join(agentDir, "workspace"),  // 每个Agent独立的workspace
      createdAt: Date.now(),
    },
    ai: {
      model: oldConfig.model || "kimi-code/kimi-for-coding",
      templateId: "general",
      maxTurns: oldConfig.maxTurns || 100,
      temperature: 0.5,
      // 注意：不再使用全局cwd，每个Agent使用自己的workspace.path
    },
    memory: {
      enabled: true,
      maxItems: 100,
      autoExtract: true,
    },
    features: {
      scheduledTasks: true,
      notifications: true,
      fileAccess: true,
      webSearch: true,
    },
    stats: {
      totalConversations: 0,
      totalMessages: 0,
    },
  };
  await fs.writeFile(join(agentDir, "config.json"), JSON.stringify(newConfig, null, 2));
  console.log("   ✓ Agent配置已创建\n");

  // 迁移凭证
  console.log("4. 迁移登录凭证...");
  await fs.copyFile(oldCredsPath, join(agentDir, "credentials.json"));
  console.log("   ✓ 凭证已迁移\n");

  // 迁移其他文件
  console.log("5. 迁移其他数据文件...");
  const migrations = [
    ["sync-buf.txt", "sync-buf.txt"],
    ["context-tokens.json", "context-tokens.json"],
  ];

  for (const [srcName, destName] of migrations) {
    const src = join(BASE_DIR, srcName);
    if (existsSync(src)) {
      await fs.copyFile(src, join(agentDir, destName));
      console.log(`   ✓ ${srcName} 已迁移`);
    }
  }

  // 迁移定时任务（添加agentId）
  const oldTasksPath = join(BASE_DIR, "scheduled-tasks.json");
  if (existsSync(oldTasksPath)) {
    const tasks = JSON.parse(await fs.readFile(oldTasksPath, "utf-8"));
    for (const task of tasks) {
      task.agentId = agentId;
    }
    await fs.writeFile(join(agentDir, "scheduled-tasks.json"), JSON.stringify(tasks, null, 2));
    console.log("   ✓ 定时任务已迁移（已添加Agent标识）");
  }
  console.log();

  // 初始化记忆
  console.log("6. 初始化记忆系统...");
  const memory = {
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
  await fs.writeFile(join(agentDir, "memory.json"), JSON.stringify(memory, null, 2));
  console.log("   ✓ 记忆系统已初始化\n");

  // 创建工作目录README
  const readmeContent = `# Agent 工作目录

此目录是AI助手的工作空间，包含：
- 代码项目
- 数据文件
- 生成的文档
- 临时文件

注意：此目录内容由AI管理，请谨慎手动修改。
`;
  await fs.writeFile(join(agentDir, "workspace", "README.md"), readmeContent);
  console.log("   ✓ 工作目录已初始化\n");

  // 完成
  console.log("=== 迁移完成 ===\n");
  console.log(`Agent ID: ${agentId}`);
  console.log(`数据目录: ${agentDir}\n`);
  console.log("启动命令:");
  console.log(`  ACTIVE_AGENT_ID=${agentId} npm start\n`);
  console.log(`旧数据备份在: ${BACKUP_DIR}\n`);
  console.log("注意:");
  console.log("1. 旧的全局配置文件仍然保留（作为备份）");
  console.log("2. 每个Agent现在拥有独立的数据目录");
  console.log("3. 可以使用 npm run agent:list 查看所有Agent");
  console.log("4. 如需创建更多Agent，运行 npm run login");
  console.log();
}

main().catch((err) => {
  console.error("迁移失败:", err);
  process.exit(1);
});
