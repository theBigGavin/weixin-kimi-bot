# FlowTask 可靠任务流 - 使用指南

基于"可靠自我迭代架构-v2"实现的结构化任务执行系统。

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

### 示例 2: 项目分析任务

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
| 计划 | 无明确计划 | 结构化 JSON 计划 |
| 控制流 | LLM 决定 | 状态机驱动 |
| 可验证 | 低 | 高（三层验证） |
| 人机协作 | 被动打断 | 主动检查点 |
| 回滚 | 不支持 | 内置支持 |
| 审计 | 简单日志 | 完整执行回放 |
| 进度报告 | 基于输出解析 | 基于步骤进度 |

### vs MCP

| 维度 | MCP | FlowTask |
|------|-----|----------|
| 控制流 | LLM 选择工具 | 状态机执行计划 |
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
  
  // 回调函数
  onProgress: async (task, progress) => { /* 发送进度 */ },
  onComplete: async (task) => { /* 发送完成通知 */ },
  onApprovalRequest: async (task, request) => { /* 发送确认请求 */ },
});
```

## 注意事项

1. **计划生成需要 LLM 调用** - 首次提交任务时需要等待计划生成（约 5-15 秒）
2. **高风险操作需确认** - 涉及文件写入、删除等操作会暂停等待确认
3. **支持回滚** - 只有带备份的 write 操作支持回滚，shell 命令不可回滚
4. **超时处理** - 单步和整体任务都有超时限制

## 故障排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 计划生成失败 | LLM 输出格式不正确 | 简化任务描述，更明确具体 |
| 步骤执行失败 | 文件不存在或权限不足 | 检查路径和权限 |
| 确认超时 | 用户未及时响应 | 重新提交任务 |
| 回滚失败 | 备份文件丢失 | 手动恢复或使用 git |
