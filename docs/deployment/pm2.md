# PM2 部署指南

本文档介绍如何使用 PM2 部署和管理 weixin-kimi-bot 服务。

## 什么是 PM2

PM2 是 Node.js 的进程管理器，提供：

- 后台进程守护
- 自动重启
- 日志管理
- 多环境支持
- 集群模式

## 安装 PM2

```bash
# 全局安装
npm install -g pm2

# 验证安装
pm2 -v
```

## 配置文件

项目使用 `ecosystem.config.cjs` 配置 PM2：

```javascript
module.exports = {
  apps: [{
    name: "weixin-kimi-bot",
    script: "./dist/index.js",
    interpreter: "node",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "1G",
    env: {
      NODE_ENV: "production",
      DEPLOY_ENV: "production",
    },
    env_staging: {
      NODE_ENV: "production",
      DEPLOY_ENV: "staging",
    },
    env_development: {
      NODE_ENV: "development",
      DEPLOY_ENV: "development",
    },
    log_file: "./logs/combined.log",
    out_file: "./logs/out.log",
    error_file: "./logs/error.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    min_uptime: "10s",
    max_restarts: 10,
    kill_timeout: 5000,
    listen_timeout: 10000,
  }],
};
```

## 快速开始

### 初始化服务

```bash
# 运行安装脚本
npm run service:setup

# 或使用 PM2 直接启动
pm2 start ecosystem.config.cjs
```

### 常用命令

```bash
# 启动服务
npm run service:start

# 停止服务
npm run service:stop

# 重启服务
npm run service:restart

# 查看状态
npm run service:status

# 查看日志
npm run service:logs

# 删除服务
npm run service:delete
```

## 环境配置

### 生产环境

```bash
# 默认启动（生产环境）
pm2 start ecosystem.config.cjs

# 或显式指定
pm2 start ecosystem.config.cjs --env production
```

### Staging 环境

```bash
npm run service:start:staging
# 或
pm2 start ecosystem.config.cjs --env staging
```

### 开发环境

```bash
npm run service:start:dev
# 或
pm2 start ecosystem.config.cjs --env development
```

## 日志管理

### 查看日志

```bash
# 实时日志
pm2 logs weixin-kimi-bot

# 最近 100 行
pm2 logs weixin-kimi-bot --lines 100

# 只看错误
pm2 logs weixin-kimi-bot --err

# 查看日志文件
pm2 logs weixin-kimi-bot --json
```

### 日志文件

日志默认保存在项目 `logs/` 目录：

- `out.log` - 标准输出
- `error.log` - 错误输出
- `combined.log` - 合并日志

### 日志轮转

安装 PM2 LogRotate：

```bash
pm2 install pm2-logrotate

# 配置
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 10
```

## 监控

### PM2 Monitor

```bash
# 终端监控
pm2 monit

# 或
npm run service:monitor
```

### PM2 Plus（Web 监控）

```bash
# 登录 PM2 Plus
pm2 plus

# 在浏览器中查看监控面板
```

## 进程管理

### 自动重启

```bash
# 查看重启次数
pm2 show weixin-kimi-bot

# 重启策略配置
max_restarts: 10,      // 最大重启次数
min_uptime: "10s",     // 最小运行时间
autorestart: true,     // 启用自动重启
```

### 内存管理

```bash
# 内存超过 1G 自动重启
max_memory_restart: "1G"
```

### 无停机部署

```bash
# 零停机重启
pm2 reload weixin-kimi-bot
```

## 开机自启

### 设置开机启动

```bash
# 生成启动脚本
pm2 startup

# 保存当前进程列表
pm2 save

# 系统重启后会自动启动
```

### 取消开机启动

```bash
pm2 unstartup
```

## 多实例部署

### 多 Agent 部署

同一台机器运行多个 Agent：

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "weixin-kimi-bot-agent1",
      script: "./dist/index.js",
      env: {
        ACTIVE_AGENT_ID: "agent_001",
      },
    },
    {
      name: "weixin-kimi-bot-agent2",
      script: "./dist/index.js",
      env: {
        ACTIVE_AGENT_ID: "agent_002",
      },
    },
  ],
};
```

启动：

```bash
pm2 start ecosystem.config.cjs
```

## 故障排除

### 服务无法启动

```bash
# 查看详细错误
pm2 logs weixin-kimi-bot --lines 200

# 检查进程状态
pm2 describe weixin-kimi-bot

# 手动运行查看错误
node ./dist/index.js
```

### 内存泄漏

```bash
# 查看内存使用
pm2 show weixin-kimi-bot

# 重启服务
pm2 restart weixin-kimi-bot
```

### 环境变量问题

```bash
# 查看环境变量
pm2 env weixin-kimi-bot

# 重启时更新环境
pm2 restart weixin-kimi-bot --update-env
```

## 高级配置

### 集群模式

```javascript
module.exports = {
  apps: [{
    name: "weixin-kimi-bot",
    script: "./dist/index.js",
    instances: "max",  // 使用所有 CPU 核心
    exec_mode: "cluster",
  }],
};
```

### 自定义日志格式

```javascript
module.exports = {
  apps: [{
    // ...
    log_type: "json",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    error_file: "./logs/err.log",
    out_file: "./logs/out.log",
    log_file: "./logs/combined.log",
  }],
};
```

## 参考

- [PM2 官方文档](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [PM2 最佳实践](https://pm2.keymetrics.io/docs/usage/best-practices/)
