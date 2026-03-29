/**
 * Helper Utils 测试
 */

import { describe, it, expect } from 'vitest';
import { sleep, parseCommand } from '../../src/utils/helpers.js';

describe('sleep', () => {
  it('should return a promise', () => {
    const result = sleep(100);
    expect(result).toBeInstanceOf(Promise);
  });

  it('should resolve after specified time', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    
    expect(elapsed).toBeGreaterThanOrEqual(45); // Allow small variance
  });

  it('should resolve with undefined', async () => {
    const result = await sleep(10);
    expect(result).toBeUndefined();
  });
});

describe('parseCommand', () => {
  it('should parse command without arguments', () => {
    const result = parseCommand('/help');
    
    expect(result).toEqual({
      command: 'help',
      args: '',
    });
  });

  it('should parse command with arguments', () => {
    const result = parseCommand('/help something here');
    
    expect(result).toEqual({
      command: 'help',
      args: 'something here',
    });
  });

  it('should parse command with multiple spaces', () => {
    const result = parseCommand('/status   detailed   info');
    
    expect(result).toEqual({
      command: 'status',
      args: 'detailed   info',
    });
  });

  it('should return null for non-command text', () => {
    const result = parseCommand('Hello world');
    
    expect(result).toBeNull();
  });

  it('should return empty command for slash with spaces', () => {
    const result = parseCommand('/   ');
    
    expect(result).toEqual({
      command: '',
      args: '',
    });
  });

  it('should handle single slash', () => {
    const result = parseCommand('/');
    
    expect(result).toEqual({
      command: '',
      args: '',
    });
  });

  it('should handle command with various characters', () => {
    const result = parseCommand('/task:create arg1 arg2');
    
    expect(result).toEqual({
      command: 'task:create',
      args: 'arg1 arg2',
    });
  });

  it('should return null for empty string', () => {
    const result = parseCommand('');
    
    expect(result).toBeNull();
  });

  it('should return null for whitespace only', () => {
    const result = parseCommand('   ');
    
    expect(result).toBeNull();
  });

  it('should convert command to lowercase', () => {
    const result = parseCommand('/HELP');
    
    expect(result).toEqual({
      command: 'help',
      args: '',
    });
  });

  it('should preserve args case', () => {
    const result = parseCommand('/template SWITCH Default');
    
    expect(result).toEqual({
      command: 'template',
      args: 'SWITCH Default',
    });
  });

  it('should trim args', () => {
    const result = parseCommand('/reset   extra spaces   ');
    
    expect(result).toEqual({
      command: 'reset',
      args: 'extra spaces',
    });
  });
});
