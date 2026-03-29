/**
 * 消息处理工具函数
 */

import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { symlink } from "node:fs/promises";
import type { WeixinMessage } from "../ilink/types.js";
import { MessageType, MessageState, MessageItemType } from "../ilink/types.js";
import { sendMessage, sendTyping, getConfig, type ApiOptions } from "../ilink/api.js";
import { TypingStatus } from "../ilink/types.js";
import type { AgentSession, UserWorkspace } from "./types.js";
import { generateClientId, chunkMessage } from "../utils/index.js";

/**
 * 发送文本回复
 */
export async function sendTextReply(
  api: ApiOptions,
  toUserId: string,
  contextToken: string,
  text: string,
): Promise<void> {
  const chunks = chunkMessage(text);

  for (const chunk of chunks) {
    const msg: WeixinMessage = {
      to_user_id: toUserId,
      from_user_id: "",
      client_id: generateClientId(),
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: contextToken,
      item_list: [{
        type: MessageItemType.TEXT,
        text_item: { text: chunk },
      }],
    };
    await sendMessage(api, { msg });
  }
}

/**
 * 获取用户工作目录
 */
export async function getUserWorkspace(
  session: AgentSession,
  userId: string,
): Promise<UserWorkspace> {
  const cacheKey = `${userId}:workspace`;
  const cached = session.userWorkspaces.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as UserWorkspace;
  }

  const isFounder = session.config.type === "founder";
  const workspaceBase = session.config.workspace.path;

  let cwd: string;
  let projectDir: string | undefined;

  cwd = join(workspaceBase, ".sessions", userId);
  await mkdir(cwd, { recursive: true });

  if (isFounder && session.config.projectSpace) {
    projectDir = session.config.projectSpace.path;
    const projectLink = join(cwd, "project");
    if (!existsSync(projectLink)) {
      await symlink(projectDir, projectLink, "dir");
      console.log(`  🔗 创建项目软链接: ${projectLink} -> ${projectDir}`);
    }
  }

  const workspaceLink = join(cwd, "workspace");
  if (!existsSync(workspaceLink)) {
    await symlink(workspaceBase, workspaceLink, "dir");
  }

  const result: UserWorkspace = { cwd, projectDir };
  session.userWorkspaces.set(cacheKey, JSON.stringify(result));
  return result;
}

/**
 * 构建创始Agent提示词
 */
export function buildFounderPrompt(config: { projectSpace?: { path: string; description?: string; repository?: string }; workspace: { path: string } }): string {
  if (!config.projectSpace) return "";

  const project = config.projectSpace;
  const workspace = config.workspace.path;
  const projectName = project.description || "当前项目";

  return `

## 项目维护规范 (ProjectSpace)

你当前正在维护项目：${projectName}
项目路径：${project.path}
${project.repository ? `代码仓库：${project.repository}` : ""}

### 目录结构说明
当前目录 (${workspace}/.sessions/{userId}/) 包含：
- ./project/ → 软链接到 ${project.path} (项目源码，操作此目录)
- ./workspace/ → 软链接到 ${workspace} (你的持久化空间)

### 工作规范

**1. 整洁性原则**
- 临时文件、过程性文件必须放在 ./workspace/ 下，禁止放入 ./project/
- ./project/ 只存放：源码、配置、文档

**2. 开发流程 (必须遵循)**
每次修改前，按此 checklist：
- [ ] 进入 ./project/ 目录
- [ ] git status 确认无未提交变更
- [ ] 全面了解变更影响范围
- [ ] 在 ./workspace/Projects/${projectName.replace(/\s+/g, "_")}/ 写方案草稿
- [ ] 给用户确认方案后再实施
- [ ] 修改完成：git add . && git commit -m "wip: xxx"
- [ ] 用户测试确认后：git commit -m "feat: 清晰描述" && git push
- [ ] 更新版本：npm run deploy:patch

**3. PARA 整理 (每周执行)**
你的 workspace 应遵循 PARA 模式：
- Projects/ - 进行中的项目（如本项目）
- Areas/ - 持续维护的职责领域
- Resources/ - 参考资料、学习笔记
- Archives/ - 已完成或暂停的项目

**4. CI/CD 利用**
已配置 GitHub Actions，push 后自动构建。关注 Actions 状态。`;
}

/**
 * 显示正在输入状态
 */
export async function showTyping(api: ApiOptions, userId: string, contextToken?: string): Promise<void> {
  try {
    const config = await getConfig(api, userId, contextToken);
    if (config.typing_ticket) {
      await sendTyping(api, {
        ilink_user_id: userId,
        typing_ticket: config.typing_ticket,
        status: TypingStatus.TYPING,
      });
    }
  } catch {
    // 忽略错误
  }
}
