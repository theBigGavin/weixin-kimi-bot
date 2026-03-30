# 贡献指南

感谢你对 weixin-kimi-bot 项目的兴趣！本文档将帮助你快速开始为项目做贡献。

## 📋 目录

- [行为准则](#行为准则)
- [如何贡献](#如何贡献)
- [开发环境搭建](#开发环境搭建)
- [提交规范](#提交规范)
- [代码审查](#代码审查)
- [文档贡献](#文档贡献)

## 行为准则

参与本项目即表示你同意遵守以下准则：

- 尊重所有参与者
- 接受建设性批评
- 关注对社区最有利的事情
- 对其他社区成员表示同理心

## 如何贡献

### 报告 Bug

如果你发现了 Bug，请通过 [GitHub Issues](https://github.com/theBigGavin/weixin-kimi-bot/issues) 报告，并包含以下信息：

1. **问题描述** - 清晰简洁的描述
2. **复现步骤** - 详细的分步说明
3. **期望行为** - 你期望发生什么
4. **实际行为** - 实际发生了什么
5. **环境信息** - Node.js 版本、操作系统等
6. **截图/日志** - 如果有的话

### 建议新功能

欢迎提出建议！请创建 Issue 并：

1. 使用清晰的标题描述功能
2. 详细说明该功能的用例
3. 如果可能，提供实现思路

### 提交代码

1. Fork 本仓库
2. 创建你的功能分支 (`git checkout -b feature/amazing-feature`)
3. 编写代码和测试（遵循 TDD）
4. 确保所有测试通过 (`npm test`)
5. 提交更改 (`git commit -m 'feat: add amazing feature'`)
6. 推送到分支 (`git push origin feature/amazing-feature`)
7. 创建 Pull Request

## 开发环境搭建

### 前置要求

- Node.js 18+
- npm 9+
- Git

### 安装步骤

```bash
# 1. Fork 并 Clone 你的 Fork
git clone https://github.com/YOUR_USERNAME/weixin-kimi-bot.git
cd weixin-kimi-bot

# 2. 安装依赖
npm install

# 3. 运行测试确保环境正常
npm test

# 4. 构建项目
npm run build
```

### 项目结构

```
weixin-kimi-bot/
├── src/              # 源代码
├── tests/            # 测试文件
├── docs/             # 文档
├── scripts/          # 脚本工具
└── ...
```

## 提交规范

我们使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

### 提交类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat: add scheduler support` |
| `fix` | Bug 修复 | `fix: resolve memory leak` |
| `docs` | 文档更新 | `docs: update README` |
| `style` | 代码格式 | `style: fix indentation` |
| `refactor` | 重构 | `refactor: simplify handler logic` |
| `test` | 测试相关 | `test: add agent validation tests` |
| `chore` | 构建/工具 | `chore: update dependencies` |

### 提交示例

```bash
# 新功能
git commit -m "feat(scheduler): add cron expression validation"

# Bug 修复
git commit -m "fix(agent): resolve workspace path issue

The workspace path was incorrectly resolved when path contains spaces.
Fixed by using proper path normalization."

# 文档
git commit -m "docs: add deployment environment guide"
```

## TDD 开发流程

本项目严格遵循测试驱动开发（TDD）：

### 红-绿-重构循环

```
1. 编写失败的测试（红）
   ↓
2. 运行测试，确认失败
   ↓
3. 编写最简单的代码使测试通过（绿）
   ↓
4. 重构代码，保持测试通过
   ↓
5. 重复
```

### 示例

```typescript
// Step 1: 写测试（红）
// tests/agent/validation.test.ts
import { describe, it, expect } from "vitest";
import { validateAgentConfig } from "../../src/agent/validation.js";

describe("Agent Validation", () => {
  it("应该拒绝空名称", () => {
    const result = validateAgentConfig({ name: "" });
    expect(result.valid).toBe(false);
  });
});

// Step 2: 运行测试（应失败）
// npm test -- tests/agent/validation.test.ts

// Step 3: 实现功能（绿）
// src/agent/validation.ts
export function validateAgentConfig(config: { name: string }) {
  return { valid: config.name.length > 0, errors: [] };
}

// Step 4: 重构
// 优化代码结构，确保测试仍通过
```

### 测试要求

- 所有新功能必须包含测试
- 所有 Bug 修复必须包含回归测试
- 测试覆盖率不应下降
- 使用 `describe` 和 `it` 清晰组织测试

## 代码审查

所有提交都需要通过代码审查：

### 审查清单

- [ ] 代码符合项目风格
- [ ] 所有测试通过
- [ ] 新功能有适当测试
- [ ] 文档已更新
- [ ] 提交信息符合规范

### 审查流程

1. 创建 PR 并填写描述模板
2. 等待 CI 检查通过
3. 维护者进行代码审查
4. 根据反馈修改
5. 合并到主分支

## 文档贡献

文档贡献同样重要！

### 文档位置

- `README.md` - 项目主介绍
- `CONTRIBUTING.md` - 本文件
- `docs/` - 详细文档目录
- 代码注释 - 复杂逻辑的说明

### 文档规范

1. 使用清晰简洁的中文
2. 代码示例必须可运行
3. 保持目录结构一致
4. 更新时同步相关文档

### 文档更新检查清单

- [ ] 新增功能同步更新文档
- [ ] 修改功能更新相关文档
- [ ] 删除功能移除相关文档
- [ ] 链接检查（无死链）

## 发布流程

项目维护者按以下流程发布新版本：

1. 确保所有测试通过
2. 更新 `CHANGELOG.md`
3. 更新版本号 (`npm run version:patch|minor|major`)
4. 创建 Git Tag
5. 推送并创建 Release

## 获取帮助

如有任何问题：

- 查看 [文档](./docs/)
- 搜索 [Issues](https://github.com/theBigGavin/weixin-kimi-bot/issues)
- 创建 Issue 提问
- 联系维护者

## 许可证

通过贡献代码，你同意将你的贡献在 [MIT 许可证](../LICENSE) 下发布。

---

感谢你的贡献！🎉
