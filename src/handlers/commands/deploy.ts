/**
 * /deploy 命令处理器
 */

import type { CommandContext } from "../types.js";
import { spawn } from "node:child_process";
import { getLongTaskManager } from "../../longtask/manager.js";
import { saveRestartInfo } from "../../services/restart-notify.js";
import { sendTextReply } from "../message-utils.js";
import { execSync } from "node:child_process";
import { cleanupTestTempDirs } from "../../scripts/cleanup-temp-dirs.js";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * 部署环境类型
 */
export type DeployEnvironment = "development" | "staging" | "production";

/**
 * 测试结果类型
 */
export interface TestResult {
  success: boolean;
  passed: number;
  failed: number;
  skipped: number;
  failedTests?: Array<{ name: string; error: string }>;
}

/**
 * 部署验证结果
 */
export interface DeployValidationResult {
  canDeploy: boolean;
  message: string;
  details?: TestResult;
}

/**
 * 获取当前部署环境
 * 优先级：DEPLOY_ENV > NODE_ENV > development
 */
export function getDeployEnvironment(): DeployEnvironment {
  const env = process.env.DEPLOY_ENV || process.env.NODE_ENV || "development";
  
  // 只允许特定的环境值
  if (["production", "staging", "development"].includes(env)) {
    return env as DeployEnvironment;
  }
  
  return "development";
}

/**
 * 运行集成测试
 */
export async function runIntegrationTests(): Promise<TestResult> {
  try {
    console.log("[Deploy] 运行集成测试...");
    
    // 设置测试数据目录环境变量，避免污染真实数据
    const testDataDir = process.env.TEST_DATA_DIR || 
      join(homedir(), ".weixin-kimi-bot", "test-data");
    
    // 运行测试并捕获输出
    const output = execSync("npm test 2>&1", { 
      encoding: "utf-8",
      timeout: 180000, // 3分钟超时（测试可能较慢）
      cwd: process.cwd(),
      env: {
        ...process.env,
        TEST_DATA_DIR: testDataDir,
        NODE_ENV: "test",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // 解析测试结果
    const passedMatch = output.match(/Tests\s+(\d+)\s+passed/);
    const failedMatch = output.match(/Tests\s+(\d+)\s+failed/);
    const skippedMatch = output.match(/(\d+)\s+skipped/);

    const passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
    const failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
    const skipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;

    console.log(`[Deploy] 测试解析结果: passed=${passed}, failed=${failed}, skipped=${skipped}`);

    return {
      success: failed === 0,
      passed,
      failed,
      skipped,
    };
  } catch (error) {
    // 测试失败时也会抛出错误，尝试从错误对象获取输出
    let output = "";
    if (error && typeof error === "object") {
      // execSync 错误对象可能有 stdout 属性
      const execError = error as { stdout?: string; stderr?: string; message: string };
      output = execError.stdout || execError.stderr || execError.message || String(error);
    } else {
      output = String(error);
    }
    
    console.error(`[Deploy] 测试执行出错或包含失败用例，原始输出:`, output.substring(0, 500));
    
    const passedMatch = output.match(/Tests\s+(\d+)\s+passed/);
    const failedMatch = output.match(/Tests\s+(\d+)\s+failed/);
    const skippedMatch = output.match(/(\d+)\s+skipped/);

    const passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
    const failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
    const skipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;

    console.error(`[Deploy] 解析结果: passed=${passed}, failed=${failed}, skipped=${skipped}`);

    return {
      success: false,
      passed,
      failed,
      skipped,
    };
  }
}

/**
 * 验证是否可以部署
 * 
 * 根据环境有不同的策略：
 * - production: 要求所有测试通过，不能有任何跳过
 * - staging: 允许有跳过测试，但不能有失败
 * - development: 允许有跳过测试，但不能有失败
 */
export async function validateBeforeDeploy(
  testResult: TestResult | null,
  force: boolean = false,
  environment: DeployEnvironment = getDeployEnvironment()
): Promise<DeployValidationResult> {
  // 如果没有测试结果
  if (!testResult) {
    if (force) {
      return {
        canDeploy: true,
        message: `⚠️ [${environment}] 强制部署：无法获取测试结果，跳过验证`,
      };
    }
    return {
      canDeploy: false,
      message: "❌ 部署被拒绝：无法获取测试结果，请确保测试可以正常运行",
    };
  }

  const { passed, failed, skipped } = testResult;
  const total = passed + failed + skipped;

  // 任何环境都不允许有失败测试
  if (failed > 0) {
    return {
      canDeploy: false,
      message: `❌ [${environment}] 部署被拒绝：${failed} 个测试失败（共 ${total} 个测试）`,
      details: testResult,
    };
  }

  // 开发环境：允许有跳过（方便调试）
  if (environment === "development") {
    if (skipped > 0) {
      console.log(`[Deploy] [${environment}] 警告：${skipped} 个测试被跳过，但无失败测试，允许部署`);
    }
    return {
      canDeploy: true,
      message: `✅ [${environment}] 测试验证通过：${passed} 个测试通过，${skipped} 个跳过`,
      details: testResult,
    };
  }

  // production 和 staging：不允许有任何跳过（严格要求）
  if (skipped > 0) {
    return {
      canDeploy: false,
      message: `❌ [${environment}] 部署被拒绝：${skipped} 个测试被跳过（${environment} 环境要求100%测试通过）`,
      details: testResult,
    };
  }

  // production 额外要求：测试数量不能太少
  if (environment === "production" && total < 50) {
    return {
      canDeploy: false,
      message: `❌ [${environment}] 部署被拒绝：测试数量不足（${total} 个，要求至少50个）`,
      details: testResult,
    };
  }

  // 所有测试通过
  return {
    canDeploy: true,
    message: `✅ [${environment}] 测试验证通过：${passed} 个测试全部通过（100%）`,
    details: testResult,
  };
}

export async function deployHandler(args: string, context: CommandContext): Promise<string> {
  const { session, fromUser, contextToken } = context;

  const versionType = args.trim() || "patch";
  if (!["patch", "minor", "major", "patch --force", "minor --force", "major --force", "patch -f", "minor -f", "major -f"].includes(versionType.split(" ")[0])) {
    // 检查基础版本类型
    const baseType = versionType.split(" ")[0];
    if (!["patch", "minor", "major"].includes(baseType)) {
      const currentEnv = getDeployEnvironment();
      return `❌ 无效的版本类型: ${versionType}\n\n用法:\n- \`/deploy\` 或 \`/deploy patch\` - 补丁版本\n- \`/deploy minor\` - 次版本\n- \`/deploy major\` - 主版本\n- \`/deploy patch --force\` - 强制部署（跳过测试）\n\n⚠️ 部署前会自动运行测试验证\n当前环境: ${currentEnv}`;
    }
  }

  // 检查是否强制部署
  const isForce = args.includes("--force") || args.includes("-f");
  const baseVersionType = args.trim().split(" ")[0] || "patch";

  // 获取当前环境
  const environment = getDeployEnvironment();
  console.log(`[Deploy] 当前环境: ${environment}, 版本类型: ${baseVersionType}, 强制: ${isForce}`);

  const projectPath = session.config.projectSpace?.path || process.cwd();

  // 立即提交 LongTask，测试和部署都在其中执行
  const ltManager = await getLongTaskManager(session.config.id);
  const task = ltManager.submit({
    agentId: session.config.id,
    userId: fromUser,
    chatId: fromUser,
    contextToken,
    prompt: `部署 Bot: ${baseVersionType}${isForce ? " (强制)" : ""}`,
    command: `bash scripts/deploy-pipeline.sh ${baseVersionType}${isForce ? " --force" : ""}`,
    cwd: projectPath,
    model: session.config.ai.model,
    maxTurns: 1,
  });

  // ========== 最低保障机制：确保即使通知逻辑失败也能重启 ==========
  // 设置一个绝对定时器，在任务提交后 60 秒强制重启
  // 这是为了防止 /deploy 命令自身的 bug 导致无法完成部署
  console.log(`[Deploy] 设置最低保障重启定时器（60秒后）...`);
  const failSafeTimeout = setTimeout(() => {
    console.log(`[Deploy] ⚠️ 最低保障机制触发：强制重启服务...`);
    spawn("pm2", ["restart", "weixin-kimi-bot"], {
      cwd: projectPath,
      stdio: "ignore",
      detached: true,
    }).unref();
  }, 60000);

  // 监听部署任务完成
  let checkCount = 0;
  const maxChecks = 360; // 最多检查30分钟 (360 * 5秒 = 1800秒)
  
  const checkTaskStatus = async () => {
    const currentTask = ltManager.getTask(task.id);
    checkCount++;
    
    if (!currentTask) {
      console.error(`[Deploy] 任务 ${task.id} 不存在`);
      // 取消最低保障，让 LongTask 的 onComplete 处理
      clearTimeout(failSafeTimeout);
      return;
    }
    
    // 任务还在运行中，继续等待
    if (currentTask.status === "pending" || currentTask.status === "running") {
      if (checkCount < maxChecks) {
        setTimeout(checkTaskStatus, 5000);
      } else {
        console.error(`[Deploy] 任务 ${task.id} 超时`);
        clearTimeout(failSafeTimeout);
        await sendTextReply(session.api, fromUser, contextToken, `❌ **部署失败**\n\n任务执行超时（超过30分钟）`);
      }
      return;
    }

    // 任务已完成（成功或失败）- 取消最低保障
    clearTimeout(failSafeTimeout);

    if (currentTask.status === "completed") {
      const result = currentTask.result || "";
      const releaseMatch = result.match(/🎉 版本 v(\d+\.\d+\.\d+)/);
      const version = releaseMatch ? releaseMatch[1] : "未知";

      const deployMessage =
        `✅ **部署成功**\n\n` +
        `版本: ${version}\n` +
        `类型: ${baseVersionType}${isForce ? " (强制)" : ""}\n` +
        `时间: ${new Date().toLocaleString("zh-CN")}\n\n` +
        `🔄 服务将在 3 秒后重启以应用新版本...`;

      try {
        await sendTextReply(session.api, fromUser, contextToken, deployMessage);
        console.log(`[Deploy] 已发送部署成功通知，3秒后重启服务...`);
      } catch (error) {
        console.error(`[Deploy] 发送通知失败:`, error);
      }

      saveRestartInfo({
        timestamp: Date.now(),
        reason: "deploy",
        operator: fromUser,
        version: version,
        agentId: process.env.ACTIVE_AGENT_ID,
        chatId: fromUser,
        contextToken: contextToken,
      });
      console.log(`[Deploy] 已保存重启信息`);

      setTimeout(() => {
        console.log(`[Deploy] 执行服务重启...`);
        const restartChild = spawn("pm2", ["restart", "weixin-kimi-bot"], {
          cwd: projectPath,
          stdio: "ignore",
          detached: true,
        });
        restartChild.unref();
      }, 3000);
    } else {
      // 任务失败
      const errorMsg = currentTask.error || "未知错误";
      try {
        await sendTextReply(session.api, fromUser, contextToken, `❌ **部署失败**\n\n错误: ${errorMsg}`);
        console.error(`[Deploy] 部署失败: ${errorMsg}`);
      } catch (error) {
        console.error(`[Deploy] 发送失败通知失败:`, error);
      }
    }
  };
  
  // 立即开始检查（任务可能很快完成）
  checkTaskStatus().catch(error => {
    console.error(`[Deploy] 检查任务状态时发生错误:`, error);
  });

  const queueLen = ltManager.getQueueLength();
  let response = `🚀 部署任务已提交为耗时任务\n\nID: \`${task.id}\`\n类型: ${baseVersionType}${isForce ? " (强制)" : ""}\n路径: ${projectPath}\n`;
  if (task.status === "pending" && queueLen > 0) {
    response += `排队位置: 前面还有 ${queueLen} 个任务\n`;
  }
  response += `\n📋 执行流程：测试 → 清理 → 版本更新\n`;
  response += `每 ${ltManager.getReportIntervalSec()} 秒会收到进度报告。\n`;
  response += `使用 \`/longtask status ${task.id}\` 查看进度\n`;
  response += `使用 \`/longtask cancel ${task.id}\` 取消任务`;

  return response;
}
