/**
 * Message Utils 测试
 */

import { describe, it, expect } from 'vitest';
import { extractText, generateClientId, chunkMessage, MAX_MSG_LEN } from '../../src/utils/message.js';
import { MessageType, MessageState, MessageItemType } from '../../src/ilink/types.js';
import type { WeixinMessage } from '../../src/ilink/types.js';

describe('extractText', () => {
  it('should extract text from message with TEXT item', () => {
    const msg: WeixinMessage = {
      to_user_id: 'user1',
      from_user_id: 'user2',
      client_id: 'client1',
      message_type: MessageType.USER,
      message_state: MessageState.FINISH,
      context_token: 'ctx1',
      item_list: [
        {
          type: MessageItemType.TEXT,
          text_item: { text: 'Hello world' },
        },
      ],
    };

    const result = extractText(msg);
    expect(result).toBe('Hello world');
  });

  it('should return empty string for message without item_list', () => {
    const msg: WeixinMessage = {
      to_user_id: 'user1',
      from_user_id: 'user2',
      client_id: 'client1',
      message_type: MessageType.USER,
      message_state: MessageState.FINISH,
      context_token: 'ctx1',
    };

    const result = extractText(msg);
    expect(result).toBe('');
  });

  it('should return empty string for empty item_list', () => {
    const msg: WeixinMessage = {
      to_user_id: 'user1',
      from_user_id: 'user2',
      client_id: 'client1',
      message_type: MessageType.USER,
      message_state: MessageState.FINISH,
      context_token: 'ctx1',
      item_list: [],
    };

    const result = extractText(msg);
    expect(result).toBe('');
  });

  it('should return empty string when first item is not TEXT type', () => {
    const msg: WeixinMessage = {
      to_user_id: 'user1',
      from_user_id: 'user2',
      client_id: 'client1',
      message_type: MessageType.USER,
      message_state: MessageState.FINISH,
      context_token: 'ctx1',
      item_list: [
        {
          type: MessageItemType.FILE,
          file_item: { file_name: 'test.txt', file_size: 100 },
        },
      ],
    };

    const result = extractText(msg);
    expect(result).toBe('');
  });

  it('should extract text from first TEXT item only', () => {
    const msg: WeixinMessage = {
      to_user_id: 'user1',
      from_user_id: 'user2',
      client_id: 'client1',
      message_type: MessageType.USER,
      message_state: MessageState.FINISH,
      context_token: 'ctx1',
      item_list: [
        {
          type: MessageItemType.TEXT,
          text_item: { text: 'First message' },
        },
        {
          type: MessageItemType.TEXT,
          text_item: { text: 'Second message' },
        },
      ],
    };

    const result = extractText(msg);
    expect(result).toBe('First message');
  });

  it('should handle undefined text_item', () => {
    const msg: WeixinMessage = {
      to_user_id: 'user1',
      from_user_id: 'user2',
      client_id: 'client1',
      message_type: MessageType.USER,
      message_state: MessageState.FINISH,
      context_token: 'ctx1',
      item_list: [
        {
          type: MessageItemType.TEXT,
        },
      ],
    };

    const result = extractText(msg);
    expect(result).toBe('');
  });
});

describe('generateClientId', () => {
  it('should generate unique IDs', () => {
    const id1 = generateClientId();
    const id2 = generateClientId();
    
    expect(id1).not.toBe(id2);
  });

  it('should generate IDs with correct format', () => {
    const id = generateClientId();
    
    // Format: random-timestamp-random (alphanumeric segments)
    expect(id).toMatch(/^[a-z0-9]+-\d+-[a-z0-9]+$/);
  });

  it('should generate IDs of reasonable length', () => {
    const id = generateClientId();
    
    expect(id.length).toBeGreaterThan(10);
    expect(id.length).toBeLessThan(50);
  });

  it('should contain timestamp in middle segment', () => {
    const before = Date.now();
    const id = generateClientId();
    const after = Date.now();
    
    const parts = id.split('-');
    expect(parts).toHaveLength(3);
    
    const timestamp = parseInt(parts[1], 10);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

describe('chunkMessage', () => {
  it('should return single chunk for short messages', () => {
    const text = 'Short message';
    const chunks = chunkMessage(text);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it('should use MAX_MSG_LEN as default', () => {
    const text = 'a'.repeat(MAX_MSG_LEN);
    const chunks = chunkMessage(text);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].length).toBe(MAX_MSG_LEN);
  });

  it('should split long messages into multiple chunks', () => {
    const maxLen = 10;
    const text = 'a'.repeat(25);
    const chunks = chunkMessage(text, maxLen);
    
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBe(maxLen);
  });

  it('should split at exact boundaries', () => {
    const maxLen = 10;
    const text = '0123456789'.repeat(3); // 30 characters
    const chunks = chunkMessage(text, maxLen);
    
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toBe('0123456789');
    expect(chunks[1]).toBe('0123456789');
    expect(chunks[2]).toBe('0123456789');
  });

  it('should handle custom max length', () => {
    const text = 'Hello World Test';
    const chunks = chunkMessage(text, 5);
    
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBeLessThanOrEqual(5);
  });

  it('should handle empty string', () => {
    const chunks = chunkMessage('');
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('');
  });

  it('should handle unicode characters correctly', () => {
    const text = '你好世界'.repeat(100);
    const chunks = chunkMessage(text, 10);
    
    // Verify no chunk exceeds max length
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(10);
    }
    
    // Verify all content is preserved
    expect(chunks.join('')).toBe(text);
  });
});

describe('MAX_MSG_LEN constant', () => {
  it('should be defined', () => {
    expect(MAX_MSG_LEN).toBeDefined();
    expect(typeof MAX_MSG_LEN).toBe('number');
  });

  it('should have reasonable value', () => {
    expect(MAX_MSG_LEN).toBeGreaterThan(1000);
    expect(MAX_MSG_LEN).toBeLessThan(10000);
  });

  it('should be 4000', () => {
    expect(MAX_MSG_LEN).toBe(4000);
  });
});
