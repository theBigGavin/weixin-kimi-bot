# 快速开始

本指南帮助你在 5 分钟内启动并运行 weixin-kimi-bot。

## 前置条件

- 已完成 [安装指南](./installation.md)
- Kimi CLI 已登录
- 微信已扫码登录

## 启动 Bot

### 方式一：前台运行（开发调试）

```bash
npm start
```

看到以下输出表示启动成功：

```
=== 微信 Kimi Bot 已启动 ===
Bot名称: 程序员助手
Agent ID: agent_xxx
工作目录: /home/user/.weixin-kimi-bot/agents/agent_xxx/workspace
等待消息中...
```

按 `Ctrl+C` 停止。

### 方式二：后台服务（生产环境）

```bash
# 启动服务
npm run service:start

# 查看状态
npm run service:status

# 查看日志
npm run service:logs

# 停止服务
npm run service:stop
```

## 测试 Bot

在你的微信上给 Bot 发消息：

1. **基础测试**
   ```
   你好
   ```
   Bot 应该回复问候语。

2. **命令测试**
   ```
   /help
   ```
   Bot 应该列出所有可用命令。

3. **代码测试**
   ```
   帮我写一个计算斐波那契数列的函数
   ```
   Bot 应该生成代码并解释。

## 基础命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助信息 |
| `/status` | 查看 Bot 状态 |
| `/reset` | 重置对话上下文 |
| `/template` | 查看/切换能力模板 |
| `/memory` | 查看长期记忆 |

## 创建多个 Agent

你可以为不同场景创建不同的 Agent：

```bash
# 运行登录创建新 Agent
npm run login

# 查看所有 Agent
npm run agent:list

# 切换当前 Agent
npm run agent:switch
```

## 设置定时任务

让 Bot 自动执行某些任务：

```
/schedule add "喝水提醒" "0 9,14 * * *" "提醒主人喝水"
```

这会创建每天 9:00 和 14:00 的喝水提醒。

## 查看工作目录

Bot 会在工作目录中创建和修改文件：

```bash
# 查看当前 Agent 的工作目录
npm run agent:config

# 或直接查看
ls ~/.weixin-kimi-bot/agents/
```

## 下一步

- [配置说明](./configuration.md) - 了解详细配置
- [用户指南](../user-guide/agents.md) - 深入了解多 Agent 系统
- [命令参考](../user-guide/commands.md) - 查看所有命令

## 常见问题

### Q: 启动后没有响应？

检查日志：
```bash
# 前台模式
npm start

# 或后台模式
npm run service:logs
```

### Q: 如何重启 Bot？

```bash
# 前台模式：Ctrl+C 后再 npm start

# 后台模式
npm run service:restart
```

### Q: 如何更新到最新版本？

```bash
git pull
npm install
npm run build
npm run service:restart
```
