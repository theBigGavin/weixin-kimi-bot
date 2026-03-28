#!/usr/bin/env node
/**
 * 迁移脚本：将 workspace/users/{userId}/ 迁移到 workspace/.sessions/{userId}/
 */

import { readdir, rename, mkdir, readlink, symlink, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const BASE_DIR = join(homedir(), ".weixin-kimi-bot", "agents");

async function migrateAgent(agentId) {
  const agentDir = join(BASE_DIR, agentId);
  const workspaceDir = join(agentDir, "workspace");
  const usersDir = join(workspaceDir, "users");
  const sessionsDir = join(workspaceDir, ".sessions");

  // 检查是否存在 users 目录
  if (!existsSync(usersDir)) {
    console.log(`  ⏭️  ${agentId}: 无 users 目录，跳过`);
    return;
  }

  console.log(`\n🔄 迁移 ${agentId}...`);

  // 创建 .sessions 目录
  await mkdir(sessionsDir, { recursive: true });

  // 遍历 users 下的所有用户目录
  const entries = await readdir(usersDir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const userId = entry.name;
      const oldUserDir = join(usersDir, userId);
      const newSessionDir = join(sessionsDir, userId);

      // 检查目标是否已存在
      if (existsSync(newSessionDir)) {
        console.log(`    ⚠️  ${userId}: .sessions/${userId} 已存在，跳过`);
        continue;
      }

      // 迁移用户目录
      await rename(oldUserDir, newSessionDir);
      console.log(`    ✅ ${userId}: users/ -> .sessions/`);

      // 为普通Agent创建 workspace 软链接（如果还没有）
      const workspaceLink = join(newSessionDir, "workspace");
      if (!existsSync(workspaceLink)) {
        await symlink(workspaceDir, workspaceLink, "dir");
        console.log(`    🔗 ${userId}: 创建 workspace 软链接`);
      }
    }
  }

  // 删除空的 users 目录
  const remaining = await readdir(usersDir);
  if (remaining.length === 0) {
    // 需要先删除目录下的所有内容
    const { rmdir } = await import("node:fs/promises");
    await rmdir(usersDir);
    console.log(`  🗑️  删除空的 users 目录`);
  } else {
    console.log(`  ⚠️  users 目录仍有内容，保留: ${remaining.join(", ")}`);
  }

  console.log(`  ✅ ${agentId} 迁移完成`);
}

async function main() {
  console.log("=== 迁移 users 到 .sessions ===\n");

  // 获取所有 Agent
  const agents = await readdir(BASE_DIR, { withFileTypes: true });
  
  for (const agent of agents) {
    if (agent.isDirectory() && agent.name.startsWith("agent_")) {
      await migrateAgent(agent.name);
    }
  }

  console.log("\n✅ 迁移完成！");
  console.log("\n请重启 PM2 服务使变更生效:");
  console.log("  pm2 restart weixin-kimi-bot");
}

main().catch((err) => {
  console.error("❌ 迁移失败:", err);
  process.exit(1);
});
