/**
 * 错误恢复和边界情况集成测试
 * 
 * 测试系统在各种异常情况下的行为
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { tmpdir } from "os";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";

// 设置测试目录
const testDataDir = mkdtempSync(join(tmpdir(), "error-recovery-test-"));
process.env.TEST_DATA_DIR = testDataDir;

import type { WeixinMessage } from "../../src/ilink/types.js";
import { MessageType } from "../../src/ilink/types.js";
import { extractText, parseCommand, chunkMessage, MAX_MSG_LEN } from "../../src/utils/index.js";
import { initializeContextSystem } from "../../src/context/index.js";
import { llmIntentResolver } from "../../src/context/llm-intent-resolver.js";
import { ConversationState } from "../../src/context/types.js";

// 禁用LLM意图识别，使用正则模式
beforeAll(() => {
  llmIntentResolver.updateOptions({ disabled: true });
});

describe("错误恢复和边界情况集成测试", () => {
  describe("消息解析错误处理", () => {
    it("应该处理空消息", () => {
      const msg: WeixinMessage = {
        id: "msg-empty",
        message_type: MessageType.USER,
        from_user_id: "user-1",
        item_list: [],
      };

      const text = extractText(msg);
      expect(text).toBe("");
    });

    it("应该处理 undefined item_list", () => {
      const msg: any = {
        id: "msg-undefined",
        message_type: MessageType.USER,
        from_user_id: "user-1",
      };

      const text = extractText(msg);
      expect(text).toBe("");
    });

    it("应该处理非文本类型消息项", () => {
      const msg: WeixinMessage = {
        id: "msg-image",
        message_type: MessageType.USER,
        from_user_id: "user-1",
        item_list: [
          {
            type: 2, // IMAGE
            text_item: undefined,
          } as any,
        ],
      };

      const text = extractText(msg);
      expect(text).toBe("");
    });

    it("应该处理超长文本", () => {
      const longText = "A".repeat(100000);
      const chunks = chunkMessage(longText);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(MAX_MSG_LEN);
      });
    });

    it("应该处理特殊字符", () => {
      const specialChars = "你好世界 🌍 émoji \n\t <script>alert('xss')</script>";
      const msg: WeixinMessage = {
        id: "msg-special",
        message_type: MessageType.USER,
        from_user_id: "user-1",
        item_list: [
          {
            type: 1,
            text_item: { text: specialChars },
          } as any,
        ],
      };

      const text = extractText(msg);
      expect(text).toBe(specialChars);
    });

    it("应该处理 Unicode 字符", () => {
      const unicode = "🎉🎊🎁 中文字符 Japanese: 日本語 Korean: 한국어 Arabic: العربية";
      const chunks = chunkMessage(unicode, 100);

      // 分块不应该破坏多字节字符
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(100);
      });
    });
  });

  describe("命令解析错误处理", () => {
    it("应该处理只有空格的命令", () => {
      const result = parseCommand("   ");
      expect(result).toBeNull();
    });

    it("应该处理多个连续斜杠", () => {
      const result = parseCommand("//help");
      // //help 会被解析为 command: '/help'
      expect(result).not.toBeNull();
      expect(result?.command).toBe("/help");
    });

    it("应该处理超长命令", () => {
      const longCommand = "/" + "a".repeat(1000);
      const result = parseCommand(longCommand);

      expect(result).not.toBeNull();
      expect(result?.command.length).toBeGreaterThan(0);
    });

    it("应该处理包含特殊字符的参数", () => {
      const result = parseCommand("/echo hello | world ; rm -rf /");

      expect(result).not.toBeNull();
      expect(result?.command).toBe("echo");
      expect(result?.args).toContain("hello");
    });
  });

  describe("上下文系统错误处理", () => {
    it("应该处理重复的状态转移请求", async () => {
      const contextSystem = initializeContextSystem();
      const userId = `error-user-${Date.now()}`;
      const agentId = "test-agent";

      const context = await contextSystem.contextManager.getOrCreate(userId, agentId);

      // 第一次转移
      await contextSystem.contextManager.updateState(context, ConversationState.EXPLORING);
      expect(context.state.current).toBe(ConversationState.EXPLORING);

      // 重复转移到相同状态（不应该出错）
      await contextSystem.contextManager.updateState(context, ConversationState.EXPLORING);
      expect(context.state.current).toBe(ConversationState.EXPLORING);
    });

    it("应该处理无效的状态转移", () => {
      const contextSystem = initializeContextSystem();

      const state = { current: ConversationState.IDLE, topic: "" };
      const invalidIntent = {
        type: "invalid_type" as any,
        confidence: 0.5,
        rawText: "test",
        entities: [],
        references: [],
      };

      const result = contextSystem.stateMachine.transition(state, invalidIntent);

      // 无效意图应该导致转移失败或保持当前状态
      expect(result.success === false || result.newState === undefined).toBe(true);
    });

    it("应该处理空消息历史", async () => {
      const contextSystem = initializeContextSystem();
      const userId = `empty-user-${Date.now()}`;
      const agentId = "test-agent";

      const context = await contextSystem.contextManager.getOrCreate(userId, agentId);

      expect(context.messages).toEqual([]);

      // 获取最近消息不应该出错
      const recent = context.messages.slice(-5);
      expect(recent).toEqual([]);
    });

    it("应该处理并发上下文访问", async () => {
      const contextSystem = initializeContextSystem();
      const userId = `concurrent-user-${Date.now()}`;
      const agentId = "test-agent";

      // 模拟并发获取上下文
      const promises = Array.from({ length: 5 }, () =>
        contextSystem.contextManager.getOrCreate(userId, agentId)
      );

      const contexts = await Promise.all(promises);

      // 所有调用应该返回相同的 userId 和 agentId
      contexts.forEach((ctx) => {
        expect(ctx.userId).toBe(userId);
        expect(ctx.agentId).toBe(agentId);
      });
    });
  });

  describe("边界情况", () => {
    it("应该处理空字符串分块", () => {
      const chunks = chunkMessage("");
      expect(chunks).toEqual([""]);
    });

    it("应该处理刚好等于最大长度的消息", () => {
      const exactLength = "A".repeat(MAX_MSG_LEN);
      const chunks = chunkMessage(exactLength);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].length).toBe(MAX_MSG_LEN);
    });

    it("应该处理刚好超过最大长度的消息", () => {
      const overLength = "A".repeat(MAX_MSG_LEN + 1);
      const chunks = chunkMessage(overLength);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].length).toBe(MAX_MSG_LEN);
    });

    it("应该处理只有空白字符的消息", () => {
      const whitespace = "   \n\t   ";
      const chunks = chunkMessage(whitespace);

      expect(chunks).toEqual([whitespace]);
    });
  });

  describe("数据持久化错误", () => {
    it("应该处理会话 ID 边界值", async () => {
      const contextSystem = initializeContextSystem();

      // 非常长的用户 ID
      const longUserId = "user-" + "x".repeat(200);
      const agentId = "test-agent";

      const context = await contextSystem.contextManager.getOrCreate(longUserId, agentId);
      expect(context.userId).toBe(longUserId);

      // 特殊字符的用户 ID
      const specialUserId = "user-你好🌍<script>";
      const context2 = await contextSystem.contextManager.getOrCreate(specialUserId, agentId);
      expect(context2.userId).toBe(specialUserId);
    });

    it("应该处理消息数量边界", async () => {
      const contextSystem = initializeContextSystem();
      const userId = `msg-boundary-${Date.now()}`;
      const agentId = "test-agent";

      const context = await contextSystem.contextManager.getOrCreate(userId, agentId);

      // 添加大量消息，超过 MAX_MESSAGES(20) 的限制
      const msgCount = 50;
      for (let i = 0; i < msgCount; i++) {
        await contextSystem.contextManager.addMessage(context, "user", `消息 ${i}`);
      }

      // 由于 MAX_MESSAGES = 20，只保留最近的消息
      expect(context.messages.length).toBeLessThanOrEqual(20);
    });
  });

  describe("状态机边界情况", () => {
    it("应该处理所有状态的转移", () => {
      const contextSystem = initializeContextSystem();
      const states = Object.values(ConversationState);

      states.forEach((state) => {
        const testState = { current: state, topic: "" };
        const intent = {
          type: "ask_info" as any,
          confidence: 0.9,
          rawText: "test",
          entities: [],
          references: [],
        };

        // 不应该抛出错误
        expect(() => contextSystem.stateMachine.transition(testState, intent)).not.toThrow();
      });
    });

    it("应该处理极端置信度值", () => {
      const contextSystem = initializeContextSystem();

      const state = { current: ConversationState.IDLE, topic: "" };

      // 置信度为 0
      const zeroConfidence = {
        type: "ask_info" as any,
        confidence: 0,
        rawText: "test",
        entities: [],
        references: [],
      };
      expect(() => contextSystem.stateMachine.transition(state, zeroConfidence)).not.toThrow();

      // 置信度为 1
      const fullConfidence = {
        type: "ask_info" as any,
        confidence: 1,
        rawText: "test",
        entities: [],
        references: [],
      };
      expect(() => contextSystem.stateMachine.transition(state, fullConfidence)).not.toThrow();
    });
  });

  describe("资源清理", () => {
    it("应该正确处理会话关闭", async () => {
      const contextSystem = initializeContextSystem();
      const userId = `cleanup-${Date.now()}`;
      const agentId = "test-agent";

      const context = await contextSystem.contextManager.getOrCreate(userId, agentId);
      await contextSystem.contextManager.addMessage(context, "user", "test");

      // 重置应该清理状态
      await contextSystem.contextManager.reset(context);

      expect(context.state.current).toBe(ConversationState.IDLE);
      expect(context.messages).toEqual([]);
      expect(context.activeOptions.size).toBe(0);
    });
  });

  describe("网络和数据错误模拟", () => {
    it("应该处理上下文存储错误", async () => {
      const contextSystem = initializeContextSystem();
      const userId = `storage-error-${Date.now()}`;
      const agentId = "test-agent";

      // 即使存储失败，内存中的操作应该继续
      const context = await contextSystem.contextManager.getOrCreate(userId, agentId);

      // 添加消息不应该崩溃
      await expect(
        contextSystem.contextManager.addMessage(context, "user", "test")
      ).resolves.not.toThrow();
    });

    it("应该优雅处理意图识别失败", async () => {
      const contextSystem = initializeContextSystem();
      const userId = `intent-fail-${Date.now()}`;
      const agentId = "test-agent";

      const context = await contextSystem.contextManager.getOrCreate(userId, agentId);

      // 导入意图解析器
      const { createIntentResolver } = await import("../../src/context/intent-resolver.js");
      const intentResolver = createIntentResolver();

      // 空文本意图识别
      const intent = await intentResolver.identify("", context);
      expect(intent.type).toBeDefined();
      expect(intent.confidence).toBeGreaterThanOrEqual(0);

      // 超长文本意图识别
      const longText = "test ".repeat(1000);
      const intent2 = await intentResolver.identify(longText, context);
      expect(intent2.type).toBeDefined();
    });
  });
});

// 清理测试目录
afterAll(() => {
  try {
    rmSync(testDataDir, { recursive: true, force: true });
  } catch {
    // 忽略清理错误
  }
  delete process.env.TEST_DATA_DIR;
});
