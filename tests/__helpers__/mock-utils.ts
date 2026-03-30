/**
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
