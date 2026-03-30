# weixin-kimi-bot 项目指南

本文件为 AI Coding Agent 提供项目概述、构建说明、代码规范等关键信息。

> ⚠️ **TDD 强制要求**：本项目严格遵循测试驱动开发（TDD）。任何代码修改必须先写测试，严禁先改代码后补测试！详见 [TDD_GUIDELINE.md](../../TDD_GUIDELINE.md)

## 项目概述

**weixin-kimi-bot** 是一个基于腾讯 iLink 协议的微信 AI Bot，通过微信消息远程操控 Kimi Code CLI。

```
微信用户 ──► iLink 协议 ──► weixin-kimi-bot ──► Kimi CLI ──► 本地文件系统
   ◄─────────────────────────────────────────────────────────────────────┘
```

### 核心特性

- **多 Agent 架构**：支持多个微信账号，每个账号拥有独立的 AI 助手、工作目录和长期记忆
- **能力模板**：预置多种专业角色（程序员助手、写作助手、Vlog 创作者、数字货币投资者、A 股操盘手、通用助手）
- **上下文感知架构**：四层架构（会话上下文、任务上下文、项目上下文、用户画像、知识图谱）
- **任务系统**：支持定时任务、耗时任务（LongTask）、可靠任务流（FlowTask）、工作流（Workflow）
- **通知通道**：支持邮件、Telegram 等多种通知方式

## 技术栈

| 类别 | 技术 |
|------|------|
| 语言 | TypeScript 5.x |
| 运行时 | Node.js 18+ |
| 模块系统 | ES Modules (ES2022) |
| 构建工具 | TypeScript Compiler (`tsc`) |
| 即时执行 | tsx (免编译运行 .ts) |
| 测试框架 | Vitest 2.x |
| 进程管理 | PM2 (后台服务) |
| 外部依赖 | `qrcode-terminal`, `nodemailer` |

## 项目结构

```
weixin-kimi-bot/
├── src/                          # 源代码目录
│   ├── index.ts                  # 主入口：多 Agent 消息处理
│   ├── login.ts                  # QR 扫码登录 + Agent 创建
│   ├── config.ts                 # 配置管理 CLI
│   ├── store.ts                  # 状态持久化
│   ├── scheduler.ts              # 定时任务调度器
│   │
│   ├── ilink/                    # iLink 协议封装
│   │   ├── types.ts              # iLink 协议类型
│   │   ├── api.ts                # HTTP API 封装
│   │   └── auth.ts               # QR 登录流程
│   │
│   ├── kimi/                     # Kimi CLI 集成
│   │   ├── handler.ts            # Kimi CLI 调用处理
│   │   └── session.ts            # Session 管理
│   │
│   ├── agent/                    # 多 Agent 系统核心
│   │   ├── types.ts              # Agent 类型定义
│   │   ├── manager.ts            # Agent 管理器
│   │   ├── prompt-builder.ts     # 提示词构建
│   │   └── cli.ts                # Agent 管理 CLI
│   │
│   ├── handlers/                 # 消息和命令处理
│   │   ├── index.ts              # 处理器入口
│   │   ├── message-handler.ts    # 消息处理
│   │   ├── command-handler.ts    # 命令处理
│   │   ├── command-context.ts    # 上下文感知命令处理
│   │   └── commands/             # 子命令实现
│   │
│   ├── context/                  # 上下文感知架构
│   │   ├── types.ts              # 上下文类型定义
│   │   ├── session-context.ts    # 会话上下文管理
│   │   ├── state-machine.ts      # 对话状态机
│   │   ├── intent-resolver.ts    # 意图识别
│   │   ├── reference-resolver.ts # 指代消解
│   │   ├── output-parser.ts      # 输出解析
│   │   └── persistence.ts        # 持久化
│   │
│   ├── longtask/                 # 耗时任务管理
│   │   ├── manager.ts            # 任务管理器
│   │   ├── parser.ts             # 进度解析器
│   │   ├── tool-predictor.ts     # 工具调用预测
│   │   ├── persistence.ts        # 状态持久化
│   │   └── recovery.ts           # 崩溃恢复
│   │
│   ├── flowtask/                 # 可靠任务流
│   │   ├── manager.ts            # 任务流管理器
│   │   ├── worker.ts             # 工作进程
│   │   ├── plan-generator.ts     # 计划生成
│   │   └── state-machine.ts      # 状态管理
│   │
│   ├── workflow/                 # 工作流系统
│   │   ├── manager.ts            # 工作流管理器
│   │   ├── engine.ts             # 执行引擎
│   │   ├── parser.ts             # DSL 解析器
│   │   └── nodes/                # 节点类型实现
│   │
│   ├── task-router/              # 智能任务路由
│   │   ├── index.ts              # 路由主逻辑
│   │   ├── analyzer.ts           # 任务分析器
│   │   └── decision.ts           # 决策逻辑
│   │
│   ├── templates/                # 能力模板
│   │   ├── definitions.ts        # 预置角色模板
│   │   └── custom-manager.ts     # 自定义模板管理
│   │
│   ├── memory/                   # 长期记忆系统
│   │   └── manager.ts            # 记忆管理器
│   │
│   ├── notifications/            # 通知通道
│   │   ├── types.ts              # 通知类型定义
│   │   ├── manager.ts            # 通知管理器
│   │   ├── channels/             # 通道实现
│   │   └── cli.ts                # CLI 工具
│   │
│   ├── services/                 # 服务层
│   │   ├── agent-poller.ts       # Agent 消息轮询
│   │   ├── session-manager.ts    # Session 管理
│   │   └── restart-notify.ts     # 重启通知
│   │
│   ├── prompt/                   # Prompt 构建
│   │   ├── builder.ts            # Prompt 构建器
│   │   └── index.ts              # 导出
│   │
│   ├── utils/                    # 工具函数
│   │   ├── helpers.ts            # 通用辅助函数
│   │   └── message.ts            # 消息处理工具
│   │
│   ├── types/index.ts            # 全局类型定义
│   └── version.ts                # 版本信息
│
├── tests/                        # 测试目录
│   ├── context/                  # 上下文系统测试
│   ├── handlers/                 # 处理器测试
│   ├── services/                 # 服务层测试
│   ├── integration/              # 集成测试
│   └── utils/                    # 工具函数测试
│
├── scripts/                      # 脚本工具
│   ├── bump-version.js           # 版本号管理
│   ├── migrate-to-multi-agent.js # 迁移脚本
│   └── setup-service.sh          # 服务安装脚本
│
├── docs/                         # 文档目录
│   └── flowtask-usage.md         # FlowTask 使用文档
│
├── package.json                  # 项目配置
├── tsconfig.json                 # TypeScript 配置
├── ecosystem.config.cjs          # PM2 配置
└── [各种文档].md                  # 项目文档
```

## 构建和运行

### 前置条件

- Node.js 18+
- Kimi CLI (通过 `uv tool install kimi-cli` 安装)
- Moonshot API Key (Kimi CLI 配置时已设置)

### 安装依赖

```bash
npm install
```

### 开发运行

```bash
# 创建第一个 Agent（扫码登录）
npm run login

# 启动 Bot（前台模式）
npm start

# 启动指定 Agent
ACTIVE_AGENT_ID=agent_xxx npm start
```

### 生产部署

```bash
# 编译 TypeScript
npm run build

# 使用 PM2 启动后台服务
npm run service:start

# 查看状态
npm run service:status

# 查看日志
npm run service:logs
```

### 部署更新

```bash
# 更新版本号并重启
npm run deploy:patch   # 修订号 +1
npm run deploy:minor   # 次版本号 +1
npm run deploy:major   # 主版本号 +1
```

## 测试

本项目采用 **TDD (测试驱动开发)** 模式。

### 运行测试

```bash
# 运行所有测试
npm test

# 监视模式（开发时使用）
npm run test:watch

# 运行特定测试文件
npm test -- tests/context/state-machine.test.ts

# 生成覆盖率报告
npm run test:coverage

# 运行匹配描述的测试
npm test -- -t "应该创建新Agent"
```

### TDD 工作流程

1. **编写测试** (红色) - 先写测试，定义期望行为
2. **运行测试** (应失败) - 确认测试失败
3. **编写代码** (绿色) - 实现最小功能使测试通过
4. **重构** (保持绿色) - 优化代码，确保测试仍通过
5. **重复** - 继续下一个功能

### 测试规范

- 测试文件: `tests/{模块}/{功能}.test.ts`
- 命名规范: `应该{期望行为}当{条件}`
- 使用数据工厂: `tests/__fixtures__/factories.ts`
- 使用 Mock 工具: `tests/__helpers__/mock-utils.ts`

### 测试示例

```typescript
// tests/agent/validation.test.ts
import { describe, it, expect } from "vitest";
import { validateAgentConfig } from "../../src/agent/validation.js";

describe('validateAgentConfig', () => {
  it('应该检测缺少名称', () => {
    // Arrange
    const config = { wechat: { accountId: 'wxid_test' } };
    
    // Act
    const result = validateAgentConfig(config);
    
    // Assert
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('name is required');
  });
});
```

## 代码规范

### 导入规范

- 使用 ES Modules (`"type": "module"`)
- TypeScript 文件扩展名使用 `.ts`，导入时保留 `.js` 扩展名（Node16 模块解析）
- 示例：
  ```typescript
  import { agentManager } from "../agent/manager.js";
  import type { AgentConfig } from "../agent/types.js";
  ```

### 命名规范

- 文件名使用 kebab-case（短横线连接）
- 类型/接口使用 PascalCase
- 函数/变量使用 camelCase
- 常量使用 UPPER_SNAKE_CASE

### 注释规范

- 使用 JSDoc 注释函数和类型
- 关键逻辑添加中文注释
- 复杂算法添加实现说明

### 类型规范

- 优先使用 `type` 定义对象类型
- 使用 `interface` 定义可扩展的类层次结构
- 导出类型使用 `export type`
- 类型文件统一放在 `src/types/` 或模块内的 `types.ts`

### TDD 规范（强制）

**所有代码编写必须遵循 TDD 原则：**

1. **红-绿-重构循环**
   - 🔴 红色：先写测试，定义期望行为
   - 🟢 绿色：编写最小代码使测试通过
   - 🔵 重构：在测试保护下优化代码

2. **测试要求**
   - 测试文件：`tests/{模块}/{功能}.test.ts`
   - 命名规范：`应该{期望行为}当{条件}`
   - AAA 模式：Arrange → Act → Assert
   - 必须测试边界条件和错误路径

3. **提交规范**
   ```bash
   test: 添加用户认证测试      # 红色阶段
   feat: 实现用户认证功能      # 绿色阶段
   refactor: 优化认证逻辑      # 重构阶段
   ```

4. **测试运行**
   ```bash
   npm test                    # 运行所有测试
   npm test -- tests/xxx.test.ts  # 运行特定测试
   npm run test:coverage       # 覆盖率报告
   ```

**注意**：程序员助手角色的 Agent 会自动在系统提示词中接收 TDD 指令。

## Agent 管理命令

```bash
# 列出所有 Agent
npm run agent:list

# 交互式选择 Agent
npm run agent:switch

# 查看 Agent 配置
npm run agent:config [agent-id]

# 切换能力模板
npm run agent:template [agent-id]

# 查看长期记忆
npm run agent:memory [agent-id]

# 删除 Agent
npm run agent:delete <agent-id>
```

## 关键环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ACTIVE_AGENT_ID` | 指定要启动的 Agent ID | 所有 Agent |
| `ENABLE_CONTEXT_AWARE` | 启用上下文感知架构 | `true` |
| `NODE_ENV` | 运行环境 | `production` |

## 数据存储

所有数据存储在 `~/.weixin-kimi-bot/`，每个 Agent 拥有完全独立的存储空间：

```
~/.weixin-kimi-bot/
├── agents/{agent_id}/
│   ├── config.json              # Agent 配置
│   ├── memory.json              # 长期记忆
│   ├── credentials.json         # 微信登录凭证
│   ├── sync-buf.txt             # 消息同步游标
│   ├── context-tokens.json      # 会话上下文
│   ├── scheduled-tasks.json     # 定时任务
│   ├── notification-channels.json # 通知通道
│   ├── longtask/                # 耗时任务数据
│   ├── contexts/                # 上下文会话存储
│   └── workspace/               # 工作目录
│
└── templates/                   # 能力模板（共享）
```

## 微信聊天命令

用户在聊天中可以使用以下命令：

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助信息 |
| `/status` | 查看 Agent 状态 |
| `/reset` | 重置对话上下文 |
| `/template` | 查看/切换能力模板 |
| `/memory` | 查看长期记忆 |
| `/prompt` | 预览系统提示词 |
| `/task` | 定时任务管理 |
| `/longtask` | 后台执行耗时任务 |
| `/flowtask` | 可靠任务流 |
| `/workflow` | 工作流管理 |
| `/route` | 智能任务路由分析 |
| `/context` | 查看上下文详情 |
| `/session` | 查看 Session 状态 |
| `/deploy` | 部署更新（自动运行测试验证） |
| `/ver` | 查看版本信息 |

### /deploy 命令说明

**功能：** 部署 Bot 更新（patch/minor/major）

**特点：**
- 部署前**自动运行测试验证**
- 如有测试失败或跳过，将**阻止部署**
- 支持 `--force` 强制部署（不推荐）

**用法：**
```bash
/deploy patch          # 修订版本 +1，先运行测试
/deploy minor          # 次版本 +1，先运行测试
/deploy major          # 主版本 +1，先运行测试
/deploy patch --force  # 强制部署，跳过测试验证
```

**部署流程：**
1. 运行 `npm test` 进行集成测试
2. 验证测试结果（通过且没有跳过项）
3. 测试通过后执行版本更新
4. 自动重启服务

## 相关文档

- [README.md](./README.md) - 项目使用说明
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 多 Agent 架构设计
- [CONTEXT_ARCHITECTURE.md](./CONTEXT_ARCHITECTURE.md) - 上下文感知架构
- [SCHEDULER.md](./SCHEDULER.md) - 定时任务文档
- [LONGTASK.md](./LONGTASK.md) - 耗时任务文档
- [NOTIFICATIONS.md](./NOTIFICATIONS.md) - 通知通道文档
- [MIGRATION.md](./MIGRATION.md) - 版本迁移指南

## 安全注意事项

1. **Token 安全**：微信登录凭证和 Kimi CLI 凭据存储在本地，不会上传到任何服务器
2. **Agent 隔离**：每个 Agent 拥有完全独立的工作目录和数据，互不干扰
3. **iLink 协议**：腾讯未正式公开该协议，API 可能随时变更，不建议用于生产环境
4. **后台服务**：使用 PM2 运行后台服务前，必须先在 前台完成 Kimi 登录

## 故障排查

### 启动失败

1. 检查 Kimi CLI 是否安装：`kimi --version`
2. 检查是否已登录：`kimi login`
3. 检查是否有可用的 Agent：`npm run agent:list`

### 测试失败

1. 检查依赖是否完整：`npm install`
2. 检查 TypeScript 编译：`npm run build`

### 消息无法发送

1. 检查微信登录状态：重新运行 `npm run login`
2. 检查网络连接
3. 查看日志：`npm run service:logs`
