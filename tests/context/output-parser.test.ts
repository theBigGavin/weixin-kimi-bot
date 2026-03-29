/**
 * 输出解析器测试
 */

import { describe, it, expect } from 'vitest';
import { OutputParser } from '../../src/context/output-parser.js';

describe('OutputParser', () => {
  const parser = new OutputParser();

  describe('选项解析', () => {
    it('应该解析方括号格式的选项', () => {
      const content = `
我为你准备了3个方案：

[opt_1] 方案1：技术分析工具
基于K线、均线等技术指标进行分析

[opt_2] 方案2：量化交易平台
支持策略回测、自动交易

[opt_3] 方案3：智能选股助手
AI驱动的股票筛选和推荐

请选择一个方案。
      `.trim();

      const options = parser.parseOptions(content);
      
      expect(options).toHaveLength(3);
      expect(options[0].id).toBe('opt_1');
      expect(options[0].label).toBe('方案1：技术分析工具');
      expect(options[0].description).toContain('K线');
    });

    it('应该解析数字列表格式的选项', () => {
      const content = `
1. 方案一：使用TypeScript
类型安全，易于维护

2. 方案二：使用JavaScript
简单直接，快速开发
      `.trim();

      const options = parser.parseOptions(content);
      
      expect(options.length).toBeGreaterThanOrEqual(1);
    });

    it('应该解析加粗格式的选项', () => {
      const content = `
**方案A**：前端框架
React或Vue

**方案B**：后端服务
Node.js或Python
      `.trim();

      const options = parser.parseOptions(content);
      
      expect(options.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('确认请求解析', () => {
    it('应该识别确认请求', () => {
      const content = '请确认这个方案是否正确？';
      const confirmation = parser.parseConfirmation(content);
      
      expect(confirmation).not.toBeNull();
      expect(confirmation?.requiresResponse).toBe(true);
    });

    it('应该识别"是否"问句', () => {
      const content = '是否继续执行？';
      const confirmation = parser.parseConfirmation(content);
      
      expect(confirmation).not.toBeNull();
    });
  });

  describe('计划解析', () => {
    it('应该解析步骤列表', () => {
      const content = `
执行计划：

1. 分析需求
2. 设计方案
3. 编写代码
4. 测试验证
5. 部署上线
      `.trim();

      const plan = parser.parsePlan(content);
      
      expect(plan).not.toBeNull();
      expect(plan?.steps).toHaveLength(5);
      expect(plan?.steps[0]).toBe('分析需求');
    });

    it('应该解析带"步骤"关键词的计划', () => {
      const content = `
步骤1：安装依赖
步骤2：配置环境
步骤3：启动服务
      `.trim();

      const plan = parser.parsePlan(content);
      
      expect(plan).not.toBeNull();
      expect(plan?.steps.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('代码块解析', () => {
    it('应该解析代码块', () => {
      const content = `
\`\`\`typescript
const x = 1;
console.log(x);
\`\`\`
      `.trim();

      const code = parser.parseCode(content);
      
      expect(code).not.toBeNull();
      expect(code?.blocks).toHaveLength(1);
      expect(code?.blocks[0].language).toBe('typescript');
      expect(code?.blocks[0].code).toContain('const x');
    });

    it('应该解析多语言代码块', () => {
      const content = `
\`\`\`json
{"key": "value"}
\`\`\`

\`\`\`python
print("hello")
\`\`\`
      `.trim();

      const code = parser.parseCode(content);
      
      expect(code?.blocks).toHaveLength(2);
      expect(code?.blocks[0].language).toBe('json');
      expect(code?.blocks[1].language).toBe('python');
    });
  });

  describe('综合分析', () => {
    it('应该优先解析选项', () => {
      const content = `
分析完成，这是3个方案：

[opt_1] 方案1
描述

[opt_2] 方案2
描述

请确认选择哪个？
      `.trim();

      const result = parser.parse(content);
      
      expect(result.success).toBe(true);
      expect(result.content?.type).toBe('options');
    });
  });
});
