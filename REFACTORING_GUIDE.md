# src/index.ts 重构指南

## 现状

当前 `src/index.ts`：**2494 行**

## 推荐重构策略：渐进式模块化

### Phase 1: 提取工具函数（已完成）

已创建以下文件：
- `src/utils/message.ts` - 消息提取、分块
- `src/utils/helpers.ts` - 辅助函数
- `src/services/restart-notify.ts` - 重启通知

### Phase 2: 命令处理器拆分

目标：将 `handleAgentCommand`（~850行）拆分到单独模块

建议结构：
```
src/handlers/
├── command-handler.ts      # 命令分发器
├── commands/
│   ├── help.ts            # /help
│   ├── status.ts          # /status
│   ├── reset.ts           # /reset
│   ├── session.ts         # /session
│   ├── template.ts        # /template
│   ├── memory.ts          # /memory
│   ├── task.ts            # /task
│   ├── longtask.ts        # /longtask
│   ├── flowtask.ts        # /flowtask
│   ├── route.ts           # /route
│   ├── auto.ts            # /auto
│   └── deploy.ts          # /deploy
```

### Phase 3: 消息处理器拆分

目标：将消息处理逻辑分离

建议结构：
```
src/handlers/
├── message-handler.ts      # 新架构消息处理
├── legacy-handler.ts       # 旧版消息处理
└── message-utils.ts        # 消息处理工具
```

### Phase 4: 服务层提取

```
src/services/
├── workspace-service.ts    # 工作目录管理
├── notification-service.ts # 通知服务
├── scheduler-service.ts    # 定时任务服务
└── context-service.ts      # 上下文管理服务
```

## 立即可做的简化

### 1. 使用已提取的工具函数

在 `src/index.ts` 中，可以将以下代码：
```typescript
function extractText(msg: WeixinMessage): string { ... }
const MAX_MSG_LEN = 4000;
function generateClientId(): string { ... }
```

替换为：
```typescript
import { extractText, generateClientId, MAX_MSG_LEN } from "./utils/index.js";
```

### 2. 重启通知服务

将重启通知相关代码替换为：
```typescript
import {
  saveRestartInfo,
  loadRestartInfo,
  clearRestartInfo,
  formatRestartNotification,
} from "./services/restart-notify.js";
```

### 3. 辅助函数

将以下代码：
```typescript
function parseCommand(text: string): { command: string; args: string } | null { ... }
function sleep(ms: number): Promise<void> { ... }
```

替换为：
```typescript
import { parseCommand, sleep, COMMAND_DESCRIPTIONS } from "./utils/index.js";
```

## 重构后的预期结构

```typescript
// src/index.ts - 约 600 行
import { ... } from "./utils/index.js";
import { ... } from "./services/restart-notify.js";
import { handleAgentCommand } from "./handlers/command-handler.js";
import { handleMessage } from "./handlers/message-handler.js";

// 主逻辑...
async function main() {
  // 初始化和启动逻辑
}
```

## 风险缓解

1. **分步实施**：每次只移动一个功能模块
2. **保持测试**：每次移动后运行测试
3. **类型检查**：每次移动后运行 `npm run build`
4. **功能验证**：在实际环境中验证功能

## 需要我执行的重构范围

请告诉我：
1. **完整重构** - 我执行全部重构（风险较高，需要充分测试）
2. **Phase 1 集成** - 只集成已提取的工具函数（推荐，风险低）
3. **仅提供方案** - 保留当前文档，你自己执行重构

推荐选择 **Phase 1 集成**，这样：
- 风险最低
- 可立即看到效果
- 为后续重构奠定基础
