# weixin-kimi-bot TDD 迁移计划

## 当前状态分析

### 测试现状
| 指标 | 数值 |
|------|------|
| 源文件数量 | 98 个 |
| 测试文件数量 | 21 个 |
| 通过测试 | 324 个 |
| 失败测试 | 2 个（权限问题） |
| 跳过测试 | 6 个 |
| **测试覆盖率** | **约 35%** |

### 模块覆盖情况

**已有测试的模块：**
- ✅ `context/` - 上下文系统（意图解析、状态机、输出解析等）
- ✅ `handlers/` - 消息和命令处理
- ✅ `services/` - 服务层
- ✅ `utils/` - 工具函数
- ✅ `prompt/` - Prompt 构建器
- ✅ `integration/` - 集成测试

**缺少测试的模块：**
- ❌ `agent/` - Agent 管理（核心）
- ❌ `kimi/` - Kimi CLI 集成（核心）
- ❌ `ilink/` - iLink 协议封装（核心）
- ❌ `longtask/` - 耗时任务管理（核心）
- ❌ `flowtask/` - 可靠任务流（核心）
- ❌ `workflow/` - 工作流系统（核心）
- ❌ `notifications/` - 通知通道
- ❌ `memory/` - 长期记忆
- ❌ `task-router/` - 任务路由
- ❌ `templates/` - 能力模板

### 现有问题
1. **环境依赖问题** - 部分测试依赖真实文件系统路径
2. **Mock 不充分** - 外部依赖（Kimi CLI、微信 API）未完全隔离
3. **测试顺序依赖** - 部分测试间存在隐式依赖
4. **异步处理不一致** - 部分异步测试缺少 proper cleanup

---

## TDD 目标定义

### 短期目标（1-2周）
- [ ] 修复现有失败的测试
- [ ] 为核心模块补充基础单元测试
- [ ] 建立测试基础设施（Mock、Fixture、Helper）

### 中期目标（3-4周）
- [ ] 核心模块测试覆盖率达到 80%+
- [ ] 建立集成测试规范
- [ ] 实现测试自动化（CI/CD 集成）

### 长期目标（2-3个月）
- [ ] 整体测试覆盖率达到 85%+
- [ ] 建立完整的 TDD 工作流程
- [ ] 所有新功能必须先写测试

---

## TDD 工作流程

### 1. 红-绿-重构循环

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   编写测试   │ --> │  运行测试   │ --> │  编写代码   │
│   (红色)    │     │  (应失败)   │     │  (绿色)    │
└─────────────┘     └─────────────┘     └──────┬──────┘
      ↑                                          │
      └─────────────┐     ┌──────────────────────┘
                        │     │
                   ┌────┴─────┴────┐
                   │    重构代码    │
                   │   (保持绿色)   │
                   └───────────────┘
```

### 2. 测试粒度金字塔

```
         /\
        /  \
       / E2E\         <- 少量端到端测试 (5%)
      /______\
     /        \
    /  Integration\    <- 集成测试 (15%)
   /______________\
  /                \
 /    Unit Tests     \  <- 单元测试 (80%)
/______________________\
```

### 3. 提交规范

```bash
# TDD 风格的提交信息
test: add test for user authentication    # 先写测试（红色）
feat: implement user authentication       # 实现功能（绿色）
refactor: simplify auth logic             # 重构（保持绿色）
```

---

## 实施步骤

### Phase 1: 基础设施完善（Week 1）

#### 1.1 修复现有测试
```bash
# 问题清单
- [ ] tests/integration/command-processing.test.ts - 权限问题
  - WorkflowManager 使用硬编码路径
  - 需要改为可配置或使用临时目录
```

**修复方案：**
```typescript
// 修改 WorkflowManager 支持测试模式
class WorkflowManager {
  constructor(options?: { baseDir?: string }) {
    this.baseDir = options?.baseDir || process.env.WORKFLOW_DIR || 
                   path.join(homedir(), '.weixin-kimi-bot', 'workflows');
  }
}
```

#### 1.2 建立测试基础设施

**创建测试工具库：**
```
tests/
├── __fixtures__/          # 测试数据
│   ├── agents/
│   ├── messages/
│   └── configs/
├── __mocks__/             # Mock 实现
│   ├── kimi-cli.ts
│   ├── ilink-api.ts
│   └── file-system.ts
├── __helpers__/           # 测试辅助函数
│   ├── agent-factory.ts
│   ├── mock-utils.ts
│   └── test-setup.ts
└── __e2e__/              # E2E 测试
```

**核心测试辅助函数：**
```typescript
// tests/__helpers__/test-setup.ts
import { vi } from 'vitest';

export function setupTestEnvironment() {
  // 隔离测试环境
  process.env.TEST_MODE = 'true';
  process.env.WORKFLOW_DIR = '/tmp/test-workflows';
  
  // Mock 外部依赖
  vi.mock('../src/kimi/session.js', () => ({
    checkKimiSession: vi.fn(() => Promise.resolve({ exists: true })),
    executeKimiCommand: vi.fn(),
  }));
}

export function createMockAgent(overrides = {}) {
  return {
    id: `test-agent-${Date.now()}`,
    name: 'Test Agent',
    wechat: { accountId: 'wxid_test', nickname: 'Test' },
    ...overrides
  };
}
```

#### 1.3 配置测试运行

**更新 vitest.config.ts：**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/__helpers__/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.d.ts',
        '**/vendor/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true, // 避免测试间状态污染
      },
    },
  },
});
```

### Phase 2: 核心模块测试补充（Week 2-3）

#### 2.1 Agent 模块测试

**创建 `tests/agent/manager.test.ts`：**
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentManager } from '../../src/agent/manager.js';
import type { AgentConfig } from '../../src/agent/types.js';

describe('AgentManager', () => {
  let manager: AgentManager;
  
  beforeEach(() => {
    manager = new AgentManager({ testMode: true });
  });
  
  describe('createAgent', () => {
    it('应该使用默认配置创建 Agent', async () => {
      // Arrange
      const wechatId = 'wxid_test123';
      
      // Act
      const agent = await manager.createAgent(wechatId);
      
      // Assert
      expect(agent).toBeDefined();
      expect(agent.id).toMatch(/^agent_/);
      expect(agent.wechat.accountId).toBe(wechatId);
    });
    
    it('应该支持自定义配置', async () => {
      // Arrange
      const config: Partial<AgentConfig> = {
        name: 'Custom Agent',
        ai: { model: 'custom-model', templateId: 'writer' }
      };
      
      // Act
      const agent = await manager.createAgent('wxid_test', config);
      
      // Assert
      expect(agent.name).toBe('Custom Agent');
      expect(agent.ai.model).toBe('custom-model');
    });
  });
  
  describe('getAgent', () => {
    it('应该返回存在的 Agent', async () => {
      // Arrange
      const created = await manager.createAgent('wxid_test');
      
      // Act
      const retrieved = await manager.getAgent(created.id);
      
      // Assert
      expect(retrieved).toEqual(created);
    });
    
    it('应该返回 null 当 Agent 不存在', async () => {
      // Act
      const result = await manager.getAgent('non-existent');
      
      // Assert
      expect(result).toBeNull();
    });
  });
});
```

#### 2.2 Kimi 模块测试

**创建 `tests/kimi/handler.test.ts`：**
```typescript
import { describe, it, expect, vi } from 'vitest';
import { KimiHandler } from '../../src/kimi/handler.js';

describe('KimiHandler', () => {
  describe('executeCommand', () => {
    it('应该成功执行简单命令', async () => {
      // Arrange
      const handler = new KimiHandler();
      const mockExec = vi.fn().mockResolvedValue({ stdout: 'result', stderr: '' });
      
      // Act
      const result = await handler.execute('/help', { exec: mockExec });
      
      // Assert
      expect(result.success).toBe(true);
      expect(mockExec).toHaveBeenCalledWith('kimi /help');
    });
    
    it('应该处理执行错误', async () => {
      // Arrange
      const handler = new KimiHandler();
      const mockExec = vi.fn().mockRejectedValue(new Error('Command failed'));
      
      // Act
      const result = await handler.execute('/invalid', { exec: mockExec });
      
      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
```

#### 2.3 iLink 模块测试

**创建 `tests/ilink/api.test.ts`：**
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ILinkAPI } from '../../src/ilink/api.js';

describe('ILinkAPI', () => {
  let api: ILinkAPI;
  
  beforeEach(() => {
    api = new ILinkAPI({ baseURL: 'https://test.api.com' });
  });
  
  describe('sendMessage', () => {
    it('应该成功发送文本消息', async () => {
      // Arrange
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ code: 0, data: { msgId: '123' } })
      });
      global.fetch = mockFetch;
      
      // Act
      const result = await api.sendMessage('wxid_user', 'Hello');
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.msgId).toBe('123');
    });
  });
});
```

### Phase 3: 工作流测试（Week 3-4）

#### 3.1 LongTask 模块

**创建 `tests/longtask/manager.test.ts`：**
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LongTaskManager } from '../../src/longtask/manager.js';

describe('LongTaskManager', () => {
  let manager: LongTaskManager;
  let tempDir: string;
  
  beforeEach(async () => {
    tempDir = await createTempDir();
    manager = new LongTaskManager({ dataDir: tempDir });
  });
  
  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });
  
  describe('submit', () => {
    it('应该创建新任务并返回任务ID', async () => {
      // Arrange
      const command = '/task analyze code';
      
      // Act
      const task = await manager.submit(command);
      
      // Assert
      expect(task.id).toBeDefined();
      expect(task.status).toBe('pending');
      expect(task.command).toBe(command);
    });
    
    it('应该支持任务优先级', async () => {
      // Arrange
      const lowPriority = await manager.submit('low', { priority: 1 });
      const highPriority = await manager.submit('high', { priority: 10 });
      
      // Act
      const queue = manager.getQueue();
      
      // Assert
      expect(queue[0].id).toBe(highPriority.id);
      expect(queue[1].id).toBe(lowPriority.id);
    });
  });
});
```

### Phase 4: 集成测试完善（Week 4）

#### 4.1 端到端测试

**创建 `tests/__e2e__/message-flow.test.ts`：**
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer } from '../__helpers__/e2e-setup.js';

describe('消息处理端到端测试', () => {
  let server: TestServer;
  
  beforeAll(async () => {
    server = await createTestServer();
  });
  
  afterAll(async () => {
    await server.close();
  });
  
  it('应该完整处理用户消息并回复', async () => {
    // Arrange
    const userId = 'wxid_test_user';
    const message = '你好，帮我写一个快速排序';
    
    // Act
    const response = await server.simulateMessage(userId, message);
    
    // Assert
    expect(response).toBeDefined();
    expect(response.content).toContain('排序');
  });
});
```

---

## 测试规范

### 1. 命名规范

```typescript
// 文件命名
user-service.test.ts       // 单元测试
user-integration.test.ts   // 集成测试
message-flow.e2e.test.ts   // E2E 测试

// 测试描述
describe('UserService', () => {           // 被测对象
  describe('createUser', () => {          // 被测方法
    it('应该创建新用户当数据有效', () => {  // 期望行为（中文）
      // ...
    });
    
    it('应该抛出错误当邮箱已存在', () => {
      // ...
    });
  });
});
```

### 2. 结构规范（AAA 模式）

```typescript
it('应该正确计算总价', () => {
  // Arrange（准备）
  const cart = new Cart();
  cart.addItem({ price: 100, quantity: 2 });
  cart.addItem({ price: 50, quantity: 1 });
  
  // Act（执行）
  const total = cart.calculateTotal();
  
  // Assert（断言）
  expect(total).toBe(250);
});
```

### 3. Mock 规范

```typescript
// ✅ 好的做法 - 明确 Mock 依赖
vi.mock('../src/services/email.js', () => ({
  sendEmail: vi.fn(() => Promise.resolve({ sent: true }))
}));

// ❌ 避免 - Mock 实现逻辑
vi.mock('../src/services/email.js', () => ({
  sendEmail: vi.fn((to, content) => {
    if (!to.includes('@')) throw new Error('Invalid email');
    return Promise.resolve({ sent: true });
  })
}));
```

### 4. 数据工厂模式

```typescript
// tests/__fixtures__/factories.ts
export function createAgentFixture(overrides = {}) {
  return {
    id: `agent_${randomId()}`,
    name: 'Test Agent',
    wechat: {
      accountId: `wxid_${randomId()}`,
      nickname: 'Test User'
    },
    ai: {
      model: 'kimi-code',
      templateId: 'programmer',
      maxTurns: 100
    },
    ...overrides
  };
}

// 使用
const agent = createAgentFixture({ name: 'Custom Name' });
```

---

## CI/CD 集成

### GitHub Actions 配置

**.github/workflows/test.yml：**
```yaml
name: Test

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    
    strategy:
      matrix:
        node-version: [18.x, 20.x]
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: ${{ matrix.node-version }}
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run linter
      run: npm run lint
    
    - name: Run tests
      run: npm test -- --coverage
    
    - name: Upload coverage
      uses: codecov/codecov-action@v3
      with:
        files: ./coverage/lcov.info
    
    - name: Check coverage thresholds
      run: |
        if [ $(cat coverage/coverage-summary.json | jq '.total.lines.pct') -lt 80 ]; then
          echo "Coverage below threshold!"
          exit 1
        fi
```

### 预提交钩子

**.husky/pre-commit：**
```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# 只测试相关文件
npx lint-staged
npm run test:changed
```

---

## 迁移检查清单

### 基础设施
- [ ] 修复现有失败的测试
- [ ] 创建测试工具库（fixtures、helpers、mocks）
- [ ] 配置代码覆盖率工具
- [ ] 设置 CI/CD 流水线
- [ ] 添加预提交钩子

### 模块测试补充
- [ ] `agent/` - Agent 管理模块
- [ ] `kimi/` - Kimi CLI 集成
- [ ] `ilink/` - iLink 协议封装
- [ ] `longtask/` - 耗时任务管理
- [ ] `flowtask/` - 可靠任务流
- [ ] `workflow/` - 工作流系统
- [ ] `notifications/` - 通知通道
- [ ] `memory/` - 长期记忆
- [ ] `task-router/` - 任务路由
- [ ] `templates/` - 能力模板

### 文档更新
- [ ] 更新 AGENTS.md 中的测试说明
- [ ] 编写测试开发指南
- [ ] 记录 Mock 使用规范
- [ ] 创建测试数据工厂文档

---

## 时间表

| 阶段 | 时间 | 目标 | 交付物 |
|------|------|------|--------|
| Phase 1 | Week 1 | 基础设施 | 修复测试、工具库、CI/CD |
| Phase 2 | Week 2-3 | 核心模块 | Agent/Kimi/iLink 测试 |
| Phase 3 | Week 3-4 | 工作流 | LongTask/FlowTask/Workflow 测试 |
| Phase 4 | Week 4 | 集成完善 | E2E 测试、覆盖率 80%+ |

---

## 成功指标

- [ ] 测试覆盖率 >= 85%
- [ ] 所有核心模块有单元测试
- [ ] CI/CD 流水线通过
- [ ] 新功能开发遵循 TDD 流程
- [ ] 测试运行时间 < 30 秒
