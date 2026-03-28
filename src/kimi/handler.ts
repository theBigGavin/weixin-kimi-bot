/**
 * Kimi Code CLI integration.
 * Processes WeChat messages through Kimi CLI and returns text responses.
 */
import { spawn } from "node:child_process";
import type { BotConfig } from "../store.js";

export type KimiResponse = {
  text: string;
  durationMs: number;
};

export type KimiOptions = {
  model: string;
  systemPrompt?: string;
  cwd: string;
  /** Session 存储目录（用于隔离不同用户的 session） */
  sessionDir?: string;
  maxTurns: number;
  planMode: boolean;
  yolo?: boolean;  // Auto-approve all actions
  continueSession?: boolean;  // 使用 --continue 复用 session
};

/**
 * Check if a prompt is a Kimi slash command.
 */
function isSlashCommand(prompt: string): boolean {
  const trimmed = prompt.trim();
  return trimmed.startsWith("/") && !trimmed.startsWith("//");
}

/**
 * Send a prompt to Kimi CLI and collect the text response.
 * Kimi CLI runs in a subprocess with access to the local filesystem.
 * 
 * For slash commands (like /help, /tools), we use interactive mode
 * because --quiet mode doesn't support them.
 */
export async function askKimi(prompt: string, opts: KimiOptions): Promise<KimiResponse> {
  const start = Date.now();
  const isSlashCmd = isSlashCommand(prompt);
  
  // Build kimi command arguments
  const args: string[] = [];
  
  // For slash commands, we need interactive mode
  // For normal prompts, use quiet mode
  if (!isSlashCmd) {
    args.push("--quiet");
  }
  
  // Add model if specified
  if (opts.model) {
    args.push("--model", opts.model);
  }
  
  // Note: kimi CLI doesn't support --system-prompt flag
  // System prompt will be prepended to the main prompt below
  
  // Add max steps per turn if specified
  if (opts.maxTurns) {
    args.push("--max-steps-per-turn", String(opts.maxTurns));
  }
  
  // Add plan mode if enabled
  if (opts.planMode) {
    args.push("--plan");
  }
  
  // Add yolo mode if enabled (auto-approve all actions)
  if (opts.yolo) {
    args.push("--yolo");
  }
  
  // Add continue mode to reuse previous session
  if (opts.continueSession) {
    args.push("--continue");
  }
  
  // Build the final prompt (prepend system prompt if provided)
  let finalPrompt = prompt;
  if (opts.systemPrompt) {
    // Combine system prompt with user prompt
    // Using a clear separator to help the model understand the structure
    finalPrompt = `${opts.systemPrompt}\n\n=== 用户消息 ===\n\n${prompt}`;
  }
  args.push("--prompt", finalPrompt);

  return new Promise((resolve, reject) => {
    const child = spawn("kimi", args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // 设置 5 分钟超时
    const TIMEOUT_MS = 5 * 60 * 1000;
    const timeoutId = setTimeout(() => {
      console.error(`[Kimi] 响应超时 (${TIMEOUT_MS / 1000}s)，终止进程`);
      child.kill("SIGTERM");
      
      // 给 5 秒优雅退出时间，否则强制杀死
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 5000);
      
      reject(new Error(
        "⏱️ Kimi 响应超时（5分钟）\n\n" +
        "可能原因：\n" +
        "1. 任务过于复杂\n" +
        "2. Kimi 等待用户确认（建议使用 --yolo 模式或简化任务）\n" +
        "3. 网络问题\n\n" +
        "请重试或简化任务。"
      ));
    }, TIMEOUT_MS);

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (data: Buffer) => {
      stdout.push(data);
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr.push(data);
    });

    child.on("error", (err) => {
      clearTimeout(timeoutId);  // 清除超时
      if (err.message.includes("ENOENT")) {
        reject(new Error(
          "未找到 kimi 命令。请先安装 Kimi CLI:\n" +
          "  uv tool install kimi-cli\n" +
          "或访问: https://github.com/MoonshotAI/kimi-cli"
        ));
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      clearTimeout(timeoutId);  // 清除超时
      const durationMs = Date.now() - start;
      const output = Buffer.concat(stdout).toString("utf-8");
      const errorOutput = Buffer.concat(stderr).toString("utf-8");

      // Check for specific error conditions
      if (errorOutput.includes("LLM not set") || output.includes("LLM not set")) {
        reject(new Error(
          "Kimi CLI 未配置 LLM。可能原因:\n" +
          "1. 未登录: 请执行 kimi login\n" +
          "2. 模型名称错误: 检查配置中的 model 是否正确\n" +
          "   可用模型: kimi-code/kimi-for-coding, kimi-code/kimi-k2"
        ));
        return;
      }

      if (errorOutput.includes("not authenticated") || 
          errorOutput.includes("unauthorized") ||
          errorOutput.includes("Invalid token")) {
        reject(new Error(
          "Kimi CLI 登录已过期。请执行: kimi login"
        ));
        return;
      }

      // In quiet mode, kimi outputs to stdout even with exit code 0
      // We consider it successful if we got any output
      if (output.trim()) {
        // Clean up the output - remove ANSI escape codes for slash commands
        const cleanText = isSlashCmd 
          ? output.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim()
          : output.trim();
        
        resolve({
          text: cleanText || "(Kimi 没有返回文本内容)",
          durationMs,
        });
        return;
      }

      if (code !== 0 && code !== null) {
        const errorMsg = errorOutput || `进程退出码: ${code}`;
        reject(new Error(`Kimi CLI 执行失败: ${errorMsg}`));
        return;
      }

      resolve({
        text: "(Kimi 没有返回文本内容)",
        durationMs,
      });
    });
  });
}

/**
 * Check if Kimi CLI is installed and accessible.
 */
export async function checkKimiInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("kimi", ["--version"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    
    child.on("error", () => {
      resolve(false);
    });
    
    child.on("close", (code) => {
      resolve(code === 0);
    });
  });
}

/**
 * Check if Kimi CLI is properly authenticated.
 */
export async function checkKimiAuthenticated(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("kimi", ["--quiet", "--prompt", "hi"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    
    let output = "";
    let errorOutput = "";
    
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });
    
    child.stderr.on("data", (data: Buffer) => {
      errorOutput += data.toString();
    });
    
    child.on("error", () => {
      resolve(false);
    });
    
    child.on("close", () => {
      // If we get any non-error response, we're authenticated
      if (output.includes("LLM not set") || 
          errorOutput.includes("LLM not set") ||
          errorOutput.includes("not authenticated") ||
          errorOutput.includes("unauthorized")) {
        resolve(false);
      } else if (output.trim()) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

/**
 * Run kimi login interactively.
 * Returns true if login succeeded, false otherwise.
 */
export async function runKimiLogin(): Promise<boolean> {
  return new Promise((resolve) => {
    console.log("\n🔐 正在启动 Kimi 登录...");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("如果下方没有显示链接，请手动运行: kimi login");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
    const child = spawn("kimi", ["login"], {
      stdio: ["inherit", "pipe", "pipe"], // Pipe stdout/stderr so we can display it
      detached: false,
    });

    // Capture and display output
    child.stdout.on("data", (data: Buffer) => {
      process.stdout.write(data);
    });

    child.stderr.on("data", (data: Buffer) => {
      process.stderr.write(data);
    });

    child.on("error", (err) => {
      console.error("\n❌ 启动登录失败:", err.message);
      console.error("\n请尝试手动运行: kimi login");
      resolve(false);
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log("\n✅ 登录流程完成");
        resolve(true);
      } else {
        console.error(`\n❌ 登录失败 (退出码: ${code})`);
        console.error("\n请尝试手动运行: kimi login");
        resolve(false);
      }
    });
  });
}

/**
 * Check if running in a TTY (interactive terminal).
 */
function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/**
 * Ensure Kimi CLI is authenticated, prompting for login if needed.
 * In interactive mode, will guide user through login.
 * In non-interactive mode (e.g., PM2), will fail with instructions.
 * Returns true if authenticated (or successfully logged in), false otherwise.
 */
export async function ensureKimiAuthenticated(): Promise<boolean> {
  // First check if already authenticated
  const isAuthenticated = await checkKimiAuthenticated();
  if (isAuthenticated) {
    return true;
  }

  // Not authenticated
  console.log("\n⚠️  Kimi CLI 未登录");

  // Check if we're in an interactive terminal
  if (!isInteractive()) {
    // Non-interactive mode (e.g., PM2 service)
    console.error("");
    console.error("╔════════════════════════════════════════════════════════════════╗");
    console.error("║  后台服务模式下无法自动登录                                    ║");
    console.error("╠════════════════════════════════════════════════════════════════╣");
    console.error("║  请先在前台完成登录:                                           ║");
    console.error("║                                                                ║");
    console.error("║    1. 先在前台启动一次: npm start                              ║");
    console.error("║    2. 完成 Kimi 登录流程                                       ║");
    console.error("║    3. 然后使用: npm run service:start                          ║");
    console.error("║                                                                ║");
    console.error("║  或者手动登录:                                                 ║");
    console.error("║    kimi login                                                  ║");
    console.error("╚════════════════════════════════════════════════════════════════╝");
    console.error("");
    return false;
  }

  // Interactive mode - guide user through login
  console.log("需要登录后才能使用 Bot。");
  console.log("\n💡 提示: 如果下方没有显示登录链接，请按 Ctrl+C 退出");
  console.log("   然后手动运行: kimi login\n");
  
  // Auto-start login
  const loginSuccess = await runKimiLogin();
  
  if (!loginSuccess) {
    console.log("\n💡 备用方案：请手动运行以下命令完成登录：");
    console.log("   kimi login");
    console.log("   登录完成后，重新运行: npm start\n");
    return false;
  }

  // Verify login worked
  console.log("\n正在验证登录状态...");
  const verifyAuth = await checkKimiAuthenticated();
  
  if (verifyAuth) {
    console.log("✅ 登录验证成功！\n");
    return true;
  } else {
    console.error("❌ 登录验证失败，请重试");
    return false;
  }
}
