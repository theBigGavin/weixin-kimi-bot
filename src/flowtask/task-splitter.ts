/**
 * 大任务拆分器 - 方案2实现
 * 
 * 自动将大任务拆分为多个小任务（子任务）：
 * 1. 分析任务复杂度和预估步骤数
 * 2. 当预估步骤数超过阈值时，自动拆分为子任务
 * 3. 子任务可以并行或串行执行
 * 4. 支持子任务结果合并
 * 
 * 关键特性：
 * - 自动识别可拆分的任务类型
 * - 智能拆分策略（按文件、按模块、按阶段）
 * - 子任务依赖关系管理
 * - 结果自动聚合
 */

import type { ValidatedPlan, PlanStep, StepType, RiskLevel, ErrorAction } from "./types.js";

/**
 * 子任务定义
 */
export interface SubTask {
  id: string;
  name: string;
  description: string;
  goal: string;
  steps: PlanStep[];
  dependencies: string[]; // 依赖的子任务ID
  estimatedDuration: number; // 预估执行时间（毫秒）
  canParallel: boolean; // 是否可以并行执行
  priority: number; // 优先级（越小越优先）
}

/**
 * 拆分后的任务组
 */
export interface SplitTaskGroup {
  originalGoal: string;
  subTasks: SubTask[];
  totalSteps: number;
  parallelGroups: string[][]; // 可以并行执行的子任务组
  mergeStrategy: "sequential" | "aggregate" | "custom";
}

/**
 * 拆分策略配置
 */
export interface SplitStrategy {
  maxStepsPerTask: number;
  enableParallel: boolean;
  splitBy: "file" | "module" | "phase" | "auto";
}

/**
 * 拆分结果
 */
export interface TaskSplitResult {
  shouldSplit: boolean;
  reason?: string;
  splitGroup?: SplitTaskGroup;
}

/**
 * 任务拆分器
 */
export class TaskSplitter {
  private config: SplitStrategy;

  constructor(config: Partial<SplitStrategy> = {}) {
    this.config = {
      maxStepsPerTask: 10,
      enableParallel: true,
      splitBy: "auto",
      ...config,
    };
  }

  /**
   * 分析任务并决定是否拆分
   */
  analyze(plan: ValidatedPlan): TaskSplitResult {
    const stepCount = plan.steps.length;

    // 如果步骤数未超过阈值，不需要拆分
    if (stepCount <= this.config.maxStepsPerTask) {
      return { shouldSplit: false };
    }

    // 分析任务类型和拆分策略
    const strategy = this.detectSplitStrategy(plan);
    
    // 执行拆分
    const subTasks = this.splitPlan(plan, strategy);
    
    // 计算并行组
    const parallelGroups = this.config.enableParallel 
      ? this.calculateParallelGroups(subTasks)
      : [subTasks.map(st => st.id)];

    return {
      shouldSplit: true,
      reason: `任务包含 ${stepCount} 个步骤，超过阈值 ${this.config.maxStepsPerTask}，已拆分为 ${subTasks.length} 个子任务`,
      splitGroup: {
        originalGoal: plan.goal,
        subTasks,
        totalSteps: stepCount,
        parallelGroups,
        mergeStrategy: this.detectMergeStrategy(plan),
      },
    };
  }

  /**
   * 检测拆分策略
   */
  private detectSplitStrategy(plan: ValidatedPlan): SplitStrategy["splitBy"] {
    if (this.config.splitBy !== "auto") {
      return this.config.splitBy;
    }

    const steps = plan.steps;
    
    // 检查是否有明显的文件操作分组
    const filePatterns = this.extractFilePatterns(steps);
    if (filePatterns.length >= 3) {
      return "file";
    }

    // 检查是否有明显的阶段划分
    const phases = this.detectPhases(steps);
    if (phases.length >= 2) {
      return "phase";
    }

    // 检查是否有模块划分
    const modules = this.detectModules(steps);
    if (modules.length >= 2) {
      return "module";
    }

    // 默认按阶段拆分
    return "phase";
  }

  /**
   * 提取文件操作模式
   */
  private extractFilePatterns(steps: PlanStep[]): string[] {
    const patterns = new Set<string>();
    
    for (const step of steps) {
      const paths = step.inputs?.paths || [];
      for (const path of paths) {
        // 提取目录或文件类型
        const parts = path.split("/");
        if (parts.length > 1) {
          patterns.add(parts[0]);
        }
        // 提取文件扩展名
        const ext = path.split(".").pop();
        if (ext && ext !== path) {
          patterns.add(`*.${ext}`);
        }
      }
    }

    return Array.from(patterns);
  }

  /**
   * 检测任务阶段
   */
  private detectPhases(steps: PlanStep[]): string[] {
    const phases: string[] = [];
    const phaseKeywords: Record<string, string[]> = {
      analysis: ["分析", "analyze", "搜索", "查找", "探索", "explore", "扫描", "scan"],
      planning: ["计划", "规划", "plan", "设计", "design"],
      implementation: ["实现", "编写", "write", "创建", "create", "修改", "update", "重构", "refactor"],
      validation: ["验证", "测试", "test", "检查", "check", "验证", "validate"],
      deployment: ["部署", "发布", "deploy", "push", "提交", "commit"],
    };

    let currentPhase = "";
    for (const step of steps) {
      const desc = step.description.toLowerCase();
      
      for (const [phase, keywords] of Object.entries(phaseKeywords)) {
        if (keywords.some(kw => desc.includes(kw.toLowerCase()))) {
          if (phase !== currentPhase) {
            currentPhase = phase;
            if (!phases.includes(phase)) {
              phases.push(phase);
            }
          }
          break;
        }
      }
    }

    return phases;
  }

  /**
   * 检测模块
   */
  private detectModules(steps: PlanStep[]): string[] {
    const modules = new Set<string>();
    
    for (const step of steps) {
      const desc = step.description.toLowerCase();
      
      // 常见的模块关键词
      const moduleKeywords = [
        "auth", "user", "product", "order", "payment",
        "api", "service", "controller", "model", "view",
        "database", "cache", "queue", "notification",
        "登录", "用户", "产品", "订单", "支付",
        "认证", "授权", "数据库", "缓存", "队列"
      ];

      for (const kw of moduleKeywords) {
        if (desc.includes(kw.toLowerCase())) {
          modules.add(kw);
        }
      }
    }

    return Array.from(modules);
  }

  /**
   * 拆分计划
   */
  private splitPlan(plan: ValidatedPlan, strategy: SplitStrategy["splitBy"]): SubTask[] {
    switch (strategy) {
      case "file":
        return this.splitByFile(plan);
      case "module":
        return this.splitByModule(plan);
      case "phase":
      default:
        return this.splitByPhase(plan);
    }
  }

  /**
   * 按阶段拆分
   */
  private splitByPhase(plan: ValidatedPlan): SubTask[] {
    const phases = [
      { name: "analysis", keywords: ["分析", "analyze", "搜索", "查找", "探索", "explore", "扫描", "scan", "read", "查看"] },
      { name: "planning", keywords: ["计划", "规划", "plan", "设计", "design"] },
      { name: "implementation", keywords: ["实现", "编写", "write", "创建", "create", "修改", "update", "重构", "refactor", "shell", "npm"] },
      { name: "validation", keywords: ["验证", "测试", "test", "检查", "check", "验证", "validate"] },
      { name: "deployment", keywords: ["部署", "发布", "deploy", "push", "提交", "commit", "git"] },
    ];

    const subTasks: SubTask[] = [];
    const steps = [...plan.steps];
    
    let currentPhaseIndex = 0;
    let currentSteps: PlanStep[] = [];

    for (const step of steps) {
      const desc = step.description.toLowerCase();
      let matchedPhase = -1;

      for (let i = 0; i < phases.length; i++) {
        if (phases[i].keywords.some(kw => desc.includes(kw.toLowerCase()))) {
          matchedPhase = i;
          break;
        }
      }

      // 如果阶段变化且当前有步骤，创建子任务
      if (matchedPhase !== -1 && matchedPhase !== currentPhaseIndex && currentSteps.length > 0) {
        subTasks.push(this.createSubTask(
          subTasks.length,
          phases[currentPhaseIndex].name,
          `阶段 ${currentPhaseIndex + 1}: ${phases[currentPhaseIndex].name}`,
          currentSteps,
          subTasks.length > 0 ? [subTasks[subTasks.length - 1].id] : []
        ));
        currentSteps = [];
        currentPhaseIndex = matchedPhase;
      }

      currentSteps.push(step);
    }

    // 添加最后一个阶段的步骤
    if (currentSteps.length > 0) {
      subTasks.push(this.createSubTask(
        subTasks.length,
        phases[currentPhaseIndex]?.name || "final",
        `阶段 ${currentPhaseIndex + 1}: ${phases[currentPhaseIndex]?.name || "收尾"}`,
        currentSteps,
        subTasks.length > 0 ? [subTasks[subTasks.length - 1].id] : []
      ));
    }

    return subTasks;
  }

  /**
   * 按文件拆分
   */
  private splitByFile(plan: ValidatedPlan): SubTask[] {
    const fileGroups = new Map<string, PlanStep[]>();
    const otherSteps: PlanStep[] = [];

    for (const step of plan.steps) {
      const paths = step.inputs?.paths || [];
      
      if (paths.length > 0) {
        // 使用第一个文件路径作为分组键
        const key = paths[0].split("/")[0] || "root";
        if (!fileGroups.has(key)) {
          fileGroups.set(key, []);
        }
        fileGroups.get(key)!.push(step);
      } else {
        otherSteps.push(step);
      }
    }

    const subTasks: SubTask[] = [];
    const fileGroupKeys = Array.from(fileGroups.keys());

    // 为每个文件组创建子任务
    for (let i = 0; i < fileGroupKeys.length; i++) {
      const key = fileGroupKeys[i];
      const steps = fileGroups.get(key)!;
      
      subTasks.push(this.createSubTask(
        i,
        key,
        `处理 ${key} 相关文件`,
        steps,
        i > 0 ? [subTasks[i - 1].id] : []
      ));
    }

    // 将其他步骤添加到第一个子任务，或创建新子任务
    if (otherSteps.length > 0) {
      if (subTasks.length > 0) {
        subTasks[0].steps.push(...otherSteps);
      } else {
        subTasks.push(this.createSubTask(
          0,
          "general",
          "通用操作",
          otherSteps,
          []
        ));
      }
    }

    return subTasks;
  }

  /**
   * 按模块拆分
   */
  private splitByModule(plan: ValidatedPlan): SubTask[] {
    // 简化实现：先尝试按文件拆分
    return this.splitByFile(plan);
  }

  /**
   * 创建子任务
   */
  private createSubTask(
    index: number,
    name: string,
    description: string,
    steps: PlanStep[],
    dependencies: string[]
  ): SubTask {
    return {
      id: `subtask-${index + 1}`,
      name,
      description,
      goal: `${description} (${steps.length} 步骤)`,
      steps,
      dependencies,
      estimatedDuration: steps.length * 30_000, // 预估每步30秒
      canParallel: dependencies.length === 0,
      priority: index,
    };
  }

  /**
   * 检测合并策略
   */
  private detectMergeStrategy(plan: ValidatedPlan): "sequential" | "aggregate" | "custom" {
    // 根据任务类型决定合并策略
    const goal = plan.goal.toLowerCase();
    
    if (goal.includes("报告") || goal.includes("总结") || goal.includes("统计")) {
      return "aggregate";
    }
    
    if (goal.includes("迁移") || goal.includes("重构")) {
      return "sequential";
    }

    return "sequential";
  }

  /**
   * 计算可并行执行的组
   */
  private calculateParallelGroups(subTasks: SubTask[]): string[][] {
    const groups: string[][] = [];
    const completed = new Set<string>();
    const remaining = new Set(subTasks.map(st => st.id));

    while (remaining.size > 0) {
      const group: string[] = [];
      
      for (const taskId of remaining) {
        const task = subTasks.find(st => st.id === taskId)!;
        
        // 检查依赖是否都已完成
        const depsSatisfied = task.dependencies.every(dep => completed.has(dep));
        
        if (depsSatisfied) {
          group.push(taskId);
        }
      }

      if (group.length === 0) {
        // 避免死循环：如果没有任何任务可以执行，强制添加第一个
        const firstRemaining = remaining.values().next().value;
        if (firstRemaining) {
          group.push(firstRemaining);
        }
      }

      // 添加到组并标记完成
      groups.push(group);
      for (const taskId of group) {
        completed.add(taskId);
        remaining.delete(taskId);
      }
    }

    return groups;
  }

  /**
   * 将子任务转换回计划
   */
  convertSubTaskToPlan(subTask: SubTask, originalPlan: ValidatedPlan): ValidatedPlan {
    return {
      ...originalPlan,
      planId: `${originalPlan.planId}-${subTask.id}`,
      goal: subTask.goal,
      steps: subTask.steps,
      reliability: {
        ...originalPlan.reliability,
        maxSteps: subTask.steps.length,
        checkpoints: this.recalculateCheckpoints(subTask.steps, originalPlan.reliability.checkpoints),
      },
    };
  }

  /**
   * 重新计算检查点
   */
  private recalculateCheckpoints(steps: PlanStep[], originalCheckpoints: number[]): number[] {
    // 简化：在新的步骤数组中，保持相对位置
    const ratio = steps.length / (originalCheckpoints.length + 1);
    return originalCheckpoints
      .map(cp => Math.round(cp / ratio))
      .filter(cp => cp < steps.length);
  }
}

/**
 * 子任务执行结果
 */
export interface SubTaskResult {
  subTaskId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  result?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  progressLogs: unknown[];
}

/**
 * 结果合并器
 */
export class ResultMerger {
  /**
   * 合并子任务结果
   */
  merge(results: SubTaskResult[], strategy: SplitTaskGroup["mergeStrategy"], originalGoal: string): string {
    switch (strategy) {
      case "aggregate":
        return this.aggregateMerge(results, originalGoal);
      case "custom":
        return this.customMerge(results, originalGoal);
      case "sequential":
      default:
        return this.sequentialMerge(results, originalGoal);
    }
  }

  /**
   * 顺序合并
   */
  private sequentialMerge(results: SubTaskResult[], originalGoal: string): string {
    const lines: string[] = [
      `# 任务完成: ${originalGoal}`,
      "",
      "## 执行摘要",
      "",
    ];

    const completed = results.filter(r => r.status === "completed").length;
    const failed = results.filter(r => r.status === "failed").length;

    lines.push(`- 总子任务: ${results.length}`);
    lines.push(`- 成功: ${completed}`);
    lines.push(`- 失败: ${failed}`);
    lines.push("");

    lines.push("## 详细结果");
    lines.push("");

    for (const result of results) {
      const statusEmoji = result.status === "completed" ? "✅" : 
                         result.status === "failed" ? "❌" : "⏹️";
      lines.push(`### ${statusEmoji} ${result.subTaskId}`);
      
      if (result.result) {
        lines.push(result.result);
      }
      if (result.error) {
        lines.push(`**错误**: ${result.error}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * 聚合合并
   */
  private aggregateMerge(results: SubTaskResult[], originalGoal: string): string {
    const lines: string[] = [
      `# 任务完成: ${originalGoal}`,
      "",
      "## 聚合结果",
      "",
    ];

    // 收集所有成功的结果
    const allResults = results
      .filter(r => r.status === "completed" && r.result)
      .map(r => r.result!);

    if (allResults.length === 0) {
      lines.push("*没有成功的结果*");
    } else {
      lines.push(...allResults);
    }

    lines.push("");
    lines.push(`---`);
    lines.push(`*共 ${results.length} 个子任务，成功 ${allResults.length} 个*`);

    return lines.join("\n");
  }

  /**
   * 自定义合并
   */
  private customMerge(results: SubTaskResult[], originalGoal: string): string {
    // 默认使用顺序合并
    return this.sequentialMerge(results, originalGoal);
  }
}

/**
 * 创建任务拆分器
 */
export function createTaskSplitter(config?: Partial<SplitStrategy>): TaskSplitter {
  return new TaskSplitter(config);
}

/**
 * 创建结果合并器
 */
export function createResultMerger(): ResultMerger {
  return new ResultMerger();
}
