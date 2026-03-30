# 🤖 weixin-kimi-bot

通过微信消息远程操控 [Kimi Code CLI](https://github.com/moonshotai/Kimi-cli) —— 基于腾讯 iLink 协议的微信 AI Bot。

[English](README_CN.md) | [文档中心](docs/README.md) | [快速开始](docs/getting-started/quickstart.md)

[![Tests](https://github.com/theBigGavin/weixin-kimi-bot/actions/workflows/test.yml/badge.svg)](https://github.com/theBigGavin/weixin-kimi-bot/actions)
[![Version](https://img.shields.io/badge/version-0.7.5-blue.svg)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## ✨ 核心特性

| 特性 | 说明 |
|------|------|
| 🤖 **多 Agent 架构** | 每个微信账号拥有独立的 AI 助手、工作目录和记忆 |
| 💬 **自然语言交互** | 像聊天一样让 AI 写代码、查资料、管理项目 |
| ⏰ **定时任务** | 定时提醒、自动化工作流 |
| 📝 **长期记忆** | Bot 记住你的偏好和项目信息 |
| 🚀 **后台服务** | PM2 管理，稳定可靠 |
| 🧪 **TDD 开发** | 435+ 测试保障代码质量 |

## 🚀 快速开始

### 1. 安装依赖

```bash
# 克隆仓库
git clone https://github.com/theBigGavin/weixin-kimi-bot.git
cd weixin-kimi-bot

# 安装依赖
npm install

# 安装 Kimi CLI
uv tool install kimi-cli
```

### 2. 配置登录

```bash
# 登录 Kimi
kimi login

# 登录微信并创建 Agent
npm run login
```

### 3. 启动服务

```bash
# 前台运行（开发）
npm start

# 或后台服务（生产）
npm run service:start
```

详细指南请查看 [📚 文档中心](docs/README.md)。

## 📝 使用示例

在你的微信上给 Bot 发消息：

**代码相关：**
```
帮我写一个快速排序算法
解释这段代码的时间复杂度
重构这个函数使其更易读
```

**项目管理：**
```
读取 README.md 并总结一下项目
给这个项目添加单元测试
分析代码架构并给出优化建议
```

**系统命令：**
```
/help          # 显示帮助
/status        # 查看状态
/schedule add "每日提醒" "0 9 * * *" "早上好！"
```

## 📚 文档

- [📖 完整文档](docs/README.md) - 文档中心首页
- [⚡ 快速开始](docs/getting-started/quickstart.md) - 5 分钟上手
- [🔧 安装指南](docs/getting-started/installation.md) - 详细安装步骤
- [💻 用户指南](docs/user-guide/agents.md) - 多 Agent 系统
- [🛠️ 开发文档](docs/development/architecture-overview.md) - 架构设计
- [🚀 部署指南](docs/deployment/environments.md) - 生产部署
- [🤝 贡献指南](CONTRIBUTING.md) - 参与项目

## 🏗️ 架构

```
┌─────────────────────────────────────────────┐
│              微信消息 (iLink)                │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│              Message Handler                │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │ Command  │ │  Chat    │ │   File      │ │
│  │ Handler  │ │ Handler  │ │  Handler    │ │
│  └──────────┘ └──────────┘ └─────────────┘ │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│              Agent Session                  │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │ Context  │ │ Memory   │ │ Workspace   │ │
│  └──────────┘ └──────────┘ └─────────────┘ │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│              Kimi CLI                       │
└─────────────────────────────────────────────┘
```

## 🧪 测试

```bash
# 运行测试
npm test

# 监视模式
npm run test:watch

# 覆盖率
npm run test:coverage
```

所有代码遵循 TDD 开发模式，确保 435+ 测试通过。

## 🤝 贡献

欢迎贡献！请阅读 [贡献指南](CONTRIBUTING.md) 了解如何参与项目。

### 贡献者

<a href="https://github.com/theBigGavin/weixin-kimi-bot/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=theBigGavin/weixin-kimi-bot" />
</a>

## 📄 许可证

[MIT License](LICENSE)

## 🙏 致谢

- [Kimi Code CLI](https://github.com/moonshotai/Kimi-cli) - 强大的 AI 编程助手
- [wechaty](https://github.com/wechaty/wechaty) - 微信机器人 SDK 参考

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/theBigGavin">theBigGavin</a>
</p>
