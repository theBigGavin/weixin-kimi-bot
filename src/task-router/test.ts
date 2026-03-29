/**
 * Task Router 快速测试
 */

import { TaskAnalyzer, DecisionEngine, ruleEngine } from './index.js';
import type { AnalysisContext, TaskSubmission } from './index.js';

// 测试用例
const testCases: { prompt: string; expectedMode: string }[] = [
  // Direct 模式
  { prompt: '你好，今天天气怎么样？', expectedMode: 'direct' },
  { prompt: '什么是闭包？', expectedMode: 'direct' },
  { prompt: '解释一下这段代码', expectedMode: 'direct' },
  
  // LongTask 模式
  { prompt: '重构这个函数，提取重复代码', expectedMode: 'longtask' },
  { prompt: '运行所有单元测试', expectedMode: 'longtask' },
  { prompt: '构建项目并检查错误', expectedMode: 'longtask' },
  { prompt: '扫描项目中的废弃代码', expectedMode: 'longtask' },
  
  // FlowTask 模式
  { prompt: '实现一个完整的用户认证系统，包括登录、注册、密码重置功能', expectedMode: 'flowtask' },
  { prompt: '大规模重构整个项目架构', expectedMode: 'flowtask' },
  { prompt: '批量处理所有文件并修改命名规范', expectedMode: 'flowtask' },
  { prompt: '第一步分析代码，第二步重构，第三步测试', expectedMode: 'flowtask' },
];

async function runTests() {
  console.log('=== Task Router 测试 ===\n');
  
  const analyzer = new TaskAnalyzer();
  const context: AnalysisContext = {
    userId: 'test_user',
    chatId: 'test_chat',
    cwd: '/home/gavin/project',
  };

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    const decision = await analyzer.analyze(testCase.prompt, context);
    const success = decision.mode === testCase.expectedMode;
    
    if (success) {
      passed++;
      console.log(`✅ [${decision.mode.padEnd(8)}] "${testCase.prompt.substring(0, 40)}..."`);
    } else {
      failed++;
      console.log(`❌ [${decision.mode.padEnd(8)}] "${testCase.prompt.substring(0, 40)}..."`);
      console.log(`   期望: ${testCase.expectedMode}, 实际: ${decision.mode}`);
      console.log(`   理由: ${decision.reason}`);
    }
  }

  console.log(`\n=== 测试结果 ===`);
  console.log(`总计: ${testCases.length}, 通过: ${passed}, 失败: ${failed}`);
  
  // 详细分析示例
  console.log(`\n=== 详细分析示例 ===`);
  const detailedPrompt = '帮我实现一个完整的任务调度系统，包括队列管理、优先级调度、重试机制';
  const detailed = await analyzer.analyzeDetailed(detailedPrompt, context);
  
  console.log(`提示: "${detailedPrompt}"`);
  console.log(`执行模式: ${detailed.decision.mode}`);
  console.log(`复杂度: ${detailed.decision.analysis.complexity}/10`);
  console.log(`预计耗时: ${detailed.decision.analysis.estimatedDuration}秒`);
  console.log(`步骤数: ${detailed.decision.analysis.stepCount}`);
  console.log(`风险等级: ${detailed.decision.analysis.riskLevel}`);
  console.log(`领域: ${detailed.decision.analysis.domain}`);
  console.log(`需要规划: ${detailed.decision.analysis.requiresPlanning}`);
  console.log(`涉及多文件: ${detailed.decision.analysis.involvesMultipleFiles}`);
  console.log(`置信度: ${Math.round(detailed.decision.confidence * 100)}%`);
  console.log(`使用深度分析: ${detailed.usedDeepAnalysis}`);
  console.log(`使用 LLM: ${detailed.usedLLM}`);
  console.log(`分析来源: ${detailed.analysisSource}`);
  console.log(`缓存命中: ${detailed.cacheHit}`);
  console.log(`决策理由: ${detailed.decision.reason}`);
  
  if (detailed.decision.analysis.llmReasoning) {
    console.log(`LLM 推理: ${detailed.decision.analysis.llmReasoning}`);
  }
  
  if (detailed.decision.analysis.suggestedSubtasks?.length) {
    console.log(`建议子任务:`);
    detailed.decision.analysis.suggestedSubtasks.forEach((subtask, i) => {
      console.log(`  ${i + 1}. ${subtask}`);
    });
  }
  
  // 统计信息
  const stats = analyzer.getCacheStats();
  console.log(`\n缓存统计: 大小=${stats.size}, TTL=${stats.ttl}ms`);
}

// 测试规则引擎
function testRules() {
  console.log('\n=== 规则引擎测试 ===');
  
  const testPrompts = [
    '批量处理所有文件',
    '生成项目文档',
    '修改配置文件',
    '运行测试套件',
  ];
  
  for (const prompt of testPrompts) {
    const matches = ruleEngine.analyze(prompt);
    console.log(`\n"${prompt}"`);
    matches.slice(0, 3).forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.rule} (得分: ${m.score})`);
    });
  }
}

// 运行测试
runTests()
  .then(() => testRules())
  .catch(console.error);
