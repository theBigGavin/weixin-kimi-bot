/**
 * Task Router - 规则引擎
 * 基于关键词和模式的快速分析规则
 */

import { TaskAnalysis, RuleMatch, TaskDomain, RiskLevel } from './types.js';

/** 规则权重定义 */
interface RuleWeight {
  complexity: number;
  duration: number;
  steps: number;
  risk: number;
}

/** 单条规则定义 */
interface AnalysisRule {
  /** 规则名称 */
  name: string;
  /** 匹配模式 */
  patterns: RegExp[];
  /** 排除模式（如果匹配则忽略此规则） */
  excludePatterns?: RegExp[];
  /** 影响的领域 */
  domain: TaskDomain;
  /** 权重调整 */
  weights: RuleWeight;
  /** 关键词 */
  keywords: string[];
  /** 是否涉及写操作 */
  involvesWrite?: boolean;
  /** 是否涉及 shell 命令 */
  involvesShell?: boolean;
  /** 是否涉及多文件 */
  involvesMultipleFiles?: boolean;
  /** 是否需要网络搜索 */
  requiresWebSearch?: boolean;
  /** 风险等级覆盖 */
  riskLevel?: RiskLevel;
}

/** 复杂度评分规则 */
const COMPLEXITY_RULES: AnalysisRule[] = [
  // ========== FlowTask 级别规则 (复杂度 8-10) ==========
  {
    name: 'large_refactor',
    patterns: [
      /重构.*项目|重构.*系统/i,
      /大规模.*重构|整体.*重构/i,
      /重写.*架构|架构.*升级/i,
      /migrat.*(project|codebase|system)/i,
      /refactor.*(entire|whole|large)/i,
      /重写.*项目|重写.*系统/i,
    ],
    domain: 'refactor',
    weights: { complexity: 9, duration: 600, steps: 15, risk: 8 },
    keywords: ['重构', '项目', '系统', '架构', '重写', '大规模'],
    involvesWrite: true,
    involvesMultipleFiles: true,
    riskLevel: 'high',
  },
  {
    name: 'complex_analysis',
    patterns: [
      /分析.*代码库|分析.*项目.*结构/i,
      /codebase.*analys/i,
      /依赖.*分析|耦合.*分析/i,
      /生成.*架构图|生成.*流程图/i,
      /分析.*所有.*文件|扫描.*整个/i,
    ],
    domain: 'analysis',
    weights: { complexity: 8, duration: 300, steps: 8, risk: 3 },
    keywords: ['分析', '代码库', '项目结构', '依赖', '架构图'],
    involvesMultipleFiles: true,
  },
  {
    name: 'multi_step_task',
    patterns: [
      /先.*然后.*再/i,
      /第一步.*第二步.*第三步/i,
      /分.*步骤|分.*阶段/i,
      /流程.*实现|完整.*流程/i,
      /从.*开始.*到.*结束/i,
    ],
    domain: 'other',
    weights: { complexity: 8, duration: 400, steps: 10, risk: 5 },
    keywords: ['步骤', '阶段', '流程', '实现', '计划'],
    involvesWrite: true,
  },
  {
    name: 'batch_processing',
    patterns: [
      /批量.*处理|批量.*修改/i,
      /处理.*所有.*文件/i,
      /批量.*替换|批量.*重命名/i,
      /batch.*process/i,
      /bulk.*(update|modify|rename)/i,
      /处理.*(\d+)个.*文件/i,
    ],
    domain: 'code',
    weights: { complexity: 8, duration: 300, steps: 6, risk: 6 },
    keywords: ['批量', '处理', '所有文件', '替换', '重命名'],
    involvesWrite: true,
    involvesMultipleFiles: true,
    riskLevel: 'medium',
  },
  {
    name: 'feature_implementation',
    patterns: [
      /实现.*功能|开发.*模块/i,
      /添加.*系统|添加.*服务/i,
      /implement.*feature|develop.*module/i,
      /添加.*完整.*功能/i,
      /开发.*新.*功能/i,
    ],
    domain: 'code',
    weights: { complexity: 9, duration: 480, steps: 12, risk: 6 },
    keywords: ['实现', '功能', '开发', '模块', '系统', '服务'],
    involvesWrite: true,
    involvesMultipleFiles: true,
    riskLevel: 'medium',
  },

  // ========== LongTask 级别规则 (复杂度 4-7) ==========
  {
    name: 'code_refactor',
    patterns: [
      /重构|重构代码|rewrite|refactor/i,
      /优化.*代码|改进.*实现/i,
      /简化.*逻辑|提取.*函数/i,
    ],
    excludePatterns: [
      /重构.*命名|重命名|rename/i,  // 简单重命名排除
    ],
    domain: 'refactor',
    weights: { complexity: 6, duration: 180, steps: 4, risk: 4 },
    keywords: ['重构', '优化', '改进', '简化', '提取'],
    involvesWrite: true,
    riskLevel: 'medium',
  },
  {
    name: 'migration',
    patterns: [
      /迁移|migrate|migration/i,
      /升级.*版本|版本.*升级/i,
      /迁移到|migrate to/i,
    ],
    domain: 'refactor',
    weights: { complexity: 7, duration: 300, steps: 6, risk: 5 },
    keywords: ['迁移', '升级', '版本', '转换'],
    involvesWrite: true,
    involvesMultipleFiles: true,
    riskLevel: 'medium',
  },
  {
    name: 'build_compile',
    patterns: [
      /构建|build|compile/i,
      /打包|bundle|webpack/i,
      /编译.*项目|构建.*系统/i,
    ],
    domain: 'deployment',
    weights: { complexity: 5, duration: 120, steps: 3, risk: 3 },
    keywords: ['构建', '编译', '打包', 'build', 'webpack'],
    involvesShell: true,
  },
  {
    name: 'testing',
    patterns: [
      /测试|test|testing/i,
      /单元测试|集成测试/i,
      /跑测试|运行.*测试/i,
      /生成.*测试|编写.*测试/i,
    ],
    domain: 'testing',
    weights: { complexity: 5, duration: 120, steps: 3, risk: 2 },
    keywords: ['测试', '单元测试', '集成测试', 'jest', 'mocha'],
    involvesWrite: true,
    involvesShell: true,
  },
  {
    name: 'code_generation',
    patterns: [
      /生成.*代码|创建.*文件/i,
      /生成.*组件|生成.*模块/i,
      /脚手架|scaffold/i,
      /创建.*类|创建.*接口/i,
    ],
    domain: 'code',
    weights: { complexity: 5, duration: 90, steps: 3, risk: 3 },
    keywords: ['生成', '创建', '组件', '模块', '脚手架'],
    involvesWrite: true,
  },
  {
    name: 'scan_search',
    patterns: [
      /扫描|scan/i,
      /查找.*所有|搜索.*全部/i,
      /检查.*项目|检查.*代码/i,
      /统计.*代码|统计.*文件/i,
    ],
    domain: 'analysis',
    weights: { complexity: 5, duration: 60, steps: 2, risk: 1 },
    keywords: ['扫描', '查找', '搜索', '检查', '统计'],
    involvesMultipleFiles: true,
  },
  {
    name: 'file_processing',
    patterns: [
      /处理.*文件|process.*files/i,
      /读取.*文件|解析.*文件/i,
      /修改.*配置|更新.*配置/i,
      /处理.*(\d+)个/i,
    ],
    domain: 'code',
    weights: { complexity: 5, duration: 90, steps: 3, risk: 3 },
    keywords: ['处理', '文件', '读取', '解析', '修改', '配置'],
    involvesWrite: true,
  },
  {
    name: 'documentation',
    patterns: [
      /生成.*文档|更新.*文档/i,
      /编写.*README|完善.*文档/i,
      /生成.*注释|添加.*注释/i,
      /文档.*生成|自动生成.*文档/i,
    ],
    domain: 'documentation',
    weights: { complexity: 4, duration: 60, steps: 2, risk: 1 },
    keywords: ['文档', 'README', '注释', '生成'],
    involvesWrite: true,
  },

  // ========== Direct 级别规则 (复杂度 1-3) ==========
  {
    name: 'simple_question',
    patterns: [
      /^什么是|^怎么|^如何|^为什么/i,
      /^请问|^请教|^咨询/i,
      /\?$/,
      /解释一下|介绍一下/i,
      /help|usage|如何使用/i,
    ],
    excludePatterns: [
      /如何实现|怎么开发|如何构建/i,  // 排除复杂操作
    ],
    domain: 'question',
    weights: { complexity: 2, duration: 15, steps: 1, risk: 0 },
    keywords: ['问题', '解释', '介绍', '什么是', '怎么'],
  },
  {
    name: 'code_review_simple',
    patterns: [
      /看看.*这段代码|检查.*代码/i,
      /这段.*代码.*怎么样|review.*code/i,
      /优化.*这段|改进.*这段/i,
      /^```[\s\S]*```$/m,  // 只有代码块
    ],
    domain: 'code',
    weights: { complexity: 3, duration: 30, steps: 1, risk: 1 },
    keywords: ['代码', '检查', 'review', '看看'],
  },
  {
    name: 'simple_edit',
    patterns: [
      /修改.*命名|重命名|rename/i,
      /改.*名字|改.*变量名/i,
      /修改变量|修改常量/i,
      /改一下.*格式/i,
    ],
    domain: 'code',
    weights: { complexity: 2, duration: 20, steps: 1, risk: 2 },
    keywords: ['修改', '重命名', '变量名', '名字'],
    involvesWrite: true,
  },
  {
    name: 'conversation',
    patterns: [
      /^你好|^嗨|^hi|^hello/i,
      /谢谢|感谢|再见|拜拜/i,
      /好的|明白|了解|OK/i,
    ],
    domain: 'conversation',
    weights: { complexity: 1, duration: 5, steps: 1, risk: 0 },
    keywords: ['问候', '对话'],
  },
  {
    name: 'read_only',
    patterns: [
      /查看.*文件|读取.*内容/i,
      /显示.*代码|展示.*实现/i,
      /获取.*信息|查询.*状态/i,
      /cat|less|more|head|tail/i,
    ],
    domain: 'analysis',
    weights: { complexity: 2, duration: 15, steps: 1, risk: 0 },
    keywords: ['查看', '读取', '显示', '展示', '获取', '查询'],
  },
];

/** 风险规则 - 根据关键词判断风险等级 */
const RISK_RULES: { pattern: RegExp; level: RiskLevel; reason: string }[] = [
  // High risk
  { pattern: /rm -rf|删除.*目录|清空.*数据/i, level: 'high', reason: '涉及删除操作' },
  { pattern: /DROP TABLE|DELETE FROM|清空表/i, level: 'high', reason: '涉及数据库删除' },
  { pattern: /修改.*生产|修改.*线上|生产.*环境/i, level: 'high', reason: '涉及生产环境' },
  { pattern: /发布|deploy.*prod|上线/i, level: 'high', reason: '涉及发布操作' },
  
  // Medium risk
  { pattern: /修改.*配置|更新.*配置/i, level: 'medium', reason: '涉及配置修改' },
  { pattern: /安装.*依赖|更新.*包/i, level: 'medium', reason: '涉及依赖变更' },
  { pattern: /修改.*权限|chmod|chown/i, level: 'medium', reason: '涉及权限修改' },
  { pattern: /执行.*脚本|运行.*命令/i, level: 'medium', reason: '涉及命令执行' },
  
  // Low risk (默认)
];

/** 网络搜索关键词 */
const WEB_SEARCH_KEYWORDS = [
  /搜索.*网上|网上.*搜索/i,
  /查一下.*最新|最新.*版本/i,
  /搜索.*文档|官方.*文档/i,
  /google|search.*web/i,
  /查.*资料|查.*信息/i,
];

/**
 * 规则引擎类
 */
export class RuleEngine {
  private rules: AnalysisRule[];

  constructor(rules: AnalysisRule[] = COMPLEXITY_RULES) {
    this.rules = rules;
  }

  /**
   * 分析文本，返回匹配的规则和得分
   */
  analyze(prompt: string): RuleMatch[] {
    const matches: RuleMatch[] = [];
    const lowerPrompt = prompt.toLowerCase();

    for (const rule of this.rules) {
      // 检查排除模式
      if (rule.excludePatterns) {
        const excluded = rule.excludePatterns.some(p => p.test(prompt));
        if (excluded) continue;
      }

      // 检查匹配模式
      const matchedPatterns = rule.patterns.filter(p => p.test(prompt));
      if (matchedPatterns.length === 0) continue;

      // 计算得分
      const score = this.calculateScore(rule, prompt, matchedPatterns);
      
      matches.push({
        rule: rule.name,
        score,
        matchedElements: [
          ...matchedPatterns.map(p => p.source),
          ...rule.keywords.filter(k => lowerPrompt.includes(k.toLowerCase())),
        ],
      });
    }

    // 按得分排序
    return matches.sort((a, b) => b.score - a.score);
  }

  /**
   * 计算规则匹配得分
   */
  private calculateScore(
    rule: AnalysisRule,
    prompt: string,
    matchedPatterns: RegExp[]
  ): number {
    let score = matchedPatterns.length * 10;
    
    // 关键词匹配加分
    const lowerPrompt = prompt.toLowerCase();
    const keywordMatches = rule.keywords.filter(k => 
      lowerPrompt.includes(k.toLowerCase())
    ).length;
    score += keywordMatches * 5;

    // 规则权重越高，基础分越高
    score += rule.weights.complexity * 2;

    return score;
  }

  /**
   * 根据规则生成分析结果
   */
  generateAnalysis(prompt: string, topMatches: RuleMatch[]): Partial<TaskAnalysis> {
    if (topMatches.length === 0) {
      return {
        complexity: 3,
        estimatedDuration: 30,
        stepCount: 1,
        requiresPlanning: false,
        riskLevel: 'low',
        involvesWrite: false,
        involvesShell: false,
        domain: 'other',
        keywords: [],
        involvesMultipleFiles: false,
        requiresWebSearch: false,
      };
    }

    // 获取匹配的规则详情
    const matchedRules = topMatches
      .map(m => this.rules.find(r => r.name === m.rule))
      .filter((r): r is AnalysisRule => r !== undefined);

    // 加权平均计算各项指标
    const totalScore = topMatches.reduce((sum, m) => sum + m.score, 0);
    
    const complexity = this.weightedAverage(
      matchedRules.map(r => ({ value: r.weights.complexity, weight: 
        topMatches.find(m => m.rule === r.name)?.score || 0 }))
    );

    const duration = this.weightedAverage(
      matchedRules.map(r => ({ value: r.weights.duration, weight: 
        topMatches.find(m => m.rule === r.name)?.score || 0 }))
    );

    const steps = this.weightedAverage(
      matchedRules.map(r => ({ value: r.weights.steps, weight: 
        topMatches.find(m => m.rule === r.name)?.score || 0 }))
    );

    // 确定主要领域（得分最高的）
    const domain = matchedRules[0]?.domain || 'other';

    // 合并所有关键词
    const keywords = [...new Set(matchedRules.flatMap(r => r.keywords))];

    // 判断各项标志
    const involvesWrite = matchedRules.some(r => r.involvesWrite);
    const involvesShell = matchedRules.some(r => r.involvesShell);
    const involvesMultipleFiles = matchedRules.some(r => r.involvesMultipleFiles);
    const requiresWebSearch = WEB_SEARCH_KEYWORDS.some(p => p.test(prompt));

    // 判断风险等级
    let riskLevel: RiskLevel = 'low';
    for (const riskRule of RISK_RULES) {
      if (riskRule.pattern.test(prompt)) {
        riskLevel = riskRule.level;
        break;
      }
    }
    // 如果有规则指定了风险等级，取最高
    const levelPriority: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
    for (const rule of matchedRules) {
      if (rule.riskLevel) {
        if (levelPriority[rule.riskLevel] > levelPriority[riskLevel]) {
          riskLevel = rule.riskLevel;
        }
      }
    }

    return {
      complexity: Math.round(complexity),
      estimatedDuration: Math.round(duration),
      stepCount: Math.round(steps),
      requiresPlanning: steps > 5 || complexity > 7,
      riskLevel,
      involvesWrite,
      involvesShell,
      domain,
      keywords: keywords.slice(0, 10), // 最多10个关键词
      involvesMultipleFiles,
      requiresWebSearch,
    };
  }

  /**
   * 加权平均计算
   */
  private weightedAverage(items: { value: number; weight: number }[]): number {
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight === 0) return 3;
    
    const sum = items.reduce((acc, item) => acc + item.value * item.weight, 0);
    return sum / totalWeight;
  }

  /**
   * 获取所有规则名称（用于调试）
   */
  getRuleNames(): string[] {
    return this.rules.map(r => r.name);
  }
}

// 导出单例
export const ruleEngine = new RuleEngine();
