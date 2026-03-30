# src/index.ts 重构计划

## 现状分析

当前 `src/index.ts` 文件：**2494 行**

### 主要问题
1. **文件过大** - 2494行，难以阅读和维护
2. **职责混杂** - 包含命令处理、消息处理、通知、工具函数等
3. **耦合严重** - 各功能模块之间耦合度高
4. **测试困难** - 难以对单个功能进行单元测试

### 当前功能模块

| 功能 | 行数估算 | 当前位置 |
|------|---------|---------|
| 导入和配置 | ~70行 | 顶部 |
| 重启通知 | ~60行 | 70-130 |
| 常量和类型 | ~50行 | 150-200 |
| 命令定义 | ~20行 | 200-220 |
| 命令处理 | ~850行 | 240-1090 |
| 消息处理工具 | ~50行 | 1070-1130 |
| 创始Agent提示 | ~50行 | 1130-1180 |
| 工作目录管理 | ~50行 | 1180-1230 |
| 消息处理(新架构) | ~400行 | 1250-1650 |
| 消息处理(旧架构) | ~150行 | 1650-1800 |
| 主函数 | ~200行 | 1800-2000 |
| 动态加载 | ~100行 | 2000-2100 |
| 轮询 | ~100行 | 2100-2200 |
| 部署功能 | ~200行 | 2200-2400 |

## 重构目标

### 目标结构

```
src/
├── index.ts                    # 入口文件 (~300行)
├── handlers/                   # 处理器模块
│   ├── index.ts               # 统一导出
│   ├── command-handler.ts     # 命令处理 (~400行)
│   ├── message-handler.ts     # 消息处理 (~500行)
│   └── legacy-handler.ts      # 旧版消息处理 (~200行)
├── services/                   # 服务模块
│   ├── index.ts
│   ├── restart-notify.ts      # 重启通知 (~80行)
│   ├── session-manager.ts     # 会话管理 (~100行)
│   └── workspace-manager.ts   # 工作目录 (~80行)
├── utils/                      # 工具函数
│   ├── index.ts
│   ├── message.ts             # 消息工具 (~50行)
│   ├── prompt.ts              # 提示词构建 (~60行)
│   └── helpers.ts             # 通用辅助 (~50行)
└── types/                      # 类型定义
    └── index.ts               # 聚合类型
```

## 重构步骤

### Phase 1: 提取工具函数和类型
- [ ] 创建 `src/utils/message.ts` - 提取消息相关工具
- [ ] 创建 `src/utils/prompt.ts` - 提取提示词构建
- [ ] 创建 `src/utils/helpers.ts` - 提取通用辅助函数

### Phase 2: 提取服务模块
- [ ] 创建 `src/services/restart-notify.ts`
- [ ] 创建 `src/services/workspace-manager.ts`

### Phase 3: 提取处理器模块
- [ ] 创建 `src/handlers/command-handler.ts`
- [ ] 创建 `src/handlers/message-handler.ts`
- [ ] 创建 `src/handlers/legacy-handler.ts`

### Phase 4: 重构入口文件
- [ ] 简化 `src/index.ts`
- [ ] 更新导入
- [ ] 验证功能

## 预期结果

| 文件 | 重构前行数 | 重构后行数 |
|------|-----------|-----------|
| src/index.ts | 2494 | ~300 |
| src/handlers/command-handler.ts | - | ~400 |
| src/handlers/message-handler.ts | - | ~500 |
| src/handlers/legacy-handler.ts | - | ~200 |
| src/services/*.ts | - | ~200 |
| src/utils/*.ts | - | ~150 |
| **总计** | **2494** | **~1750** |

## 风险和对策

| 风险 | 对策 |
|------|------|
| 功能回归 | 逐步重构，每一步验证编译和基本功能 |
| 循环依赖 | 使用依赖注入，避免直接导入 |
| 类型丢失 | 确保所有类型正确导出 |
| 测试失效 | 更新测试导入路径 |

## 验收标准

- [ ] `src/index.ts` 行数 < 400
- [ ] 所有功能正常工作
- [ ] TypeScript 编译无错误
- [ ] 代码结构清晰，职责单一
