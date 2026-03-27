#!/usr/bin/env node
/**
 * 版本号更新脚本
 * 
 * 使用方法:
 *   npm run version:patch  # 0.2.0 -> 0.2.1
 *   npm run version:minor  # 0.2.0 -> 0.3.0
 *   npm run version:major  # 0.2.0 -> 1.0.0
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

// 读取当前版本
const versionPath = join(__dirname, "..", "src", "version.ts");
const versionContent = readFileSync(versionPath, "utf-8");

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

// 获取最近一次 commit message 作为版本描述
try {
  const lastCommitMsg = execSync("git log -1 --pretty=%B", { encoding: "utf-8" }).trim();
  // 提取第一行作为描述，去掉常见的 commit 前缀
  const description = lastCommitMsg
    .split("\n")[0]
    .replace(/^(chore|feat|fix|docs|refactor|test|style)(\(.+\))?:\s*/i, "")
    .substring(0, 100); // 限制长度
  
  if (description) {
    // 更新 description
    const newContentWithDesc = versionContent.replace(
      /description:\s*"[^"]*"/,
      `description: "${description}"`
    );
    if (newContentWithDesc !== versionContent) {
      versionContent = newContentWithDesc;
      console.log(`📝 版本描述: ${description}`);
    }
  }
} catch {
  // 获取失败则保留原描述
}

// 更新 version.ts
const newContent = versionContent
  .replace(/major:\s*\d+/, `major: ${major}`)
  .replace(/minor:\s*\d+/, `minor: ${minor}`)
  .replace(/patch:\s*\d+/, `patch: ${patch}`)
  .replace(/date:\s*"[^"]+"/, `date: "${today}"`);

writeFileSync(versionPath, newContent);
console.log(`✅ 版本已更新: v${newVersion}`);

// 更新 package.json
const pkgPath = join(__dirname, "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`✅ package.json 已更新`);

// 构建
console.log("🔨 正在构建...");
try {
  execSync("npm run build", { stdio: "inherit" });
  console.log("✅ 构建完成");
} catch (e) {
  console.error("❌ 构建失败");
  process.exit(1);
}

// Git 提交
console.log("📝 正在提交...");
try {
  execSync("git add -A", { stdio: "ignore" });
  execSync(`git commit -m "chore: bump version to v${newVersion}"`, { stdio: "inherit" });
  execSync("git push origin master", { stdio: "inherit" });
  console.log("✅ 已提交并推送到 GitHub");
} catch (e) {
  console.log("⚠️ Git 提交失败，请手动提交");
}

console.log(`\n🎉 版本 v${newVersion} 发布完成！`);
