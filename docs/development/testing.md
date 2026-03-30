# 测试指南

本文档介绍 weixin-kimi-bot 的测试策略和 TDD 实践。

## 测试理念

本项目严格遵循**测试驱动开发（TDD）**模式：

```
红 -> 绿 -> 重构

1. 编写测试（红色）
   ↓
2. 运行测试，确认失败
   ↓
3. 编写代码使测试通过（绿色）
   ↓
4. 重构代码，保持测试通过
   ↓
5. 重复
```

## 测试统计

当前测试覆盖：

| 指标 | 数值 |
|------|------|
| 测试文件 | 33 个 |
| 测试用例 | 435 个 |
| 通过 | 435 个 |
| 失败 | 0 个 |
| 跳过 | 0 个 |

## 运行测试

### 基本命令

```bash
# 运行所有测试
npm test

# 监视模式（开发时使用）
npm run test:watch

# 覆盖率报告
npm run test:coverage
```

### 特定测试

```bash
# 只运行特定测试文件
npm test -- tests/agent/validation.test.ts

# 运行匹配描述的测试
npm test -- -t "应该验证"

# 详细输出
npm test -- --reporter=verbose
```

## 编写测试

### 基本结构

```typescript
import { describe, it, expect } from "vitest";
import { myFunction } from "../../src/my-module.js";

describe("模块名称", () => {
  describe("函数名称", () => {
    it("应该做某事", () => {
      // Arrange
      const input = "test";
      
      // Act
      const result = myFunction(input);
      
      // Assert
      expect(result).toBe("expected");
    });
  });
});
```

### AAA 模式

测试应遵循 Arrange-Act-Assert 模式：

```typescript
it("应该计算总价", () => {
  // Arrange - 准备数据
  const cart = new Cart();
  cart.addItem({ price: 100, quantity: 2 });
  
  // Act - 执行操作
  const total = cart.calculateTotal();
  
  // Assert - 验证结果
  expect(total).toBe(200);
});
```

### 测试命名

使用清晰的中文描述：

```typescript
// ✅ 好的命名
describe("AgentService", () => {
  describe("createAgent", () => {
    it("应该创建 Agent 当数据有效", () => {});
    it("应该抛出错误当名称为空", () => {});
    it("应该生成唯一 ID", () => {});
  });
});

// ❌ 差的命名
describe("test", () => {
  it("test1", () => {});
  it("test2", () => {});
});
```

## 使用测试工具

### Fixtures（测试数据工厂）

```typescript
import { createAgentFixture, createMessageFixture } from "../__fixtures__/factories.js";

// 创建默认 Agent
const agent = createAgentFixture();

// 创建自定义 Agent
const customAgent = createAgentFixture({ 
  name: "Custom Name",
  templateId: "writer"
});

// 创建消息
const message = createMessageFixture({ content: "Hello" });
```

### Mock

```typescript
import { vi } from "vitest";

// Mock 函数
const mockFn = vi.fn();
mockFn.mockReturnValue("mocked");

// Mock 模块
vi.mock("../../src/services/api.js", () => ({
  fetchData: vi.fn().mockResolvedValue({ data: [] }),
}));

// Mock 定时器
vi.useFakeTimers();
vi.advanceTimersByTime(1000);
```

### 异步测试

```typescript
// 使用 async/await
it("应该异步获取数据", async () => {
  const result = await fetchData();
  expect(result).toBeDefined();
});

// 使用 rejects
it("应该在错误时抛出", async () => {
  await expect(fetchData()).rejects.toThrow("Network error");
});
```

## 测试最佳实践

### 1. 独立性

每个测试应该独立运行，不依赖其他测试：

```typescript
// ✅ 好的做法
beforeEach(() => {
  // 重置状态
  resetState();
});

// ❌ 差的做法
// 测试 A 修改了全局状态，影响测试 B
```

### 2. 单一职责

每个测试只验证一个概念：

```typescript
// ✅ 好的做法
it("应该拒绝空名称", () => {});
it("应该拒绝过长名称", () => {});
it("应该接受有效名称", () => {});

// ❌ 差的做法
it("应该验证名称", () => {
  // 测试了太多东西
});
```

### 3. 可读性

测试应该像文档一样可读：

```typescript
it("应该发送通知当任务完成", async () => {
  // 给定一个正在运行的任务
  const task = createRunningTask();
  
  // 当任务完成时
  await task.complete();
  
  // 应该发送通知
  expect(notificationService.send).toHaveBeenCalled();
});
```

## 覆盖率要求

### 当前覆盖率

| 模块 | 行覆盖率 | 函数覆盖率 |
|------|----------|-----------|
| context/ | 87-94% | 75-100% |
| handlers/ | 73-92% | 80%+ |
| utils/ | 93% | 81% |
| agent/ | 40-80% | 70%+ |

### 目标

- 核心模块：>= 80%
- 工具模块：>= 90%
- 整体项目：>= 60%

## 调试测试

### 使用 VS Code

在项目根目录创建 `.vscode/launch.json`：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Current Test",
      "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
      "args": ["run", "${relativeFile}"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

### 使用 Node.js Inspector

```bash
node --inspect-brk node_modules/.bin/vitest run tests/file.test.ts
```

然后在 Chrome 中打开 `chrome://inspect`。

## CI/CD 集成

测试在 GitHub Actions 中自动运行：

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npm test
```

## 故障排除

### 测试失败

```bash
# 查看详细输出
npm test -- --reporter=verbose

# 只运行失败的测试
npm test -- --rerun-failed
```

### 覆盖率不足

```bash
# 生成 HTML 报告
npm run test:coverage
open coverage/index.html
```

### 环境问题

```bash
# 清理并重装依赖
rm -rf node_modules package-lock.json
npm install
npm test
```

## 提交前检查清单

- [ ] 所有测试通过 (`npm test`)
- [ ] 新功能有测试覆盖
- [ ] 测试命名清晰
- [ ] 无测试间依赖
- [ ] 使用 Fixtures 而非硬编码数据

## 参考

- [Vitest 文档](https://vitest.dev/)
- [Testing Patterns](https://martinfowler.com/testing/)
