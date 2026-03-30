#!/bin/bash
#
# 部署流水线脚本
# 由 LongTask 调用，执行：测试 → 部署
#
# 用法: ./deploy-pipeline.sh <version-type> [force]
#   version-type: patch | minor | major
#   force: --force 可选，强制部署

set -e

VERSION_TYPE=${1:-patch}
FORCE_FLAG=${2:-}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "🚀 开始部署流水线..."
echo "版本类型: $VERSION_TYPE"
echo "强制模式: ${FORCE_FLAG:-否}"
echo ""

# 步骤1: 运行测试
echo "📋 步骤 1/3: 运行集成测试..."
echo "================================"

# 设置测试环境
export TEST_DATA_DIR="${TEST_DATA_DIR:-$HOME/.weixin-kimi-bot/test-data}"
export NODE_ENV=test

if npm test 2>&1; then
    echo ""
    echo "✅ 测试通过"
else
    TEST_EXIT=$?
    echo ""
    echo "❌ 测试失败 (退出码: $TEST_EXIT)"
    
    if [ -z "$FORCE_FLAG" ]; then
        echo "部署被拒绝。请修复测试或添加 --force 强制部署。"
        exit 1
    else
        echo "⚠️ 强制模式：忽略测试失败，继续部署..."
    fi
fi

echo ""

# 步骤2: 清理临时目录
echo "🧹 步骤 2/3: 清理临时目录..."
echo "================================"
node "$SCRIPT_DIR/cleanup-temp-dirs.js"
echo ""

# 步骤3: 执行版本更新和部署
echo "📦 步骤 3/3: 执行版本更新..."
echo "================================"
npm run "version:$VERSION_TYPE" 2>&1

echo ""
echo "✅ 部署流水线完成！"
