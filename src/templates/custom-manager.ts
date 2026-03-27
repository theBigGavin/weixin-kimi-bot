/**
 * 用户自定义模板管理器
 * 
 * 支持用户创建和管理自定义模板
 * 保存在 ~/.weixin-kimi-bot/templates/ 目录
 */
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { CapabilityTemplate } from "../agent/types.js";
import { getTemplateById } from "./definitions.js";

const TEMPLATES_DIR = join(homedir(), ".weixin-kimi-bot", "templates");

/**
 * 自定义模板（继承自基础模板）
 */
export interface CustomTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** 继承的基础模板 ID */
  extends?: string;
  /** 覆盖的系统提示词 */
  systemPrompt?: string;
  /** 追加的系统提示词 */
  systemPromptAppend?: string;
  /** 覆盖的默认配置 */
  defaults?: Partial<CapabilityTemplate["defaults"]>;
  /** 覆盖的工具权限 */
  tools?: Partial<CapabilityTemplate["tools"]>;
  createdAt: number;
  updatedAt: number;
}

/**
 * Agent 模板覆盖配置
 */
export interface AgentTemplateOverride {
  /** 覆盖的系统提示词 */
  systemPrompt?: string;
  /** 追加的系统提示词 */
  systemPromptAppend?: string;
  /** 覆盖的模型 */
  model?: string;
  updatedAt: number;
}

class CustomTemplateManager {
  private templates: Map<string, CustomTemplate> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await mkdir(TEMPLATES_DIR, { recursive: true });
    await this.loadAllTemplates();

    this.initialized = true;
  }

  async reload(): Promise<void> {
    this.templates.clear();
    await this.loadAllTemplates();
  }

  private async loadAllTemplates(): Promise<void> {
    try {
      const entries = await readdir(TEMPLATES_DIR, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".json")) {
          try {
            const template = await this.loadTemplateFile(entry.name);
            if (template) {
              this.templates.set(template.id, template);
            }
          } catch (e) {
            console.error(`[CustomTemplateManager] 加载模板 ${entry.name} 失败:`, e);
          }
        }
      }
    } catch {
      // 目录可能不存在
    }
  }

  private async loadTemplateFile(filename: string): Promise<CustomTemplate | null> {
    const path = join(TEMPLATES_DIR, filename);
    const data = await readFile(path, "utf-8");
    return JSON.parse(data) as CustomTemplate;
  }

  private async saveTemplateFile(template: CustomTemplate): Promise<void> {
    const path = join(TEMPLATES_DIR, `${template.id}.json`);
    template.updatedAt = Date.now();
    await writeFile(path, JSON.stringify(template, null, 2), "utf-8");
  }

  /**
   * 获取所有自定义模板
   */
  getAllTemplates(): CustomTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * 获取自定义模板
   */
  getTemplate(id: string): CustomTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * 创建自定义模板
   */
  async createTemplate(
    id: string,
    options: {
      name: string;
      description: string;
      icon?: string;
      extends?: string;
      systemPrompt?: string;
      systemPromptAppend?: string;
      defaults?: Partial<CapabilityTemplate["defaults"]>;
    }
  ): Promise<CustomTemplate> {
    if (this.templates.has(id)) {
      throw new Error(`模板 ${id} 已存在`);
    }

    const template: CustomTemplate = {
      id,
      name: options.name,
      description: options.description,
      icon: options.icon || "🤖",
      extends: options.extends,
      systemPrompt: options.systemPrompt,
      systemPromptAppend: options.systemPromptAppend,
      defaults: options.defaults,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.saveTemplateFile(template);
    this.templates.set(id, template);

    return template;
  }

  /**
   * 更新自定义模板
   */
  async updateTemplate(
    id: string,
    updates: Partial<Omit<CustomTemplate, "id" | "createdAt">>
  ): Promise<CustomTemplate | null> {
    const template = this.templates.get(id);
    if (!template) return null;

    const updated = {
      ...template,
      ...updates,
      updatedAt: Date.now(),
    };

    await this.saveTemplateFile(updated);
    this.templates.set(id, updated);

    return updated;
  }

  /**
   * 删除自定义模板
   */
  async deleteTemplate(id: string): Promise<boolean> {
    if (!this.templates.has(id)) return false;

    const path = join(TEMPLATES_DIR, `${id}.json`);
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(path);
    } catch {
      // 文件可能不存在
    }

    this.templates.delete(id);
    return true;
  }

  /**
   * 基于现有模板创建自定义模板
   */
  async extendTemplate(
    baseTemplateId: string,
    customId: string,
    overrides: {
      name?: string;
      description?: string;
      icon?: string;
      systemPromptAppend?: string;
      defaults?: Partial<CapabilityTemplate["defaults"]>;
    }
  ): Promise<CustomTemplate> {
    const baseTemplate = getTemplateById(baseTemplateId);
    if (!baseTemplate) {
      throw new Error(`基础模板 ${baseTemplateId} 不存在`);
    }

    return this.createTemplate(customId, {
      name: overrides.name || `${baseTemplate.name} (自定义)`,
      description: overrides.description || baseTemplate.description,
      icon: overrides.icon || baseTemplate.icon,
      extends: baseTemplateId,
      systemPromptAppend: overrides.systemPromptAppend,
      defaults: overrides.defaults,
    });
  }

  /**
   * 构建最终模板（合并继承关系）
   */
  buildFinalTemplate(templateId: string): CapabilityTemplate | null {
    // 1. 先查找自定义模板
    const customTemplate = this.templates.get(templateId);
    if (customTemplate) {
      return this.mergeTemplate(customTemplate);
    }

    // 2. 查找预置模板
    const presetTemplate = getTemplateById(templateId);
    if (presetTemplate) {
      return presetTemplate;
    }

    return null;
  }

  /**
   * 合并模板（处理继承关系）
   */
  private mergeTemplate(custom: CustomTemplate): CapabilityTemplate {
    // 获取基础模板
    let base: CapabilityTemplate | undefined;
    if (custom.extends) {
      base = getTemplateById(custom.extends);
    }

    // 如果没有基础模板，使用通用模板作为兜底
    if (!base) {
      base = getTemplateById("general")!;
    }

    // 合并系统提示词
    let finalSystemPrompt = custom.systemPrompt;
    if (!finalSystemPrompt) {
      finalSystemPrompt = base.systemPrompt;
      if (custom.systemPromptAppend) {
        finalSystemPrompt += "\n\n" + custom.systemPromptAppend;
      }
    }

    return {
      ...base,
      id: custom.id,
      name: custom.name,
      description: custom.description,
      icon: custom.icon,
      systemPrompt: finalSystemPrompt,
      defaults: {
        ...base.defaults,
        ...custom.defaults,
      },
      tools: {
        ...base.tools,
        ...custom.tools,
      },
    };
  }
}

// 导出单例
export const customTemplateManager = new CustomTemplateManager();
