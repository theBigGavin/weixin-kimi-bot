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

# 运行测试并捕获所有输出
npm test 2>&1 | tee "$TEST_LOG_FILE"
TEST_EXIT=${PIPESTATUS[0]}

echo ""
echo "================================"
echo "📊 测试结果分析"
echo "================================"

# 从日志文件解析测试结果（更可靠）
if [ -f "$TEST_LOG_FILE" ]; then
    # 查找测试统计行
    TEST_SUMMARY=$(tail -20 "$TEST_LOG_FILE" | grep -E "Test Files|Tests\s+\d+")
    echo "$TEST_SUMMARY"
    
    # 提取数字
    PASSED=$(grep -oE "Tests\s+[0-9]+\s+passed" "$TEST_LOG_FILE" | tail -1 | grep -oE "[0-9]+" || echo "0")
    FAILED=$(grep -oE "Tests\s+[0-9]+\s+failed" "$TEST_LOG_FILE" | tail -1 | grep -oE "[0-9]+" || echo "0")
    SKIPPED=$(grep -oE "[0-9]+\s+skipped" "$TEST_LOG_FILE" | tail -1 | grep -oE "[0-9]+" || echo "0")
    
    # 如果没有匹配到 passed，尝试其他格式
    if [ "$PASSED" = "0" ]; then
        # 尝试匹配 "Tests  432 passed (432)" 这种格式
        PASSED=$(grep -oE "Tests\s+[0-9]+\s+passed" "$TEST_LOG_FILE" | tail -1 | awk '{print $2}' || echo "0")
    fi
else
    echo "错误: 测试日志文件未找到"
    PASSED="0"
    FAILED="0"
    SKIPPED="0"
fi

echo ""
echo "统计结果:"
echo "  通过: ${PASSED:-0}"
echo "  失败: ${FAILED:-0}"
echo "  跳过: ${SKIPPED:-0}"
echo "  npm exit code: $TEST_EXIT"
echo ""

# 判断测试是否成功
# 标准: 通过数 > 0 且 失败数 = 0
if [ "${FAILED:-0}" -eq 0 ] && [ "${PASSED:-0}" -gt 0 ]; then
    echo "✅ 测试验证通过！($PASSED 个测试)"
elif [ -n "$FORCE_FLAG" ]; then
    echo "⚠️ 警告: 测试未完全通过，但强制模式启用"
    echo "   通过: $PASSED, 失败: $FAILED, 跳过: $SKIPPED"
    echo "   继续执行部署..."
else
    echo "❌ 测试验证失败"
    echo "   通过: $PASSED, 失败: $FAILED, 跳过: $SKIPPED"
    echo ""
    echo "部署被拒绝。修复建议:"
    echo "  1. 运行 'npm test' 本地查看详细错误"
    echo "  2. 或使用强制部署: /deploy $VERSION_TYPE --force"
    echo ""
    echo "测试日志: $TEST_LOG_FILE"
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
