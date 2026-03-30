# 术语表

本文档解释 weixin-kimi-bot 项目中使用的专业术语。

## A

### Agent（智能体）

一个完整的 AI 助手实例，包含独立身份、工作目录、能力模板、长期记忆和专属配置。

### Active Agent

当前正在运行的 Agent。通过 `ACTIVE_AGENT_ID` 环境变量指定。

## C

### Context（上下文）

对话的历史记录和状态信息，用于保持对话的连续性。

### Context Token
n用于标识和恢复特定对话上下文的令牌。

### Cron

一种时间表达式格式，用于定义定时任务的执行时间。例如：`0 9 * * *` 表示每天 9:00。

## D

### Deploy（部署）

将代码更新发布到生产环境的过程。包括版本升级、构建、测试和服务重启。

## F

### FlowTask（可靠任务流）

支持暂停、恢复和持久化的任务执行系统。适用于需要长时间运行且不能失败的任务。

## H

### Handler（处理器）

处理特定类型消息或命令的模块。例如：command-handler、message-handler。

## I

### iLink

腾讯微信 iLink 协议，用于接入微信消息服务。

## K

### Kimi CLI
nKimi Code CLI，基于 AI 的代码助手命令行工具，提供代码生成、重构、分析等能力。

## L

### LongTask（耗时任务）

运行时间较长的任务，通过独立进程执行，支持进度报告和状态查询。

## M

### Memory（记忆）

Bot 从对话中提取并长期保存的重要信息，如用户偏好、项目状态等。

### Migration（迁移）

将数据从旧版本格式转换为新版本格式的过程。

## N

### Notification（通知）

通过邮件、微信、Webhook 等渠道发送的消息提醒。

### Notification Channel（通知通道）

通知的发送方式配置，如 SMTP 邮件、企业微信机器人等。

## P

### PM2

Node.js 进程管理器，用于后台服务管理、自动重启和日志管理。

### Prompt（提示词）

发送给 AI 模型的输入文本，用于指导 AI 生成期望的输出。

## R

### Router（路由器）

决定消息应该由哪个处理器处理的组件。

## S

### Scheduler（调度器）

管理定时任务的组件，基于 Cron 表达式执行任务。

### Session（会话）

一次完整的对话过程，包含多轮交互。

### Slash Command（斜杠命令）

以 `/` 开头的命令，如 `/help`、`/status`。

## T

### TDD（测试驱动开发）

Test-Driven Development，先写测试再实现功能的开发模式。

### Template（模板）

预定义的 Agent 角色配置，如程序员助手、写作助手等。

### Turn（轮次）

对话中的一问一答算作一轮。

## W

### Workspace（工作空间）

Agent 的文件操作目录，每个 Agent 有独立的工作空间。

---

## 缩写对照

| 缩写 | 全称 | 说明 |
|------|------|------|
| API | Application Programming Interface | 应用程序接口 |
| CLI | Command Line Interface | 命令行接口 |
| CI/CD | Continuous Integration/Deployment | 持续集成/部署 |
| CRUD | Create, Read, Update, Delete | 增删改查操作 |
| JSON | JavaScript Object Notation | 数据交换格式 |
| SMTP | Simple Mail Transfer Protocol | 邮件传输协议 |
| URL | Uniform Resource Locator | 统一资源定位符 |
| UUID | Universally Unique Identifier | 通用唯一标识符 |
