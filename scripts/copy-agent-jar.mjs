#!/usr/bin/env node
/**
 * 把后端 JAR 复制到桌面壳的内嵌资源目录：
 *   ../jnf-harness/jnf-harness-app/target/jnf-harness-app.jar
 *     -> resources/agent/jnf-harness-app.jar
 *
 * 背景：tauri-build 编译期要求 bundle resource 文件存在，因此仓库里留了一个
 * 占位 jnf-harness-app.jar（gitignored）。占位文件不是有效 JAR：
 * Rust 壳按「≥ 1 MB」校验拒绝启动它，本脚本 --verify 也按同样阈值拦截打包。
 *
 * 用法：
 *   node scripts/copy-agent-jar.mjs           复制（JAR 不存在时报错退出 1）
 *   node scripts/copy-agent-jar.mjs --verify  校验目标 JAR 是真实 JAR（打包前调用）
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceJar = join(projectRoot, "..", "jnf-harness", "jnf-harness-app", "target", "jnf-harness-app.jar");
const targetJar = join(projectRoot, "resources", "agent", "jnf-harness-app.jar");
const MIN_JAR_BYTES = 1024 * 1024; // 真实 Spring Boot fat jar 至少兆级

function fail(message) {
  console.error(`[agent:copy] ${message}`);
  process.exit(1);
}

if (process.argv.includes("--verify")) {
  if (!existsSync(targetJar)) {
    fail(`未找到 ${targetJar}，请先执行 npm run agent:build && npm run agent:copy`);
  }
  const size = statSync(targetJar).size;
  if (size < MIN_JAR_BYTES) {
    fail(
      `${targetJar} 只有 ${size} 字节，疑似占位文件而非真实 JAR。\n` +
        "请执行 npm run agent:build && npm run agent:copy 后再打包（npm run build 会先做本校验）。",
    );
  }
  console.log(`[agent:copy] OK ${targetJar}（${(size / 1024 / 1024).toFixed(1)} MB）`);
  process.exit(0);
}

if (!existsSync(sourceJar)) {
  fail(
    `未找到后端 JAR：${sourceJar}\n` +
      "请先构建后端：npm run agent:build（即 mvn -f ../jnf-harness/pom.xml -DskipTests package）",
  );
}

mkdirSync(dirname(targetJar), { recursive: true });
copyFileSync(sourceJar, targetJar);
console.log(`[agent:copy] ${sourceJar} -> ${targetJar}`);
