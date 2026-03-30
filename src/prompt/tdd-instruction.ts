/**
 * TDD (测试驱动开发) 指令模块
 * 
 * 为 AI Agent 提供 TDD 开发指导
 */

import type { AgentRuntime } from "../agent/types.js";

/**
 * TDD 核心指令
 * 适用于所有需要编写代码的场景
 */
export const TDD_CORE_INSTRUCTION = `## 🧪 测试驱动开发 (TDD) 要求

当你需要编写、修改或重构代码时，**必须**遵循 TDD 原则：

### TDD 三步循环

\`\`\`
红 → 绿 → 重构
\`\`\`

1. **🔴 红色阶段 - 编写测试**
   - 先写测试，定义期望行为
   - 测试应该描述 "什么" 而不是 "怎么"
   - 使用描述性测试名："应该[期望行为]当[条件]"
   - 运行测试，确认它失败（红色）

2. **🟢 绿色阶段 - 编写代码**
   - 编写最小代码使测试通过
   - 不要过度设计，先让测试变绿
   - 可以暂时写 "丑陋" 的代码
   - 运行测试，确认通过（绿色）

3. **🔵 重构阶段 - 优化代码**
   - 在测试保护下优化代码
   - 保持测试通过（绿色）
   - 改进命名、结构、可读性
   - 消除重复，遵循 SOLID 原则

### 测试规范

**文件位置：**
- 测试文件：tests/{模块}/{功能}.test.ts
- 与源文件保持相同目录结构

**命名规范：**
\`\`\`typescript
// 好的测试描述
describe('UserService', () => {
  describe('createUser', () => {
    it('应该创建用户当数据有效', () => {});
    it('应该抛出错误当邮箱已存在', () => {});
  });
});
\`\`\`

**AAA 模式：**
\`\`\`typescript
it('应该正确计算总价', () => {
  // Arrange（准备）
  const cart = new Cart();
  cart.addItem({ price: 100, quantity: 2 });
  
  // Act（执行）
  const total = cart.calculateTotal();
  
  // Assert（断言）
  expect(total).toBe(200);
});
\`\`\`

### 测试覆盖要求

- **单元测试**：核心业务逻辑必须有单元测试
- **边界条件**：测试边界值、错误路径
- **Mock 外部依赖**：隔离测试，不调用真实服务
- **测试数据**：使用工厂函数创建测试数据

### 提交规范

\`\`\`
test: 添加用户认证测试          # 红色阶段
feat: 实现用户认证功能          # 绿色阶段
refactor: 优化认证逻辑          # 重构阶段
\`\`\``;

/**
 * 程序员助手专用的 TDD 扩展指令
 */
export const TDD_PROGRAMMER_INSTRUCTION = `${TDD_CORE_INSTRUCTION}

### 程序员专用测试指南

**TypeScript/JavaScript 测试：**
- 使用 Vitest 测试框架
- 使用 \`describe\` 和 \`it\` 组织测试
- 使用 \`vi.fn()\` 创建 Mock
- 使用 \`expect\` 进行断言

**测试文件模板：**
\`\`\`typescript
import { describe, it, expect, vi } from "vitest";
import { yourFunction } from "../../src/your-module.js";

describe("功能名", () => {
  it("应该...当...", async () => {
    // Arrange
    const input = ...;
    
    // Act
    const result = await yourFunction(input);
    
    // Assert
    expect(result).toBe(...);
  });
});
\`\`\`

**Mock 示例：**
\`\`\`typescript
// Mock 模块
vi.mock("../../src/dependency.js", () => ({
  externalFunction: vi.fn(() => Promise.resolve({ success: true }))
}));

// Mock 函数
const mockFn = vi.fn();
mockFn.mockReturnValue("mocked result");
\`\`\`

**运行测试：**
\`\`\`bash
# 运行所有测试
npm test

# 运行特定测试
npm test -- tests/your-module.test.ts

# 监视模式
npm run test:watch

# 覆盖率报告
npm run test:coverage
\`\`\``;

/**
 * 检查是否应该添加 TDD 指令
 */
export function shouldIncludeTDDInstruction(runtime: AgentRuntime): boolean {
  // 默认开启 TDD 要求
  // 可以通过配置关闭
  return runtime.config.features?.tddInstruction !== false;
}

/**
 * 获取适合当前角色的 TDD 指令
 */
export function getTDDInstruction(runtime: AgentRuntime): string | null {
  if (!shouldIncludeTDDInstruction(runtime)) {
    return null;
  }

  // 根据角色类型返回不同的 TDD 指令
  const templateId = runtime.config.ai.templateId;
  
  switch (templateId) {
    case "programmer":
    case "developer":
      return TDD_PROGRAMMER_INSTRUCTION;
    
    case "writer":
    case "vlog-creator":
      // 非编程角色可以返回简化版或 null
      return null;
    
    default:
      // 通用助手默认返回核心指令
      return TDD_CORE_INSTRUCTION;
  }
}
