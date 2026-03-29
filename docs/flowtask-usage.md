# FlowTask 可靠任务流 - 使用指南

基于"可靠自我迭代架构-v2"实现的结构化任务执行系统。

## V2 新特性

### 1. 后台执行能力（继承 LongTask）

FlowTask V2 继承了 LongTask 的后台长时间执行能力：

- **子进程执行**: 任务在独立子进程中执行，不占用主进程
- **无超时限制**: 不受 HTTP 请求超时限制，可执行长时间任务
- **独立取消**: 每个任务可独立取消，不影响其他任务
- **自动进度报告**: 每 30 秒自动报告进度

### 2. 自动任务拆分（方案2）

当任务步骤数超过阈值（默认10步）时，系统自动拆分：

- **智能分析**: 根据任务类型自动选择拆分策略（按阶段/文件/模块）
- **并行执行**: 无依赖的子任务可以并行执行
- **结果合并**: 自动合并子任务结果为统一报告
- **依赖管理**: 正确处理子任务间的依赖关系

**拆分示例**:
```
原始任务: "重构整个项目" (25步骤)
  ↓ 自动拆分
子任务1: "分析阶段" (5步骤) 
子任务2: "重构模块A" (8步骤) ─┐
子任务3: "重构模块B" (7步骤) ─┤→ 并行执行
子任务4: "重构模块C" (5步骤) ─┘
子任务5: "验证阶段" (5步骤) ← 依赖1-4完成
  ↓ 结果合并
完整重构报告
```

## 核心特性

- **结构化计划**: 任务执行前生成可验证的 JSON 计划
- **状态机驱动**: 确定性的控制流，LLM 不直接参与执行决策
- **分层验证**: 语法、语义、执行三层验证
- **人机协作**: 高风险操作自动请求用户确认
- **审计追踪**: 完整的执行历史记录
- **回滚支持**: 文件变更自动备份，支持回滚

## 命令列表

```
/flowtask run <任务描述>   # 启动新的可靠任务流
/flowtask list            # 查看任务列表和历史
/flowtask status <id>     # 查看任务进度
/flowtask plan <id>       # 查看执行计划
/flowtask cancel <id>     # 取消任务
/flowtask approve <id>    # 确认执行（等待确认时）
/flowtask reject <id>     # 拒绝执行（等待确认时）
```

## 使用示例

### 示例 1: 代码重构任务

```
/flowtask run 重构 src/utils.ts，提取重复逻辑到独立函数
```

执行流程：
1. **计划生成** (5%) - LLM 分析需求生成结构化计划
2. **计划验证** (10%) - 验证语法、语义和风险等级
3. **等待确认** (10%) - 如为中/高风险，展示计划等待用户确认
4. **步骤执行** (10%-90%) - 按顺序执行：
   - 📖 读取原文件
   - 🤖 LLM 分析重复逻辑
   - 👤 人工确认提取方案
   - ✏️ 写入重构后的代码
   - ⚡ 运行测试验证
5. **完成** (100%) - 报告结果和审计摘要

### 示例 2: 大任务自动拆分

```
/flowtask run 分析整个项目，为每个模块生成测试用例
```

如果计划超过10步，系统自动：
1. 按模块拆分为多个子任务
2. 并行执行独立的子任务
3. 收集所有子任务结果
4. 生成统一的测试报告

### 示例 3: 项目分析任务

```
/flowtask run 分析当前项目的代码结构，生成模块依赖图
```

此任务可能为低风险（仅读取操作），系统会自动执行无需确认。

## 风险等级说明

| 等级 | 条件 | 行为 |
|------|------|------|
| 🟢 Low | 仅读取、搜索操作 | 自动执行 |
| 🟡 Medium | 修改源代码、执行 shell 命令 | 关键步骤前确认 |
| 🔴 High | 删除文件、修改配置、git push | 完整计划审核 |

## 架构对比

### vs /longtask

| 特性 | /longtask | /flowtask |
|------|-----------|-----------|
| 后台执行 | ✅ 子进程 | ✅ V2新增 |
| 结构化计划 | ❌ 无 | ✅ JSON计划 |
| 任务拆分 | ❌ 不支持 | ✅ V2新增 |
| 并行执行 | ❌ 不支持 | ✅ V2新增 |
| 控制流 | LLM决定 | 状态机驱动 |
| 可验证 | 低 | 高（三层验证） |
| 人机协作 | 被动打断 | 主动检查点 |
| 回滚 | 不支持 | 内置支持 |
| 审计 | 简单日志 | 完整执行回放 |
| 进度报告 | 基于输出解析 | 基于步骤进度 |

### vs MCP

| 维度 | MCP | FlowTask |
|------|-----|----------|
| 控制流 | LLM选择工具 | 状态机执行计划 |
| 可预测性 | 低 | 高 |
| 可验证 | 工具级别 | 任务级别 |
| 人机协作 | 被动 | 主动检查点 |

## 执行计划示例

```json
{
  "version": "1.0",
  "planId": "plan_refactor_001",
  "goal": "重构 src/utils.ts，提取重复逻辑",
  "reliability": {
    "minSteps": 3,
    "maxSteps": 10,
    "timeout": 300000,
    "rollbackOnError": true,
    "checkpoints": [2, 5]
  },
  "steps": [
    {
      "stepId": "step-1",
      "type": "read",
      "description": "读取原文件",
      "inputs": { "paths": ["src/utils.ts"] },
      "expectedOutputs": { "type": "file" },
      "validators": [{ "type": "file_exists" }],
      "onError": "abort"
    },
    {
      "stepId": "step-2",
      "type": "llm",
      "description": "分析重复逻辑",
      "inputs": { "prompt": "分析以下代码的重复逻辑块..." },
      "expectedOutputs": { "type": "structured" },
      "onError": "human"
    },
    {
      "stepId": "step-3",
      "type": "human",
      "description": "确认提取方案",
      "inputs": { "prompt": "建议提取以下函数，是否继续？" },
      "onError": "abort"
    },
    {
      "stepId": "step-4",
      "type": "write",
      "description": "写入重构代码",
      "inputs": { "paths": ["src/utils.ts"], "content": "..." },
      "validators": [{ "type": "syntax_valid", "language": "typescript" }],
      "onError": "rollback"
    }
  ],
  "validation": {
    "syntaxValid": true,
    "semanticValid": true,
    "riskLevel": "medium",
    "requiredApproval": true,
    "warnings": []
  }
}
```

## 配置选项

在代码中配置 FlowTaskManager：

```typescript
const ftManager = getFlowTaskManager(agentId, {
  maxConcurrency: 4,              // 最大并发数
  reportIntervalMs: 30000,        // 进度报告间隔
  autoApproveLowRisk: false,      // 低风险任务自动执行
  requireApprovalFor: ["write", "shell", "human"], // 需要确认的步骤类型
  defaultTimeout: 600000,         // 默认超时时间（10分钟）
  
  // 回调函数
  onProgress: async (task, progress) => { /* 发送进度 */ },
  onComplete: async (task) => { /* 发送完成通知 */ },
  onCancel: async (task) => { /* 发送取消通知 */ },
  onApprovalRequest: async (task, request) => { /* 发送确认请求 */ },
});
```

## 任务拆分配置

```typescript
import { createTaskSplitter } from "./flowtask/task-splitter.js";

const splitter = createTaskSplitter({
  maxStepsPerTask: 10,    // 超过此阈值自动拆分
  enableParallel: true,   // 启用并行执行
  splitBy: "auto",        // 拆分策略: "auto" | "phase" | "file" | "module"
});

const result = splitter.analyze(plan);
if (result.shouldSplit) {
  console.log(`任务已拆分为 ${result.splitGroup!.subTasks.length} 个子任务`);
  console.log(`并行组: ${result.splitGroup!.parallelGroups.length} 组`);
}
```

## 执行模式选择

```typescript
// 后台执行（推荐，继承LongTask能力）
const task = await ftManager.submit({
  agentId, userId, chatId, contextToken,
  prompt: "重构项目代码",
  cwd: workspace,
  model: "kimi-for-coding",
}, "background");  // 后台执行模式

// 内联执行（快速小任务）
const task = await ftManager.submit({
  agentId, userId, chatId, contextToken,
  prompt: "简单分析",
  cwd: workspace,
  model: "kimi-for-coding",
}, "inline");  // 内联执行模式
```

## 注意事项

1. **计划生成需要 LLM 调用** - 首次提交任务时需要等待计划生成（约 5-15 秒）
2. **大任务自动拆分** - 超过10步的任务会自动拆分，可能产生多个子任务
3. **后台执行** - V2默认使用后台执行，任务可在后台长时间运行
4. **高风险操作需确认** - 涉及文件写入、删除等操作会暂停等待确认
5. **支持回滚** - 只有带备份的 write 操作支持回滚，shell 命令不可回滚
6. **超时处理** - 单步和整体任务都有超时限制

## 故障排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 计划生成失败 | LLM 输出格式不正确 | 简化任务描述，更明确具体 |
| 步骤执行失败 | 文件不存在或权限不足 | 检查路径和权限 |
| 确认超时 | 用户未及时响应 | 重新提交任务 |
| 回滚失败 | 备份文件丢失 | 手动恢复或使用 git |
| 子任务失败 | 依赖未满足或资源冲突 | 检查依赖关系和并发设置 |

## 最佳实践

1. **合理设置拆分阈值** - 根据任务类型调整 `maxStepsPerTask`
2. **利用并行执行** - 设计任务时考虑可并行性
3. **设置检查点** - 在关键步骤设置检查点以便人工介入
4. **监控子任务** - 大任务拆分时关注各子任务进度
5. **及时确认** - 收到确认请求后尽快响应，避免超时
