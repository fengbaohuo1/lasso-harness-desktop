#!/usr/bin/env node
/**
 * 把后端制品复制到桌面壳的内嵌资源目录（P4 多 jar 布局）：
 *   ../jnf-harness/jnf-harness-app/target/jnf-harness-app.jar
 *     -> resources/agent/jnf-harness-app.jar          内核 fat jar
 *   ../jnf-harness/jnf-harness-app/target/plugins/*.jar
 *     -> resources/agent/plugins/*.jar                官方插件（动态加载）
 *
 * 内核按「jar 同级 plugins/」自动发现插件目录（PluginDirectoryResolver），
 * 因此 Rust 壳 spawn 无需额外参数。
 *
 * 背景：tauri-build 编译期要求 bundle resource 文件存在，因此仓库里留了一个
 * 占位 jnf-harness-app.jar（gitignored）。占位文件不是有效 JAR：
 * Rust 壳按「≥ 1 MB」校验拒绝启动它，本脚本 --verify 也按同样阈值拦截打包。
 *
 * 用法：
 *   node scripts/copy-agent-jar.mjs           复制（JAR/插件不存在时报错退出 1）
 *   node scripts/copy-agent-jar.mjs --verify  校验目标制品是真实 JAR（打包前调用）
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceJar = join(projectRoot, "..", "jnf-harness", "jnf-harness-app", "target", "jnf-harness-app.jar");
const sourcePlugins = join(projectRoot, "..", "jnf-harness", "jnf-harness-app", "target", "plugins");
const targetJar = join(projectRoot, "resources", "agent", "jnf-harness-app.jar");
const targetPlugins = join(projectRoot, "resources", "agent", "plugins");
const MIN_JAR_BYTES = 1024 * 1024; // 真实 Spring Boot fat jar 至少兆级
const MIN_PLUGIN_BYTES = 1024; // 真实插件薄 JAR 至少 KB 级

function fail(message) {
  console.error(`[agent:copy] ${message}`);
  process.exit(1);
}

function pluginJars(dir) {
  return existsSync(dir)
    ? readdirSync(dir).filter((name) => name.endsWith(".jar"))
    : [];
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
  const plugins = pluginJars(targetPlugins);
  if (plugins.length === 0) {
    fail(`${targetPlugins} 内没有插件 JAR——内核将无 fs/shell/web 工具。请执行 npm run agent:copy`);
  }
  for (const name of plugins) {
    const pluginSize = statSync(join(targetPlugins, name)).size;
    if (pluginSize < MIN_PLUGIN_BYTES) {
      fail(`${join(targetPlugins, name)} 只有 ${pluginSize} 字节，疑似占位文件`);
    }
  }
  console.log(`[agent:copy] OK ${targetJar}（${(size / 1024 / 1024).toFixed(1)} MB）+ ${plugins.length} 个插件 JAR`);
  process.exit(0);
}

if (!existsSync(sourceJar)) {
  fail(
    `未找到后端 JAR：${sourceJar}\n` +
      "请先构建后端：npm run agent:build（即 mvn -f ../jnf-harness/pom.xml -DskipTests package）",
  );
}
const sourcePluginJars = pluginJars(sourcePlugins);
if (sourcePluginJars.length === 0) {
  fail(`未找到插件 JAR：${sourcePlugins}（mvn package 会产出官方插件到该目录）`);
}

mkdirSync(dirname(targetJar), { recursive: true });
copyFileSync(sourceJar, targetJar);
console.log(`[agent:copy] ${sourceJar} -> ${targetJar}`);

// 插件目录：全量替换（避免残留已下线插件）
rmSync(targetPlugins, { recursive: true, force: true });
mkdirSync(targetPlugins, { recursive: true });
for (const name of sourcePluginJars) {
  copyFileSync(join(sourcePlugins, name), join(targetPlugins, name));
  console.log(`[agent:copy] plugins/${name}`);
}
