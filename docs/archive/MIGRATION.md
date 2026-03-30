# 迁移指南：从单Agent到多Agent版本

## 目录结构变化

### 旧版本（单Agent）
```
~/.weixin-kimi-bot/
├── credentials.json          # 微信凭证
├── config.json              # Bot配置
├── sync-buf.txt             # 消息同步游标
├── context-tokens.json      # 上下文令牌
├── scheduled-tasks.json     # 定时任务
└── ...
```

### 新版本（多Agent）
```
~/.weixin-kimi-bot/
├── agents/                          # 所有Agent数据（完全隔离）
│   └── agent_xxx/                  # 每个Agent独立目录
│       ├── config.json             # Agent配置
│       ├── credentials.json        # 微信凭证
│       ├── memory.json             # 长期记忆
│       ├── sync-buf.txt            # 消息同步游标
│       ├── context-tokens.json     # 上下文令牌
│       ├── scheduled-tasks.json    # 定时任务
│       └── workspace/              # 工作目录
└── templates/                       # 能力模板（共享）
```

## 自动迁移

如果你正在使用旧版本，运行以下命令自动迁移：

```bash
npm run migrate
```

这会：
1. 备份旧数据到 `~/.weixin-kimi-bot/backup-xxx/`
2. 创建新的Agent目录结构
3. 迁移所有数据到第一个Agent
4. 初始化记忆系统

## 手动迁移

如果你想手动控制迁移过程：

```bash
# 1. 备份数据
cp -r ~/.weixin-kimi-bot ~/.weixin-kimi-bot-backup

# 2. 检查并清理旧配置（重要）
# 如果 config.json 中有 "cwd" 字段，建议删除或注释掉
# 新版本每个 Agent 使用自己的工作目录，不再共享全局 cwd

# 3. 创建Agent目录
mkdir -p ~/.weixin-kimi-bot/agents

# 4. 重新登录（会自动创建新Agent结构）
npm run login
```

## 多Agent优势

迁移到多Agent版本后，你可以：

1. **绑定多个微信账号**
   ```bash
   npm run login  # 扫码绑定第一个微信
   npm run login  # 再扫码绑定第二个微信（不同的Agent）
   ```

2. **同时运行多个Agent**
   ```bash
   # 终端1：运行Agent A
   ACTIVE_AGENT_ID=agent_xxx npm start
   
   # 终端2：运行Agent B
   ACTIVE_AGENT_ID=agent_yyy npm start
   ```

3. **每个Agent完全隔离**
   - 独立的工作目录
   - 独立的长期记忆
   - 独立的定时任务
   - 独立的能力模板

## 常见问题

### Q: 迁移后旧数据还在吗？
A: 是的，旧数据会保留在 `~/.weixin-kimi-bot/backup-xxx/` 目录中。

### Q: 可以同时运行多个Agent吗？
A: 是的，每个Agent在不同的终端运行，使用不同的 `ACTIVE_AGENT_ID`。

### Q: Agent之间可以共享数据吗？
A: 默认情况下不共享。如果需要共享，可以：
- 手动复制文件到多个Agent的workspace
- 设置相同的外部工作目录

### Q: 如何查看所有Agent？
A: 使用命令：
```bash
npm run agent:list
```

### Q: 如何切换当前Agent？
A: 使用环境变量：
```bash
ACTIVE_AGENT_ID=agent_xxx npm start
```

## 数据隔离详情

| 数据类型 | 隔离级别 | 说明 |
|---------|---------|------|
| 配置 | ✅ 完全隔离 | 每个Agent有自己的config.json |
| 凭证 | ✅ 完全隔离 | 每个Agent绑定不同微信 |
| 记忆 | ✅ 完全隔离 | 个性化记忆不共享 |
| 工作目录 | ✅ 完全隔离 | 代码/文件互不干扰 |
| 定时任务 | ✅ 完全隔离 | 各Agent独立任务 |
| 消息游标 | ✅ 完全隔离 | 各Agent独立轮询 |
| 能力模板 | 🔄 共享 | 所有Agent使用相同模板定义 |
