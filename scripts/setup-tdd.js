#!/usr/bin/env node
/**
 * TDD 环境设置脚本
 * 一键修复测试问题并建立测试基础设施
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(__dirname, '..');

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function createFile(path, content) {
  const dir = path.substring(0, path.lastIndexOf('/'));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, content, 'utf8');
}

// ============ 创建测试基础设施 ============

function setupTestInfrastructure() {
  log('📁 创建测试基础设施...', 'blue');

  // 1. 创建 vitest.config.ts
  const vitestConfig = `import { defineConfig } from 'vitest/config';

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
        'scripts/',
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
        singleThread: true,
      },
    },
  },
});
`;
  createFile(join(rootDir, 'vitest.config.ts'), vitestConfig);
  log('  ✓ vitest.config.ts', 'green');

  // 2. 创建测试 setup 文件
  const testSetup = `/**
 * 测试全局设置
 * 在每个测试文件运行前执行
 */

import { vi } from 'vitest';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';

// 全局测试环境变量
process.env.TEST_MODE = 'true';
process.env.NODE_ENV = 'test';

// 创建临时测试目录
const testTempDir = mkdtempSync(join(tmpdir(), 'weixin-kimi-bot-test-'));
process.env.TEST_TEMP_DIR = testTempDir;

// 清理函数
export function cleanup() {
  try {
    rmSync(testTempDir, { recursive: true, force: true });
  } catch {
    // 忽略清理错误
  }
}

// 全局 Mock 外部依赖
vi.mock('../src/kimi/session.js', () => ({
  checkKimiSession: vi.fn(() => Promise.resolve({ 
    exists: true, 
    sessionId: 'test-session' 
  })),
  clearKimiSessions: vi.fn(() => Promise.resolve()),
  getSessionInfo: vi.fn(() => Promise.resolve({
    id: 'test-session',
    status: 'active'
  })),
}));

vi.mock('../src/store.js', () => ({
  loadUserSessionMeta: vi.fn(() => ({ turnCount: 0, lastActive: Date.now() })),
  saveUserSessionMeta: vi.fn(),
  resetUserSessionMeta: vi.fn(),
  clearAllUserSessionMeta: vi.fn(),
  getContextToken: vi.fn(() => 'test-token'),
  setContextToken: vi.fn(),
}));

vi.mock('../src/ilink/api.js', () => ({
  ILinkAPI: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn(() => Promise.resolve({ success: true, msgId: 'test-msg' })),
    getMessages: vi.fn(() => Promise.resolve([])),
  })),
}));

// 全局测试超时
vi.setConfig({ testTimeout: 10000 });

// 测试完成后的清理
process.on('exit', cleanup);
`;
  createFile(join(rootDir, 'tests/__helpers__/test-setup.ts'), testSetup);
  log('  ✓ tests/__helpers__/test-setup.ts', 'green');

  // 3. 创建测试数据工厂
  const factories = `/**
 * 测试数据工厂
 * 提供标准化的测试数据创建函数
 */

import type { AgentConfig } from '../../src/agent/types.js';
import type { ILinkMessage } from '../../src/ilink/types.js';

let idCounter = 0;

export function generateId(prefix: string): string {
  return \`\${prefix}_\${Date.now()}_\${++idCounter}\`;
}

/**
 * 创建 Agent 配置
 */
export function createAgentFixture(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: generateId('agent'),
    name: 'Test Agent',
    wechat: {
      accountId: generateId('wxid'),
      nickname: 'Test User',
    },
    workspace: {
      path: \`/tmp/test-workspace/\${generateId('ws')}\`,
    },
    ai: {
      model: 'kimi-code',
      templateId: 'programmer',
      maxTurns: 100,
    },
    memory: {
      enabled: true,
      autoExtract: true,
    },
    features: {
      fileAccess: true,
      webSearch: true,
      scheduledTasks: true,
    },
    ...overrides,
  } as AgentConfig;
}

/**
 * 创建微信消息
 */
export function createMessageFixture(overrides: Partial<ILinkMessage> = {}): ILinkMessage {
  return {
    msgId: generateId('msg'),
    fromUser: generateId('wxid'),
    toUser: generateId('wxid'),
    content: 'Hello, this is a test message',
    type: 1, // 文本消息
    createTime: Date.now(),
    ...overrides,
  } as ILinkMessage;
}

/**
 * 创建会话上下文
 */
export function createSessionFixture(overrides = {}) {
  return {
    id: generateId('session'),
    agentId: generateId('agent'),
    userId: generateId('wxid'),
    state: 'idle',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}
`;
  createFile(join(rootDir, 'tests/__fixtures__/factories.ts'), factories);
  log('  ✓ tests/__fixtures__/factories.ts', 'green');

  // 4. 创建 Mock 工具
  const mockUtils = `/**
 * Mock 工具函数
 */

import { vi } from 'vitest';

/**
 * 创建可控制的定时器 Mock
 */
export function mockTimers() {
  vi.useFakeTimers();
  return {
    advanceTime: (ms: number) => vi.advanceTimersByTime(ms),
    runAll: () => vi.runAllTimers(),
    restore: () => vi.useRealTimers(),
  };
}

/**
 * 创建文件系统 Mock
 */
export function mockFileSystem() {
  const files = new Map<string, string>();
  
  return {
    readFile: vi.fn((path: string) => {
      if (files.has(path)) {
        return Promise.resolve(files.get(path));
      }
      return Promise.reject(new Error('File not found'));
    }),
    writeFile: vi.fn((path: string, content: string) => {
      files.set(path, content);
      return Promise.resolve();
    }),
    exists: vi.fn((path: string) => Promise.resolve(files.has(path))),
    clear: () => files.clear(),
  };
}

/**
 * 创建 API Mock
 */
export function mockAPI() {
  const responses = new Map<string, any>();
  
  return {
    setResponse: (url: string, data: any) => {
      responses.set(url, data);
    },
    fetch: vi.fn((url: string) => {
      const data = responses.get(url);
      return Promise.resolve({
        ok: !!data,
        json: () => Promise.resolve(data || { error: 'Not found' }),
      });
    }),
    clear: () => responses.clear(),
  };
}

/**
 * 等待异步操作完成
 */
export function flushPromises() {
  return new Promise(resolve => setImmediate(resolve));
}

/**
 * 捕获控制台输出
 */
export function captureConsole() {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => logs.push(args.join(' '));
  
  return {
    logs: () => logs,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}
`;
  createFile(join(rootDir, 'tests/__helpers__/mock-utils.ts'), mockUtils);
  log('  ✓ tests/__helpers__/mock-utils.ts', 'green');
}

// ============ 修复现有问题 ============

function fixExistingIssues() {
  log('\\n🔧 修复现有测试问题...', 'blue');

  // 修复 WorkflowManager 测试问题
  const workflowManagerPath = join(rootDir, 'src/workflow/manager.ts');
  if (existsSync(workflowManagerPath)) {
    let content = readFileSync(workflowManagerPath, 'utf8');
    
    // 检查是否已经有测试支持
    if (!content.includes('options?:')) {
      // 添加构造函数参数支持
      content = content.replace(
        /constructor\s*\([^)]*\)/,
        'constructor(options?: { baseDir?: string; agentId?: string })'
      );
      
      // 修改 baseDir 赋值
      content = content.replace(
        /this\.baseDir\s*=\s*[^;]+;/,
        `const agentId = options?.agentId || 'default';
    this.baseDir = options?.baseDir || path.join(homedir(), '.weixin-kimi-bot', 'agents', agentId, 'workflows');`
      );
      
      writeFileSync(workflowManagerPath, content, 'utf8');
      log('  ✓ 修复 WorkflowManager 构造函数', 'green');
    }
  }
}

// ============ 创建示例测试 ============

function createExampleTests() {
  log('\\n📝 创建示例测试...', 'blue');

  // 1. Agent 验证测试（TDD 示例）
  const agentValidationTest = `/**
 * Agent 配置验证测试
 * TDD 示例：验证配置合法性
 */

import { describe, it, expect } from 'vitest';
import { validateAgentConfig } from '../../src/agent/validation.js';

describe('validateAgentConfig', () => {
  describe('基本验证', () => {
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
    
    it('应该检测缺少微信ID', () => {
      const config = {
        name: 'Test Agent'
      };
      
      const result = validateAgentConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('wechat.accountId is required');
    });
    
    it('应该检测无效的微信ID格式', () => {
      const config = {
        name: 'Test Agent',
        wechat: { accountId: 'invalid_id' }
      };
      
      const result = validateAgentConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('wechat.accountId must start with wxid_');
    });
  });
  
  describe('AI 配置验证', () => {
    it('应该检测缺少 AI 模型', () => {
      const config = {
        name: 'Test Agent',
        wechat: { accountId: 'wxid_test123' },
        ai: { templateId: 'programmer' }
      };
      
      const result = validateAgentConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('ai.model is required');
    });
    
    it('应该检测无效的能力模板', () => {
      const config = {
        name: 'Test Agent',
        wechat: { accountId: 'wxid_test123' },
        ai: { model: 'kimi-code', templateId: 'invalid_template' }
      };
      
      const result = validateAgentConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('ai.templateId must be one of: programmer, writer, vlog, crypto, stock, general');
    });
  });
});
`;
  createFile(join(rootDir, 'tests/agent/validation.test.ts'), agentValidationTest);
  log('  ✓ tests/agent/validation.test.ts', 'green');

  // 2. 创建验证实现（最小实现使测试通过）
  const agentValidation = `/**
 * Agent 配置验证
 */

import type { AgentConfig } from './types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const VALID_TEMPLATES = ['programmer', 'writer', 'vlog', 'crypto', 'stock', 'general'];

/**
 * 验证 Agent 配置
 * 
 * TODO: 这是 TDD 的最小实现，后续需要完善
 */
export function validateAgentConfig(config: Partial<AgentConfig>): ValidationResult {
  const errors: string[] = [];
  
  // 验证名称
  if (!config.name) {
    errors.push('name is required');
  }
  
  // 验证微信ID
  if (!config.wechat?.accountId) {
    errors.push('wechat.accountId is required');
  } else if (!config.wechat.accountId.startsWith('wxid_')) {
    errors.push('wechat.accountId must start with wxid_');
  }
  
  // 验证 AI 配置
  if (config.ai) {
    if (!config.ai.model) {
      errors.push('ai.model is required');
    }
    
    if (config.ai.templateId && !VALID_TEMPLATES.includes(config.ai.templateId)) {
      errors.push(\`ai.templateId must be one of: \${VALID_TEMPLATES.join(', ')}\`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
`;
  createFile(join(rootDir, 'src/agent/validation.ts'), agentValidation);
  log('  ✓ src/agent/validation.ts (最小实现)', 'green');

  // 3. 更新 index.ts 导出
  const agentIndex = join(rootDir, 'src/agent/index.ts');
  if (!existsSync(agentIndex)) {
    writeFileSync(agentIndex, `export * from './types.js';
export * from './manager.js';
export * from './validation.js';
`, 'utf8');
    log('  ✓ src/agent/index.ts', 'green');
  }
}

// ============ 更新 package.json ============

function updatePackageJson() {
  log('\\n📦 更新 package.json...', 'blue');
  
  const packagePath = join(rootDir, 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  
  // 添加测试相关脚本
  pkg.scripts = {
    ...pkg.scripts,
    'test:watch': 'vitest',
    'test:coverage': 'vitest run --coverage',
    'test:changed': 'vitest run --changed',
    'test:ui': 'vitest --ui',
    'lint': 'echo "TODO: Add linter"',
  };
  
  // 添加开发依赖
  pkg.devDependencies = {
    ...pkg.devDependencies,
    '@vitest/coverage-v8': '^2.0.0',
    '@vitest/ui': '^2.0.0',
  };
  
  writeFileSync(packagePath, JSON.stringify(pkg, null, 2), 'utf8');
  log('  ✓ 更新 package.json 脚本', 'green');
}

// ============ 创建 GitHub Actions ============

function createGitHubActions() {
  log('\\n🔄 创建 CI/CD 配置...', 'blue');
  
  const ciConfig = `name: Test

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]

jobs:
  test:
    runs-on: ubuntu-latest
    
    strategy:
      matrix:
        node-version: [18.x, 20.x]
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Setup Node.js \${{ matrix.node-version }}
      uses: actions/setup-node@v4
      with:
        node-version: \${{ matrix.node-version }}
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run tests
      run: npm test -- --coverage
    
    - name: Upload coverage
      uses: codecov/codecov-action@v3
      with:
        files: ./coverage/lcov.info
        fail_ci_if_error: false
`;
  
  createFile(join(rootDir, '.github/workflows/test.yml'), ciConfig);
  log('  ✓ .github/workflows/test.yml', 'green');
}

// ============ 主流程 ============

function main() {
  log('╔════════════════════════════════════════════════════════╗', 'blue');
  log('║     weixin-kimi-bot TDD 环境设置脚本                   ║', 'blue');
  log('╚════════════════════════════════════════════════════════╝', 'blue');
  log('');
  
  try {
    setupTestInfrastructure();
    fixExistingIssues();
    createExampleTests();
    updatePackageJson();
    createGitHubActions();
    
    log('');
    log('✅ TDD 环境设置完成！', 'green');
    log('');
    log('下一步：', 'yellow');
    log('  1. 运行测试: npm test', 'reset');
    log('  2. 查看覆盖率: npm run test:coverage', 'reset');
    log('  3. 阅读指南: cat TDD_QUICKSTART.md', 'reset');
    log('  4. 查看计划: cat TDD_MIGRATION_PLAN.md', 'reset');
    log('');
    
  } catch (error) {
    log('\\n❌ 设置失败:', 'red');
    log(error.message, 'red');
    process.exit(1);
  }
}

main();
