# 配置说明

本文档详细介绍 weixin-kimi-bot 的各项配置选项。

## 配置文件位置

每个 Agent 有独立的配置文件：

```
~/.weixin-kimi-bot/agents/{agent_id}/config.json
```

## 配置项说明

### 基础配置

```json
{
  "id": "agent_1234567890",
  "name": "我的程序员助手",
  "wechat": {
    "accountId": "wxid_xxx",
    "nickname": "张三"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | Agent 唯一标识 |
| `name` | string | Agent 显示名称 |
| `wechat.accountId` | string | 绑定的微信账号 ID |
| `wechat.nickname` | string | 微信昵称 |

### AI 配置

```json
{
  "ai": {
    "model": "kimi-code/kimi-for-coding",
    "templateId": "programmer",
    "maxTurns": 100
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `model` | string | - | 使用的 AI 模型 |
| `templateId` | string | - | 能力模板 ID |
| `maxTurns` | number | 100 | 最大对话轮数 |

### 工作空间配置

```json
{
  "workspace": {
    "path": "/home/user/.weixin-kimi-bot/agents/agent_123/workspace"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `path` | string | Agent 工作目录路径 |

### 记忆系统配置

```json
{
  "memory": {
    "enabled": true,
    "autoExtract": true
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | true | 是否启用长期记忆 |
| `autoExtract` | boolean | true | 是否自动提取记忆 |

### 功能开关

```json
{
  "features": {
    "fileAccess": true,
    "webSearch": true,
    "scheduledTasks": true
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `fileAccess` | boolean | true | 允许文件操作 |
| `webSearch` | boolean | true | 允许网络搜索 |
| `scheduledTasks` | boolean | true | 允许定时任务 |

## 查看配置

### 命令行查看

```bash
# 查看当前 Agent 配置
npm run agent:config

# 查看指定 Agent 配置
npm run agent:config agent_xxx
```

### 编程方式查看

```typescript
import { agentManager } from "./agent/manager.js";

const agent = await agentManager.getAgent("agent_xxx");
console.log(agent.config);
```

## 修改配置

### 方式一：直接编辑文件

```bash
# 编辑配置文件
nano ~/.weixin-kimi-bot/agents/{agent_id}/config.json

# 重启服务生效
npm run service:restart
```

### 方式二：通过 CLI

```bash
# 使用配置向导
npm run config
```

## 环境变量

### 部署环境

| 变量 | 说明 | 可选值 |
|------|------|--------|
| `DEPLOY_ENV` | 部署环境 | `production`, `staging`, `development` |
| `NODE_ENV` | Node 环境 | `production`, `development` |

### 运行时变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `ACTIVE_AGENT_ID` | 指定启动的 Agent | `agent_xxx` |
| `LOG_LEVEL` | 日志级别 | `debug`, `info`, `warn`, `error` |

### PM2 环境配置

在 `ecosystem.config.cjs` 中配置：

```javascript
module.exports = {
  apps: [{
    name: "weixin-kimi-bot",
    env: {
      NODE_ENV: "production",
      DEPLOY_ENV: "production",
    },
    env_staging: {
      NODE_ENV: "production",
      DEPLOY_ENV: "staging",
    },
  }],
};
```

## 配置示例

### 开发环境配置

```json
{
  "id": "agent_dev_001",
  "name": "开发助手",
  "ai": {
    "model": "kimi-code/kimi-for-coding",
    "templateId": "programmer",
    "maxTurns": 50
  },
  "features": {
    "fileAccess": true,
    "webSearch": true,
    "scheduledTasks": false
  }
}
```

### 生产环境配置

```json
{
  "id": "agent_prod_001",
  "name": "生产助手",
  "ai": {
    "model": "kimi-code/kimi-for-coding",
    "templateId": "programmer",
    "maxTurns": 100
  },
  "features": {
    "fileAccess": true,
    "webSearch": true,
    "scheduledTasks": true
  },
  "memory": {
    "enabled": true,
    "autoExtract": true
  }
}
```

## 配置备份

```bash
# 备份所有配置
cp -r ~/.weixin-kimi-bot ./backup/

# 恢复配置
cp -r ./backup/agents ~/.weixin-kimi-bot/
```

## 配置验证

```bash
# 运行验证测试
npm test -- tests/agent/validation.test.ts
```

## 下一步

- [用户指南](../user-guide/agents.md) - 了解多 Agent 系统
- [部署文档](../deployment/environments.md) - 生产环境配置
