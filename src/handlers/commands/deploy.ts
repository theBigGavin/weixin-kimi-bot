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
    
    // 运行测试并捕获输出
    const output = execSync("npm test 2>&1", { 
      encoding: "utf-8",
      timeout: 120000, // 2分钟超时
      cwd: process.cwd(),
    });

    // 解析测试结果
    const passedMatch = output.match(/Tests\s+(\d+)\s+passed/);
    const failedMatch = output.match(/Tests\s+(\d+)\s+failed/);
    const skippedMatch = output.match(/(\d+)\s+skipped/);

    const passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
    const failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
    const skipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;

    return {
      success: failed === 0,
      passed,
      failed,
      skipped,
    };
  } catch (error) {
    // 测试失败时也会抛出错误
    const output = error instanceof Error ? error.message : String(error);
    
    const passedMatch = output.match(/Tests\s+(\d+)\s+passed/);
    const failedMatch = output.match(/Tests\s+(\d+)\s+failed/);
    const skippedMatch = output.match(/(\d+)\s+skipped/);

    const passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
    const failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
    const skipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;

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
  if (!["patch", "minor", "major"].includes(versionType)) {
    const currentEnv = getDeployEnvironment();
    return `❌ 无效的版本类型: ${versionType}\n\n用法:\n- \`/deploy\` 或 \`/deploy patch\` - 补丁版本\n- \`/deploy minor\` - 次版本\n- \`/deploy major\` - 主版本\n\n⚠️ 部署前会自动运行测试验证\n当前环境: ${currentEnv}\n\n环境配置:\n- DEPLOY_ENV: ${process.env.DEPLOY_ENV || "未设置"}\n- NODE_ENV: ${process.env.NODE_ENV || "未设置"}`;
  }

  // 检查是否强制部署（使用 --force 或 -f 标志）
  const isForce = args.includes("--force") || args.includes("-f");

  // 获取当前环境
  const environment = getDeployEnvironment();
  console.log(`[Deploy] 当前环境: ${environment}`);

  // 运行集成测试验证
  const testResult = await runIntegrationTests();
  const validation = await validateBeforeDeploy(testResult, isForce, environment);

  if (!validation.canDeploy) {
    return `❌ **部署被拒绝**\n\n${validation.message}\n\n请先修复测试问题后再部署。\n\n如需强制部署（不推荐），请使用：\n\`/deploy ${versionType} --force\``;
  }

  // 测试通过，继续部署
  console.log(`[Deploy] ${validation.message}`);

  // 清理测试产生的临时目录
  console.log("[Deploy] 清理测试临时目录...");
  const cleanupResult = cleanupTestTempDirs();
  console.log(`[Deploy] 已清理 ${cleanupResult.count} 个临时目录`);

  const projectPath = session.config.projectSpace?.path || process.cwd();

  const ltManager = await getLongTaskManager(session.config.id);
  const task = ltManager.submit({
    agentId: session.config.id,
    userId: fromUser,
    chatId: fromUser,
    contextToken,
    prompt: `部署 Bot: ${versionType}`,
    command: `npm run version:${versionType}`,
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
        `类型: ${versionType}\n` +
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
  let response = `🚀 部署任务已提交为耗时任务\n\nID: \`${task.id}\`\n类型: ${versionType}\n路径: ${projectPath}\n`;
  if (task.status === "pending" && queueLen > 0) {
    response += `排队位置: 前面还有 ${queueLen} 个任务\n`;
  }
  response += `\n每 ${ltManager.getReportIntervalSec()} 秒会收到进度报告。\n`;
  response += `使用 \`/longtask status ${task.id}\` 查看进度\n`;
  response += `使用 \`/longtask cancel ${task.id}\` 取消任务`;

  return response;
}
