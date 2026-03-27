/**
 * AI News Collection Task
 *
 * This task demonstrates how to use Kimi CLI to collect latest AI news
 * Can be scheduled to run daily via the task scheduler
 */

import { spawn } from "node:child_process";

/**
 * Collect AI news using Kimi CLI
 */
export async function collectAINews(): Promise<string> {
  const prompt = `Please collect and summarize today's AI news, including:
1. Latest AI technology breakthroughs and product releases
2. Updates from major AI companies (OpenAI, Google, Anthropic, Meta, etc.)
3. Important open source community updates

Present in a concise Chinese list format with:
- Title
- One-sentence summary
- Source (if available)

Format:
📰 Today AI News (Date)

1. **[Title]**
   Summary: ...
   Source: ...

2. ...

If there are no significant news today, say "No major AI news today".`;

  return new Promise((resolve, reject) => {
    const child = spawn("kimi", ["--quiet", "--prompt", prompt], {
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
      reject(new Error(`Execution failed: ${err.message}`));
    });

    child.on("close", (code) => {
      const output = Buffer.concat(stdout).toString("utf-8");
      const errorOutput = Buffer.concat(stderr).toString("utf-8");

      if (code !== 0 && !output.trim()) {
        reject(new Error(`Exit code ${code}: ${errorOutput}`));
      } else {
        resolve(output.trim() || "(No content returned)");
      }
    });
  });
}

/**
 * Collect news for a specific topic
 */
export async function collectTopicNews(topic: string): Promise<string> {
  const prompt = `Please collect latest AI news about "${topic}", including:
1. Latest technology advances
2. Related products or tools released
3. Industry application cases

Present in a concise Chinese list format.`;

  return new Promise((resolve, reject) => {
    const child = spawn("kimi", ["--quiet", "--prompt", prompt], {
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
      reject(new Error(`Execution failed: ${err.message}`));
    });

    child.on("close", (code) => {
      const output = Buffer.concat(stdout).toString("utf-8");

      if (code !== 0 && !output.trim()) {
        reject(new Error(`Exit code ${code}`));
      } else {
        resolve(output.trim() || "(No content returned)");
      }
    });
  });
}

/**
 * Main function - CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    if (command === "topic" && args[1]) {
      const result = await collectTopicNews(args[1]);
      console.log(result);
    } else {
      const result = await collectAINews();
      console.log(result);
    }
  } catch (e) {
    console.error("Error:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
