# API 参考

本文档介绍 weixin-kimi-bot 的内部 API。

## Agent 管理

### AgentManager

```typescript
import { agentManager } from "./agent/manager.js";
```

#### createAgent

创建新 Agent。

```typescript
async function createAgent(
  wechatAccountId: string,
  options: CreateAgentOptions
): Promise<AgentConfig>
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `wechatAccountId` | string | 微信账号 ID |
| `options.name` | string | Agent 名称 |
| `options.templateId` | string | 能力模板 ID |

**返回：** `Promise<AgentConfig>`

**示例：**

```typescript
const agent = await agentManager.createAgent("wxid_xxx", {
  name: "我的助手",
  templateId: "programmer",
});
```

#### getAgent

获取 Agent 配置。

```typescript
async function getAgent(agentId: string): Promise<AgentConfig | null>
```

#### getAllAgents

获取所有 Agent。

```typescript
async function getAllAgents(): Promise<AgentConfig[]>
```

#### updateAgent

更新 Agent 配置。

```typescript
async function updateAgent(
  agentId: string,
  updates: Partial<AgentConfig>
): Promise<AgentConfig>
```

#### deleteAgent

删除 Agent。

```typescript
async function deleteAgent(agentId: string): Promise<void>
```

## 消息处理

### MessageHandler

```typescript
import { handleMessage } from "./handlers/message-handler.js";
```

#### handleMessage

处理微信消息。

```typescript
async function handleMessage(
  message: WeixinMessage,
  context: HandlerContext
): Promise<void>
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `message` | WeixinMessage | 微信消息对象 |
| `context.session` | AgentSession | Agent 会话 |
| `context.fromUser` | string | 发送者 ID |

### CommandHandler

```typescript
import { handleCommand } from "./handlers/command-handler.js";
```

#### handleCommand

处理斜杠命令。

```typescript
async function handleCommand(
  command: string,
  args: string,
  context: CommandContext
): Promise<string>
```

## 耗时任务

### LongTaskManager

```typescript
import { getLongTaskManager } from "./longtask/manager.js";

const manager = await getLongTaskManager(agentId);
```

#### submit

提交耗时任务。

```typescript
function submit(task: LongTaskOptions): LongTask
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `agentId` | string | Agent ID |
| `userId` | string | 用户 ID |
| `prompt` | string | 任务描述 |
| `command` | string | 执行的命令 |
| `cwd` | string | 工作目录 |

**示例：**

```typescript
const task = manager.submit({
  agentId: "agent_xxx",
  userId: "wxid_xxx",
  prompt: "重构代码",
  command: "kimi --prompt '重构 src/index.ts'",
  cwd: "/path/to/workspace",
});
```

#### getTask

获取任务状态。

```typescript
function getTask(taskId: string): LongTask | undefined
```

#### cancel

取消任务。

```typescript
function cancel(taskId: string): boolean
```

## 定时任务

### AgentTaskScheduler

```typescript
import { AgentTaskScheduler } from "./scheduler.js";

const scheduler = new AgentTaskScheduler(agentId);
```

#### addTask

添加定时任务。

```typescript
function addTask(task: ScheduledTask): void
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | string | 任务名称 |
| `cron` | string | Cron 表达式 |
| `message` | string | 发送的消息 |

**示例：**

```typescript
scheduler.addTask({
  name: "喝水提醒",
  cron: "0 9,14 * * *",
  message: "该喝水了！",
  enabled: true,
});
```

#### removeTask

删除定时任务。

```typescript
function removeTask(name: string): boolean
```

#### listTasks

列出所有任务。

```typescript
function listTasks(): ScheduledTask[]
```

## 通知系统

### NotificationManager

```typescript
import { getNotificationManager } from "./notifications/manager.js";

const manager = await getNotificationManager(agentId);
```

#### addChannel

添加通知通道。

```typescript
async function addChannel(channel: NotificationChannel): Promise<void>
```

**通道类型：**

```typescript
// 邮件
type EmailChannel = {
  type: "email";
  smtp: { host: string; port: number; auth: { user: string; pass: string } };
  to: string;
};

// Webhook
type WebhookChannel = {
  type: "webhook";
  url: string;
  method?: "POST" | "GET";
  headers?: Record<string, string>;
};
```

#### send

发送通知。

```typescript
async function send(message: string): Promise<void>
```

## Kimi 集成

### askKimi

向 Kimi CLI 发送请求。

```typescript
import { askKimi } from "./kimi/handler.js";

const response = await askKimi("帮我写代码", {
  model: "kimi-code/kimi-for-coding",
  cwd: "/workspace",
  maxTurns: 100,
  planMode: false,
});
```

**返回：**

```typescript
interface KimiResponse {
  text: string;        // AI 回复内容
  durationMs: number;  // 响应耗时
}
```

## 工具函数

### extractText

从微信消息中提取文本。

```typescript
import { extractText } from "./utils/index.js";

const text = extractText(message);
```

### parseCommand

解析斜杠命令。

```typescript
import { parseCommand } from "./utils/index.js";

const { command, args } = parseCommand("/task create 任务名");
// command: "task"
// args: "create 任务名"
```

## 类型定义

### AgentConfig

```typescript
interface AgentConfig {
  id: string;
  name: string;
  wechat: {
    accountId: string;
    nickname: string;
  };
  workspace: {
    path: string;
  };
  ai: {
    model: string;
    templateId: string;
    maxTurns: number;
  };
  memory: {
    enabled: boolean;
    autoExtract: boolean;
  };
  features: {
    fileAccess: boolean;
    webSearch: boolean;
    scheduledTasks: boolean;
  };
}
```

### WeixinMessage

```typescript
interface WeixinMessage {
  MsgId: string;
  FromUserName: string;
  ToUserName: string;
  MsgType: number;
  Content: string;
  CreateTime: number;
}
```

## 错误处理

所有异步 API 都可能抛出错误：

```typescript
try {
  const agent = await agentManager.getAgent("agent_xxx");
} catch (error) {
  if (error instanceof AgentNotFoundError) {
    // 处理 Agent 不存在
  } else {
    // 处理其他错误
  }
}
```

## 事件监听

### 任务完成事件

```typescript
manager.on("taskCompleted", (task) => {
  console.log(`任务完成: ${task.id}`);
});
```

### 任务失败事件

```typescript
manager.on("taskFailed", (task, error) => {
  console.error(`任务失败: ${task.id}`, error);
});
```
