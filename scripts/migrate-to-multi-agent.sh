#!/bin/bash
#
# 迁移脚本：从单Agent版本迁移到多Agent版本
#
# 使用方法：
#   ./scripts/migrate-to-multi-agent.sh
#

set -e

BASE_DIR="${HOME}/.weixin-kimi-bot"
BACKUP_DIR="${BASE_DIR}/backup-$(date +%Y%m%d-%H%M%S)"

echo "=== 微信 Kimi Bot 数据迁移工具 ==="
echo ""
echo "此脚本将帮助您从旧版本迁移到新的多Agent版本。"
echo ""

# 检查旧数据是否存在
if [ ! -f "${BASE_DIR}/credentials.json" ]; then
    echo "未找到旧版本数据，无需迁移。"
    exit 0
fi

echo "发现旧版本数据，开始迁移..."
echo ""

# 创建备份
echo "1. 创建数据备份..."
mkdir -p "${BACKUP_DIR}"
cp -r "${BASE_DIR}"/*.json "${BACKUP_DIR}/" 2>/dev/null || true
cp -r "${BASE_DIR}"/*.txt "${BACKUP_DIR}/" 2>/dev/null || true
echo "   备份已保存到: ${BACKUP_DIR}"
echo ""

# 创建Agent目录
echo "2. 创建Agent目录结构..."
mkdir -p "${BASE_DIR}/agents"

# 生成Agent ID
AGENT_ID="agent_$(date +%s)_$(openssl rand -hex 4 2>/dev/null || echo $(($RANDOM % 10000)))"
AGENT_DIR="${BASE_DIR}/agents/${AGENT_ID}"

mkdir -p "${AGENT_DIR}/workspace"
echo "   Agent ID: ${AGENT_ID}"
echo "   Agent目录: ${AGENT_DIR}"
echo ""

# 迁移凭证
echo "3. 迁移登录凭证..."
if [ -f "${BASE_DIR}/credentials.json" ]; then
    cp "${BASE_DIR}/credentials.json" "${AGENT_DIR}/credentials.json"
    echo "   ✓ 凭证已迁移"
fi

# 迁移配置
echo "4. 迁移Bot配置..."
if [ -f "${BASE_DIR}/config.json" ]; then
    # 读取旧配置并转换为新格式
    node << 'NODE_SCRIPT'
const fs = require('fs');
const path = require('path');

const baseDir = process.env.HOME + '/.weixin-kimi-bot';
const agentId = process.env.AGENT_ID;
const agentDir = path.join(baseDir, 'agents', agentId);

// 读取旧配置
const oldConfig = JSON.parse(fs.readFileSync(path.join(baseDir, 'config.json'), 'utf-8'));
const credentials = JSON.parse(fs.readFileSync(path.join(baseDir, 'credentials.json'), 'utf-8'));

// 创建新配置
const newConfig = {
  id: agentId,
  name: "迁移的Agent",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  wechat: {
    accountId: credentials.accountId,
  },
  workspace: {
    path: path.join(agentDir, 'workspace'),
    createdAt: Date.now(),
  },
  ai: {
    model: oldConfig.model || "kimi-code/kimi-for-coding",
    templateId: "general",
    maxTurns: oldConfig.maxTurns || 100,
    temperature: 0.5,
  },
  memory: {
    enabled: true,
    maxItems: 100,
    autoExtract: true,
  },
  features: {
    scheduledTasks: true,
    notifications: true,
    fileAccess: true,
    webSearch: true,
  },
  stats: {
    totalConversations: 0,
    totalMessages: 0,
  },
};

fs.writeFileSync(path.join(agentDir, 'config.json'), JSON.stringify(newConfig, null, 2));
console.log('   ✓ 配置已迁移并转换');
NODE_SCRIPT
    export AGENT_ID="${AGENT_ID}"
fi

# 迁移同步游标
echo "5. 迁移消息同步状态..."
if [ -f "${BASE_DIR}/sync-buf.txt" ]; then
    cp "${BASE_DIR}/sync-buf.txt" "${AGENT_DIR}/sync-buf.txt"
    echo "   ✓ 同步游标已迁移"
fi

# 迁移上下文令牌
echo "6. 迁移会话上下文..."
if [ -f "${BASE_DIR}/context-tokens.json" ]; then
    cp "${BASE_DIR}/context-tokens.json" "${AGENT_DIR}/context-tokens.json"
    echo "   ✓ 上下文令牌已迁移"
fi

# 迁移定时任务
echo "7. 迁移定时任务..."
if [ -f "${BASE_DIR}/scheduled-tasks.json" ]; then
    # 为任务添加agentId
    node << 'NODE_SCRIPT'
const fs = require('fs');
const path = require('path');

const baseDir = process.env.HOME + '/.weixin-kimi-bot';
const agentId = process.env.AGENT_ID;
const agentDir = path.join(baseDir, 'agents', agentId);

const tasks = JSON.parse(fs.readFileSync(path.join(baseDir, 'scheduled-tasks.json'), 'utf-8'));
// 为每个任务添加agentId
tasks.forEach(task => {
    task.agentId = agentId;
});
fs.writeFileSync(path.join(agentDir, 'scheduled-tasks.json'), JSON.stringify(tasks, null, 2));
console.log('   ✓ 定时任务已迁移（已添加Agent标识）');
NODE_SCRIPT
fi

# 创建工作目录README
echo "8. 初始化工作目录..."
cat > "${AGENT_DIR}/workspace/README.md" << 'EOF'
# Agent 工作目录

此目录是AI助手的工作空间，包含：
- 代码项目
- 数据文件
- 生成的文档
- 临时文件

注意：此目录内容由AI管理，请谨慎手动修改。
EOF
echo "   ✓ 工作目录已初始化"
echo ""

# 创建内存文件
echo "9. 初始化记忆系统..."
node << 'NODE_SCRIPT'
const fs = require('fs');
const path = require('path');

const baseDir = process.env.HOME + '/.weixin-kimi-bot';
const agentId = process.env.AGENT_ID;
const agentDir = path.join(baseDir, 'agents', agentId);

const memory = {
  version: 1,
  updatedAt: Date.now(),
  userProfile: {
    preferences: [],
    expertise: [],
    habits: [],
  },
  facts: [],
  projects: [],
  learning: [],
};

fs.writeFileSync(path.join(agentDir, 'memory.json'), JSON.stringify(memory, null, 2));
console.log('   ✓ 记忆系统已初始化');
NODE_SCRIPT
echo ""

echo "=== 迁移完成 ==="
echo ""
echo "Agent ID: ${AGENT_ID}"
echo "数据目录: ${AGENT_DIR}"
echo ""
echo "启动命令:"
echo "  ACTIVE_AGENT_ID=${AGENT_ID} npm start"
echo ""
echo "旧数据备份在: ${BACKUP_DIR}"
echo ""
echo "注意："
echo "1. 旧的全局配置文件仍然保留（作为备份）"
echo "2. 每个Agent现在拥有独立的数据目录"
echo "3. 可以使用 npm run agent:list 查看所有Agent"
echo ""
