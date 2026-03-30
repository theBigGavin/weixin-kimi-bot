/**
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
      errors.push(`ai.templateId must be one of: ${VALID_TEMPLATES.join(', ')}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
