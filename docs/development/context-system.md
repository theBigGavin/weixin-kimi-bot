# 上下文感知架构文档

## 概述

本文档描述 weixin-kimi-bot 的上下文感知架构，该架构实现了**可靠的可自我迭代的智能助手**目标，确保 Agent 能够跟踪和理解用户上下文。

## 背景

### 解决的问题

在传统架构中，Agent 面临上下文丢失问题：

```
用户: 我们做一个A股投资工具
Agent: [提供3个方案]
用户: 按方案1落实
Agent: ??? (不知道方案1是什么)
```

### 新架构的优势

```
用户: 我们做一个A股投资工具
      ↓ 状态: IDLE → EXPLORING → PROPOSING
Agent: [opt_1]方案1...[opt_2]方案2...[opt_3]方案3...
      ↓ 结构化存储到 activeOptions
用户: 按方案1落实
      ↓ 指代消解: "方案1" → opt_1 (置信度95%)
Agent: "好的，选择方案1。开始制定计划..."
      ↓ 状态转移: PROPOSING → PLANNING
```

## 架构设计

### 四层架构

```
┌─────────────────────────────────────────────────────────────┐
│                     用户交互层                                │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ 对话状态机   │  │ 意图解析器   │  │    指代消解引擎      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                    上下文管理层                               │
├──────────┬──────────┬──────────┬──────────┬────────────────┤
│ 会话上下文 │ 任务上下文 │ 项目上下文 │ 用户画像  │   知识图谱      │
│(短期记忆) │(中期记忆) │(长期记忆) │(持久记忆) │  (话题关联)     │
└──────────┴──────────┴──────────┴──────────┴────────────────┘
```

### 核心组件

| 组件 | 文件 | 功能 |
|------|------|------|
| 类型定义 | `src/context/types.ts` | 状态、意图、上下文等类型 |
| 会话管理 | `src/context/session-context.ts` | 上下文CRUD、选项管理 |
| 状态机 | `src/context/state-machine.ts` | 状态流转规则 |
| 指代消解 | `src/context/reference-resolver.ts` | 解析"方案1"、"这个"等 |
| 意图识别 | `src/context/intent-resolver.ts` | 识别15种意图类型 |
| 输出解析 | `src/context/output-parser.ts` | 提取结构化内容 |
| 持久化 | `src/context/persistence.ts` | 存储和加载 |
| Prompt构建 | `src/prompt/builder.ts` | 上下文感知Prompt |

## 对话状态

```typescript
enum ConversationState {
  IDLE        // 空闲，等待新任务
  EXPLORING   // 探索需求
  CLARIFYING  // 澄清疑问
  PROPOSING   // 提供方案
  COMPARING   // 对比选项
  CONFIRMING  // 等待确认
  REFINING    // 调整优化
  PLANNING    // 制定计划
  EXECUTING   // 执行中
  REVIEWING   // 审查结果
  COMPLETED   // 已完成
}
```

### 状态流转示例

```
IDLE ──(EXECUTE)──> PLANNING ──(CONFIRM)──> EXECUTING ──(COMPLETE)──> REVIEWING
  │                    │                          │                        │
  │                    │                          │                        │
  └──(ASK_INFO)──> EXPLORING ──(EXECUTE)─────────┘                        │
                          │                                               │
                          └──(PROVIDE_OPTIONS)──> PROPOSING ──(SELECT)────┘
```

## 意图类型

| 类型 | 示例 |
|------|------|
| SELECT_OPTION | "选方案1"、"用A方案"、"就这个" |
| CONFIRM | "确认"、"好的"、"可以" |
| REJECT | "不行"、"不对"、"取消" |
| MODIFY | "修改一下"、"换成B" |
| EXECUTE | "开始吧"、"执行" |
| PAUSE | "暂停"、"等一下" |
| RESUME | "继续"、"接着做" |
| CANCEL | "取消"、"放弃" |
| ASK_INFO | "什么是..."、"怎么做" |
| REFERENCE | "这个"、"刚才的" |

## 指代消解

### 支持的模式

| 模式 | 示例 | 解析结果 |
|------|------|----------|
| 数字索引 | "方案1"、"第2个"、"第三个" | option_index |
| 字母标签 | "方案A"、"选B" | option_label |
| 指代词 | "这个方案"、"那个" | option_anaphora |
| 时间指代 | "刚才的"、"之前的" | temporal_anaphora |
| 任务引用 | "刚才的任务"、"继续" | task_reference |
| 话题引用 | "回到话题"、"继续说" | topic_reference |

## 使用方式

### 环境变量控制

```bash
# 启用新架构（默认）
ENABLE_CONTEXT_AWARE=true npm start

# 使用传统模式
ENABLE_CONTEXT_AWARE=false npm start
```

### 新命令

```
/context status    - 查看上下文状态
/context options   - 查看活跃选项
/context history   - 查看消息历史
```

### 增强的 /session status

```
/session status

📊 Session 状态（上下文感知架构）

Agent: agent_xxx
用户: user_xxx
工作目录: /path/to/workspace

对话统计:
- 轮次: 10
- 当前状态: 提供方案
- 活跃选项: 3
- 消息历史: 10
- 待决策: 请选择一个方案
```

## 技术细节

### 存储结构

```
~/.weixin-kimi-bot/agents/{agentId}/contexts/
  └── {base64(userId)}.json
```

### 序列化格式

```json
{
  "id": "ctx_xxx",
  "userId": "user_xxx",
  "agentId": "agent_xxx",
  "state": {
    "current": "proposing",
    "previous": "exploring",
    "topic": "A股投资工具",
    "pendingDecision": {
      "type": "select_option",
      "options": ["opt_1", "opt_2", "opt_3"]
    }
  },
  "messages": [...],
  "activeOptions": {
    "opt_1": {"id": "opt_1", "label": "方案1..."},
    "opt_2": {...},
    "opt_3": {...}
  },
  "metadata": {
    "totalMessages": 10,
    "version": "1.0"
  }
}
```

### Prompt注入示例

```
## 当前对话状态
- 阶段: 提供方案
- 主题: A股投资工具
- 期望: 用户选择方案
- 等待决策: 请从提供的方案中选择一个
- 可选项: opt_1, opt_2, opt_3

## 当前可选项
用户需要从以下选项中选择：

1. [opt_1] 方案1：技术分析工具
   基于K线、均线等技术指标...
   （用户可以说"方案一"、"选第1个"、"选A"来引用此选项）

2. [opt_2] 方案2：量化交易平台
   支持策略回测、自动交易...

3. [opt_3] 方案3：智能选股助手
   AI驱动的股票筛选...

## 近期对话
[10:00] 用户: 我们做一个A股投资工具
[10:01] AI: 我为你准备了3个方案...

## 用户消息
选择方案：方案1：技术分析工具
（原始输入: "按方案1落实"，经指代消解引擎解析）
```

## 测试

```bash
# 运行单元测试
npm test

# 运行特定测试
npm test -- tests/context/state-machine.test.ts
npm test -- tests/context/reference-resolver.test.ts
npm test -- tests/context/intent-resolver.test.ts
npm test -- tests/context/output-parser.test.ts
npm test -- tests/integration/context-flow.test.ts
```

## 迁移指南

### 从传统模式迁移

1. 启用新架构：`ENABLE_CONTEXT_AWARE=true`
2. 观察日志中的 `[Context]` 输出
3. 测试关键场景：
   - 提供多个选项后选择
   - 使用指代词引用之前内容
   - 多轮对话状态保持

### 回滚

如果遇到问题，立即切换回传统模式：

```bash
ENABLE_CONTEXT_AWARE=false npm start
```

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2026-03-29 | 初始版本，四层上下文架构 |

## 未来规划

- 对话图谱可视化
- 多Agent上下文共享
- 基于向量的语义搜索
- 自动话题聚类
