/**
 * 文件持久化工具
 * 
 * 支持多Agent架构的按Agent隔离存储
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const BASE_DIR = path.join(os.homedir(), ".weixin-kimi-bot");

// 获取当前活跃的Agent ID（从环境变量）
function getActiveAgentId(): string | null {
  return process.env.ACTIVE_AGENT_ID || null;
}

// 获取Agent目录
function getAgentDir(agentId?: string): string {
  const id = agentId || getActiveAgentId();
  if (!id) {
    // 兼容旧版本：如果没有指定Agent，使用基础目录
    return BASE_DIR;
  }
  return path.join(BASE_DIR, "agents", id);
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

// ============ 凭证存储（已迁移到Agent目录） ============

export type Credentials = {
  botToken: string;
  accountId: string;
  baseUrl: string;
  userId?: string;
  savedAt: string;
};

/**
 * 获取Agent的凭证路径
 * @deprecated 凭证现在直接存储在Agent目录下的 credentials.json
 */
function credentialsPath(agentId?: string): string {
  return path.join(getAgentDir(agentId), "credentials.json");
}

/**
 * 保存凭证（到指定Agent目录）
 */
export function saveCredentials(
  creds: Omit<Credentials, "savedAt">,
  agentId?: string
): void {
  const dir = getAgentDir(agentId);
  ensureDir(dir);
  const data: Credentials = { ...creds, savedAt: new Date().toISOString() };
  const credPath = path.join(dir, "credentials.json");
  fs.writeFileSync(credPath, JSON.stringify(data, null, 2));
  fs.chmodSync(credPath, 0o600);
  console.log(`凭证已保存到 ${credPath}`);
}

/**
 * 加载凭证（从指定Agent目录）
 */
export function loadCredentials(agentId?: string): Credentials | null {
  try {
    const credPath = path.join(getAgentDir(agentId), "credentials.json");
    const raw = fs.readFileSync(credPath, "utf-8");
    return JSON.parse(raw) as Credentials;
  } catch {
    // 兼容旧版本：尝试从根目录加载
    try {
      const oldPath = path.join(BASE_DIR, "credentials.json");
      const raw = fs.readFileSync(oldPath, "utf-8");
      return JSON.parse(raw) as Credentials;
    } catch {
      return null;
    }
  }
}

// ============ 同步游标（按Agent隔离） ============

/**
 * 加载同步游标（每个Agent独立）
 */
export function loadSyncBuf(agentId?: string): string {
  try {
    const bufPath = path.join(getAgentDir(agentId), "sync-buf.txt");
    return fs.readFileSync(bufPath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * 保存同步游标
 */
export function saveSyncBuf(buf: string, agentId?: string): void {
  const dir = getAgentDir(agentId);
  ensureDir(dir);
  const bufPath = path.join(dir, "sync-buf.txt");
  fs.writeFileSync(bufPath, buf);
}

// ============ 上下文令牌（按Agent隔离） ============

// 内存缓存：agentId -> userId -> token
const tokenCaches: Map<string, Record<string, string>> = new Map();

function getTokenCache(agentId: string): Record<string, string> {
  if (!tokenCaches.has(agentId)) {
    // 尝试从文件加载
    try {
      const cachePath = path.join(getAgentDir(agentId), "context-tokens.json");
      const raw = fs.readFileSync(cachePath, "utf-8");
      tokenCaches.set(agentId, JSON.parse(raw));
    } catch {
      tokenCaches.set(agentId, {});
    }
  }
  return tokenCaches.get(agentId)!;
}

function saveTokenCache(agentId: string): void {
  const cache = tokenCaches.get(agentId);
  if (cache) {
    const dir = getAgentDir(agentId);
    ensureDir(dir);
    const cachePath = path.join(dir, "context-tokens.json");
    fs.writeFileSync(cachePath, JSON.stringify(cache));
  }
}

/**
 * 加载上下文令牌（指定Agent）
 */
export function loadContextTokens(agentId?: string): void {
  const id = agentId || getActiveAgentId();
  if (id) {
    getTokenCache(id);
  }
}

/**
 * 获取上下文令牌
 */
export function getContextToken(userId: string, agentId?: string): string | undefined {
  const id = agentId || getActiveAgentId();
  if (!id) return undefined;
  return getTokenCache(id)[userId];
}

/**
 * 设置上下文令牌
 */
export function setContextToken(userId: string, token: string, agentId?: string): void {
  const id = agentId || getActiveAgentId();
  if (!id) return;
  
  const cache = getTokenCache(id);
  cache[userId] = token;
  saveTokenCache(id);
}

// ============ 全局配置（保留，但Agent配置优先） ============

export type BotConfig = {
  model?: string;
  systemPrompt?: string;
  /** @deprecated 不再使用全局cwd，每个Agent有自己的workspace */
  cwd?: string;
  maxTurns?: number;
  planMode?: boolean;
};

const DEFAULT_CONFIG: Required<BotConfig> = {
  model: "kimi-code/kimi-for-coding",
  systemPrompt: "",
  cwd: "",  // 不再使用全局cwd，每个Agent有自己的workspace
  maxTurns: 100,
  planMode: false,
};

/**
 * 加载全局默认配置
 * @deprecated 请使用Agent级别的配置
 */
export function loadConfig(): Required<BotConfig> {
  try {
    const configPath = path.join(BASE_DIR, "config.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    const saved = JSON.parse(raw) as BotConfig;
    return { ...DEFAULT_CONFIG, ...saved };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * 保存全局默认配置
 * @deprecated 请使用Agent级别的配置
 */
export function saveConfig(config: BotConfig): void {
  ensureDir(BASE_DIR);
  const existing = loadConfig();
  const merged = { ...existing, ...config };
  const configPath = path.join(BASE_DIR, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
  console.log(`全局配置已保存到 ${configPath}`);
  console.log("注意：新创建的Agent将使用此默认配置，已有Agent不受影响");
}

// ============ 定时任务路径（支持全局或Agent级别） ============

/**
 * 获取定时任务文件路径
 * 
 * 支持两种模式：
 * - 全局模式：所有Agent共享定时任务
 * - Agent模式：每个Agent有独立的定时任务
 * 
 * 默认使用Agent级别（如果指定了ACTIVE_AGENT_ID）
 */
export function scheduledTasksPath(agentId?: string): string {
  const id = agentId || getActiveAgentId();
  if (id) {
    return path.join(getAgentDir(id), "scheduled-tasks.json");
  }
  // 全局共享
  return path.join(BASE_DIR, "scheduled-tasks.json");
}

// ============ 待确认任务（内存中，不需要持久化） ============

interface PendingTask {
  id: string;
  agentId: string;
  userId: string;
  contextToken: string;
  taskInfo: {
    name: string;
    cron: string;
    command: string;
    description: string;
  };
  createdAt: number;
}

const pendingTasks: Map<string, PendingTask> = new Map();
const PENDING_TIMEOUT_MS = 5 * 60 * 1000;

export function createPendingTask(
  agentId: string,
  userId: string,
  contextToken: string,
  taskInfo: PendingTask["taskInfo"]
): string {
  const id = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  pendingTasks.set(id, {
    id,
    agentId,
    userId,
    contextToken,
    taskInfo,
    createdAt: Date.now(),
  });
  cleanupPendingTasks();
  return id;
}

export function getPendingTask(id: string): PendingTask | null {
  cleanupPendingTasks();
  return pendingTasks.get(id) || null;
}

export function deletePendingTask(id: string): boolean {
  return pendingTasks.delete(id);
}

export function getAgentPendingTasks(agentId: string): PendingTask[] {
  cleanupPendingTasks();
  return Array.from(pendingTasks.values()).filter(t => t.agentId === agentId);
}

export function getUserPendingTasks(agentId: string, userId: string): PendingTask[] {
  cleanupPendingTasks();
  return Array.from(pendingTasks.values())
    .filter(t => t.agentId === agentId && t.userId === userId);
}

function cleanupPendingTasks(): void {
  const now = Date.now();
  for (const [id, task] of pendingTasks) {
    if (now - task.createdAt > PENDING_TIMEOUT_MS) {
      pendingTasks.delete(id);
    }
  }
}

// ============ 工具函数 ============

/**
 * 获取基础目录
 */
export function getBaseDir(): string {
  return BASE_DIR;
}

/**
 * 获取Agent数据目录
 */
export function getAgentDataDir(agentId?: string): string {
  return getAgentDir(agentId);
}

/**
 * 列出所有Agent目录
 */
export function listAgentDirs(): string[] {
  try {
    const agentsDir = path.join(BASE_DIR, "agents");
    if (!fs.existsSync(agentsDir)) return [];
    
    return fs.readdirSync(agentsDir)
      .filter(name => name.startsWith("agent_"))
      .map(name => path.join(agentsDir, name));
  } catch {
    return [];
  }
}

/**
 * 迁移旧数据到Agent目录
 * 
 * 将旧版本的全局配置迁移到新版本的Agent目录
 */
export function migrateOldData(agentId: string): void {
  const agentDir = getAgentDir(agentId);
  ensureDir(agentDir);
  
  // 迁移凭证
  const oldCredsPath = path.join(BASE_DIR, "credentials.json");
  const newCredsPath = path.join(agentDir, "credentials.json");
  if (fs.existsSync(oldCredsPath) && !fs.existsSync(newCredsPath)) {
    fs.copyFileSync(oldCredsPath, newCredsPath);
    console.log(`已迁移凭证到 ${newCredsPath}`);
  }
  
  // 迁移同步游标
  const oldBufPath = path.join(BASE_DIR, "sync-buf.txt");
  const newBufPath = path.join(agentDir, "sync-buf.txt");
  if (fs.existsSync(oldBufPath) && !fs.existsSync(newBufPath)) {
    fs.copyFileSync(oldBufPath, newBufPath);
  }
  
  // 迁移上下文令牌
  const oldTokensPath = path.join(BASE_DIR, "context-tokens.json");
  const newTokensPath = path.join(agentDir, "context-tokens.json");
  if (fs.existsSync(oldTokensPath) && !fs.existsSync(newTokensPath)) {
    fs.copyFileSync(oldTokensPath, newTokensPath);
  }
}
