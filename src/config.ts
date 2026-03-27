/**
 * CLI config tool: `npm run config -- --model kimi-k2`
 *
 * Usage:
 *   npm run config                                  # Show current config
 *   npm run config -- --model kimi-k2               # Set model
 *   npm run config -- --max-turns 5                 # Set max turns
 *   npm run config -- --system-prompt "..."         # Set system prompt
 *   npm run config -- --cwd /path/to/dir            # Set working directory
 *   npm run config -- --plan                        # Enable plan mode
 *   npm run config -- --no-plan                     # Disable plan mode
 */
import { loadConfig, saveConfig, type BotConfig } from "./store.js";

/** Available Kimi models (from ~/.kimi/config.toml) */
const KNOWN_MODELS = [
  "kimi-code/kimi-for-coding",  // 默认编程模型
  "kimi-code/kimi-k2",          // K2 模型
  "kimi-code/kimi-k2-0711-preview",
  "kimi-code/kimi-k1.5",
  "kimi-code/kimi-k1.5-0711-preview",
];

function printConfig() {
  const config = loadConfig();
  console.log("\n=== 当前配置 ===");
  console.log(`模型 (--model):                ${config.model}`);
  console.log(`最大轮次 (--max-turns):         ${config.maxTurns}`);
  console.log(`工作目录 (--cwd):               ${config.cwd}`);
  console.log(`规划模式 (--plan):              ${config.planMode ? "开启" : "关闭"}`);
  console.log(`系统提示 (--system-prompt):     ${config.systemPrompt || "(无)"}`);
  console.log(`\n可用模型: ${KNOWN_MODELS.join(", ")}`);
  console.log("\n配置说明:");
  console.log("  --model          设置使用的模型");
  console.log("  --max-turns      设置最大 agent 轮次");
  console.log("  --cwd            设置工作目录");
  console.log("  --plan           启用规划模式");
  console.log("  --no-plan        禁用规划模式");
  console.log("  --system-prompt  设置系统提示词");
  console.log();
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printConfig();
    return;
  }

  let hasChanges = false;
  const updates: Partial<BotConfig> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--model":
        if (!next) { console.error("--model 需要参数"); process.exit(1); }
        updates.model = next;
        i++;
        hasChanges = true;
        break;
      case "--max-turns":
        if (!next) { console.error("--max-turns 需要参数"); process.exit(1); }
        updates.maxTurns = parseInt(next, 10);
        if (isNaN(updates.maxTurns)) { console.error("--max-turns 必须是数字"); process.exit(1); }
        i++;
        hasChanges = true;
        break;
      case "--system-prompt":
        if (!next) { console.error("--system-prompt 需要参数"); process.exit(1); }
        updates.systemPrompt = next;
        i++;
        hasChanges = true;
        break;
      case "--cwd":
        if (!next) { console.error("--cwd 需要参数"); process.exit(1); }
        updates.cwd = next;
        i++;
        hasChanges = true;
        break;
      case "--plan":
        updates.planMode = true;
        hasChanges = true;
        break;
      case "--no-plan":
        updates.planMode = false;
        hasChanges = true;
        break;
      default:
        console.error(`未知参数: ${arg}`);
        process.exit(1);
    }
  }

  if (hasChanges) {
    saveConfig(updates);
    printConfig();
  }
}

main();
