#!/bin/bash
# 安全清理测试 Agent 脚本
# 警告：此脚本只删除明显是测试产生的 agent，保留真实用户 agent

set -e

AGENTS_DIR="$HOME/.weixin-kimi-bot/agents"

if [ ! -d "$AGENTS_DIR" ]; then
    echo "Agent 目录不存在"
    exit 0
fi

echo "=== 清理测试 Agent ==="
echo ""

# 只删除明显是测试产生的 agent
# 标准：
# 1. 包含 "test" 字样的 agent
# 2. integration-test-agent

count=0
for agent in "$AGENTS_DIR"/*; do
    if [ -d "$agent" ]; then
        name=$(basename "$agent")
        
        # 只删除测试 agent（不删除真实用户的 agent）
        if [[ "$name" == *"test"* ]] || [[ "$name" == "integration-test-agent" ]]; then
            echo "删除测试 agent: $name"
            rm -rf "$agent"
            ((count++))
        fi
    fi
done

echo ""
echo "清理完成，删除了 $count 个测试 agent"
echo ""
echo "剩余的 agent:"
ls "$AGENTS_DIR/"
