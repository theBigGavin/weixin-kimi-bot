/**
 * 上下文持久化
 * 
 * 负责会话上下文的持久化存储和加载
 */

import { SessionContext } from './types.js';
import { mkdir, writeFile, readFile, unlink, copyFile } from 'fs/promises';
import { join } from 'path';

/**
 * 获取Agent数据目录
 * （从store.ts导入，避免循环依赖）
 */
function getAgentDataDir(agentId: string): string {
  // 使用环境变量或默认路径
  // 优先级: TEST_DATA_DIR (测试) > WEIXIN_KIMI_BOT_DIR (自定义) > HOME (默认)
  const baseDir = process.env.TEST_DATA_DIR || 
    process.env.WEIXIN_KIMI_BOT_DIR || 
    join(process.env.HOME || process.env.USERPROFILE || '', '.weixin-kimi-bot');
  return join(baseDir, 'agents', agentId);
}

/**
 * 上下文持久化
 */
export class ContextPersistence {
  /**
   * 获取上下文存储目录
   */
  private getContextDir(agentId: string): string {
    return join(getAgentDataDir(agentId), 'contexts');
  }

  /**
   * 获取上下文文件路径
   */
  private getContextPath(agentId: string, userId: string): string {
    // 对用户ID进行base64编码，避免特殊字符问题
    const encodedUserId = Buffer.from(userId).toString('base64url');
    return join(this.getContextDir(agentId), `${encodedUserId}.json`);
  }

  /**
   * 保存上下文
   */
  async save(context: SessionContext): Promise<void> {
    const dir = this.getContextDir(context.agentId);
    await mkdir(dir, { recursive: true });

    const path = this.getContextPath(context.agentId, context.userId);

    // 序列化：Map转为普通对象
    const serialized: SerializedContext = {
      ...context,
      activeOptions: Object.fromEntries(context.activeOptions),
    };

    const data = JSON.stringify(serialized, null, 2);

    // 策略1：尝试原子写入（先写临时文件，再覆盖）
    const tempPath = `${path}.tmp.${Date.now()}`;
    
    try {
      // 1. 写入临时文件
      await writeFile(tempPath, data, 'utf-8');
      
      // 2. 复制到目标路径（原子操作）
      await copyFile(tempPath, path);
      
      // 3. 删除临时文件
      try {
        await unlink(tempPath);
      } catch {
        // 忽略清理错误
      }
      
      return;
    } catch (err) {
      console.warn(`[Context] 原子写入失败: ${context.agentId}:${context.userId}`, err);
    }

    // 策略2：直接写入（更简单可靠）
    try {
      await writeFile(path, data, 'utf-8');
      console.log(`[Context] 直接写入成功: ${context.agentId}:${context.userId}`);
    } catch (err) {
      console.error(`[Context] 直接写入也失败: ${context.agentId}:${context.userId}`, err);
      throw err;
    }
  }

  /**
   * 加载上下文
   */
  async load(userId: string, agentId: string): Promise<SessionContext | null> {
    try {
      const path = this.getContextPath(agentId, userId);
      const data = await readFile(path, 'utf-8');
      const parsed = JSON.parse(data) as SerializedContext;

      // 恢复为SessionContext结构
      const context: SessionContext = {
        ...parsed,
        activeOptions: new Map(Object.entries(parsed.activeOptions || {})),
      };

      // 版本兼容性检查
      if (context.metadata.version !== '1.0') {
        console.warn(`[ContextPersistence] 版本不兼容: ${context.metadata.version}, 执行迁移`);
        return this.migrate(context);
      }

      return context;
    } catch (err) {
      // 文件不存在或读取失败
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[ContextPersistence] 加载失败: ${userId}`, err);
      }
      return null;
    }
  }

  /**
   * 删除上下文
   */
  async delete(userId: string, agentId: string): Promise<void> {
    try {
      const path = this.getContextPath(agentId, userId);
      await unlink(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[ContextPersistence] 删除失败: ${userId}`, err);
      }
    }
  }

  /**
   * 列出所有上下文
   */
  async list(agentId: string): Promise<{ userId: string; updatedAt: number }[]> {
    try {
      const dir = this.getContextDir(agentId);
      const files = await import('fs/promises').then(fs => fs.readdir(dir));
      
      const results: { userId: string; updatedAt: number }[] = [];
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const encodedUserId = file.replace('.json', '');
          const userId = Buffer.from(encodedUserId, 'base64url').toString('utf-8');
          const context = await this.load(userId, agentId);
          
          if (context) {
            results.push({
              userId,
              updatedAt: context.updatedAt,
            });
          }
        } catch {
          // 跳过无效文件
        }
      }
      
      // 按更新时间排序
      results.sort((a, b) => b.updatedAt - a.updatedAt);
      return results;
    } catch {
      return [];
    }
  }

  /**
   * 清理过期上下文
   * 
   * 删除超过7天未活跃的上下文
   */
  async cleanup(agentId: string, maxAgeDays: number = 7): Promise<number> {
    const contexts = await this.list(agentId);
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    let cleaned = 0;

    for (const { userId, updatedAt } of contexts) {
      if (now - updatedAt > maxAgeMs) {
        await this.delete(userId, agentId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[ContextPersistence] 清理过期上下文: ${cleaned}个`);
    }

    return cleaned;
  }

  /**
   * 数据迁移
   * 
   * 处理版本升级时的数据格式转换
   */
  private migrate(context: SessionContext): SessionContext {
    // 当前只有1.0版本，后续版本在这里添加迁移逻辑
    context.metadata.version = '1.0';
    return context;
  }
}

/**
 * 序列化后的上下文结构
 * （Map被转换为普通对象）
 */
interface SerializedContext extends Omit<SessionContext, 'activeOptions'> {
  activeOptions: Record<string, any>;
}

// 补充类型声明
interface NodeJS {
  ErrnoException: Error & { code?: string };
}
