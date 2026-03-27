#!/usr/bin/env node
/**
 * 版本号更新脚本
 * 
 * 使用方法:
 *   npm run version:patch  # 0.2.0 -> 0.2.1
 *   npm run version:minor  # 0.2.0 -> 0.3.0
 *   npm run version:major  # 0.2.0 -> 1.0.0
 * 
 * 工作流程:
 *   1. 提交功能代码: git commit -m "feat: xxx"
 *   2. 更新版本号: npm run version:patch
 *   3. 推送到远程: git push
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const type = process.argv[2] || "patch";

if (!["major", "minor", "patch"].includes(type)) {
  console.error("用法: node bump-version.js [major|minor|patch]");
  console.error("  major - 重大版本更新（如架构重构）");
  console.error("  minor - 新功能添加");
  console.error("  patch - bug修复、文档更新");
  process.exit(1);
}

// ========== 1. 获取功能描述（从最近一次 commit）==========

let featureDescription = "";
try {
  const lastCommitMsg = execSync("git log -1 --pretty=%B", { encoding: "utf-8" }).trim();
  // 提取第一行，去掉 commit 类型前缀
  featureDescription = lastCommitMsg
    .split("\n")[0]
    .replace(/^(chore|feat|fix|docs|refactor|test|style)(\(.+\))?:\s*/i, "")
    .substring(0, 80);
} catch {
  // 忽略错误
}

// ========== 2. 读取并更新版本 ==========

const versionPath = join(__dirname, "..", "src", "version.ts");
let versionContent = readFileSync(versionPath, "utf-8");

const majorMatch = versionContent.match(/major:\s*(\d+)/);
const minorMatch = versionContent.match(/minor:\s*(\d+)/);
const patchMatch = versionContent.match(/patch:\s*(\d+)/);

let major = parseInt(majorMatch?.[1] || "0");
let minor = parseInt(minorMatch?.[1] || "0");
let patch = parseInt(patchMatch?.[1] || "0");

// 更新版本号
switch (type) {
  case "major":
    major++;
    minor = 0;
    patch = 0;
    break;
  case "minor":
    minor++;
    patch = 0;
    break;
  case "patch":
    patch++;
    break;
}

const newVersion = `${major}.${minor}.${patch}`;
const today = new Date().toISOString().split("T")[0];

// 更新 version.ts
if (featureDescription) {
  versionContent = versionContent.replace(
    /description:\s*"[^"]*"/,
    `description: "${featureDescription}"`
  );
}

const newContent = versionContent
  .replace(/major:\s*\d+/, `major: ${major}`)
  .replace(/minor:\s*\d+/, `minor: ${minor}`)
  .replace(/patch:\s*\d+/, `patch: ${patch}`)
  .replace(/date:\s*"[^"]+"/, `date: "${today}"`);

writeFileSync(versionPath, newContent);
console.log(`✅ 版本已更新: v${newVersion}`);
if (featureDescription) {
  console.log(`📝 功能描述: ${featureDescription}`);
}

// ========== 3. 更新 package.json ==========

const pkgPath = join(__dirname, "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`✅ package.json 已更新`);

// ========== 4. 构建 ==========

console.log("🔨 正在构建...");
try {
  execSync("npm run build", { stdio: "inherit" });
  console.log("✅ 构建完成");
} catch (e) {
  console.error("❌ 构建失败");
  process.exit(1);
}

// ========== 5. Git 提交 ==========

console.log("📝 正在提交...");
const commitMessage = featureDescription
  ? `release: v${newVersion} - ${featureDescription}`
  : `release: v${newVersion}`;

try {
  // 检查是否有未提交的更改
  const status = execSync("git status --porcelain", { encoding: "utf-8" });
  if (!status.trim()) {
    console.log("⚠️ 没有需要提交的更改");
  } else {
    execSync("git add -A", { stdio: "ignore" });
    execSync(`git commit -m "${commitMessage}"`, { stdio: "inherit" });
    console.log("✅ 已提交");
  }
  
  // 推送到远程
  console.log("🚀 推送到远程...");
  execSync("git push origin master", { stdio: "inherit" });
  console.log("✅ 已推送到 GitHub");
} catch (e) {
  console.log("⚠️ Git 操作失败，请手动提交和推送");
}

console.log(`\n🎉 版本 v${newVersion} 发布完成！`);
