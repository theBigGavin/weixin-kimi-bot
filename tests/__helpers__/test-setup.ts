/**
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
