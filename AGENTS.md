# 多Agent系统使用指南

微信 Kimi Bot 支持多Agent架构，每个微信账号可以绑定独立的AI助手，拥有不同的能力、工作目录和记忆。

## 核心概念

### Agent（智能体）
一个Agent代表一个完整的AI助手实例，包含：
- **独立身份**：绑定的微信账号
- **工作目录**：独立的文件系统空间
- **能力模板**：角色设定和行为模式
- **长期记忆**：个性化的知识库
- **专属配置**：模型参数、功能开关

### 能力模板
预置的专业角色模板：

| 模板 | 图标 | 说明 |
|------|------|------|
| 程序员助手 | 💻 | 代码编写、调试、架构设计 |
| 写作助手 | ✍️ | 文案创作、编辑润色 |
| Vlog创作者 | 🎬 | 脚本策划、分镜设计 |
| 数字货币投资者 | ₿ | 市场分析、投资策略 |
| A股操盘手 | 📈 | 政策解读、板块分析 |
| 通用助手 | 🤖 | 日常问答、学习辅导 |

## 快速开始

### 1. 创建第一个Agent

```bash
npm run login
```

流程：
1. 扫描二维码登录微信
2. 选择能力模板（如：程序员助手）
3. 设置Agent名称
4. 选择/创建工作目录
5. 完成创建

### 2. 启动Agent

```bash
# 启动默认Agent（如果有多个，启动所有）
npm start

# 启动指定Agent
ACTIVE_AGENT_ID=agent_xxx npm start
```

### 3. 创建更多Agent

再次运行 `npm run login`，用不同的微信扫码即可创建新Agent。

每个Agent完全隔离：
- **不同的工作目录** - 每个Agent有自己的 workspace，默认在 `~/.weixin-kimi-bot/agents/{id}/workspace/`
- **不同的长期记忆** - 个性化记忆不共享
- **不同的能力设定** - 各自的能力模板和配置

**安全设计**：新版本移除了全局 `cwd` 配置，每个 Agent 默认使用隔离的工作目录，避免文件冲突和数据泄露。

## Agent管理命令

```bash
# 列出所有Agent
npm run agent:list

# 交互式选择Agent
npm run agent:switch

# 查看Agent配置
npm run agent:config [agent-id]

# 切换能力模板
npm run agent:template [agent-id]

# 查看长期记忆
npm run agent:memory [agent-id]

# 删除Agent
npm run agent:delete <agent-id>
```

## 工作目录结构

> ⚠️ **安全提示**：每个 Agent 拥有**完全独立**的工作目录，不再共享全局 `cwd`。
> 这避免了不同 Agent 之间的文件冲突和数据泄露风险。

每个Agent的数据目录：

```
~/.weixin-kimi-bot/
├── agents/                          # 所有Agent数据
│   ├── agent_001_abcd1234/         # Agent 1（完全隔离）
│   │   ├── config.json             # Agent专属配置
│   │   ├── memory.json             # 长期记忆
│   │   ├── credentials.json        # 微信登录凭证
│   │   ├── sync-buf.txt            # 消息同步游标（独立）
│   │   ├── context-tokens.json     # 微信上下文令牌（独立）
│   │   ├── scheduled-tasks.json    # 定时任务（独立）
│   │   └── workspace/              # 工作目录
│   │       ├── README.md
│   │       └── ...（项目文件）
│   │
│   └── agent_002_efgh5678/         # Agent 2（完全隔离）
│       └── ...（相同结构）
│
└── templates/                       # 能力模板（共享）
```

### 数据隔离说明

| 数据类型 | 存储位置 | 是否隔离 | 说明 |
|---------|---------|---------|------|
| Agent配置 | `agents/{id}/config.json` | ✅ 完全隔离 | 每个Agent独立配置 |
| 长期记忆 | `agents/{id}/memory.json` | ✅ 完全隔离 | 个性化记忆不共享 |
| 微信凭证 | `agents/{id}/credentials.json` | ✅ 完全隔离 | 绑定不同微信 |
| 同步游标 | `agents/{id}/sync-buf.txt` | ✅ 完全隔离 | 各Agent独立消息轮询 |
| 上下文令牌 | `agents/{id}/context-tokens.json` | ✅ 完全隔离 | 各Agent独立会话 |
| 定时任务 | `agents/{id}/scheduled-tasks.json` | ✅ 完全隔离 | 各Agent独立任务 |
| 工作目录 | `agents/{id}/workspace/` | ✅ 完全隔离 | 代码/文件互不干扰 |
| 能力模板 | `templates/` | 🔄 共享 | 所有Agent共用模板定义 |
| 通知通道 | `agents/{id}/notification-channels.json` | ✅ 完全隔离 | 各Agent独立配置，安全隔离 |

## 聊天命令

在与Bot对话时，可以使用以下命令：

```
/help          # 显示帮助
/status        # 查看Agent状态
/reset         # 重置对话上下文
/template      # 查看/切换能力模板
/memory        # 查看长期记忆
/prompt        # 预览系统提示词
/ver           # 查看Bot版本信息
```

## 长期记忆系统

### 自动记忆提取

Bot会自动从对话中提取重要信息：
- 用户身份信息（姓名、职业）
- 正在进行的项目
- 技术偏好和习惯
- 重要决策和事实

### 记忆在对话中的应用

每次对话时，相关记忆会自动注入系统提示词，使Bot能够：
- 记住你的姓名和角色
- 了解你正在进行的项目
- 适应你的偏好和习惯
- 避免重复询问已知信息

### 记忆查看和管理

```
/memory              # 查看所有记忆
```

## 提示词管理策略

### 智能注入

系统会在以下情况重新注入完整的系统提示词：
1. 对话开始时（首轮）
2. 对话轮次达到阈值的80%
3. 用户发送 `/reset` 命令
4. 检测到上下文可能丢失

### 提示词组成

完整的系统提示词包括：
1. **基础能力模板** - 角色设定和核心能力
2. **长期记忆** - 相关的事实和项目信息
3. **当前项目** - 活跃项目上下文
4. **用户自定义指令** - 额外的个性化设定
5. **工作目录** - 当前工作空间路径

### 查看当前提示词

```
/prompt
```

## 多Agent并行

你可以同时运行多个Agent：

```bash
# 终端1：启动Agent A
ACTIVE_AGENT_ID=agent_xxx npm start

# 终端2：启动Agent B
ACTIVE_AGENT_ID=agent_yyy npm start
```

每个Agent独立处理各自微信账号的消息。

## 配置存储

### Agent配置 (~/.weixin-kimi-bot/agents/{id}/config.json)

```json
{
  "id": "agent_1234567890",
  "name": "我的程序员助手",
  "wechat": {
    "accountId": "wxid_xxx",
    "nickname": "张三"
  },
  "workspace": {
    "path": "/home/user/.weixin-kimi-bot/agents/agent_123/workspace"
  },
  "ai": {
    "model": "kimi-code/kimi-for-coding",
    "templateId": "programmer",
    "maxTurns": 100
  },
  "memory": {
    "enabled": true,
    "autoExtract": true
  },
  "features": {
    "fileAccess": true,
    "webSearch": true,
    "scheduledTasks": true
  }
}
```

## 最佳实践

### 1. 为不同场景创建不同Agent

- **工作Agent**：程序员助手，绑定工作微信
- **个人Agent**：通用助手，绑定个人微信
- **创作Agent**：写作助手，用于内容创作

### 2. 定期查看和整理记忆

```bash
npm run agent:memory
```

### 3. 切换能力模板

随着需求变化，可以随时切换角色：

```bash
npm run agent:template
```

### 4. 使用 `/reset` 管理上下文

当感觉Bot"忘记"了重要设定时，发送 `/reset` 重新注入系统提示词。

## 故障排查

### Agent无法启动

1. 检查凭证是否存在
   ```bash
   ls ~/.weixin-kimi-bot/agents/agent_xxx/credentials.json
   ```

2. 重新登录
   ```bash
   npm run login
   ```

### 记忆没有更新

1. 检查记忆功能是否启用
   ```bash
   npm run agent:config
   ```

2. 确保对话足够长（至少5轮才会触发记忆提取）

### 提示词太长

如果系统提示词超过模型限制：
1. 减少自定义提示词
2. 定期清理不重要的记忆
3. 关闭某些功能

## 高级功能

### 自定义能力模板

编辑 `src/templates/definitions.ts` 添加新的角色模板。

### 程序化创建Agent

```typescript
import { agentManager } from "./agent/manager.js";

await agentManager.createAgent(wechatAccountId, {
  name: "自定义Agent",
  templateId: "programmer",
  workspacePath: "/custom/path",
});
```

### 导出/导入Agent

```bash
# 导出Agent配置
cp -r ~/.weixin-kimi-bot/agents/agent_xxx ./backup/

# 导入Agent配置
cp -r ./backup/agent_xxx ~/.weixin-kimi-bot/agents/
```
