#!/bin/bash
#
# 部署流水线脚本
# 由 LongTask 调用，执行：测试 → 部署
#
# 用法: ./deploy-pipeline.sh <version-type> [force]
#   version-type: patch | minor | major
#   force: --force 可选，强制部署

VERSION_TYPE=${1:-patch}
FORCE_FLAG=${2:-}
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$PROJECT_DIR"

echo "🚀 开始部署流水线"
echo "版本: $VERSION_TYPE | 强制: ${FORCE_FLAG:-否} | 时间: $(date '+%H:%M:%S')"
echo ""

# 步骤1: 运行测试
echo "📋 步骤 1/3: 运行集成测试..."

# 设置测试环境
export TEST_DATA_DIR="${TEST_DATA_DIR:-$HOME/.weixin-kimi-bot/test-data}"
export NODE_ENV=test

# 运行测试，只保存最后结果
npm test > /tmp/deploy-test.log 2>&1
TEST_EXIT=$?

# 提取关键结果
SUMMARY=$(tail -10 /tmp/deploy-test.log)
PASSED=$(echo "$SUMMARY" | grep -oE "Tests\s+[0-9]+\s+passed" | grep -oE "[0-9]+" | tail -1 || echo "0")
FAILED=$(echo "$SUMMARY" | grep -oE "Test Files\s+[0-9]+\s+failed" | grep -oE "[0-9]+" | tail -1 || echo "0")

echo "  结果: ${PASSED:-0} 个测试通过"

if [ "$TEST_EXIT" -eq 0 ] && [ "${FAILED:-0}" -eq 0 ]; then
    echo "  ✅ 测试通过"
elif [ -n "$FORCE_FLAG" ]; then
    echo "  ⚠️ 强制模式：忽略测试结果"
else
    echo "  ❌ 测试失败 (exit: $TEST_EXIT, failed: ${FAILED:-0})"
    echo "  日志: /tmp/deploy-test.log"
    exit 1
fi

echo ""

# 步骤2: 清理临时目录
echo "🧹 步骤 2/3: 清理临时目录..."
node "$PROJECT_DIR/dist/scripts/cleanup-temp-dirs.js" > /dev/null 2>&1
echo "  ✅ 清理完成"
echo ""

# 步骤3: 执行版本更新和部署
echo "📦 步骤 3/3: 执行版本更新..."
npm run "version:$VERSION_TYPE" 2>&1 || exit $?

echo ""
echo "✅ 部署完成！时间: $(date '+%H:%M:%S')"
