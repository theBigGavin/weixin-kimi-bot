/**
 * LongTask 持久化核心模块
 * 
 * 提供功能：
 * - 实时任务快照
 * - WAL (Write-Ahead Logging) 保证数据一致性
 * - 数据压缩与轮转
 * - 自动清理过期数据
 * - 高效查询接口
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  appendFileSync,
  renameSync,
  unlinkSync,
  statSync,
  createReadStream,
  createWriteStream,
} from "node:fs";
import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { createGunzip, createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import type {
  LongTask,
  LongTaskHistoryRecord,
  TaskSnapshot,
  PersistenceOptions,
  PersistenceMetadata,
  HistoryQueryFilter,
  QueryResult,
  LongTaskStatus,
} from "./types.js";

const DEFAULT_OPTIONS: Required<PersistenceOptions> = {
  strategy: "jsonl",
  dataDir: "",
  snapshotIntervalMs: 30_000,
  enableWAL: true,
  historyRetentionDays: 30,
  enableCompression: true,
  maxFileSizeMB: 100,
  enableRecovery: true,
  maxConcurrentWrites: 4,
};

const PERSISTENCE_VERSION = "2.0.0";

/**
 * 任务持久化管理器
 */
export class TaskPersistenceManager {
  private options: Required<PersistenceOptions>;
  private dataDir: string;
  private snapshotFile: string;
  private historyFile: string;
  private walFile: string;
  private metadataFile: string;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private pendingSnapshots: Map<string, TaskSnapshot> = new Map();
  private writeQueue: Array<() => Promise<void>> = [];
  private writeInProgress = false;
  private walBuffer: string[] = [];
  private walFlushTimer: NodeJS.Timeout | null = null;
  private readonly agentId: string;

  constructor(agentId: string, dataDir: string, options: PersistenceOptions = {}) {
    this.agentId = agentId;
    this.options = { ...DEFAULT_OPTIONS, ...options, dataDir };
    this.dataDir = dataDir;
    this.snapshotFile = join(dataDir, "task-snapshots.jsonl");
    this.historyFile = join(dataDir, "task-history.jsonl");
    this.walFile = join(dataDir, "task-wal.jsonl");
    this.metadataFile = join(dataDir, "persistence-meta.json");
  }

  /**
   * 初始化持久化管理器
   */
  async initialize(): Promise<void> {
    // 确保目录存在
    await mkdir(this.dataDir, { recursive: true });

    // 加载 WAL 并恢复
    if (this.options.enableWAL) {
      await this.recoverFromWAL();
    }

    // 启动定期快照
    this.startSnapshotTimer();

    // 启动 WAL 刷新定时器
    if (this.options.enableWAL) {
      this.startWALTimer();
    }

    // 执行数据维护
    await this.performMaintenance();
  }

  /**
   * 关闭持久化管理器
   */
  async close(): Promise<void> {
    // 停止定时器
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    if (this.walFlushTimer) {
      clearInterval(this.walFlushTimer);
      this.walFlushTimer = null;
    }

    // 刷新剩余数据
    await this.flushWAL();
    await this.flushSnapshots();
  }

  /**
   * 保存任务快照
   */
  async saveSnapshot(task: LongTask): Promise<void> {
    const snapshot: TaskSnapshot = {
      ...task,
      snapshotVersion: (this.pendingSnapshots.get(task.id)?.snapshotVersion || 0) + 1,
      lastUpdatedAt: Date.now(),
    };

    this.pendingSnapshots.set(task.id, snapshot);

    // 立即写入 WAL
    if (this.options.enableWAL) {
      this.walBuffer.push(JSON.stringify({
        type: "snapshot",
        timestamp: Date.now(),
        data: snapshot,
      }));
    }

    // 如果任务已结束，立即保存到快照文件
    if (["completed", "failed", "cancelled"].includes(task.status)) {
      await this.flushTaskSnapshot(task.id);
    }
  }

  /**
   * 批量保存任务快照
   */
  async saveSnapshots(tasks: LongTask[]): Promise<void> {
    for (const task of tasks) {
      await this.saveSnapshot(task);
    }
  }

  /**
   * 保存历史记录
   */
  async saveHistory(record: LongTaskHistoryRecord): Promise<void> {
    const entry = JSON.stringify(record);

    // 写入 WAL
    if (this.options.enableWAL) {
      this.walBuffer.push(JSON.stringify({
        type: "history",
        timestamp: Date.now(),
        data: record,
      }));
    }

    // 添加到写入队列
    await this.enqueueWrite(async () => {
      appendFileSync(this.historyFile, entry + "\n");
    });

    // 更新元数据
    await this.updateMetadata();
  }

  /**
   * 加载所有活跃任务快照
   */
  async loadActiveSnapshots(): Promise<TaskSnapshot[]> {
    const snapshots: TaskSnapshot[] = [];

    if (!existsSync(this.snapshotFile)) {
      return snapshots;
    }

    try {
      const content = await readFile(this.snapshotFile, "utf-8");
      const lines = content.split("\n").filter(line => line.trim());

      // 使用 Map 去重，保留最新版本
      const latestSnapshots = new Map<string, TaskSnapshot>();

      for (const line of lines) {
        try {
          const snapshot: TaskSnapshot = JSON.parse(line);
          const existing = latestSnapshots.get(snapshot.id);
          if (!existing || existing.snapshotVersion < snapshot.snapshotVersion) {
            latestSnapshots.set(snapshot.id, snapshot);
          }
        } catch {
          // 忽略解析错误的行
        }
      }

      // 只返回活跃任务（未完成的）
      for (const snapshot of latestSnapshots.values()) {
        if (["pending", "running"].includes(snapshot.status)) {
          snapshots.push(snapshot);
        }
      }
    } catch (error) {
      console.error(`[Persistence] 加载快照失败:`, error);
    }

    return snapshots;
  }

  /**
   * 查询历史记录
   */
  async queryHistory(
    filter: HistoryQueryFilter = {},
    limit: number = 100,
    cursor?: string
  ): Promise<QueryResult<LongTaskHistoryRecord>> {
    const records: LongTaskHistoryRecord[] = [];

    if (!existsSync(this.historyFile)) {
      return { items: [], total: 0, hasMore: false };
    }

    try {
      const content = await readFile(this.historyFile, "utf-8");
      const lines = content.split("\n").filter(line => line.trim());

      // 解析游标
      let skipCount = 0;
      if (cursor) {
        try {
          const cursorData = JSON.parse(Buffer.from(cursor, "base64").toString());
          skipCount = cursorData.offset || 0;
        } catch {
          // 无效游标，从头开始
        }
      }

      // 过滤条件
      const statuses = filter.status
        ? Array.isArray(filter.status) ? filter.status : [filter.status]
        : null;

      let matched = 0;
      let skipped = 0;

      // 从后往前遍历（最新的在前）
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const record: LongTaskHistoryRecord = JSON.parse(lines[i]);

          // 应用过滤器
          if (filter.userId && record.userId !== filter.userId) continue;
          if (statuses && !statuses.includes(record.status)) continue;
          if (filter.startTime && record.createdAt < filter.startTime) continue;
          if (filter.endTime && record.createdAt > filter.endTime) continue;
          if (filter.keyword && !record.prompt.toLowerCase().includes(filter.keyword.toLowerCase())) continue;

          matched++;

          // 跳过游标之前的记录
          if (skipped < skipCount) {
            skipped++;
            continue;
          }

          records.push(record);

          if (records.length >= limit) {
            break;
          }
        } catch {
          // 忽略解析错误的行
        }
      }

      // 生成下一页游标
      let nextCursor: string | undefined;
      if (records.length === limit && matched > skipCount + limit) {
        nextCursor = Buffer.from(JSON.stringify({ offset: skipCount + limit })).toString("base64");
      }

      return {
        items: records,
        total: matched,
        hasMore: !!nextCursor,
        nextCursor,
      };
    } catch (error) {
      console.error(`[Persistence] 查询历史记录失败:`, error);
      return { items: [], total: 0, hasMore: false };
    }
  }

  /**
   * 获取持久化元数据
   */
  async getMetadata(): Promise<PersistenceMetadata> {
    try {
      if (existsSync(this.metadataFile)) {
        const content = await readFile(this.metadataFile, "utf-8");
        return JSON.parse(content);
      }
    } catch {
      // 忽略错误
    }

    return this.buildMetadata();
  }

  /**
   * 删除任务快照
   */
  async deleteSnapshot(taskId: string): Promise<void> {
    this.pendingSnapshots.delete(taskId);

    // 标记为已删除
    if (this.options.enableWAL) {
      this.walBuffer.push(JSON.stringify({
        type: "delete",
        timestamp: Date.now(),
        taskId,
      }));
    }
  }

  /**
   * 执行数据维护（压缩、清理等）
   */
  async performMaintenance(): Promise<void> {
    await Promise.all([
      this.compressOldFiles(),
      this.cleanupExpiredRecords(),
      this.rotateLargeFiles(),
    ]);
  }

  // ==================== 私有方法 ====================

  /**
   * 启动快照定时器
   */
  private startSnapshotTimer(): void {
    this.snapshotTimer = setInterval(() => {
      this.flushSnapshots().catch(err => {
        console.error(`[Persistence] 快照刷新失败:`, err);
      });
    }, this.options.snapshotIntervalMs);
  }

  /**
   * 启动 WAL 定时器
   */
  private startWALTimer(): void {
    this.walFlushTimer = setInterval(() => {
      this.flushWAL().catch(err => {
        console.error(`[Persistence] WAL刷新失败:`, err);
      });
    }, 5000); // 每5秒刷新一次 WAL
  }

  /**
   * 刷新单个任务快照
   */
  private async flushTaskSnapshot(taskId: string): Promise<void> {
    const snapshot = this.pendingSnapshots.get(taskId);
    if (!snapshot) return;

    await this.enqueueWrite(async () => {
      appendFileSync(this.snapshotFile, JSON.stringify(snapshot) + "\n");
    });
  }

  /**
   * 刷新所有待处理快照
   */
  private async flushSnapshots(): Promise<void> {
    if (this.pendingSnapshots.size === 0) return;

    const snapshots = Array.from(this.pendingSnapshots.values());
    this.pendingSnapshots.clear();

    await this.enqueueWrite(async () => {
      const lines = snapshots.map(s => JSON.stringify(s)).join("\n") + "\n";
      appendFileSync(this.snapshotFile, lines);
    });

    await this.updateMetadata();
  }

  /**
   * 刷新 WAL 缓冲区
   */
  private async flushWAL(): Promise<void> {
    if (this.walBuffer.length === 0) return;

    const entries = this.walBuffer.splice(0, this.walBuffer.length);

    await this.enqueueWrite(async () => {
      const lines = entries.map(e => JSON.stringify(e)).join("\n") + "\n";
      appendFileSync(this.walFile, lines);
    });
  }

  /**
   * 从 WAL 恢复数据
   */
  private async recoverFromWAL(): Promise<void> {
    if (!existsSync(this.walFile)) return;

    try {
      const content = await readFile(this.walFile, "utf-8");
      const lines = content.split("\n").filter(line => line.trim());

      let recoveredSnapshots = 0;
      let recoveredHistory = 0;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === "snapshot" && entry.data) {
            this.pendingSnapshots.set(entry.data.id, entry.data);
            recoveredSnapshots++;
          } else if (entry.type === "history" && entry.data) {
            // 重新写入历史记录
            await this.saveHistory(entry.data);
            recoveredHistory++;
          }
        } catch {
          // 忽略解析错误的行
        }
      }

      if (recoveredSnapshots > 0 || recoveredHistory > 0) {
        console.log(`[Persistence] 从 WAL 恢复: ${recoveredSnapshots} 个快照, ${recoveredHistory} 条历史`);
      }

      // 清空 WAL 文件
      await writeFile(this.walFile, "");
    } catch (error) {
      console.error(`[Persistence] WAL 恢复失败:`, error);
    }
  }

  /**
   * 写入队列管理
   */
  private async enqueueWrite(writeFn: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.writeQueue.push(async () => {
        try {
          await writeFn();
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      this.processWriteQueue();
    });
  }

  /**
   * 处理写入队列
   */
  private async processWriteQueue(): Promise<void> {
    if (this.writeInProgress || this.writeQueue.length === 0) return;

    this.writeInProgress = true;

    try {
      while (this.writeQueue.length > 0) {
        const writeFn = this.writeQueue.shift();
        if (writeFn) {
          await writeFn();
        }
      }
    } finally {
      this.writeInProgress = false;
    }
  }

  /**
   * 更新元数据
   */
  private async updateMetadata(): Promise<void> {
    try {
      const metadata = await this.buildMetadata();
      await writeFile(this.metadataFile, JSON.stringify(metadata, null, 2));
    } catch (error) {
      console.error(`[Persistence] 更新元数据失败:`, error);
    }
  }

  /**
   * 构建元数据
   */
  private async buildMetadata(): Promise<PersistenceMetadata> {
    let dataSizeBytes = 0;
    let snapshotTaskCount = 0;
    let totalHistoryRecords = 0;
    let lastSnapshotAt = 0;

    // 计算文件大小
    for (const file of [this.snapshotFile, this.historyFile, this.walFile, this.metadataFile]) {
      if (existsSync(file)) {
        try {
          const stat = statSync(file);
          dataSizeBytes += stat.size;
        } catch {
          // 忽略错误
        }
      }
    }

    // 统计快照数量
    if (existsSync(this.snapshotFile)) {
      try {
        const content = await readFile(this.snapshotFile, "utf-8");
        const lines = content.split("\n").filter(line => line.trim());
        snapshotTaskCount = lines.length;

        // 获取最后更新时间
        if (lines.length > 0) {
          try {
            const lastLine: TaskSnapshot = JSON.parse(lines[lines.length - 1]);
            lastSnapshotAt = lastLine.lastUpdatedAt || lastLine.createdAt;
          } catch {
            // 忽略解析错误
          }
        }
      } catch {
        // 忽略错误
      }
    }

    // 统计历史记录数
    if (existsSync(this.historyFile)) {
      try {
        const content = await readFile(this.historyFile, "utf-8");
        totalHistoryRecords = content.split("\n").filter(line => line.trim()).length;
      } catch {
        // 忽略错误
      }
    }

    return {
      lastSnapshotAt,
      snapshotTaskCount,
      totalHistoryRecords,
      dataSizeBytes,
      version: PERSISTENCE_VERSION,
    };
  }

  /**
   * 压缩旧文件
   */
  private async compressOldFiles(): Promise<void> {
    if (!this.options.enableCompression) return;

    try {
      const files = await readdir(this.dataDir);
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (file.endsWith(".jsonl") && !file.endsWith(".gz")) {
          const filePath = join(this.dataDir, file);
          const stat = statSync(filePath);

          // 压缩一天前的文件
          if (now - stat.mtime.getTime() > oneDay) {
            const gzipPath = `${filePath}.gz`;

            // 如果已经压缩过，跳过
            if (existsSync(gzipPath)) continue;

            await pipeline(
              createReadStream(filePath),
              createGzip(),
              createWriteStream(gzipPath)
            );

            // 删除原文件
            await unlink(filePath);
            console.log(`[Persistence] 压缩文件: ${file}`);
          }
        }
      }
    } catch (error) {
      console.error(`[Persistence] 压缩文件失败:`, error);
    }
  }

  /**
   * 清理过期记录
   */
  private async cleanupExpiredRecords(): Promise<void> {
    const retentionDays = this.options.historyRetentionDays;
    if (retentionDays <= 0) return; // 0 表示不清理

    try {
      const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
      const tempFile = `${this.historyFile}.tmp`;

      if (!existsSync(this.historyFile)) return;

      const content = await readFile(this.historyFile, "utf-8");
      const lines = content.split("\n").filter(line => line.trim());

      let removedCount = 0;
      const keptLines: string[] = [];

      for (const line of lines) {
        try {
          const record: LongTaskHistoryRecord = JSON.parse(line);
          if (record.completedAt && record.completedAt < cutoffTime) {
            removedCount++;
          } else {
            keptLines.push(line);
          }
        } catch {
          // 保留无法解析的行
          keptLines.push(line);
        }
      }

      if (removedCount > 0) {
        await writeFile(tempFile, keptLines.join("\n") + "\n");
        renameSync(tempFile, this.historyFile);
        console.log(`[Persistence] 清理 ${removedCount} 条过期历史记录`);
      }
    } catch (error) {
      console.error(`[Persistence] 清理过期记录失败:`, error);
    }
  }

  /**
   * 轮转大文件
   */
  private async rotateLargeFiles(): Promise<void> {
    const maxSizeBytes = this.options.maxFileSizeMB * 1024 * 1024;

    try {
      for (const file of [this.snapshotFile, this.historyFile]) {
        if (!existsSync(file)) continue;

        const stat = statSync(file);
        if (stat.size < maxSizeBytes) continue;

        // 生成轮转文件名
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const rotatedFile = `${file}.${timestamp}`;

        renameSync(file, rotatedFile);
        console.log(`[Persistence] 文件轮转: ${basename(file)} -> ${basename(rotatedFile)}`);

        // 异步压缩轮转的文件
        if (this.options.enableCompression) {
          setImmediate(() => {
            const gzipPath = `${rotatedFile}.gz`;
            pipeline(
              createReadStream(rotatedFile),
              createGzip(),
              createWriteStream(gzipPath)
            ).then(() => {
              unlinkSync(rotatedFile);
            }).catch(err => {
              console.error(`[Persistence] 压缩轮转文件失败:`, err);
            });
          });
        }
      }
    } catch (error) {
      console.error(`[Persistence] 文件轮转失败:`, error);
    }
  }
}
