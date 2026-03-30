/**
 * Prompt Builder 测试
 * 
 * 测试提示词构建功能
 */

import { describe, it, expect } from "vitest";
import { buildStatusPrompt } from "../../src/agent/prompt-builder.js";
import type { AgentRuntime } from "../../src/agent/types.js";

// 创建测试用的 AgentRuntime
function createTestRuntime(overrides: Partial<AgentRuntime> = {}): AgentRuntime {
  const baseRuntime: AgentRuntime = {
    config: {
      id: "test-agent",
      name: "Test Agent",
      type: "assistant",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      wechat: {
        accountId: "wxid_test",
        nickname: "Test",
      },
      workspace: {
        path: "/test/workspace",
        createdAt: Date.now(),
      },
      ai: {
        model: "kimi-test",
        templateId: "general",
        maxTurns: 50,
        temperature: 0.5,
      },
      memory: {
        enabled: true,
        maxItems: 100,
        autoExtract: true,
      },
      features: {
        scheduledTasks: true,
        notifications: true,
        fileAccess: true,
        webSearch: true,
      },
      stats: {
        totalConversations: 10,
        totalMessages: 100,
        lastActiveAt: Date.now(),
      },
    },
    memory: {
      facts: [],
      projects: [],
      userProfile: {
        role: "developer",
        goals: [],
        expertise: [],
      },
      updatedAt: Date.now(),
    },
    template: {
      id: "general",
      name: "通用助手",
      icon: "🤖",
      description: "通用助手",
      systemPrompt: "You are a helpful assistant.",
      defaults: {
        model: "kimi-test",
        maxTurns: 50,
        temperature: 0.5,
      },
    },
    context: {
      recentTopics: [],
    },
  };

  return {
    ...baseRuntime,
    ...overrides,
    config: {
      ...baseRuntime.config,
      ...overrides.config,
    },
  } as AgentRuntime;
}

describe("buildStatusPrompt", () => {
  it("应该显示普通助手类型", () => {
    const runtime = createTestRuntime({
      config: {
        ...createTestRuntime().config,
        type: "assistant",
      },
    });

    const prompt = buildStatusPrompt(runtime);

    expect(prompt).toContain("类型:");
    expect(prompt).toContain("普通助手");
  });

  it("应该显示创始Agent类型", () => {
    const runtime = createTestRuntime({
      config: {
        ...createTestRuntime().config,
        type: "founder",
      },
    });

    const prompt = buildStatusPrompt(runtime);

    expect(prompt).toContain("类型:");
    expect(prompt).toContain("创始Agent");
  });

  it("应该显示项目空间信息（创始Agent）", () => {
    const runtime = createTestRuntime({
      config: {
        ...createTestRuntime().config,
        type: "founder",
        projectSpace: {
          path: "/home/gavin/projects/test-project",
          repository: "https://github.com/user/test-project",
          description: "Test project description",
          rules: {
            gitRequired: true,
            noTemporaryFiles: true,
            ciCdEnabled: true,
          },
        },
      },
    });

    const prompt = buildStatusPrompt(runtime);

    expect(prompt).toContain("项目空间");
    expect(prompt).toContain("ProjectSpace");
    expect(prompt).toContain("/home/gavin/projects/test-project");
    expect(prompt).toContain("https://github.com/user/test-project");
    expect(prompt).toContain("Test project description");
    expect(prompt).toContain("必须使用 Git");
    expect(prompt).toContain("禁止临时文件");
    expect(prompt).toContain("启用 CI/CD");
  });

  it("不应该显示项目空间（普通助手）", () => {
    const runtime = createTestRuntime({
      config: {
        ...createTestRuntime().config,
        type: "assistant",
        projectSpace: {
          path: "/some/path",
        },
      },
    });

    const prompt = buildStatusPrompt(runtime);

    expect(prompt).not.toContain("项目空间");
    expect(prompt).not.toContain("ProjectSpace");
  });

  it("不应该显示项目空间（创始Agent但没有配置）", () => {
    const runtime = createTestRuntime({
      config: {
        ...createTestRuntime().config,
        type: "founder",
        // 没有 projectSpace
      },
    });

    const prompt = buildStatusPrompt(runtime);

    expect(prompt).not.toContain("项目空间");
    expect(prompt).not.toContain("ProjectSpace");
  });
});
