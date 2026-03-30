# 部署环境配置指南

本文档介绍如何为 PM2 管理的集成测试环境配置不同的部署环境。

## 环境类型

| 环境 | 标识 | 用途 | 测试要求 |
|------|------|------|----------|
| **production** | `production` | 正式生产环境 | 100%测试通过，不允许跳过 |
| **staging** | `staging` | 预发布/集成测试 | 不允许失败，允许跳过部分测试 |
| **development** | `development` | 开发调试 | 允许失败和跳过（会警告） |

## 快速使用

### 1. 查看当前环境

```bash
npm run service:env
```

输出示例：
```
DEPLOY_ENV=production
NODE_ENV=production
```

### 2. 启动不同环境

```bash
# 生产环境（默认）
npm run service:start

# 预发布/集成测试环境
npm run service:start:staging

# 开发环境
npm run service:start:dev
```

### 3. 运行时切换环境

```bash
# 切换到 staging 环境
pm2 restart weixin-kimi-bot --env staging

# 切换到 production 环境
pm2 restart weixin-kimi-bot --env production
```

## 部署行为差异

### Production 环境

```
✅ 允许部署：所有测试通过（0 failed, 0 skipped）
❌ 拒绝部署：有测试失败
❌ 拒绝部署：有测试被跳过
❌ 拒绝部署：测试数量 < 50
```

**适用场景**：正式线上环境，代码质量要求最严格。

### Staging 环境

```
✅ 允许部署：无失败测试（允许跳过）
❌ 拒绝部署：有测试失败
```

**适用场景**：
- CI/CD 集成测试环境
- 需要快速验证但不强制100%覆盖的场景
- 某些测试在 staging 环境难以执行（如依赖外部服务）

### Development 环境

```
✅ 允许部署：无失败测试（跳过会警告）
⚠️  警告：有测试被跳过
```

**适用场景**：
- 本地开发调试
- 快速迭代验证
- 临时部署测试功能

## 配置文件说明

### ecosystem.config.cjs

```javascript
module.exports = {
  apps: [
    {
      name: "weixin-kimi-bot",
      // ... 其他配置

      // 默认环境 (production)
      env: {
        NODE_ENV: "production",
        DEPLOY_ENV: "production",
      },

      // Staging 环境
      env_staging: {
        NODE_ENV: "production",
        DEPLOY_ENV: "staging",
      },

      // Development 环境
      env_development: {
        NODE_ENV: "development",
        DEPLOY_ENV: "development",
      },
    },
  ],
};
```

### 环境变量优先级

`getDeployEnvironment()` 函数按以下优先级读取环境：

```
DEPLOY_ENV > NODE_ENV > "development"
```

这意味着：
- 如果设置了 `DEPLOY_ENV=staging`，则使用 staging
- 如果没设置 `DEPLOY_ENV` 但设置了 `NODE_ENV=production`，则使用 production
- 如果都没设置，默认为 `development`

## 微信中部署命令的行为

在不同环境下，使用 `/deploy` 命令时的验证规则：

### Production
```
/deploy patch
→ 运行所有测试
→ 如有任何失败或跳过 → 拒绝部署
→ 全部通过 → 允许部署
```

### Staging
```
/deploy patch
→ 运行所有测试
→ 如有失败 → 拒绝部署
→ 如有跳过 → 允许部署（但会提示）
→ 全部通过 → 允许部署
```

### Development
```
/deploy patch
→ 运行所有测试
→ 如有失败 → 拒绝部署
→ 如有跳过 → 允许部署（警告信息）
→ 全部通过 → 允许部署
```

## 强制部署

任何环境下都可以使用 `--force` 强制部署（不推荐）：

```
/deploy patch --force
```

## 常见问题

### Q: 如何查看当前服务运行在哪个环境？

```bash
npm run service:env
```

### Q: 如何在不重启的情况下检查环境配置？

```bash
pm2 describe weixin-kimi-bot | grep -A5 "env:\|environment"
```

### Q: 切换环境后需要重新登录微信吗？

不需要。切换 `DEPLOY_ENV` 只影响部署验证行为，不影响微信登录状态。

### Q: 可以在同一台机器上运行多个环境吗？

可以，使用不同的 PM2 应用名称：

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "weixin-kimi-bot-prod",
      env: { DEPLOY_ENV: "production" },
    },
    {
      name: "weixin-kimi-bot-staging",
      env: { DEPLOY_ENV: "staging" },
    },
  ],
};
```

## 最佳实践

1. **开发阶段**：使用 `development` 环境，快速迭代
2. **提交前**：确保在 `staging` 环境能正常部署
3. **上线前**：切换到 `production` 环境，确保100%测试通过
4. **多 Agent 场景**：建议所有 Agent 使用相同的环境配置
