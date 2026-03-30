# 变更日志

所有重要的变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 建立系统化文档体系
- 添加 CONTRIBUTING.md 贡献指南
- 添加 CHANGELOG.md 变更日志
- 创建 docs/ 目录结构

### Changed

- 重构项目文档结构
- 归档过期的过程性文档

## [0.7.5] - 2026-03-30

### Added

- 支持 PM2 多环境部署配置（production/staging/development）
- 添加 `service:start:staging` 和 `service:start:dev` 脚本
- 添加 `service:env` 命令查看当前环境变量
- 添加认证检查描述性提示词，替代简单的 "hi"

### Changed

- 优化 `checkKimiAuthenticated()` 提示词，提升用户体验
- 提取 `KIMI_AUTH_CHECK_PROMPT` 常量

## [0.7.4] - 2026-03-30

### Added

- 添加部署命令环境感知验证
- production 环境要求 100% 测试通过
- staging 环境允许跳过测试但不允许失败
- development 环境允许调试

### Fixed

- 修复 6 个跳过的测试（scheduler 测试、route analyze、cron parsing）
- 修复 `/task create` 命令无法在没有 sessionContext 时创建任务的问题

## [0.7.3] - 2026-03-29

### Added

- 集成测试验证在部署前自动运行
- 添加 `validateBeforeDeploy()` 函数
- 测试失败时阻止部署（可强制部署）

### Changed

- 重构 deploy 命令处理器

## [0.7.2] - 2026-03-29

### Added

- 添加通知通道系统（邮件、微信、Webhook）
- 支持多通道通知配置

## [0.7.1] - 2026-03-28

### Fixed

- 修复定时任务目录创建问题
- 修复 Agent 验证测试

## [0.7.0] - 2026-03-28

### Added

- 完整 TDD 迁移完成（435 个测试）
- Agent Manager 测试覆盖
- 通知管理器测试
- 内存管理器测试

### Changed

- 重构 index.ts 为模块化结构
- handlers/ 目录重组

## [0.6.0] - 2026-03-27

### Added

- 多 Agent 架构支持
- Agent 完全隔离（配置、记忆、凭证、工作目录）
- Agent CLI 管理工具（list, switch, config, template, memory, delete）
- 自动迁移工具（单 Agent → 多 Agent）

### Changed

- 数据存储结构重新设计
- 移除全局 `cwd` 配置

## [0.5.0] - 2026-03-26

### Added

- 长期记忆系统
- 自动记忆提取
- 记忆查看命令 `/memory`

## [0.4.0] - 2026-03-25

### Added

- 可靠任务流（FlowTask）系统
- 任务路由（Task Router）
- 任务暂停/恢复功能

## [0.3.0] - 2026-03-24

### Added

- 耗时任务（LongTask）系统
- 任务队列管理
- 进度报告功能
- `/longtask` 命令族

## [0.2.0] - 2026-03-23

### Added

- 定时任务调度器
- Cron 表达式支持
- `/schedule` 命令

## [0.1.0] - 2026-03-22

### Added

- 初始版本发布
- 微信消息接收和回复
- Kimi CLI 集成
- 基础命令系统（/help, /status, /reset）
- 上下文管理系统

---

## 版本号说明

版本号格式：`主版本号.次版本号.修订号`

- **主版本号**：不兼容的 API 修改
- **次版本号**：向下兼容的功能新增
- **修订号**：向下兼容的问题修复

## 分类说明

- **Added**: 新功能
- **Changed**: 现有功能的变更
- **Deprecated**: 已弃用功能
- **Removed**: 已移除功能
- **Fixed**: Bug 修复
- **Security**: 安全相关修复
