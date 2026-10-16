#!/usr/bin/env node
/**
 * 准备应用内置 Java 17 Runtime：按目标平台下载 Temurin JRE，解包到 resources/agent/runtime/。
 * 打包时随 bundle resources 进安装包，用户无需安装 JDK。
 *
 * 可裁剪项：开发环境可不准备 runtime，Rust 壳会按 JNF_AGENT_JAVA -> 内置 runtime -> 系统 java(>=17) 顺序选择。
 *
 * 环境变量：
 *   JNF_JRE_VERSION  JRE 大版本，默认 "17"
 *   JNF_JRE_TARGET   目标平台，默认当前平台，形如 win32-x64 / darwin-arm64 / linux-x64
 */
import { execFileSync } from "node:child_process";
import { cpSync, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const version = process.env.JNF_JRE_VERSION || "17";
const target = process.env.JNF_JRE_TARGET || `${process.platform}-${process.arch}`;
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputRoot = join(projectRoot, "resources", "agent", "runtime");

const platformMap = {
  "darwin-x64": { image: "mac", arch: "x64", extension: "tar.gz" },
  "darwin-arm64": { image: "mac", arch: "aarch64", extension: "tar.gz" },
  "win32-x64": { image: "windows", arch: "x64", extension: "zip" },
  "win32-arm64": { image: "windows", arch: "aarch64", extension: "zip" },
  "linux-x64": { image: "linux", arch: "x64", extension: "tar.gz" },
  "linux-arm64": { image: "linux", arch: "aarch64", extension: "tar.gz" },
};

const platform = platformMap[target];
if (!platform) {
  throw new Error(`不支持的 JRE 目标平台：${target}。可用值：${Object.keys(platformMap).join(", ")}`);
}

const url =
  `https://api.adoptium.net/v3/binary/latest/${version}/ga/${platform.image}/${platform.arch}` +
  `/jre/hotspot/normal/eclipse?project=jdk`;

const temporaryRoot = await mkdtemp(join(tmpdir(), "jnf-jre-"));
const archive = join(temporaryRoot, `java${version}-runtime.${platform.extension}`);
const unpacked = join(temporaryRoot, "unpacked");

async function download(file, destination) {
  const response = await fetch(file, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`下载 JRE 失败：HTTP ${response.status} ${file}`);
  }
  await pipeline(response.body, createWriteStream(destination));
}

console.log(`[agent:runtime] 目标平台 ${target}，下载 ${url}`);
await download(url, archive);

mkdirSync(unpacked, { recursive: true });
// Windows 10+ 自带 bsdtar（tar.exe），可解 zip 与 tar.gz；macOS/Linux 自带 tar。
execFileSync("tar", ["-xf", archive, "-C", unpacked], { stdio: "inherit" });

// 解包出的目录形如 jdk-17.x.x+x-jre/，取第一层目录作为 runtime 根。
const { readdirSync } = await import("node:fs");
const [runtimeHome] = readdirSync(unpacked);
if (!runtimeHome) {
  throw new Error(`解包 JRE 失败：${unpacked} 内无内容`);
}

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(dirname(outputRoot), { recursive: true });
const stagedHome = join(unpacked, runtimeHome);
try {
  renameSync(stagedHome, outputRoot);
} catch (error) {
  // 系统临时目录与工程目录常不在同一磁盘（C:\Temp → D:\repo），rename 会抛 EXDEV
  // 并在删掉旧 runtime 之后失败——退回递归拷贝，避免「runtime 目录被清空」的半成品状态。
  if (error?.code !== "EXDEV") {
    throw error;
  }
  console.warn(`[agent:runtime] 临时目录与工程目录不同盘（${error.code}），改用递归拷贝`);
  cpSync(stagedHome, outputRoot, { recursive: true });
}
rmSync(temporaryRoot, { recursive: true, force: true });

const javaBinary = join(outputRoot, "bin", process.platform === "win32" ? "java.exe" : "java");
if (!existsSync(javaBinary)) {
  throw new Error(`解包后未找到 ${javaBinary}`);
}
if (process.platform !== "win32") {
  execFileSync("chmod", ["+x", javaBinary], { stdio: "inherit" });
}
console.log(`[agent:runtime] 就绪：${outputRoot}`);
