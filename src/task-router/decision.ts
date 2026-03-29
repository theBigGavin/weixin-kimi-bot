/**
 * Task Router - 决策逻辑
 * 根据分析结果选择执行模式
 */

import {
  TaskAnalysis,
  TaskDecision,
  ExecutionMode,
  TaskExecutionConfig,
  TaskRouterConfig,
  RiskLevel,
} from './types.js';

/** 默认配置 */
export const DEFAULT_CONFIG: TaskRouterConfig = {
  complexityThreshold: {
    direct: 3,
    longtask: 7,
  },
  durationThreshold: {
    direct: 30,
    longtask: 600, // 10分钟
  },
  stepThreshold: {
    direct: 1,
    longtask: 5,
  },
  useDeepAnalysis: true,
  deepAnalysisThreshold: 0.7,
  defaultMode: 'direct',
  enableCache: true,
  cacheTtl: 5 * 60 * 1000, // 5分钟
};

/** 决策因素权重 */
interface DecisionWeights {
  complexity: number;
  duration: number;
  steps: number;
  risk: number;
  planning: number;
}

/** 决策引擎 */
export class DecisionEngine {
  private config: TaskRouterConfig;

  constructor(config: Partial<TaskRouterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 根据分析结果做决策
   */
  decide(analysis: TaskAnalysis, hasDeepAnalysis: boolean = false): TaskDecision {
    // 计算各模式的得分
    const directScore = this.calculateDirectScore(analysis);
    const longtaskScore = this.calculateLongTaskScore(analysis);
    const flowtaskScore = this.calculateFlowTaskScore(analysis);

    // 选择得分最高的模式
    const scores = [
      { mode: 'direct' as ExecutionMode, score: directScore },
      { mode: 'longtask' as ExecutionMode, score: longtaskScore },
      { mode: 'flowtask' as ExecutionMode, score: flowtaskScore },
    ];

    scores.sort((a, b) => b.score - a.score);
    const selected = scores[0];

    // 计算置信度
    const confidence = this.calculateConfidence(selected.score, scores, hasDeepAnalysis);

    // 生成决策理由
    const reason = this.generateReason(analysis, selected.mode, scores);

    // 生成执行配置
    const config = this.generateConfig(analysis, selected.mode);

    return {
      mode: selected.mode,
      confidence,
      reason,
      analysis,
      config,
    };
  }

  /**
   * 计算直接执行得分
   */
  private calculateDirectScore(analysis: TaskAnalysis): number {
    let score = 100;

    // 复杂度扣分
    if (analysis.complexity > this.config.complexityThreshold.direct) {
      score -= (analysis.complexity - this.config.complexityThreshold.direct) * 15;
    }

    // 耗时扣分
    if (analysis.estimatedDuration > this.config.durationThreshold.direct) {
      score -= (analysis.estimatedDuration - this.config.durationThreshold.direct) * 0.5;
    }

    // 步骤扣分
    if (analysis.stepCount > this.config.stepThreshold.direct) {
      score -= (analysis.stepCount - this.config.stepThreshold.direct) * 10;
    }

    // 需要规划大幅扣分
    if (analysis.requiresPlanning) {
      score -= 30;
    }

    // 多文件扣分
    if (analysis.involvesMultipleFiles) {
      score -= 15;
    }

    // 风险等级扣分
    score -= this.riskPenalty(analysis.riskLevel) * 2;

    return Math.max(0, score);
  }

  /**
   * 计算 LongTask 得分
   */
  private calculateLongTaskScore(analysis: TaskAnalysis): number {
    let score = 50;

    // 复杂度适中加分
    if (analysis.complexity > this.config.complexityThreshold.direct &&
        analysis.complexity <= this.config.complexityThreshold.longtask) {
      score += 20;
    }

    // 需要后台执行的指标
    if (analysis.estimatedDuration > this.config.durationThreshold.direct) {
      score += 15;
    }

    if (analysis.estimatedDuration > 120) { // 超过2分钟
      score += 10;
    }

    // 不涉及复杂规划的加分
    if (!analysis.requiresPlanning) {
      score += 10;
    }

    // 步骤适中
    if (analysis.stepCount > 1 && analysis.stepCount <= this.config.stepThreshold.longtask) {
      score += 10;
    }

    // 写操作加分（后台执行更安全）
    if (analysis.involvesWrite) {
      score += 10;
    }

    // 复杂度太高则减分（应该用 FlowTask）
    if (analysis.complexity > this.config.complexityThreshold.longtask) {
      score -= (analysis.complexity - this.config.complexityThreshold.longtask) * 15;
    }

    // 步骤太多减分
    if (analysis.stepCount > this.config.stepThreshold.longtask) {
      score -= (analysis.stepCount - this.config.stepThreshold.longtask) * 10;
    }

    return Math.max(0, score);
  }

  /**
   * 计算 FlowTask 得分
   */
  private calculateFlowTaskScore(analysis: TaskAnalysis): number {
    let score = 30;

    // 高复杂度大幅加分
    if (analysis.complexity > this.config.complexityThreshold.longtask) {
      score += (analysis.complexity - this.config.complexityThreshold.longtask) * 15;
    }

    // 需要规划大幅加分
    if (analysis.requiresPlanning) {
      score += 25;
    }

    // 多步骤加分
    if (analysis.stepCount > this.config.stepThreshold.longtask) {
      score += (analysis.stepCount - this.config.stepThreshold.longtask) * 8;
    }

    // 长时间执行加分
    if (analysis.estimatedDuration > this.config.durationThreshold.longtask) {
      score += 15;
    }

    // 多文件操作加分
    if (analysis.involvesMultipleFiles) {
      score += 10;
    }

    // 高风险操作加分（需要确认机制）
    if (analysis.riskLevel === 'high') {
      score += 15;
    }

    // 简单任务减分
    if (analysis.complexity <= this.config.complexityThreshold.direct) {
      score -= 30;
    }

    return Math.max(0, score);
  }

  /**
   * 计算风险惩罚分
   */
  private riskPenalty(risk: RiskLevel): number {
    const penalties: Record<RiskLevel, number> = { low: 0, medium: 10, high: 25 };
    return penalties[risk];
  }

  /**
   * 计算置信度
   */
  private calculateConfidence(
    selectedScore: number,
    allScores: { mode: ExecutionMode; score: number }[],
    hasDeepAnalysis: boolean
  ): number {
    const totalScore = allScores.reduce((sum, s) => sum + s.score, 0);
    if (totalScore === 0) return 0.5;

    // 基础置信度：选中模式的得分占比
    let confidence = selectedScore / totalScore;

    // 得分差距加分
    const sorted = [...allScores].sort((a, b) => b.score - a.score);
    if (sorted.length >= 2) {
      const gap = sorted[0].score - sorted[1].score;
      confidence += gap / 200; // 差距越大置信度越高
    }

    // 深度分析增加置信度
    if (hasDeepAnalysis) {
      confidence += 0.1;
    }

    return Math.min(1, Math.max(0, confidence));
  }

  /**
   * 生成决策理由
   */
  private generateReason(
    analysis: TaskAnalysis,
    selectedMode: ExecutionMode,
    scores: { mode: ExecutionMode; score: number }[]
  ): string {
    const reasons: string[] = [];

    switch (selectedMode) {
      case 'direct':
        if (analysis.complexity <= 3) {
          reasons.push('任务复杂度较低');
        }
        if (analysis.estimatedDuration <= 30) {
          reasons.push('预计执行时间短');
        }
        if (!analysis.requiresPlanning) {
          reasons.push('无需复杂规划');
        }
        if (!analysis.involvesWrite) {
          reasons.push('只读操作，无风险');
        }
        break;

      case 'longtask':
        if (analysis.estimatedDuration > 30) {
          reasons.push('预计执行时间较长，需要后台执行');
        }
        if (analysis.involvesWrite) {
          reasons.push('涉及文件修改，使用后台执行更安全');
        }
        if (analysis.stepCount > 1 && analysis.stepCount <= 5) {
          reasons.push('需要多步操作但无需复杂规划');
        }
        break;

      case 'flowtask':
        if (analysis.requiresPlanning) {
          reasons.push('任务需要结构化规划和执行');
        }
        if (analysis.complexity > 7) {
          reasons.push('任务复杂度高，需要可靠的执行机制');
        }
        if (analysis.stepCount > 5) {
          reasons.push('涉及多步骤执行');
        }
        if (analysis.involvesMultipleFiles) {
          reasons.push('涉及多文件操作');
        }
        if (analysis.riskLevel === 'high') {
          reasons.push('高风险操作，需要确认机制');
        }
        break;
    }

    if (reasons.length === 0) {
      reasons.push('根据综合评分选择');
    }

    // 添加评分对比
    const scoreInfo = scores
      .map(s => `${s.mode}=${Math.round(s.score)}`)
      .join(', ');
    
    return `${reasons.join('，')}。模式得分: ${scoreInfo}`;
  }

  /**
   * 生成执行配置
   */
  private generateConfig(
    analysis: TaskAnalysis,
    mode: ExecutionMode
  ): TaskExecutionConfig {
    const config: TaskExecutionConfig = {};

    switch (mode) {
      case 'direct':
        config.direct = {
          timeout: Math.min(300, Math.max(30, analysis.estimatedDuration * 2)),
          enableTools: analysis.involvesShell || analysis.requiresWebSearch,
        };
        break;

      case 'longtask':
        config.longtask = {
          priority: this.calculatePriority(analysis),
          maxTurns: Math.min(50, Math.max(10, analysis.stepCount * 3)),
          autoRetry: analysis.riskLevel !== 'high',
        };
        break;

      case 'flowtask':
        config.flowtask = {
          autoApproveLowRisk: analysis.riskLevel !== 'high',
          requireCheckpoint: analysis.riskLevel === 'high' || analysis.stepCount > 10,
          maxSteps: Math.min(50, Math.max(10, analysis.stepCount * 2)),
          allowSplitting: analysis.stepCount > 10,
        };
        break;
    }

    return config;
  }

  /**
   * 计算优先级
   */
  private calculatePriority(analysis: TaskAnalysis): number {
    let priority = 5;

    // 高优先级因素
    if (analysis.riskLevel === 'high') priority += 2;
    if (analysis.estimatedDuration < 60) priority += 1;

    // 低优先级因素
    if (analysis.estimatedDuration > 600) priority -= 1;
    if (analysis.stepCount > 20) priority -= 1;

    return Math.min(10, Math.max(1, priority));
  }

  /**
   * 判断是否需要深度分析
   */
  needsDeepAnalysis(analysis: TaskAnalysis, quickConfidence: number): boolean {
    if (!this.config.useDeepAnalysis) return false;
    
    // 置信度低时需要深度分析
    if (quickConfidence < this.config.deepAnalysisThreshold) {
      return true;
    }

    // 边界情况需要深度分析
    const complexity = analysis.complexity;
    if (complexity === this.config.complexityThreshold.direct ||
        complexity === this.config.complexityThreshold.longtask) {
      return true;
    }

    // 矛盾指标需要深度分析
    if (analysis.complexity <= 3 && analysis.stepCount > 5) {
      return true;
    }
    if (analysis.complexity >= 8 && analysis.stepCount <= 2) {
      return true;
    }

    return false;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<TaskRouterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): TaskRouterConfig {
    return { ...this.config };
  }
}

// 导出单例
export const decisionEngine = new DecisionEngine();
