# 安装指南

本文档介绍如何安装和配置 weixin-kimi-bot。

## 前置要求

在开始之前，请确保你的系统满足以下要求：

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | >= 18.0 | 运行时环境 |
| npm | >= 9.0 | 包管理器 |
| Kimi CLI | 最新版 | AI 能力依赖 |
| Git | 任意 | 代码管理 |

## 环境检查

运行以下命令检查环境：

```bash
# 检查 Node.js 版本
node -v
# 应输出 v18.x.x 或更高

# 检查 npm 版本
npm -v
# 应输出 9.x.x 或更高

# 检查 Git
git --version
```

## 安装 Kimi CLI

weixin-kimi-bot 依赖 Kimi CLI 提供 AI 能力：

```bash
# 使用 uv 安装（推荐）
uv tool install kimi-cli

# 验证安装
kimi --version
```

## 安装 weixin-kimi-bot

### 方式一：从源码安装（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/theBigGavin/weixin-kimi-bot.git
cd weixin-kimi-bot

# 2. 安装依赖
npm install

# 3. 构建项目
npm run build

# 4. 运行测试
npm test
```

### 方式二：使用安装脚本

```bash
# 运行安装脚本
npm run setup
```

## 配置 Kimi CLI

在使用前，需要配置 Kimi CLI：

```bash
# 登录 Kimi
kimi login

# 按提示完成浏览器登录
```

## 配置微信登录

运行登录命令完成微信配置：

```bash
npm run login
```

流程：
1. 终端显示二维码
3. 微信扫码登录
4. 选择能力模板（如：程序员助手）
5. 设置 Agent 名称
6. 完成创建

## 验证安装

```bash
# 检查配置
npm run agent:config

# 查看 Agent 列表
npm run agent:list
```

## 目录结构

安装完成后，项目目录结构如下：

```
weixin-kimi-bot/
├── src/              # 源代码
├── tests/            # 测试文件
├── docs/             # 文档
├── dist/             # 构建输出
├── logs/             # 日志文件
├── scripts/          # 工具脚本
├── package.json      # 项目配置
└── ecosystem.config.cjs  # PM2 配置
```

用户数据存储在 `~/.weixin-kimi-bot/`：

```
~/.weixin-kimi-bot/
├── agents/           # 所有 Agent 数据
│   └── agent_xxx/    # 单个 Agent 目录
│       ├── config.json
│       ├── credentials.json
│       ├── memory.json
│       └── workspace/
└── templates/        # 能力模板
```

## 常见问题

### Q: Node.js 版本过低怎么办？

使用 nvm 升级 Node.js：

```bash
# 安装 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# 安装 Node.js 18
nvm install 18
nvm use 18
```

### Q: 安装依赖很慢？

使用国内镜像：

```bash
# 使用淘宝镜像
npm config set registry https://registry.npmmirror.com

# 安装完成后恢复
npm config set registry https://registry.npmjs.org
```

### Q: Kimi CLI 登录失败？

检查网络连接，或尝试重新登录：

```bash
# 登出
kimi logout

# 重新登录
kimi login
```

### Q: 微信扫码后没有反应？

1. 确保手机网络正常
2. 重新运行 `npm run login`
3. 检查日志文件 `logs/error.log`

## 下一步

- [快速开始](./quickstart.md) - 启动你的第一个 Bot
- [配置说明](./configuration.md) - 了解详细配置选项
- [用户指南](../user-guide/agents.md) - 学习多 Agent 系统
