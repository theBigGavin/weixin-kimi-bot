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
echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# 步骤1: 运行测试
echo "📋 步骤 1/3: 运行集成测试..."
echo "================================"

# 设置测试环境
export TEST_DATA_DIR="${TEST_DATA_DIR:-$HOME/.weixin-kimi-bot/test-data}"
export NODE_ENV=test

echo "环境变量:"
echo "  TEST_DATA_DIR=$TEST_DATA_DIR"
echo "  NODE_ENV=$NODE_ENV"
echo ""

# 运行测试，将输出保存到文件以便分析
TEST_LOG_FILE="/tmp/deploy-test-$(date +%s).log"
echo "运行: npm test (日志保存到 $TEST_LOG_FILE)"
echo ""

# 运行测试并捕获所有输出
npm test 2>&1 | tee "$TEST_LOG_FILE"
TEST_EXIT=${PIPESTATUS[0]}

echo ""
echo "================================"
echo "📊 测试结果分析"
echo "================================"

# 检查测试是否成功 - 关键：查看最后的总结行
if [ -f "$TEST_LOG_FILE" ]; then
    # 显示最后几行（测试结果总结）
    echo "测试总结（最后10行）:"
    tail -10 "$TEST_LOG_FILE"
    echo ""
    
    # 检查是否所有测试文件都通过
    # 成功标志："Test Files  X passed" 且没有 "X failed"
    FAILED_FILES=$(grep -E "^\s*Test Files\s+[0-9]+\s+failed" "$TEST_LOG_FILE" | grep -oE "[0-9]+\s+failed" | grep -oE "[0-9]+" || echo "0")
    PASSED_FILES=$(grep -E "^\s*Test Files\s+[0-9]+\s+passed" "$TEST_LOG_FILE" | tail -1 | grep -oE "[0-9]+" | head -1 || echo "0")
    
    # 检查测试数量
    TESTS_LINE=$(grep -E "^\s*Tests\s+[0-9]+\s+passed" "$TEST_LOG_FILE" | tail -1)
    PASSED_TESTS=$(echo "$TESTS_LINE" | grep -oE "[0-9]+" | head -1 || echo "0")
    
    echo "文件统计:"
    echo "  通过: $PASSED_FILES 个测试文件"
    echo "  失败: $FAILED_FILES 个测试文件"
    echo ""
    echo "测试统计:"
    echo "  通过: $PASSED_TESTS 个测试"
    echo ""
else
    echo "错误: 测试日志文件未找到"
    FAILED_FILES="1"
    PASSED_TESTS="0"
fi

echo "npm test 退出码: $TEST_EXIT"
echo ""

# 判断测试是否成功的标准：
# 1. 有测试通过（PASSED_TESTS > 0）
# 2. 没有失败的测试文件（FAILED_FILES == 0）
# 3. npm 退出码为 0

if [ "${FAILED_FILES:-0}" -eq 0 ] && [ "${PASSED_TESTS:-0}" -gt 0 ] && [ "$TEST_EXIT" -eq 0 ]; then
    echo "✅ 测试验证通过！($PASSED_TESTS 个测试，$PASSED_FILES 个文件)"
elif [ -n "$FORCE_FLAG" ]; then
    echo "⚠️ 警告: 测试可能未完全通过，但强制模式启用"
    echo "   通过: $PASSED_TESTS 个测试"
    echo "   失败文件: $FAILED_FILES"
    echo "   npm exit: $TEST_EXIT"
    echo "   继续执行部署..."
else
    echo "❌ 测试验证失败"
    echo "   通过: $PASSED_TESTS 个测试"
    echo "   失败文件: $FAILED_FILES"
    echo "   npm exit: $TEST_EXIT"
    echo ""
    echo "部署被拒绝。修复建议:"
    echo "  1. 运行 'npm test' 本地查看详细错误"
    echo "  2. 或使用强制部署: /deploy $VERSION_TYPE --force"
    echo ""
    echo "完整测试日志: $TEST_LOG_FILE"
    exit 1
fi

echo ""

# 步骤2: 清理临时目录
echo "🧹 步骤 2/3: 清理临时目录..."
echo "================================"
node "$PROJECT_DIR/dist/scripts/cleanup-temp-dirs.js"
CLEANUP_EXIT=$?
if [ $CLEANUP_EXIT -eq 0 ]; then
    echo "✅ 临时目录清理完成"
else
    echo "⚠️ 临时目录清理返回代码: $CLEANUP_EXIT"
fi
echo ""

# 步骤3: 执行版本更新和部署
echo "📦 步骤 3/3: 执行版本更新..."
echo "================================"
echo "运行: npm run version:$VERSION_TYPE"
echo ""

npm run "version:$VERSION_TYPE" 2>&1
VERSION_EXIT=$?

if [ $VERSION_EXIT -eq 0 ]; then
    echo ""
    echo "================================"
    echo "✅ 部署流水线全部完成！"
    echo "================================"
    echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
else
    echo ""
    echo "================================"
    echo "❌ 版本更新失败 (exit code: $VERSION_EXIT)"
    echo "================================"
    exit $VERSION_EXIT
fi
