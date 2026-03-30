# 命令参考

本文档列出 weixin-kimi-bot 支持的所有命令。

## 基础命令

### /help

显示帮助信息。

```
/help
```

**输出示例：**
```
🤖 可用命令列表：

基础命令：
  /help     - 显示帮助
  /status   - 查看状态
  /reset    - 重置对话

Agent 管理：
  /template - 切换模板
  /memory   - 查看记忆

任务管理：
  /task     - 创建任务
  /longtask - 耗时任务
  /schedule - 定时任务

部署：
  /deploy   - 部署更新
```

### /status

查看当前 Agent 状态。

```
/status
```

**输出示例：**
```
📊 Agent 状态

名称: 程序员助手
模板: programmer
模型: kimi-code/kimi-for-coding
工作目录: /home/user/.weixin-kimi-bot/agents/agent_xxx/workspace
对话轮数: 15/100
```

### /reset

重置对话上下文。

```
/reset
```

**说明：** 清除当前对话历史，重新开始对话。

### /ver

查看版本信息。

```
/ver
```

## Agent 管理

### /template

查看或切换能力模板。

```
/template              # 查看当前模板
/template programmer   # 切换到程序员助手
```

**可用模板：**
- `programmer` - 程序员助手
- `writer` - 写作助手
- `vlog` - Vlog 创作者
- `crypto` - 数字货币投资者
- `stock` - A股操盘手
- `general` - 通用助手

### /memory

查看长期记忆。

```
/memory
```

**说明：** 显示 Bot 记住的关于你的信息。

## 任务管理

### /task

创建和管理任务。

```
/task create 任务名称    # 创建任务
/task list               # 列出任务
/task status 任务ID      # 查看任务状态
/task cancel 任务ID      # 取消任务
```

### /longtask

管理耗时任务。

```
/longtask list                    # 列出所有耗时任务
/longtask status <task-id>        # 查看任务状态
/longtask report <task-id>        # 查看进度报告
/longtask cancel <task-id>        # 取消任务
/longtask confirm <task-id>       # 确认执行操作
/longtask reject <task-id>        # 拒绝执行操作
```

### /flowtask

管理可靠任务流。

```
/flowtask list              # 列出任务流
/flowtask status <id>       # 查看状态
/flowtask pause <id>        # 暂停任务
/flowtask resume <id>       # 恢复任务
```

### /schedule

管理定时任务。

```
/schedule list                      # 列出所有定时任务
/schedule add <name> <cron> <msg>   # 添加定时任务
/schedule remove <name>             # 删除定时任务
```

**Cron 表达式示例：**

| 表达式 | 说明 |
|--------|------|
| `0 9 * * *` | 每天 9:00 |
| `0 9,18 * * *` | 每天 9:00 和 18:00 |
| `0 */2 * * *` | 每 2 小时 |
| `0 9 * * 1` | 每周一 9:00 |

## 路由控制

### /route

控制消息路由。

```
/route on    # 启用路由
/route off   # 禁用路由
/route show  # 显示路由状态
```

## 自动模式

### /auto

控制自动执行模式。

```
/auto on     # 启用自动模式
/auto off    # 禁用自动模式
/auto show   # 显示自动模式状态
```

## 部署命令

### /deploy

部署新版本。

```
/deploy patch         # 补丁版本 (0.0.1)
/deploy minor         # 次版本 (0.1.0)
/deploy major         # 主版本 (1.0.0)
/deploy patch --force # 强制部署（跳过测试）
```

**说明：** 部署前会自动运行测试验证。

## 自然语言对话

除了命令，Bot 还支持自然语言对话：

### 代码相关

- "帮我写一个排序算法"
- "解释这段代码的作用"
- "如何优化这个函数的性能"

### 文件操作

- "读取 README.md 文件"
- "创建一个新文件"
- "修改 src/index.ts"

### 项目任务

- "帮我重构这个模块"
- "给这个项目添加测试"
- "分析代码架构"

## 快捷操作

### 代码块

发送代码时，使用 Markdown 代码块格式：

<pre>
```typescript
function hello() {
  console.log("Hello");
}
```
</pre>

### 文件路径

引用文件时使用相对路径：

```
请查看 src/handlers/message.ts 文件
```

## 命令权限

| 命令 | 权限 |
|------|------|
| 基础命令 | 所有用户 |
| /deploy | 管理员 |
| /schedule | 管理员 |
| 文件操作 | 根据配置 |

## 命令别名

部分命令支持别名：

| 命令 | 别名 |
|------|------|
| /help | /h |
| /status | /s |
| /reset | /r |

## 帮助与反馈

如需更多帮助：

1. 使用 `/help` 查看命令列表
2. 发送 "/help 命令名" 获取详细帮助
3. 查看 [文档中心](../README.md)
