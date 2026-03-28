/**
 * Bot 版本信息
 * 
 * 版本号格式：主版本.次版本.修订号
 * - 主版本：重大架构变更
 * - 次版本：新功能添加
 * - 修订号：bug修复、文档更新
 */

export const VERSION = {
  major: 0,
  minor: 3,
  patch: 9,
  
  /** 完整版本号 */
  get full(): string {
    return `${this.major}.${this.minor}.${this.patch}`;
  },
  
  /** 版本日期（最后一次更新日期） */
  date: "2026-03-28",
  
  /** 版本说明 */
  description: "添加一键部署命令 npm run deploy",
};

/** 提交哈希（由构建时注入） */
export const COMMIT_HASH = process.env.GIT_COMMIT_HASH || "development";

/** 构建时间 */
export const BUILD_TIME = new Date().toISOString();

/**
 * 获取版本信息字符串
 */
export function getVersionInfo(): string {
  return `**微信 Kimi Bot**

版本: v${VERSION.full}
日期: ${VERSION.date}
说明: ${VERSION.description}
提交: ${COMMIT_HASH.slice(0, 7)}

GitHub: https://github.com/theBigGavin/weixin-kimi-bot`;
}

/**
 * 检查版本更新
 */
export function checkUpdate(): string {
  // 可以在这里实现版本检查逻辑
  return "当前是最新版本";
}
