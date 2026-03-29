# Task Router - 智能任务路由系统

自动分析用户请求并选择最合适的执行模式，无缝集成 LongTask 和 FlowTask。

## 特性

- **智能分析**：基于关键词、模式和启发式算法快速分析任务特征
- **自动决策**：根据复杂度、耗时、风险等因素自动选择执行模式
- **三种执行模式**：
  - `direct`：直接执行（简单、快速任务）
  - `longtask`：耗时任务后台执行（中等复杂度、长时间运行）
  - `flowtask`：流程任务（高复杂度、需要规划和确认）
- **深度分析**：对边界情况自动触发深度分析
- **缓存机制**：分析结果缓存，提高响应速度
- **统计监控**：内置统计分析功能

## 快速开始

```typescript
import { getTaskRouter, type TaskSubmission } from './task-router/index.js';

// 初始化
const router = await getTaskRouter({
  agentId: 'agent_001',
  onProgress: async (report) => {
    console.log(`${report.taskId}: ${report.step} (${report.percent}%)`);
  },
  onComplete: async (result) => {
    console.log(`任务完成: ${result.success}`);
  },
});

// 提交任务
const submission: TaskSubmission = {
  prompt: '帮我重构这个模块，提取公共函数',
  userId: 'user_123',
  chatId: 'chat_456',
  contextToken: 'ctx_789',
  cwd: '/home/gavin/project',
};

const routedTask = await router.analyzeAndExecute(submission);

console.log(`任务ID: ${routedTask.taskId}`);
console.log(`执行模式: ${routedTask.mode}`);  // longtask 或 flowtask
console.log(`复杂度: ${routedTask.analysis.complexity}/10`);
console.log(`决策理由: ${routedTask.decision.reason}`);
```

## API 参考

### TaskRouter 类

#### 初始化
```typescript
const router = await getTaskRouter({
  agentId: string,                    // 必需：Agent ID
  onProgress?: (report) => Promise<void>,    // 进度回调
  onComplete?: (result) => Promise<void>,    // 完成回调
  onApprovalRequest?: (taskId, request) => Promise<boolean>, // 确认回调
  routerConfig?: Partial<TaskRouterConfig>,  // 路由配置
  analyzerOptions?: AnalyzerOptions,         // 分析器选项
  longtaskOptions?: Partial<LongTaskManagerOptions>,
  flowtaskOptions?: Partial<FlowTaskManagerOptions>,
});
```

#### 方法

| 方法 | 说明 | 返回值 |
|------|------|--------|
| `analyzeAndExecute(submission, forceMode?)` | 分析并执行任务 | `RoutedTask` |
| `analyzeOnly(submission)` | 仅分析不执行 | `TaskDecision` |
| `analyzeDetailed(submission)` | 详细分析（调试用） | `{ decision, quickAnalysis, usedDeepAnalysis, cacheHit }` |
| `cancel(taskId)` | 取消任务 | `boolean` |
| `getTaskStatus(taskId)` | 获取任务状态 | `TaskInfo \| undefined` |
| `getUserTasks(userId)` | 获取用户所有任务 | `TaskInfo[]` |
| `getActiveTasks()` | 获取活跃任务 | `TaskInfo[]` |
| `getStats()` | 获取统计信息 | `RouterStats` |
| `updateConfig(config)` | 更新配置 | `void` |
| `clearCache()` | 清除缓存 | `void` |
| `close()` | 关闭路由器 | `Promise<void>` |

### 便捷函数

```typescript
// 快速路由任务
const routedTask = await routeTask(agentId, submission, options, forceMode);

// 快速分析
const decision = await analyzeTask(agentId, submission, options);
```

## 决策规则

系统根据以下因素自动决策：

### 复杂度评分 (1-10)
- **1-3**：简单任务，适合直接执行
- **4-7**：中等复杂度，适合 LongTask
- **8-10**：高复杂度，适合 FlowTask

### 预计耗时
- **< 30秒**：直接执行
- **30秒 - 10分钟**：LongTask
- **> 10分钟**：FlowTask

### 风险等级
- **low**：标准处理
- **medium**：增加确认点
- **high**：FlowTask 强制确认机制

### 关键词匹配
内置丰富的规则库，覆盖代码重构、分析、测试、部署等场景。

## 配置选项

```typescript
interface TaskRouterConfig {
  // 复杂度阈值
  complexityThreshold: {
    direct: number;      // 直接执行上限（默认：3）
    longtask: number;    // LongTask 上限（默认：7）
  };
  
  // 耗时阈值（秒）
  durationThreshold: {
    direct: number;      // 直接执行上限（默认：30）
    longtask: number;    // LongTask 上限（默认：600）
  };
  
  // 步骤数阈值
  stepThreshold: {
    direct: number;      // 直接执行上限（默认：1）
    longtask: number;    // LongTask 上限（默认：5）
  };
  
  // 深度分析
  useDeepAnalysis: boolean;           // 是否启用（默认：true）
  deepAnalysisThreshold: number;      // 触发阈值（默认：0.7）
  
  // 其他
  defaultMode: ExecutionMode;         // 默认模式（默认：'direct'）
  enableCache: boolean;               // 启用缓存（默认：true）
  cacheTtl: number;                   // 缓存有效期（默认：5分钟）
}
```

## 使用场景示例

### 场景 1: 简单问题
```typescript
const decision = await router.analyzeOnly({
  prompt: '什么是闭包？',
  // ...
});
// 结果: mode = 'direct', complexity = 2
```

### 场景 2: 代码重构
```typescript
const decision = await router.analyzeOnly({
  prompt: '重构这个函数，提取重复代码',
  // ...
});
// 结果: mode = 'longtask', complexity = 6
```

### 场景 3: 复杂功能实现
```typescript
const decision = await router.analyzeOnly({
  prompt: '实现一个完整的用户认证系统，包括登录、注册、密码重置',
  // ...
});
// 结果: mode = 'flowtask', complexity = 9
```

## 调试

```typescript
// 获取详细分析信息
const detailed = await router.analyzeDetailed(submission);
console.log('快速分析:', detailed.quickAnalysis);
console.log('使用深度分析:', detailed.usedDeepAnalysis);
console.log('缓存命中:', detailed.cacheHit);

// 获取统计
const stats = router.getStats();
console.log('总分析数:', stats.totalAnalyzed);
console.log('平均分析时间:', stats.averageAnalysisTime, 'ms');
console.log('缓存命中率:', stats.cacheHitRate);
```

## 文件结构

```
task-router/
├── index.ts      # 主入口，TaskRouter 类
├── types.ts      # 类型定义
├── analyzer.ts   # 任务分析器
├── decision.ts   # 决策引擎
├── rules.ts      # 规则引擎
├── example.ts    # 使用示例
└── README.md     # 本文档
```

## 相关模块

- [LongTask](../longtask/) - 耗时任务管理
- [FlowTask](../flowtask/) - 可靠流程任务系统
