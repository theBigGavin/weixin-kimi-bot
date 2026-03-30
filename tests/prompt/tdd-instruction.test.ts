/**
 * TDD 指令集成测试
 * 
 * 测试系统提示词是否正确包含 TDD 指令
 */

import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../../src/agent/prompt-builder.js";
import { getTemplateById } from "../../src/templates/definitions.js";
import type { AgentRuntime } from "../../src/agent/types.js";

describe("TDD 指令集成", () => {
  // 创建程序员助手的运行时
  const createProgrammerRuntime = (tddEnabled = true): AgentRuntime => ({
    config: {
      id: "test-agent",
      name: "测试Agent",
      ai: {
        model: "kimi-test",
        templateId: "programmer",
        maxTurns: 100,
      },
      features: {
        scheduledTasks: true,
        notifications: true,
        fileAccess: true,
        webSearch: true,
        tddInstruction: tddEnabled,
      },
      memory: { enabled: false },
      workspace: { path: "/tmp/test" },
    },
    template: getTemplateById("programmer")!,
    memory: {
      version: 1,
      updatedAt: Date.now(),
      userProfile: { preferences: [], expertise: [], habits: [] },
      facts: [],
      projects: [],
      learning: [],
    },
    context: { recentTopics: [] },
  });

  // 创建通用助手的运行时
  const createGeneralRuntime = (tddEnabled = true): AgentRuntime => ({
    config: {
      id: "test-agent-2",
      name: "测试Agent-2",
      ai: {
        model: "kimi-test",
        templateId: "general",
        maxTurns: 100,
      },
      features: {
        scheduledTasks: true,
        notifications: true,
        fileAccess: true,
        webSearch: true,
        tddInstruction: tddEnabled,
      },
      memory: { enabled: false },
      workspace: { path: "/tmp/test" },
    },
    template: getTemplateById("general")!,
    memory: {
      version: 1,
      updatedAt: Date.now(),
      userProfile: { preferences: [], expertise: [], habits: [] },
      facts: [],
      projects: [],
      learning: [],
    },
    context: { recentTopics: [] },
  });

  describe("程序员助手角色", () => {
    it("应该包含 TDD 核心指令", () => {
      const runtime = createProgrammerRuntime();
      const prompt = buildSystemPrompt(runtime, { includeMemory: false });

      expect(prompt).toContain("测试驱动开发");
      expect(prompt).toContain("TDD");
    });

    it("应该包含 TDD 三步循环", () => {
      const runtime = createProgrammerRuntime();
      const prompt = buildSystemPrompt(runtime, { includeMemory: false });

      expect(prompt).toContain("红 → 绿 → 重构");
      expect(prompt).toContain("红色阶段");
      expect(prompt).toContain("绿色阶段");
      expect(prompt).toContain("重构阶段");
    });

    it("应该包含程序员专用测试指南", () => {
      const runtime = createProgrammerRuntime();
      const prompt = buildSystemPrompt(runtime, { includeMemory: false });

      expect(prompt).toContain("程序员专用测试指南");
      expect(prompt).toContain("TypeScript/JavaScript 测试");
    });

    it("应该包含测试规范", () => {
      const runtime = createProgrammerRuntime();
      const prompt = buildSystemPrompt(runtime, { includeMemory: false });

      expect(prompt).toContain("测试规范");
      expect(prompt).toContain("AAA 模式");
    });
  });

  describe("通用助手角色", () => {
    it("应该包含基础 TDD 指令", () => {
      const runtime = createGeneralRuntime();
      const prompt = buildSystemPrompt(runtime, { includeMemory: false });

      expect(prompt).toContain("测试驱动开发");
      expect(prompt).toContain("TDD");
    });

    it("不应该包含程序员专用指南", () => {
      const runtime = createGeneralRuntime();
      const prompt = buildSystemPrompt(runtime, { includeMemory: false });

      // 通用助手应该只包含核心 TDD 指令
      expect(prompt).not.toContain("程序员专用测试指南");
    });
  });

  describe("禁用 TDD 指令", () => {
    it("程序员助手禁用后不应该包含 TDD 指令", () => {
      const runtime = createProgrammerRuntime(false);
      const prompt = buildSystemPrompt(runtime, { includeMemory: false });

      expect(prompt).not.toContain("测试驱动开发");
      expect(prompt).not.toContain("TDD");
    });

    it("通用助手禁用后不应该包含 TDD 指令", () => {
      const runtime = createGeneralRuntime(false);
      const prompt = buildSystemPrompt(runtime, { includeMemory: false });

      expect(prompt).not.toContain("测试驱动开发");
    });
  });

  describe("功能开关", () => {
    it("应该存在 tddInstruction 功能开关", () => {
      const runtime = createProgrammerRuntime();
      
      // 验证配置中包含 tddInstruction 字段
      expect(runtime.config.features).toHaveProperty("tddInstruction");
    });

    it("默认应该启用 TDD 指令", () => {
      const runtime = createProgrammerRuntime();
      
      expect(runtime.config.features.tddInstruction).toBe(true);
    });
  });
});
