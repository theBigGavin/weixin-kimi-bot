# weixin-kimi-bot

通过微信消息远程操控 Kimi Code CLI —— 基于腾讯 iLink 协议的微信 AI Bot。

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

### 1. 扫码登录微信

```bash
npm run login
```

终端会显示二维码，用微信扫码并确认。登录凭证保存在 `~/.weixin-kimi-bot/credentials.json`。

### 2. 配置（可选）

```bash
# 查看当前配置
npm run config

# 切换模型
npm run config -- --model kimi-code/kimi-for-coding  # 默认编程模型
npm run config -- --model kimi-code/kimi-k2          # K2 模型

# 设置工作目录
npm run config -- --cwd ~/Github/my-project

# 设置最大 agentic 轮次
npm run config -- --max-turns 20

# 启用规划模式
npm run config -- --plan

# 设置系统提示
npm run config -- --system-prompt "用简洁的中文回复，不要使用 Markdown 格式"
```

配置保存在 `~/.weixin-kimi-bot/config.json`。

### 3. 启动 Bot

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

### 4. 微信命令

在微信聊天中可以使用以下 `/` 命令：

| 命令 | 说明 | 示例 |
|------|------|------|
| `/help` | 显示帮助信息 | `/help` |
| `/status` | 查看 Bot 状态 | `/status` |
| `/config` | 查看当前配置 | `/config` |
| `/plan` | 开启规划模式（执行复杂任务前先制定计划） | `/plan 重构项目代码` |
| `/yolo` | ⚠️ 开启自动确认模式（自动批准所有操作，谨慎使用） | `/yolo 自动修复所有 bug` |
| `/reset` | 重置对话上下文 | `/reset` |

**使用示例：**

```
/plan 我要重构这个项目的代码结构，先制定详细计划
```

> **💡 提示**：如果要在后台运行（SSH 断开后继续服务），请先完成本节的前台启动和登录，然后查看【后台服务运行】章节。

### 5. 后台服务运行（推荐）

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
│   ├── index.ts             # 主入口：long-poll 循环 + 消息分发
│   ├── login.ts             # QR 扫码登录
│   ├── config.ts            # 配置管理 CLI
│   ├── store.ts             # 状态持久化
│   ├── ilink/
│   │   ├── types.ts         # iLink 协议类型
│   │   ├── api.ts           # 5 个 HTTP API 封装
│   │   └── auth.ts          # QR 登录流程
│   └── kimi/
│       └── handler.ts       # Kimi CLI 集成
├── package.json
└── tsconfig.json
```

## 本地数据

所有数据存储在 `~/.weixin-kimi-bot/`，不会上传到任何服务器：

| 文件 | 内容 |
|------|------|
| `credentials.json` | 微信登录凭证（bot_token） |
| `config.json` | Bot 配置（模型、参数） |
| `sync-buf.txt` | 消息游标（断点续传） |
| `context-tokens.json` | 会话令牌（per-user） |

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

## 注意事项

- **iLink 协议是实验性的** — 腾讯未正式公开文档，API 可能随时变更，不建议用于生产环境
- **Token 会过期** — 出现 session 过期提示时重新运行 `npm run login`
- **Kimi CLI 需要配置** — 确保 `kimi` 命令可用且已配置 API Key

## 与 weixin-claude-bot 的区别

| 特性 | weixin-claude-bot | weixin-kimi-bot |
|------|-------------------|-----------------|
| 后端 | Claude Code SDK | Kimi Code CLI |
| 安装方式 | npm 包 | uv/pip 安装 |
| 权限模式 | 多种模式可选 | Kimi CLI 原生控制 |
| 模型选择 | Claude 系列 | Kimi 系列 |
| 规划模式 | 通过模型别名 | 原生 `--plan` 支持 |

## License

MIT
