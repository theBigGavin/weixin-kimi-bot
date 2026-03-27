/**
 * 通知通道管理 CLI
 * 
 * 用法:
 *   npm run notify                    # 列出所有通道
 *   npm run notify -- --add-email     # 添加邮件通道
 *   npm run notify -- --add-telegram  # 添加 Telegram 通道
 *   npm run notify -- --delete <id>   # 删除通道
 *   npm run notify -- --toggle <id>   # 启用/禁用通道
 *   npm run notify -- --test <id>     # 测试通道
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getNotificationManager } from "./manager.js";
import type { EmailChannelConfig, TelegramChannelConfig } from "./types.js";

// 获取当前Agent ID（从环境变量）
const ACTIVE_AGENT_ID = process.env.ACTIVE_AGENT_ID;

// 获取通知管理器实例
const notificationManager = getNotificationManager(ACTIVE_AGENT_ID);

function showHelp() {
  const agentInfo = ACTIVE_AGENT_ID ? ` (Agent: ${ACTIVE_AGENT_ID})` : "";
  
  console.log(`
通知通道管理工具${agentInfo}

用法:
  npm run notify                    列出所有通道
  npm run notify -- --add-email     交互式添加邮件通道
  npm run notify -- --add-telegram  交互式添加 Telegram 通道
  npm run notify -- --delete <id>   删除通道
  npm run notify -- --toggle <id>   启用/禁用通道
  npm run notify -- --test <id>     测试通道发送
  npm run notify -- --test-all      测试所有通道

示例:
  # 为当前Agent添加邮件通知
  npm run notify -- --add-email

  # 为指定Agent添加通知（使用环境变量）
  ACTIVE_AGENT_ID=agent_xxx npm run notify -- --add-email
`);
}

async function listChannels() {
  await notificationManager.initialize();
  const channels = notificationManager.getAllStatuses();

  if (channels.length === 0) {
    console.log("\n暂无通知通道\n");
    console.log("使用 --add-email 或 --add-telegram 添加通道");
    return;
  }

  console.log("\n=== 通知通道列表 ===\n");

  for (const ch of channels) {
    const status = ch.enabled ? (ch.connected ? "✅" : "⚠️ ") : "❌";
    const typeMap: Record<string, string> = {
      email: "邮件",
      telegram: "Telegram",
      wechat: "微信",
      webhook: "Webhook",
      slack: "Slack",
      dingtalk: "钉钉",
    };
    
    console.log(`${status} ${ch.name} (${ch.id})`);
    console.log(`   类型: ${typeMap[ch.type] || ch.type}`);
    console.log(`   状态: ${ch.enabled ? "启用" : "禁用"}`);
    
    if (ch.lastError) {
      console.log(`   错误: ${ch.lastError}`);
    }
    if (ch.lastUsed) {
      console.log(`   上次使用: ${new Date(ch.lastUsed).toLocaleString("zh-CN")}`);
    }
    console.log();
  }
}

async function addEmailChannel() {
  const readline = await import("node:readline");
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => resolve(answer.trim()));
    });
  };

  console.log("\n=== 添加邮件通知通道 ===\n");
  console.log("支持的邮箱服务商:");
  console.log("  - Gmail: smtp.gmail.com, 端口 587, 安全: 是");
  console.log("  - QQ: smtp.qq.com, 端口 587, 安全: 是");
  console.log("  - 163: smtp.163.com, 端口 465, 安全: 是");
  console.log("  - Outlook: smtp.office365.com, 端口 587, 安全: 是");
  console.log();

  try {
    const name = await question("通道名称 (如: 我的Gmail): ");
    if (!name) {
      console.error("❌ 名称不能为空");
      rl.close();
      process.exit(1);
    }

    const smtpHost = await question("SMTP 服务器 (如: smtp.gmail.com): ");
    const smtpPort = parseInt(await question("SMTP 端口 (如: 587): "), 10);
    const secure = (await question("使用 SSL/TLS? (y/n): ")).toLowerCase() === "y";
    const smtpUser = await question("邮箱账号: ");
    const smtpPass = await question("邮箱密码/授权码: ");
    const from = await question("发件人地址 (留空使用账号): ") || smtpUser;
    const toStr = await question("收件人地址 (多个用逗号分隔): ");

    const config: EmailChannelConfig = {
      id: `email_${Date.now()}`,
      name,
      type: "email",
      enabled: true,
      createdAt: Date.now(),
      smtpHost,
      smtpPort,
      secure,
      smtpUser,
      smtpPass,
      from,
      to: toStr.split(",").map(s => s.trim()).filter(Boolean),
    };

    await notificationManager.initialize();
    const channel = await notificationManager.addChannel(config);
    
    console.log(`\n✅ 邮件通道已添加: ${channel.name}`);
    console.log(`   ID: ${channel.id}`);
    
    // 测试发送
    const testNow = (await question("\n是否立即发送测试邮件? (y/n): ")).toLowerCase() === "y";
    if (testNow) {
      console.log("正在发送测试邮件...");
      const result = await channel.send({
        title: "测试邮件 - 微信Kimi Bot",
        content: "这是一封测试邮件。如果您收到此邮件，说明邮件通知通道配置成功！\n\n来自: 微信Kimi Bot",
        timestamp: Date.now(),
      });
      
      if (result.success) {
        console.log("✅ 测试邮件发送成功");
      } else {
        console.error("❌ 测试邮件发送失败:", result.error);
      }
    }

  } catch (e) {
    console.error("\n❌ 添加失败:", e instanceof Error ? e.message : String(e));
  } finally {
    rl.close();
  }
}

async function addTelegramChannel() {
  const readline = await import("node:readline");
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => resolve(answer.trim()));
    });
  };

  console.log("\n=== 添加 Telegram 通知通道 ===\n");
  console.log("配置步骤:");
  console.log("  1. 在 Telegram 中找 @BotFather");
  console.log("  2. 发送 /newbot 创建新 Bot");
  console.log("  3. 获取 Bot Token (格式: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz)");
  console.log("  4. 给 Bot 发送一条消息");
  console.log("  5. 访问 https://api.telegram.org/bot<TOKEN>/getUpdates 获取 Chat ID");
  console.log();

  try {
    const name = await question("通道名称 (如: 我的Telegram): ");
    if (!name) {
      console.error("❌ 名称不能为空");
      rl.close();
      process.exit(1);
    }

    const botToken = await question("Bot Token: ");
    const chatIdsStr = await question("Chat ID (多个用逗号分隔): ");

    const config: TelegramChannelConfig = {
      id: `telegram_${Date.now()}`,
      name,
      type: "telegram",
      enabled: true,
      createdAt: Date.now(),
      botToken,
      chatIds: chatIdsStr.split(",").map(s => s.trim()).filter(Boolean),
    };

    await notificationManager.initialize();
    const channel = await notificationManager.addChannel(config);
    
    console.log(`\n✅ Telegram 通道已添加: ${channel.name}`);
    console.log(`   ID: ${channel.id}`);
    
    // 测试发送
    const testNow = (await question("\n是否立即发送测试消息? (y/n): ")).toLowerCase() === "y";
    if (testNow) {
      console.log("正在发送测试消息...");
      const result = await channel.send({
        title: "测试消息 - 微信Kimi Bot",
        content: "这是一条测试消息。如果您收到此消息，说明 Telegram 通知通道配置成功！",
        timestamp: Date.now(),
      });
      
      if (result.success) {
        console.log("✅ 测试消息发送成功");
      } else {
        console.error("❌ 测试消息发送失败:", result.error);
      }
    }

  } catch (e) {
    console.error("\n❌ 添加失败:", e instanceof Error ? e.message : String(e));
  } finally {
    rl.close();
  }
}

async function deleteChannel(channelId: string) {
  await notificationManager.initialize();
  
  if (await notificationManager.removeChannel(channelId)) {
    console.log(`✅ 已删除通道: ${channelId}`);
  } else {
    console.error(`❌ 未找到通道: ${channelId}`);
    process.exit(1);
  }
}

async function toggleChannel(channelId: string) {
  await notificationManager.initialize();
  
  const channel = notificationManager.getChannel(channelId);
  if (!channel) {
    console.error(`❌ 未找到通道: ${channelId}`);
    process.exit(1);
  }

  const newEnabled = !channel.enabled;
  if (await notificationManager.toggleChannel(channelId, newEnabled)) {
    console.log(`✅ 通道 ${channelId} 已${newEnabled ? "启用" : "禁用"}`);
  } else {
    console.error(`❌ 操作失败`);
    process.exit(1);
  }
}

async function testChannel(channelId: string) {
  await notificationManager.initialize();
  
  const channel = notificationManager.getChannel(channelId);
  if (!channel) {
    console.error(`❌ 未找到通道: ${channelId}`);
    process.exit(1);
  }

  console.log(`正在测试通道: ${channel.name}...`);
  
  const result = await channel.send({
    title: "测试通知 - 微信Kimi Bot",
    content: `这是一条测试通知。\n\n时间: ${new Date().toLocaleString("zh-CN")}\n通道: ${channel.name}\n类型: ${channel.type}`,
    timestamp: Date.now(),
  });

  if (result.success) {
    console.log("✅ 测试通知发送成功");
  } else {
    console.error("❌ 测试通知发送失败:", result.error);
    process.exit(1);
  }
}

async function testAllChannels() {
  await notificationManager.initialize();
  
  const channels = notificationManager.getAllChannels().filter(c => c.enabled);
  
  if (channels.length === 0) {
    console.log("没有启用的通知通道");
    return;
  }

  console.log(`正在测试 ${channels.length} 个通道...\n`);

  for (const channel of channels) {
    process.stdout.write(`测试 ${channel.name}... `);
    
    const result = await channel.send({
      title: "测试通知 - 微信Kimi Bot",
      content: `这是一条测试通知。\n\n时间: ${new Date().toLocaleString("zh-CN")}\n通道: ${channel.name}\n类型: ${channel.type}`,
      timestamp: Date.now(),
    });

    if (result.success) {
      console.log("✅ 成功");
    } else {
      console.log(`❌ 失败: ${result.error}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    await listChannels();
    return;
  }

  const command = args[0];

  switch (command) {
    case "--help":
    case "-h":
      showHelp();
      break;

    case "--add-email":
      await addEmailChannel();
      break;

    case "--add-telegram":
      await addTelegramChannel();
      break;

    case "--delete":
      if (!args[1]) {
        console.error("❌ 请提供通道ID");
        process.exit(1);
      }
      await deleteChannel(args[1]);
      break;

    case "--toggle":
      if (!args[1]) {
        console.error("❌ 请提供通道ID");
        process.exit(1);
      }
      await toggleChannel(args[1]);
      break;

    case "--test":
      if (!args[1]) {
        console.error("❌ 请提供通道ID");
        process.exit(1);
      }
      await testChannel(args[1]);
      break;

    case "--test-all":
      await testAllChannels();
      break;

    default:
      console.error(`❌ 未知命令: ${command}`);
      showHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("错误:", err);
  process.exit(1);
});
