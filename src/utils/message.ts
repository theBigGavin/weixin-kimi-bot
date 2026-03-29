/**
 * 消息工具函数
 * 
 * 处理微信消息的提取和格式化
 */

import {
  MessageItemType,
  type WeixinMessage,
} from "../ilink/types.js";

/** 最大消息长度 */
export const MAX_MSG_LEN = 4000;

/**
 * 从微信消息中提取文本内容
 */
export function extractText(msg: WeixinMessage): string {
  if (!msg.item_list?.length) return "";
  for (const item of msg.item_list) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      const ref = item.ref_msg;
      if (ref?.title) {
        return `[引用: ${ref.title}]\n${item.text_item.text}`;
      }
      return item.text_item.text;
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return "";
}

/**
 * 生成客户端ID
 */
export function generateClientId(): string {
  return `wkb-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * 分块消息（如果超过最大长度）
 */
export function chunkMessage(text: string, maxLen: number = MAX_MSG_LEN): string[] {
  if (text.length <= maxLen) {
    return [text];
  }
  return text.match(new RegExp(`.{1,${maxLen}}`, "gs")) || [text];
}
