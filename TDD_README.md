# weixin-kimi-bot TDD 迁移方案

## 📊 当前状况

```
源文件: 98 个        测试文件: 21 个        覆盖率: ~35%
通过: 324 个         失败: 2 个            跳过: 6 个
```

**已有测试的模块：**
- ✅ context/ - 上下文系统
- ✅ handlers/ - 消息处理
- ✅ services/ - 服务层
- ✅ utils/ - 工具函数

**缺少测试的模块：**
- ❌ agent/ - Agent 管理
- ❌ kimi/ - Kimi CLI 集成
- ❌ ilink/ - iLink 协议
- ❌ longtask/ - 耗时任务
- ❌ flowtask/ - 可靠任务流
- ❌ workflow/ - 工作流系统
- ❌ notifications/ - 通知通道
- ❌ memory/ - 长期记忆

---

## 🚀 快速开始（3种方式）

### 方式一：一键设置（推荐）

```bash
node scripts/setup-tdd.js
npm test
```

### 方式二：手动修复

```bash
# 1. 修复现有失败的测试
# 修改 src/workflow/manager.ts 支持测试目录

# 2. 运行测试
npm test

# 3. 查看覆盖率
npm run test:coverage
```

### 方式三：按模块逐步迁移

参考 `TDD_MIGRATION_PLAN.md` 的详细步骤。

---

## 📚 文档导航

| 文档 | 内容 | 适用人群 |
|------|------|----------|
| **TDD_README.md** | 本文件，快速入门 | 所有人 |
| **TDD_MIGRATION_PLAN.md** | 完整迁移计划 | 技术负责人 |
| **TDD_QUICKSTART.md** | TDD 实践指南 | 开发人员 |

---

## 🎯 TDD 工作流程

```
红 -> 绿 -> 重构

1. 编写测试（红色）
   ↓
2. 运行测试（应失败）
   ↓
3. 编写代码使测试通过（绿色）
   ↓
4. 重构（保持绿色）
   ↓
5. 重复
```

### 示例：添加新功能

```typescript
// Step 1: 写测试
it('应该验证 Agent 名称', () => {
  const result = validateAgentConfig({ name: '' });
  expect(result.valid).toBe(false);
});

// Step 2: 运行测试（失败）
npm test -- tests/agent/validation.test.ts

// Step 3: 实现功能
export function validateAgentConfig(config) {
  return { valid: !!config.name, errors: [] };
}

// Step 4: 运行测试（通过）
npm test

// Step 5: 重构
// ... 优化代码结构，确保测试仍通过
```

---

## 📋 迁移检查清单

### Phase 1: 基础设施（Week 1）
- [ ] 运行 `node scripts/setup-tdd.js`
- [ ] 验证所有测试通过
- [ ] 配置 CI/CD

### Phase 2: 核心模块（Week 2-3）
- [ ] agent/ 模块测试
- [ ] kimi/ 模块测试
- [ ] ilink/ 模块测试

### Phase 3: 工作流模块（Week 3-4）
- [ ] longtask/ 模块测试
- [ ] flowtask/ 模块测试
- [ ] workflow/ 模块测试

### Phase 4: 集成与完善（Week 4）
- [ ] E2E 测试
- [ ] 覆盖率 >= 85%
- [ ] 文档更新

---

## 🧪 常用命令

```bash
# 运行所有测试
npm test

# 监视模式（开发时使用）
npm run test:watch

# 覆盖率报告
npm run test:coverage

# 只运行特定测试
npm test -- tests/agent/validation.test.ts

# 运行匹配描述的测试
npm test -- -t "应该验证"
```

---

## 📈 目标指标

| 指标 | 当前 | 目标 | 时间 |
|------|------|------|------|
| 测试覆盖率 | 35% | 85% | 4 周 |
| 单元测试数 | 324 | 600+ | 4 周 |
| 核心模块覆盖 | 40% | 100% | 3 周 |
| CI/CD 通过率 | - | 100% | 1 周 |

---

## 💡 最佳实践

### 1. 测试命名
```typescript
// ✅ 好的描述
describe('UserService', () => {
  describe('createUser', () => {
    it('应该创建用户当数据有效', () => {});
    it('应该抛出错误当邮箱已存在', () => {});
  });
});
```

### 2. AAA 模式
```typescript
it('应该计算总价', () => {
  // Arrange
  const cart = new Cart();
  cart.addItem({ price: 100, quantity: 2 });
  
  // Act
  const total = cart.calculateTotal();
  
  // Assert
  expect(total).toBe(200);
});
```

### 3. 使用数据工厂
```typescript
const agent = createAgentFixture({ name: 'Custom' });
const message = createMessageFixture({ content: 'Hello' });
```

---

## 🔧 故障排除

### 测试失败
```bash
# 查看详细输出
npm test -- --reporter=verbose

# 调试模式
node --inspect-brk node_modules/.bin/vitest run tests/file.test.ts
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

---

## 📞 需要帮助？

1. 阅读 `TDD_QUICKSTART.md` 获取详细指南
2. 查看 `tests/__fixtures__/factories.ts` 了解测试数据
3. 参考已有测试文件学习模式

---

## ✅ 开始迁移

选择你的路径：

```bash
# 快速路径（一键设置）
node scripts/setup-tdd.js

# 手动路径（逐步理解）
cat TDD_MIGRATION_PLAN.md
```

---

*最后更新: 2026-03-30*
