# weixin-kimi-bot 🤖

> **Remote control Kimi Code CLI via WeChat messages.**
> A powerful WeChat AI Bot bridging the Tencent iLink protocol to Kimi Code's advanced reasoning capabilities.

[![Release](https://img.shields.io/badge/Release-v0.7.0-blue.svg)](https://github.com/theBigGavin/weixin-kimi-bot/releases)
[![Language](https://img.shields.io/badge/Language-TypeScript-green.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[**中文文档**](README_CN.md) | [Migration Guide](MIGRATION.md) | [Scheduler Guide](SCHEDULER.md)

---

## 🌟 What's New in v0.7.0?
The latest update transforms the bot from a simple assistant into a **Complex Workflow Automator**.
- 🧩 **Pluggable Workflow Engine**: Modular architecture for extending bot capabilities [1].
- 🚀 **FlowTask V2**: Reliable task flows with **Structured Plan Execution** and automatic task splitting [1, 2].
- 🗺️ **Task Router**: Intelligent routing that analyzes user intent to dispatch the right tools [1].
- 🏗️ **Multi-Agent Architecture**: Each WeChat account gets its own independent environment, memory, and workspace [1, 3].

---

## 🚀 Key Features

### 👤 Multi-Agent System
Run multiple WeChat accounts simultaneously. Each Agent is completely isolated with its own:
- **Work Directory**: Local file space for Kimi to read/write [4].
- **Long-term Memory**: Persistent context across sessions [2, 4].
- **Capability Templates**: Specialized personas (Coder, Writer, etc.) [2].

### ⏳ LongTask & FlowTask V2
Execute time-consuming operations without blocking your chat:
- **Real-time Tracking**: Auto-pushed progress reports every 30 seconds [5].
- **Percentage Accuracy**: Progress calculated based on actual tool calls [5].
- **Resilience**: Supports concurrency (up to 4 tasks) and **auto-recovery** after crashes [5].

### 📅 Advanced Scheduler
Manage tasks using natural language or standard Crontab:
- `/task create "Collect AI news every morning at 9 AM"` [2].
- AI-powered intent parsing and confirmation [4].

---

## 🛠 Prerequisites

| Dependency | Min Version | Description |
| :--- | :--- | :--- |
| **Node.js** | 18+ | Runtime environment [3] |
| **Kimi CLI** | Latest | Installed and configured via `kimi` command [3] |
| **WeChat** | Mobile | For QR code login [3] |

---

## ⚡ Quick Start

1. **Clone & Install**
   ```bash
   git clone https://github.com/theBigGavin/weixin-kimi-bot.git
   npm install
Create Your Agent
Scan the QR code displayed in the terminal.
Choose a capability template.
Set the agent name and directory
.
Start the Bot

--------------------------------------------------------------------------------
⌨️ Command Reference
Command
Function
/help
Show help information
/task
Manage scheduled tasks (Add, List, Del, Toggle)
/longtask
Execute background tasks with progress tracking
/flowtask
Execute structured, multi-step workflows (V2)
/route
Intelligent intent analysis and routing
/status
Check current Agent status and memory
/reset
Reset context and re-inject system prompt

--------------------------------------------------------------------------------
📂 Project Structure
All data is stored locally in ~/.weixin-kimi-bot/, ensuring privacy and isolation
.
.sessions/: Agent-level session and context management
.
LONGTASK.md: Detailed documentation for background tasks
.
ARCHITECTURE.md: Technical deep dive into the multi-agent system
.

--------------------------------------------------------------------------------
⚠️ Disclaimer
Experimental Protocol: Uses iLink protocol (non-public), use at your own risk
.
Token Expiry: Run npm run login if your session expires
.

--------------------------------------------------------------------------------
Created by theBigGavin