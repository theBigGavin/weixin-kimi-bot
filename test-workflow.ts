/**
 * 工作流引擎测试脚本
 */

import {
  initializeWorkflowEngine,
  nodeRegistry,
  WorkflowEngine,
  quickParse,
  WorkflowManager,
  registerBuiltinNodes,
} from "./src/workflow/index.js";

// 测试节点注册
console.log("=== 测试节点注册 ===");
registerBuiltinNodes();
console.log("已注册节点:", nodeRegistry.getAllTypes());
console.log("统计:", nodeRegistry.getStats());

// 测试快速解析
console.log("\n=== 测试快速解析 ===");
const testDescriptions = [
  "每天早上8点搜索AI新闻并生成晨报发送给我",
  "每小时搜索科技新闻",
  "每周一搜索市场报告",
];

for (const desc of testDescriptions) {
  console.log(`\n描述: ${desc}`);
  const result = quickParse(desc);
  if (result) {
    console.log(`  名称: ${result.name}`);
    console.log(`  Cron: ${result.cron}`);
    console.log(`  节点: ${result.nodes.map((n) => `${n.type}(${n.name})`).join(" -> ")}`);
  } else {
    console.log("  未匹配快速解析规则");
  }
}

// 测试表达式求值
console.log("\n=== 测试表达式求值 ===");
import { evaluateExpression, validateExpression } from "./src/workflow/expression.js";

const exprContext = {
  nodeOutputs: {
    search: {
      results: [{ title: "Test News", url: "http://example.com" }],
      formatted: "搜索结果...",
      totalResults: 5,
    },
  },
  variables: { topic: "AI", limit: 10 },
  userId: "user_123",
  agentId: "agent_456",
  workflow: { id: "wf_789", name: "Test Workflow", cron: "0 8 * * *", description: "", variables: {}, chatId: "", contextToken: "", enabled: true, createdAt: Date.now(), updatedAt: Date.now(), runCount: 0, userId: "user_123", agentId: "agent_456" },
};

const testExprs = [
  "${search.totalResults}",
  "${search.formatted}",
  "${date:today}",
  "${date:yesterday}",
  "Hello ${user.id}",
  "${workflow.name}",
];

for (const expr of testExprs) {
  const value = evaluateExpression(expr, exprContext);
  console.log(`  ${expr} => ${JSON.stringify(value).substring(0, 50)}`);
}

console.log("\n=== 所有测试完成 ===");
