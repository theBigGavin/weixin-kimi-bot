/**
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
