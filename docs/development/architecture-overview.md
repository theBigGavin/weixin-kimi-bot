# 多Agent架构设计

## 核心概念

### Agent（智能体）
一个Agent代表一个完整的AI助手实例，包含：
- 绑定的微信账号
- 独立的工作目录
- 专属的配置（模型、能力模板等）
- 长期记忆
- 对话历史

### 能力模板（Capability Template）
预置的角色设定，包括：
- 系统提示词（System Prompt）
- 工具权限
- 行为模式
- 专业知识

## 目录结构

```
~/.weixin-kimi-bot/
├── agents/                      # 每个Agent的独立配置
│   ├── agent_001/              # Agent实例目录（以ID命名）
│   │   ├── config.json         # Agent配置（能力模板、模型等）
│   │   ├── memory.json         # 长期记忆
│   │   ├── context/            # 对话上下文历史
│   │   └── credentials.json    # 微信登录凭证
│   └── agent_002/
│       └── ...
├── templates/                   # 能力模板
│   ├── programmer.json
│   ├── writer.json
│   ├── vlog-creator.json
│   ├── crypto-trader.json
│   └── a-stock-trader.json
├── shared/                      # 共享数据
│   └── scheduled-tasks.json    # 定时任务（所有Agent共享）
└── master-config.json          # 主配置
```

## 数据模型

### AgentConfig
```typescript
{
  id: string;                    // Agent唯一ID
  name: string;                  // 显示名称
  createdAt: number;
  
  // 微信绑定信息
  wechat: {
    accountId: string;           // 微信账号ID
    nickname?: string;           // 微信昵称
  };
  
  // 工作目录
  workspace: {
    path: string;                // 工作目录绝对路径
    createdAt: number;
  };
  
  // AI能力配置
  ai: {
    model: string;               // 使用的模型
    templateId: string;          // 能力模板ID
    customSystemPrompt?: string; // 用户自定义提示词（追加）
    maxTurns: number;            // 最大轮次
    temperature?: number;        // 温度参数
  };
  
  // 记忆配置
  memory: {
    enabled: boolean;            // 是否启用长期记忆
    maxItems: number;            // 最大记忆条目数
    autoExtract: boolean;        // 自动提取记忆
  };
  
  // 功能开关
  features: {
    scheduledTasks: boolean;     // 是否支持定时任务
    notifications: boolean;      // 是否发送外部通知
    fileAccess: boolean;         // 是否允许文件操作
    webSearch: boolean;          // 是否允许网络搜索
  };
}
```

### CapabilityTemplate
```typescript
{
  id: string;
  name: string;                  // 显示名称
  description: string;           // 描述
  icon: string;                  // Emoji图标
  
  // 系统提示词（核心）
  systemPrompt: string;
  
  // 首次欢迎语
  welcomeMessage?: string;
  
  // 建议的命令/功能
  suggestions?: string[];
  
  // 默认配置
  defaults: {
    model: string;
    maxTurns: number;
    temperature: number;
  };
  
  // 工具权限
  tools: {
    fileOperations: boolean;
    codeExecution: boolean;
    webSearch: boolean;
    gitOperations: boolean;
  };
  
  // 行为模式
  behavior: {
    proactive: boolean;          // 是否主动建议
    verbose: boolean;            // 是否详细解释
    confirmDestructive: boolean; // 危险操作前确认
  };
}
```

### Memory（长期记忆）
```typescript
{
  version: number;
  updatedAt: number;
  
  // 用户画像
  userProfile: {
    name?: string;
    preferences: string[];       // 偏好列表
    expertise: string[];         // 专业领域
    habits: string[];            // 习惯
  };
  
  // 重要事实（知识图谱风格）
  facts: Array<{
    id: string;
    content: string;             // 事实内容
    category: string;            // 类别：personal/work/project/tech
    importance: number;          // 重要度 1-5
    createdAt: number;
    updatedAt: number;
    source?: string;             // 来源对话ID
  }>;
  
  // 项目上下文
  projects: Array<{
    id: string;
    name: string;
    description: string;
    status: "active" | "paused" | "completed";
    techStack?: string[];
    keyFiles?: string[];
    createdAt: number;
    updatedAt: number;
  }>;
  
  // 学习记录
  learning: Array<{
    topic: string;
    level: "beginner" | "intermediate" | "advanced";
    notes: string;
    date: number;
  }>;
}
```

## 提示词管理策略

### 上下文压缩检测
当检测到以下情况时，认为上下文可能被压缩：
1. 对话轮次超过阈值
2. 收到特定的上下文重置信号
3. 用户发送 `/reset` 命令

### 智能提示词注入
```typescript
function buildSystemPrompt(agent: Agent, context: Context): string {
  const parts: string[] = [];
  
  // 1. 基础能力模板（必须）
  parts.push(agent.template.systemPrompt);
  
  // 2. 长期记忆（如果启用）
  if (agent.config.memory.enabled) {
    const relevantMemories = findRelevantMemories(context.recentTopics);
    if (relevantMemories.length > 0) {
      parts.push("## 相关背景信息\n" + relevantMemories.map(m => `- ${m.content}`).join("\n"));
    }
  }
  
  // 3. 当前项目上下文
  const activeProject = getActiveProject(agent);
  if (activeProject) {
    parts.push(`## 当前项目: ${activeProject.name}\n${activeProject.description}`);
  }
  
  // 4. 用户自定义提示词
  if (agent.config.ai.customSystemPrompt) {
    parts.push("## 额外指令\n" + agent.config.ai.customSystemPrompt);
  }
  
  // 5. 当前工作目录
  parts.push(`## 工作目录\n${agent.config.workspace.path}`);
  
  return parts.join("\n\n");
}
```

### 记忆提取Prompt
```
请从以上对话中提取需要长期记忆的重要信息。只提取：
1. 用户明确的偏好设置
2. 重要的项目信息
3. 关键的技术决策
4. 用户的身份信息（姓名、职业等）

以JSON格式返回：
{
  "facts": [
    {"content": "...", "category": "personal|work|project|tech", "importance": 1-5}
  ],
  "projects": [
    {"name": "...", "description": "...", "techStack": [...]}
  ]
}
```

## 多Agent工作流程

### 1. 首次绑定流程
```
用户执行: npm run login
  ↓
生成二维码
  ↓
用户扫码
  ↓
创建新Agent
  ↓
选择能力模板
  ↓
设置工作目录
  ↓
完成初始化
```

### 2. 消息处理流程
```
收到微信消息
  ↓
识别发送者（微信ID）
  ↓
查找对应Agent
  ↓
加载Agent配置
  ↓
构建系统提示词（模板+记忆+上下文）
  ↓
调用Kimi CLI
  ↓
可选：提取新记忆
  ↓
返回结果
```

### 3. 多Agent切换
每个Agent独立运行，互不干扰：
- 不同的工作目录
- 不同的记忆
- 不同的能力模板
- 可以同时在线

## 命令设计

### Agent管理
```
/agent list                    # 列出所有Agent
/agent switch <agent-id>       # 切换到指定Agent（CLI）
/agent create                  # 创建新Agent
/agent config                  # 查看/修改当前Agent配置
/agent memory                  # 查看/管理长期记忆
/agent template list           # 列出能力模板
/agent template apply <id>     # 应用能力模板
```

### 记忆管理
```
/memory                        # 查看记忆摘要
/memory search <keyword>       # 搜索记忆
/memory add "内容"             # 手动添加记忆
/memory delete <id>            # 删除记忆
/memory forget                 # 清空所有记忆
```

### 提示词测试
```
/prompt                        # 查看当前系统提示词
/prompt preview                # 预览完整提示词（含记忆）
/prompt reset                  # 重置提示词为模板默认
```
