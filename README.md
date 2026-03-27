# weixin-kimi-bot

通过微信消息远程操控 Kimi Code CLI —— 基于腾讯 iLink 协议的微信 AI Bot。

> 🎉 **全新多Agent版本**：支持多个微信账号，每个账号拥有独立的AI助手、工作目录和长期记忆。
> 
> 如果你从旧版本升级，请查看 [迁移指南](./MIGRATION.md)。

```
微信用户 ──► iLink 协议 ──► weixin-kimi-bot ──► Kimi CLI ──► 本地文件系统
   ◄─────────────────────────────────────────────────────────────────────┘
```

在地铁上用微信让 Kimi 帮你改代码、查日志、跑测试。

## 前置条件

| 依赖 | 最低版本 | 说明 |
|------|---------|------|
| **Node.js** | 18+ | 运行环境 |
| **Kimi CLI** | 已安装并配置 | 通过子进程调用 kimi 命令 |
| **Moonshot API Key** | — | Kimi CLI 配置时已设置 |
| **微信** | 手机端 | 扫码登录用 |

### 安装 Node.js

```bash
# macOS (Homebrew)
brew install node

# 或使用 nvm
nvm install 18
```

### 安装 Kimi CLI

```bash
# 使用 uv 安装（推荐）
uv tool install kimi-cli

# 或使用 pip
pip install kimi-cli
```

> **注意**：首次运行 `npm start` 时，如果 Kimi CLI 未登录，会自动引导你完成登录流程。

## 安装

```bash
git clone https://github.com/yourusername/weixin-kimi-bot.git
cd weixin-kimi-bot
npm install
```

### 依赖说明

**运行时依赖：**

| 包名 | 用途 |
|------|------|
| `qrcode-terminal` | 在终端显示微信登录二维码 |

**开发依赖：**

| 包名 | 用途 |
|------|------|
| `typescript` | TypeScript 编译器 |
| `tsx` | TypeScript 即时执行（免编译运行 .ts） |
| `@types/node` | Node.js 类型声明 |

## 快速开始

### 1. 创建你的第一个 AI Agent

```bash
npm run login
```

流程：
1. 终端显示二维码，用微信扫码
2. 选择 **能力模板**（程序员、写作助手、Vlog创作者等）
3. 设置 Agent 名称和工作目录
4. 完成创建

每个微信账号对应一个独立的 AI Agent，拥有：
- 独立的 **工作目录**
- 独立的 **长期记忆**
- 专属的 **能力设定**

### 2. 启动 Agent

```bash
# 启动所有 Agent
npm start

# 或启动指定 Agent
ACTIVE_AGENT_ID=agent_xxx npm start
```

首次启动时会显示 Agent 的欢迎语。

```bash
npm start
```

首次启动时如果 Kimi CLI 未登录，会引导你完成登录：

```
=== 微信 Kimi Bot 启动 ===

⚠️  Kimi CLI 未登录
需要登录后才能使用 Bot。

💡 提示: 如果下方没有显示登录链接，请按 Ctrl+C 退出
   然后手动运行: kimi login

🔐 正在启动 Kimi 登录...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
如果下方没有显示链接，请手动运行: kimi login
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Please visit the following URL to finish authorization.
Verification URL: https://www.kimi.com/code/authorize_device?user_code=XXXX-XXXX

[浏览器自动打开...]

✅ 登录验证成功！

账号: df412faf283b@im.bot
模型: kimi-code/kimi-for-coding
最大轮次: 10
工作目录: /Users/you/Github/my-project
等待消息中...
```

现在在微信上给 Bot 发消息就能收到 Kimi 的回复了。`Ctrl+C` 停止。

### 3. 微信命令

在与 Bot 对话时可以使用以下命令：

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助信息 |
| `/status` | 查看当前 Agent 状态 |
| `/reset` | 重置对话上下文（重新注入系统提示词） |
| `/template` | 查看/切换能力模板 |
| `/memory` | 查看长期记忆 |
| `/prompt` | 预览当前系统提示词 |
| `/task` | 定时任务管理 |
| `/ver` | 查看 Bot 版本信息 |

**使用示例：**

```
/plan 我要重构这个项目的代码结构，先制定详细计划
```

> **⚠️ 注意**：Kimi CLI 的内置 `/` 命令（如 `/tools`, `/cost`, `/compact` 等）只在交互式 TUI 模式下工作，微信 Bot 模式（API 模式）暂不支持。如需使用这些命令，请直接在终端运行 `kimi` 进入交互模式。

> **💡 提示**：如果要在后台运行（SSH 断开后继续服务），请先完成本节的前台启动和登录，然后查看【后台服务运行】章节。

### 4. 后台服务运行（推荐）

如果想让 Bot 在后台运行，即使 SSH 断开也能继续服务：

#### 首次设置流程

后台服务无法交互式登录，所以需要**先在前台完成 Kimi 登录**：

```bash
# 第 1 步：前台启动，完成 Kimi 登录（只需一次）
npm start
# 按提示完成浏览器登录，看到 "等待消息中..." 后按 Ctrl+C 退出

# 第 2 步：启动后台服务
npm run service:start
```

#### 服务管理命令

```bash
# 查看状态
npm run service:status

# 查看日志
npm run service:logs

# 重启
npm run service:restart

# 停止
npm run service:stop

# 删除服务
npm run service:delete
```

#### 首次安装 PM2

```bash
npm install -g pm2

# 配置 PM2 开机自启（可选）
pm2 startup
pm2 save
```

## 项目结构

```
weixin-kimi-bot/
├── src/
│   ├── index.ts             # 主入口：多Agent消息处理
│   ├── login.ts             # QR 扫码登录 + Agent创建
│   ├── config.ts            # 配置管理 CLI
│   ├── store.ts             # 状态持久化
│   ├── ilink/
│   │   ├── types.ts         # iLink 协议类型
│   │   ├── api.ts           # HTTP API 封装
│   │   └── auth.ts          # QR 登录流程
│   ├── kimi/
│   │   └── handler.ts       # Kimi CLI 集成
│   ├── agent/               # 多Agent系统
│   │   ├── types.ts         # Agent类型定义
│   │   ├── manager.ts       # Agent管理器
│   │   ├── prompt-builder.ts # 提示词构建
│   │   └── cli.ts           # Agent管理CLI
│   ├── templates/           # 能力模板
│   │   └── definitions.ts   # 预置角色模板
│   ├── memory/              # 长期记忆系统
│   │   └── manager.ts       # 记忆管理器
│   ├── scheduler.ts         # 定时任务调度器
│   ├── notifications/       # 通知通道
│   │   ├── types.ts
│   │   ├── manager.ts
│   │   ├── channels/
│   │   │   ├── email.ts
│   │   │   └── telegram.ts
│   │   └── cli.ts
│   └── tasks/
│       └── ai-news.ts
├── package.json
├── tsconfig.json
├── AGENTS.md                # 多Agent系统文档
├── SCHEDULER.md             # 定时任务文档
└── NOTIFICATIONS.md         # 通知通道文档
```

## 本地数据

所有数据存储在 `~/.weixin-kimi-bot/`，不会上传到任何服务器：

```
~/.weixin-kimi-bot/
├── agents/                      # 每个Agent的独立数据（完全隔离）
│   ├── agent_001/
│   │   ├── config.json         # Agent配置
│   │   ├── memory.json         # 长期记忆
│   │   ├── credentials.json    # 微信登录凭证
│   │   ├── sync-buf.txt        # 消息同步游标
│   │   ├── context-tokens.json # 会话上下文
│   │   ├── scheduled-tasks.json# 定时任务
│   │   └── workspace/          # 工作目录
│   └── agent_002/
│       └── ...
└── templates/                   # 能力模板
```

每个Agent拥有**完全独立**的：
- 工作目录
- 长期记忆
- 定时任务
- 消息同步游标
- 微信会话上下文

数据隔离确保不同Agent之间互不干扰。

删除该目录即可完全清除所有数据。

## 故障排除

### 登录问题

**Q: npm start 时没有显示浏览器链接**

如果登录流程没有自动显示 URL，请手动运行：

```bash
kimi login
```

然后复制终端显示的链接到浏览器完成授权。登录成功后重新运行 `npm start`。

**Q: 提示 "Kimi CLI 未登录" 但已经登录过**

可能是登录已过期，尝试重新登录：

```bash
kimi login
npm start
```

**Q: 后台服务启动失败**

后台服务（PM2）无法交互式登录，请先在前台完成登录：

```bash
# 前台登录（只需一次）
npm start
# 完成登录后按 Ctrl+C 退出

# 然后启动后台服务
npm run service:start
```

## 定时任务

Bot 支持通过自然语言或 crontab 表达式创建定时任务：

### 自然语言创建（推荐）

```
/task create 每天早上9点搜集AI资讯
/task create 每工作日早上8点半提醒我打卡
```

机器人会解析你的描述，请你确认后创建任务。

### 其他命令

```
/task example              # 添加示例任务
/task list                 # 查看所有任务
/task run <任务ID>          # 立即执行任务
```

详细文档：[SCHEDULER.md](./SCHEDULER.md)

## 通知通道

支持通过多种通道接收定时任务通知：

```bash
# 添加邮件通知
npm run notify -- --add-email

# 添加 Telegram 通知
npm run notify -- --add-telegram

# 查看所有通道
npm run notify

# 测试通道
npm run notify -- --test-all
```

任务执行结果会同时发送到微信和所有启用的通知通道。

详细文档：[NOTIFICATIONS.md](./NOTIFICATIONS.md)

## 注意事项

- **iLink 协议是实验性的** — 腾讯未正式公开文档，API 可能随时变更，不建议用于生产环境
- **Token 会过期** — 出现 session 过期提示时重新运行 `npm run login`
- **Kimi CLI 需要配置** — 确保 `kimi` 命令可用且已配置 API Key
- **定时任务需要上下文** — 添加定时任务前需要先向机器人发送一条消息

## 与 weixin-claude-bot 的区别

| 特性 | weixin-claude-bot | weixin-kimi-bot |
|------|-------------------|-----------------|
| 后端 | Claude Code SDK | Kimi Code CLI |
| 安装方式 | npm 包 | uv/pip 安装 |
| 权限模式 | 多种模式可选 | Kimi CLI 原生控制 |
| 模型选择 | Claude 系列 | Kimi 系列 |
| 规划模式 | 通过模型别名 | 原生 `--plan` 支持 |

## 更新日志

### v0.2.3 (2025-03-28)
- 改进多 Agent 数据隔离机制
- 新增 `/ver` 命令查看版本信息
- 优化定时任务调度器

### v0.2.0
- 全新多 Agent 架构
- 支持多个微信账号独立运行
- 每个 Agent 拥有独立工作目录和记忆

查看完整更新历史：[MIGRATION.md](./MIGRATION.md)

## License

MIT
