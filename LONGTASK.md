# LongTask 耗时任务管理

LongTask 是 weixin-kimi-bot 的后台任务执行系统，用于处理需要较长时间完成的复杂任务，同时提供实时进度跟踪。

## 核心特性

- **后台执行** - 任务在独立进程中运行，不阻塞正常对话
- **实时进度** - 基于 Kimi CLI 的 `stream-json` 输出实时解析工具调用
- **进度预测** - 使用规则引擎预测工具调用序列，更准确地估算进度
- **并发控制** - 最多同时运行 4 个任务，超出部分自动排队
- **持久化** - 任务状态实时保存到磁盘，支持崩溃恢复
- **历史记录** - 自动保存完成的任务历史，支持查询和回顾

## 架构设计

```
用户提交任务
    ↓
[ToolPredictor] 预测工具调用序列
    ↓
[LongTaskManager] 创建任务快照
    ↓
[Background Process] 启动 Kimi CLI
    ↓
[stream-json] 实时输出工具调用
    ↓
[ProgressParser] 解析进度信息
    ↓
[ProgressReporter] 每 30 秒推送进度
    ↓
任务完成 → 保存历史记录
```

## 进度计算原理

### 工具调用预测

基于用户 prompt 使用规则引擎快速预测可能调用的工具序列：

```typescript
// 示例：重构类任务
const prediction = {
  predictedTools: [
    { name: "Glob", reason: "定位相关文件" },
    { name: "ReadFile", reason: "读取现有代码" },
    { name: "Grep", reason: "搜索引用" },
    { name: "StrReplaceFile", reason: "修改代码" },
    { name: "Shell", reason: "运行测试" },
  ],
  confidence: 0.85,
};
```

### 实时进度解析

从 Kimi CLI 的 `--print --output-format stream-json` 输出中解析：

```typescript
// JSON 流格式示例
{"role": "assistant", "tool_calls": [{"type": "function", "function": {"name": "ReadFile", ...}}]}
{"role": "assistant", "content": [{"type": "think", "think": "..."}]}
{"role": "assistant", "content": [{"type": "text", "text": "..."}]}
```

进度计算公式：
```
percent = min(95, (completedSteps / predictedTotal) * 100)
```

- 当实际步骤超过预测时，动态调整 `predictedTotal`
- 完成后跳转到 100%
- 上限 95% 直到真正完成

## 命令使用

### 提交任务

```
/longtask <任务描述>
```

示例：
```
/longtask 分析 src 目录下所有 TypeScript 文件，找出潜在的性能问题
```

### 查看任务列表

```
/longtask list
```

输出示例：
```
📋 耗时任务

*进行中的任务:*
🔄 `lt_1743241234567_abc12` 45% - 修改文件
   排队位置: 前面还有 2 个任务

*最近历史 (最近10条):*
✅ `lt_1743240987654_def34` 100% - 已完成
❌ `lt_1743240765432_ghi56` 30% - 执行失败
```

### 查看任务进度

```
/longtask status <任务ID>
```

输出示例：
```
⏳ 耗时任务进度 `lt_1743241234567_abc12`

██████████ 45%
步骤: 修改文件
文件: `src/utils/helper.ts`
详情: 已完成 5/10 步 | 修改代码逻辑

_任务: 重构 src/utils 目录下的所有工具函数_
```

### 取消任务

```
/longtask cancel <任务ID>
```

## 配置选项

在 `config.json` 中可配置：

```json
{
  "longtask": {
    "maxConcurrency": 4,
    "reportIntervalMs": 30000,
    "persistence": {
      "strategy": "jsonl",
      "snapshotIntervalMs": 30000,
      "enableWAL": true,
      "historyRetentionDays": 30
    }
  }
}
```

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `maxConcurrency` | 最大并发任务数 | 4 |
| `reportIntervalMs` | 进度报告间隔（毫秒） | 30000 |
| `persistence.strategy` | 持久化策略 | jsonl |
| `persistence.snapshotIntervalMs` | 快照保存间隔 | 30000 |
| `persistence.enableWAL` | 启用 WAL 日志 | true |
| `persistence.historyRetentionDays` | 历史记录保留天数 | 30 |

## 数据存储

每个 Agent 的耗时任务数据存储在：

```
~/.weixin-kimi-bot/agents/{agent_id}/longtask/
├── snapshots/           # 任务状态快照（JSON）
│   ├── lt_xxx.json
│   └── lt_yyy.json
├── history.jsonl        # 历史记录（JSON Lines）
└── wal/                 # WAL 日志
    └── ...
```

### 快照文件格式

```json
{
  "id": "lt_1743241234567_abc12",
  "agentId": "agent_xxx",
  "userId": "user@wx",
  "chatId": "user@wx",
  "contextToken": "token_xxx",
  "prompt": "分析项目代码",
  "status": "running",
  "createdAt": 1743241234567,
  "startedAt": 1743241235000,
  "cwd": "/home/user/project",
  "model": "kimi-code",
  "maxTurns": 10,
  "progressLogs": [...],
  "childPid": 12345,
  "snapshotVersion": 5,
  "lastUpdatedAt": 1743241534567,
  "toolPrediction": {
    "predictedTools": [...],
    "confidence": 0.85
  }
}
```

## 崩溃恢复

系统启动时会自动检查未完成的任务：

1. 加载所有任务快照
2. 检查进程是否仍在运行
3. 如果进程已死，标记为失败
4. 如果是排队中的任务，恢复到队列

恢复报告示例：
```
📋 任务恢复报告

已恢复 2 个任务:
• lt_xxx - 重新排队 (等待中)
• lt_yyy - 标记为失败 (进程丢失)
```

## 与 FlowTask 的区别

| 特性 | LongTask | FlowTask |
|------|----------|----------|
| 执行方式 | 单个子进程 | 多阶段工作流 |
| 计划制定 | 自动预测 | AI 生成详细计划 |
| 中断恢复 | 快照恢复 | 阶段重试 |
| 审批点 | 无 | 有 |
| 适用场景 | 连续执行的任务 | 需要分阶段确认的任务 |

## 最佳实践

### 何时使用 LongTask

✅ **适合使用：**
- 代码分析和搜索
- 批量文件处理
- 长时间构建/测试
- 项目级重构

❌ **不适合使用：**
- 需要频繁交互的任务
- 需要分阶段确认的任务（用 FlowTask）
- 几秒钟就能完成的简单任务

### 优化任务描述

为了获得更准确的进度预测，在描述中包含关键词：

| 关键词 | 预测的工具序列 |
|--------|---------------|
| "重构" | Glob → ReadFile → Grep → StrReplaceFile → Shell |
| "分析项目" | Glob → ReadFile → Grep → Agent |
| "搜索" | Grep → Glob → ReadFile |
| "创建文件" | Glob → ReadFile → WriteFile → Shell |
| "测试" | Shell → ReadFile → StrReplaceFile |

## 故障排除

### 进度始终显示 0%

检查 Kimi CLI 版本是否支持 `stream-json` 格式：
```bash
kimi --version
```

确保使用的是较新版本（支持 `--output-format stream-json`）。

### 任务队列卡住

检查是否有僵尸进程：
```bash
ps aux | grep "kimi --print"
```

手动杀死僵尸进程后，系统会自动恢复。

### 历史记录丢失

检查磁盘空间：
```bash
df -h ~/.weixin-kimi-bot
```

检查文件权限：
```bash
ls -la ~/.weixin-kimi-bot/agents/{agent_id}/longtask/
```

## API 参考

### LongTaskManager

```typescript
// 获取管理器实例
const manager = await getLongTaskManager(agentId);

// 提交任务
const task = manager.submit({
  agentId: "agent_xxx",
  userId: "user@wx",
  chatId: "user@wx",
  contextToken: "token_xxx",
  prompt: "任务描述",
  cwd: "/path/to/workspace",
  model: "kimi-code",
  systemPrompt: "系统提示词",
  maxTurns: 10,
});

// 取消任务
await manager.cancel(taskId);

// 获取任务
const task = manager.getTask(taskId);

// 查询历史
const history = await manager.queryHistory({ userId }, 10);
```

### 进度回调

```typescript
const manager = await getLongTaskManager(agentId, {
  onProgress: async (task, progress) => {
    // 每 30 秒触发
    console.log(`${task.id}: ${progress.percent}%`);
  },
  onComplete: async (task) => {
    // 任务完成时触发
    console.log(`${task.id} completed`);
  },
  onCancel: async (task) => {
    // 任务取消时触发
    console.log(`${task.id} cancelled`);
  },
});
```

## 更新日志

### v0.6.5
- 重构进度解析器，使用 `stream-json` 格式
- 新增工具调用预测功能
- 优化进度计算算法

### v0.6.0
- 初始版本发布
- 支持后台任务执行
- 基础进度跟踪
- 崩溃恢复机制
