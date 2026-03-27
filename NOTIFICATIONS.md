# 通知通道管理

微信 Kimi Bot 支持通过多种通道发送通知，包括邮件、Telegram 等。

## 功能特性

- ✅ 可扩展的通道架构（支持自定义通道）
- ✅ 内置邮件通知（SMTP）
- ✅ 内置 Telegram Bot 通知
- ✅ 支持同时发送到多个通道
- ✅ 通道状态管理和健康检查

## 快速开始

### 1. 添加邮件通知通道

```bash
npm run notify -- --add-email
```

按提示输入：
- SMTP 服务器地址（如 `smtp.gmail.com`）
- SMTP 端口（如 `587`）
- 邮箱账号和密码/授权码
- 收件人地址

### 2. 添加 Telegram 通知通道

```bash
npm run notify -- --add-telegram
```

配置步骤：
1. 在 Telegram 中搜索 @BotFather
2. 发送 `/newbot` 创建新 Bot
3. 获取 Bot Token（格式：`123456789:ABCdef...`）
4. 给 Bot 发送一条消息
5. 访问 `https://api.telegram.org/bot<TOKEN>/getUpdates` 获取 Chat ID

### 3. 查看所有通道

```bash
npm run notify
```

### 4. 测试通道

```bash
# 测试单个通道
npm run notify -- --test <通道ID>

# 测试所有通道
npm run notify -- --test-all
```

## 命令参考

```bash
# 列出所有通道
npm run notify

# 添加邮件通道
npm run notify -- --add-email

# 添加 Telegram 通道
npm run notify -- --add-telegram

# 删除通道
npm run notify -- --delete <通道ID>

# 启用/禁用通道
npm run notify -- --toggle <通道ID>

# 测试通道
npm run notify -- --test <通道ID>
npm run notify -- --test-all
```

## 配置存储

所有通道配置存储在 `~/.weixin-kimi-bot/notification-channels.json`

示例配置：
```json
[
  {
    "id": "email_1234567890",
    "name": "我的Gmail",
    "type": "email",
    "enabled": true,
    "createdAt": 1234567890,
    "smtpHost": "smtp.gmail.com",
    "smtpPort": 587,
    "smtpUser": "user@gmail.com",
    "smtpPass": "your-app-password",
    "from": "user@gmail.com",
    "to": ["recipient@example.com"],
    "secure": true
  },
  {
    "id": "telegram_1234567890",
    "name": "我的Telegram",
    "type": "telegram",
    "enabled": true,
    "createdAt": 1234567890,
    "botToken": "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
    "chatIds": ["123456789"]
  }
]
```

## 与定时任务集成

当定时任务执行时，结果会自动发送到：
1. 原生的微信聊天
2. **所有启用的通知通道**（邮件、Telegram等）

这样即使你不在微信前，也能通过邮件或 Telegram 收到任务执行结果。

## 扩展自定义通道

你可以轻松添加新的通知通道：

```typescript
import { 
  registerChannelType, 
  type NotificationChannel, 
  type NotificationMessage,
  type NotificationResult 
} from "./notifications/index.js";

// 实现自定义通道
class SlackChannel implements NotificationChannel {
  readonly type = "slack";
  readonly id: string;
  readonly name: string;
  enabled: boolean;
  
  constructor(config: any) {
    this.id = config.id;
    this.name = config.name;
    this.enabled = config.enabled;
  }
  
  async initialize(config: any): Promise<void> {
    // 初始化逻辑
  }
  
  async send(message: NotificationMessage): Promise<NotificationResult> {
    // 发送逻辑
    return { success: true, channelId: this.id, timestamp: Date.now() };
  }
  
  async validate(): Promise<boolean> {
    return true;
  }
  
  getStatus() {
    return { id: this.id, name: this.name, type: this.type, enabled: this.enabled, connected: true };
  }
}

// 注册通道类型
registerChannelType("slack", (config) => new SlackChannel(config));
```

## 常用邮箱配置

| 服务商 | SMTP 服务器 | 端口 | 安全 | 备注 |
|--------|-------------|------|------|------|
| Gmail | smtp.gmail.com | 587 | 是 | 需使用应用专用密码 |
| QQ邮箱 | smtp.qq.com | 587 | 是 | 需开启 SMTP 并获取授权码 |
| 163邮箱 | smtp.163.com | 465 | 是 | 需开启 SMTP |
| Outlook | smtp.office365.com | 587 | 是 | 需使用应用密码 |

## 故障排查

### 邮件发送失败

1. 检查 SMTP 服务器地址和端口
2. 确认邮箱已开启 SMTP 功能
3. 使用应用专用密码（而非登录密码）
4. 检查是否开启了两步验证

### Telegram 发送失败

1. 确认 Bot Token 正确
2. 确认已向 Bot 发送过消息（获取 Chat ID 前）
3. 检查 Bot 是否被 Block

### 查看详细错误

运行测试命令查看具体错误信息：
```bash
npm run notify -- --test <通道ID>
```
