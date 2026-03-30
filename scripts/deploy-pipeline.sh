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
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "🚀 开始部署流水线..."
echo "版本类型: $VERSION_TYPE"
echo "强制模式: ${FORCE_FLAG:-否}"
echo "工作目录: $(pwd)"
echo ""

# 步骤1: 运行测试
echo "📋 步骤 1/3: 运行集成测试..."
echo "================================"

# 设置测试环境
export TEST_DATA_DIR="${TEST_DATA_DIR:-$HOME/.weixin-kimi-bot/test-data}"
export NODE_ENV=test

# 运行测试，捕获输出和退出码
TEST_OUTPUT=$(npm test 2>&1)
TEST_EXIT=$?

# 输出测试结果（用于 LongTask 日志）
echo "$TEST_OUTPUT"
echo ""

# 解析测试结果（从输出中提取）
PASSED=$(echo "$TEST_OUTPUT" | grep -oE 'Tests\s+[0-9]+\s+passed' | grep -oE '[0-9]+' || echo "0")
FAILED=$(echo "$TEST_OUTPUT" | grep -oE 'Tests\s+[0-9]+\s+failed' | grep -oE '[0-9]+' || echo "0")
SKIPPED=$(echo "$TEST_OUTPUT" | grep -oE '[0-9]+\s+skipped' | grep -oE '[0-9]+' || echo "0")

echo "📊 测试结果统计:"
echo "  通过: $PASSED"
echo "  失败: $FAILED"
echo "  跳过: $SKIPPED"
echo "  退出码: $TEST_EXIT"
echo ""

# 判断测试是否成功（只要有测试通过且没有失败，就算成功）
if [ "$FAILED" -eq 0 ] && [ "$PASSED" -gt 0 ]; then
    echo "✅ 测试通过 ($PASSED 个测试)"
elif [ -n "$FORCE_FLAG" ]; then
    echo "⚠️ 测试有失败，但强制模式启用，继续部署..."
else
    echo "❌ 测试失败 ($FAILED 个失败)，部署被拒绝"
    echo ""
    echo "如需强制部署，请使用: /deploy $VERSION_TYPE --force"
    exit 1
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
