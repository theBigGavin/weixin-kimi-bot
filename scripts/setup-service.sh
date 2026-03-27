#!/bin/bash

# weixin-kimi-bot 服务安装脚本
# 用于设置 PM2 后台服务

set -e

echo "=== weixin-kimi-bot 服务安装 ==="
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未找到 Node.js，请先安装 Node.js 18+"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 版本过低，需要 18+，当前: $(node -v)"
    exit 1
fi

echo "✅ Node.js 版本: $(node -v)"

# 检查 PM2
if ! command -v pm2 &> /dev/null; then
    echo "📦 安装 PM2..."
    npm install -g pm2
fi

echo "✅ PM2 版本: $(pm2 -v)"

# 检查 Kimi CLI
if ! command -v kimi &> /dev/null; then
    echo "❌ 未找到 Kimi CLI，请先安装:"
    echo "   uv tool install kimi-cli"
    exit 1
fi

echo "✅ Kimi CLI 已安装"

# 进入项目目录
cd "$(dirname "$0")/.."
PROJECT_DIR=$(pwd)
echo "📁 项目目录: $PROJECT_DIR"

# 检查 Kimi 登录状态
echo "🔍 检查 Kimi 登录状态..."
if ! kimi --quiet --prompt "hi" &> /dev/null; then
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║  ⚠️  Kimi CLI 未登录                                           ║"
    echo "╠════════════════════════════════════════════════════════════════╣"
    echo "║  后台服务需要先完成登录。请执行以下步骤：                     ║"
    echo "║                                                                ║"
    echo "║  1. 先在前台启动：                                             ║"
    echo "║     npm start                                                  ║"
    echo "║                                                                ║"
    echo "║  2. 按提示完成浏览器登录                                       ║"
    echo "║                                                                ║"
    echo "║  3. 看到"等待消息中..."后按 Ctrl+C 退出                        ║"
    echo "║                                                                ║"
    echo "║  4. 然后再运行此脚本启动后台服务                               ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    exit 1
fi

echo "✅ Kimi CLI 已登录"

# 检查微信登录凭证
if [ ! -f "$HOME/.weixin-kimi-bot/credentials.json" ]; then
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║  ⚠️  微信未登录                                                 ║"
    echo "╠════════════════════════════════════════════════════════════════╣"
    echo "║  请先完成微信登录：                                            ║"
    echo "║                                                                ║"
    echo "║     npm run login                                              ║"
    echo "║                                                                ║"
    echo "║  扫码完成后，再运行此脚本                                      ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    exit 1
fi

echo "✅ 微信已登录"

# 创建日志目录
mkdir -p logs

# 安装依赖
echo "📦 安装项目依赖..."
npm install

# 构建项目
echo "🔨 构建项目..."
npm run build

echo ""
echo "=== 配置完成 ==="
echo ""
echo "可用命令:"
echo "  npm run service:start    - 启动后台服务"
echo "  npm run service:stop     - 停止服务"
echo "  npm run service:restart  - 重启服务"
echo "  npm run service:status   - 查看状态"
echo "  npm run service:logs     - 查看日志"
echo ""

# 询问是否启动服务
read -p "是否现在启动后台服务? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npm run service:start
    echo ""
    echo "服务已启动！使用以下命令管理:"
    echo "  npm run service:status   - 查看状态"
    echo "  npm run service:logs     - 查看日志"
    echo "  npm run service:restart  - 重启服务"
    echo "  npm run service:stop     - 停止服务"
fi
