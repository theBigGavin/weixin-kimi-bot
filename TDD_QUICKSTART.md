# TDD 快速开始指南

## 1. 立即开始（5分钟）

### 第一步：修复现有问题

```bash
# 1. 创建 vitest 配置文件
cat > vitest.config.ts << 'EOF'
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
EOF

# 2. 运行测试
npm test
```

### 第二步：修复 WorkflowManager 测试问题

```typescript
// 在 src/workflow/manager.ts 中添加测试支持
export class WorkflowManager {
  constructor(options?: { 
    baseDir?: string;
    agentId?: string;
  }) {
    const agentId = options?.agentId || 'default';
    this.baseDir = options?.baseDir || 
      path.join(homedir(), '.weixin-kimi-bot', 'agents', agentId, 'workflows');
    // ...
  }
}
```

然后更新测试：
```typescript
// tests/integration/command-processing.test.ts
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { join } from 'path';

const testDir = mkdtempSync(join(tmpdir(), 'workflow-test-'));
const manager = new WorkflowManager({ 
  baseDir: testDir,
  agentId: 'test-agent' 
});
```

---

## 2. 新功能 TDD 示例

假设要添加一个 `validateAgentConfig` 函数：

### Step 1: 写测试（红色）

```typescript
// tests/agent/validation.test.ts
import { describe, it, expect } from 'vitest';
import { validateAgentConfig } from '../../src/agent/validation.js';

describe('validateAgentConfig', () => {
  it('应该通过有效的配置', () => {
    const config = {
      name: 'Test Agent',
      wechat: { accountId: 'wxid_test123' },
      ai: { model: 'kimi-code', templateId: 'programmer' }
    };
    
    const result = validateAgentConfig(config);
    
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
  
  it('应该检测缺少名称', () => {
    const config = {
      wechat: { accountId: 'wxid_test123' }
    };
    
    const result = validateAgentConfig(config);
    
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('name is required');
  });
  
  it('应该检测无效的微信ID', () => {
    const config = {
      name: 'Test',
      wechat: { accountId: 'invalid' }
    };
    
    const result = validateAgentConfig(config);
    
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('wechat.accountId must start with wxid_');
  });
});
```

运行测试（应该失败）：
```bash
npm test -- tests/agent/validation.test.ts
# ❌ 失败 - validateAgentConfig 不存在
```

### Step 2: 实现功能（绿色）

```typescript
// src/agent/validation.ts
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateAgentConfig(config: any): ValidationResult {
  const errors: string[] = [];
  
  if (!config.name) {
    errors.push('name is required');
  }
  
  if (!config.wechat?.accountId) {
    errors.push('wechat.accountId is required');
  } else if (!config.wechat.accountId.startsWith('wxid_')) {
    errors.push('wechat.accountId must start with wxid_');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
```

运行测试（应该通过）：
```bash
npm test -- tests/agent/validation.test.ts
# ✅ 通过
```

### Step 3: 重构（保持绿色）

```typescript
// src/agent/validation.ts
const VALIDATION_RULES = [
  {
    field: 'name',
    required: true,
    message: 'name is required'
  },
  {
    field: 'wechat.accountId',
    required: true,
    validate: (value: string) => value.startsWith('wxid_'),
    message: 'wechat.accountId must start with wxid_'
  }
];

export function validateAgentConfig(config: any): ValidationResult {
  const errors: string[] = [];
  
  for (const rule of VALIDATION_RULES) {
    const value = getNestedValue(config, rule.field);
    
    if (rule.required && !value) {
      errors.push(rule.message);
    } else if (rule.validate && value && !rule.validate(value)) {
      errors.push(rule.message);
    }
  }
  
  return { valid: errors.length === 0, errors };
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((o, p) => o?.[p], obj);
}
```

再次运行测试：
```bash
npm test -- tests/agent/validation.test.ts
# ✅ 仍然通过 - 重构成功
```

---

## 3. 测试模式速查

### Mock 外部依赖

```typescript
// Mock 模块
vi.mock('../src/kimi/session.js', () => ({
  checkKimiSession: vi.fn(() => Promise.resolve({ exists: true })),
  clearKimiSessions: vi.fn()
}));

// Mock 函数
const mockSend = vi.fn();
vi.mocked(sendMessage).mockImplementation(mockSend);

// 恢复原始实现
vi.restoreAllMocks();
```

### 异步测试

```typescript
// Promise
it('应该异步加载数据', async () => {
  const data = await loadData();
  expect(data).toBeDefined();
});

// 回调
it('应该处理回调', (done) => {
  fetchData((err, result) => {
    expect(err).toBeNull();
    expect(result).toBeDefined();
    done();
  });
});

// 超时
it('应该超时', async () => {
  await expect(
    slowOperation()
  ).rejects.toThrow('timeout');
}, 5000); // 5秒超时
```

### 测试数据工厂

```typescript
// tests/__fixtures__/factories.ts
export function createAgent(overrides = {}) {
  return {
    id: `agent_${Date.now()}`,
    name: 'Test Agent',
    wechat: { accountId: 'wxid_test', nickname: 'Test' },
    ai: { model: 'kimi-code', templateId: 'programmer' },
    ...overrides
  };
}

// 使用
const agent = createAgent({ name: 'Custom' });
```

### 生命周期钩子

```typescript
describe('Suite', () => {
  beforeAll(() => {
    // 整个套件前执行一次
  });
  
  beforeEach(() => {
    // 每个测试前执行
  });
  
  afterEach(() => {
    // 每个测试后执行
  });
  
  afterAll(() => {
    // 整个套件后执行一次
  });
});
```

---

## 4. 常见测试场景

### 测试错误处理

```typescript
it('应该正确处理错误', async () => {
  // 模拟错误
  vi.mocked(api.call).mockRejectedValue(new Error('Network error'));
  
  const result = await service.fetchData();
  
  expect(result.success).toBe(false);
  expect(result.error).toBe('Network error');
});
```

### 测试边界条件

```typescript
it.each([
  { input: '', expected: false, desc: '空字符串' },
  { input: 'a', expected: true, desc: '单个字符' },
  { input: 'a'.repeat(1000), expected: true, desc: '长字符串' },
  { input: null, expected: false, desc: 'null值' },
])('应该处理 $desc', ({ input, expected }) => {
  expect(validateInput(input)).toBe(expected);
});
```

### 测试私有方法（不推荐，但有时必要）

```typescript
// 通过导出测试钩子
export const __test__ = {
  privateMethod: (arg: string) => {
    // 实现
  }
};

// 测试中
import { __test__ } from './module.js';

it('应该测试私有方法', () => {
  const result = __test__.privateMethod('test');
  expect(result).toBe('expected');
});
```

---

## 5. 调试技巧

```bash
# 只运行特定测试
npm test -- tests/agent/manager.test.ts

# 运行特定描述
npm test -- -t "应该创建新用户"

# 交互式调试
npm run test:watch

# 显示详细输出
npm test -- --reporter=verbose

# 生成覆盖率报告
npm test -- --coverage

# 调试模式
node --inspect-brk node_modules/.bin/vitest run tests/agent/manager.test.ts
```

---

## 6. 代码覆盖率检查

```bash
# 生成 HTML 报告
npm test -- --coverage --reporter=html

# 查看报告
open coverage/index.html
```

覆盖率阈值：
- Lines: 80%
- Functions: 80%
- Branches: 75%
- Statements: 80%
