/**
 * Task Router 使用示例
 */

import { 
  TaskRouter, 
  getTaskRouter, 
  routeTask, 
  analyzeTask,
  type TaskSubmission,
  type ExecutionMode,
} from './index.js';

// ============ 示例 1: 基础使用 ============

async function basicExample() {
  // 初始化 TaskRouter
  const router = await getTaskRouter({
    agentId: 'agent_001',
    onProgress: async (report) => {
      console.log(`[${report.mode}] ${report.taskId}: ${report.step} (${report.percent}%)`);
    },
    onComplete: async (result) => {
      console.log(`[完成] ${result.taskId}: ${result.success ? '成功' : '失败'}`);
      if (result.result) {
        console.log(`结果: ${result.result.substring(0, 200)}...`);
      }
    },
    onApprovalRequest: async (taskId, request) => {
      console.log(`[确认请求] ${taskId}: ${request.description}`);
      // 实际项目中，这里应该发送消息给用户等待确认
      return false; // 默认拒绝
    },
  });

  // 示例任务提交
  const submission: TaskSubmission = {
    prompt: '帮我分析这个项目的代码结构，找出主要的模块和依赖关系',
    userId: 'user_123',
    chatId: 'chat_456',
    contextToken: 'ctx_789',
    cwd: '/home/gavin/project',
    model: 'kimi',
  };

  // 分析并执行任务
  const routedTask = await router.analyzeAndExecute(submission);
  
  console.log('任务已创建:');
  console.log(`  ID: ${routedTask.taskId}`);
  console.log(`  模式: ${routedTask.mode}`);
  console.log(`  复杂度: ${routedTask.analysis.complexity}/10`);
  console.log(`  预计耗时: ${routedTask.analysis.estimatedDuration}秒`);
  console.log(`  决策置信度: ${Math.round(routedTask.decision.confidence * 100)}%`);
  console.log(`  理由: ${routedTask.decision.reason}`);

  return routedTask;
}

// ============ 示例 2: 仅分析不执行 ============

async function analyzeOnlyExample() {
  const router = await getTaskRouter({ agentId: 'agent_002' });

  const submissions: TaskSubmission[] = [
    {
      prompt: '你好，今天天气怎么样？',
      userId: 'user_1',
      chatId: 'chat_1',
      contextToken: 'ctx_1',
      cwd: '/tmp',
    },
    {
      prompt: '帮我重构这个函数，提取重复代码',
      userId: 'user_1',
      chatId: 'chat_1',
      contextToken: 'ctx_2',
      cwd: '/home/gavin/project',
    },
    {
      prompt: '实现一个完整的用户认证系统，包括登录、注册、密码重置功能',
      userId: 'user_1',
      chatId: 'chat_1',
      contextToken: 'ctx_3',
      cwd: '/home/gavin/project',
    },
  ];

  for (const submission of submissions) {
    const decision = await router.analyzeOnly(submission);
    console.log(`\n提示: "${submission.prompt.substring(0, 30)}..."`);
    console.log(`  推荐模式: ${decision.mode}`);
    console.log(`  复杂度: ${decision.analysis.complexity}/10`);
    console.log(`  领域: ${decision.analysis.domain}`);
    console.log(`  风险: ${decision.analysis.riskLevel}`);
    console.log(`  理由: ${decision.reason}`);
  }
}

// ============ 示例 3: 强制指定模式 ============

async function forceModeExample() {
  const router = await getTaskRouter({ agentId: 'agent_003' });

  const submission: TaskSubmission = {
    prompt: '帮我优化这段代码',
    userId: 'user_1',
    chatId: 'chat_1',
    contextToken: 'ctx_1',
    cwd: '/home/gavin/project',
  };

  // 强制使用 LongTask 模式
  const longTask = await router.analyzeAndExecute(submission, 'longtask');
  console.log(`强制 LongTask 模式: ${longTask.taskId}`);

  // 强制使用 FlowTask 模式
  const flowTask = await router.analyzeAndExecute(submission, 'flowtask');
  console.log(`强制 FlowTask 模式: ${flowTask.taskId}`);
}

// ============ 示例 4: 任务管理 ============

async function taskManagementExample() {
  const router = await getTaskRouter({ agentId: 'agent_004' });

  const userId = 'user_123';

  // 提交多个任务
  const tasks = await Promise.all([
    router.analyzeAndExecute({
      prompt: '分析项目依赖',
      userId,
      chatId: 'chat_1',
      contextToken: 'ctx_1',
      cwd: '/home/gavin/project',
    }),
    router.analyzeAndExecute({
      prompt: '重构 utils 模块',
      userId,
      chatId: 'chat_1',
      contextToken: 'ctx_2',
      cwd: '/home/gavin/project',
    }),
  ]);

  console.log('已创建任务:');
  tasks.forEach(t => console.log(`  ${t.taskId}: ${t.mode}`));

  // 获取用户所有任务
  const userTasks = router.getUserTasks(userId);
  console.log(`\n用户 ${userId} 的任务:`);
  userTasks.forEach(t => {
    console.log(`  ${t.taskId}: ${t.mode} - ${t.status} (${t.progress}%)`);
  });

  // 获取活跃任务
  const activeTasks = router.getActiveTasks();
  console.log(`\n活跃任务数: ${activeTasks.length}`);

  // 取消任务
  if (tasks[0]) {
    const cancelled = await router.cancel(tasks[0].taskId);
    console.log(`\n取消任务 ${tasks[0].taskId}: ${cancelled ? '成功' : '失败'}`);
  }
}

// ============ 示例 5: 便捷函数使用 ============

async function quickExample() {
  // 使用便捷函数快速路由任务
  const submission: TaskSubmission = {
    prompt: '帮我创建一个 REST API 服务，包含用户 CRUD 操作',
    userId: 'user_1',
    chatId: 'chat_1',
    contextToken: 'ctx_1',
    cwd: '/home/gavin/project',
  };

  const routedTask = await routeTask('agent_005', submission, {
    onProgress: async (report) => {
      console.log(`进度: ${report.step} (${report.percent}%)`);
    },
    onComplete: async (result) => {
      console.log(`完成: ${result.success ? '成功' : '失败'}`);
    },
  });

  console.log(`任务路由结果: ${routedTask.mode}`);

  // 仅分析
  const decision = await analyzeTask('agent_005', {
    prompt: '批量修改所有文件中的变量名',
    userId: 'user_1',
    chatId: 'chat_1',
    contextToken: 'ctx_2',
    cwd: '/home/gavin/project',
  });

  console.log(`\n分析结果: ${decision.mode}`);
  console.log(`理由: ${decision.reason}`);
}

// ============ 示例 6: 自定义配置 ============

async function customConfigExample() {
  const router = await getTaskRouter({
    agentId: 'agent_006',
    routerConfig: {
      // 调整阈值
      complexityThreshold: {
        direct: 2,      // 复杂度 <= 2 直接执行
        longtask: 6,    // 复杂度 <= 6 使用 LongTask
      },
      durationThreshold: {
        direct: 20,     // 20秒内直接执行
        longtask: 300,  // 5分钟内使用 LongTask
      },
    },
    analyzerOptions: {
      enableCache: true,
      cacheTtl: 10 * 60 * 1000, // 10分钟缓存
      useDeepAnalysis: true,
    },
  });

  const submission: TaskSubmission = {
    prompt: '扫描项目中的所有 TypeScript 文件，统计代码行数',
    userId: 'user_1',
    chatId: 'chat_1',
    contextToken: 'ctx_1',
    cwd: '/home/gavin/project',
  };

  const decision = await router.analyzeOnly(submission);
  console.log(`自定义配置分析结果: ${decision.mode}`);
}

// ============ 示例 7: 批量任务处理 ============

async function batchProcessingExample() {
  const router = await getTaskRouter({ agentId: 'agent_007' });

  const prompts = [
    '修复这个 bug',
    '生成项目文档',
    '优化数据库查询',
    '创建 Dockerfile',
    '配置 CI/CD',
  ];

  const results: { prompt: string; mode: ExecutionMode; confidence: number }[] = [];

  for (const prompt of prompts) {
    const decision = await router.analyzeOnly({
      prompt,
      userId: 'user_1',
      chatId: 'chat_1',
      contextToken: `ctx_${Date.now()}`,
      cwd: '/home/gavin/project',
    });

    results.push({
      prompt,
      mode: decision.mode,
      confidence: decision.confidence,
    });
  }

  console.log('\n批量分析结果:');
  results.forEach(r => {
    console.log(`  [${r.mode.padEnd(8)}] ${r.prompt} (置信度: ${Math.round(r.confidence * 100)}%)`);
  });

  // 统计
  const stats = router.getStats();
  console.log(`\n统计: 总分析数=${stats.totalAnalyzed}, LongTask=${stats.longtaskCount}, FlowTask=${stats.flowtaskCount}`);
}

// ============ 主函数 ============

async function main() {
  console.log('=== Task Router 示例 ===\n');

  try {
    // 选择要运行的示例
    const examples = {
      basic: basicExample,
      analyze: analyzeOnlyExample,
      force: forceModeExample,
      manage: taskManagementExample,
      quick: quickExample,
      config: customConfigExample,
      batch: batchProcessingExample,
    };

    // 默认运行分析示例
    await analyzeOnlyExample();
    
    console.log('\n=== 示例运行完成 ===');
  } catch (error) {
    console.error('示例运行失败:', error);
  }
}

// 如果直接运行此文件
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main };
