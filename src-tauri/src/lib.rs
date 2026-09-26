//! jnf-desktop 桌面壳 · Rust 层。
//!
//! 职责（壳只做壳，能力由内嵌 Spring Boot 服务承载）：
//! 1. `start_agent`：选 Java（JNF_AGENT_JAVA → 内置 runtime → 系统 java ≥ 17）、
//!    定位 JAR（JNF_AGENT_JAR → bundle resources → 开发回退）、选空闲端口、
//!    生成随机 32 字节 API Key、spawn `jnf-harness-app.jar`、捕获日志、持久化运行记录；
//! 2. `stop_agent`：kill + wait + 清理运行记录；
//! 3. `agent_status`：如实上报运行状态（含子进程意外退出感知与 Java 运行时诊断）；
//! 4. 启动前清理上次遗留的 JAR 进程（防 H2 文件锁 / 端口占用）；Drop 与退出事件双保险收尸。

use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{Manager, RunEvent, State};

// ---------------------------------------------------------------------------
// 对外状态（前端轮询 agent_status 获得）
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceState {
    /// running | stopped
    status: String,
    port: Option<u16>,
    jar_path: Option<String>,
    message: String,
    /// Java 运行时状态：ready | missing | invalid | too_old
    runtime_status: String,
    /// Java 来源：custom（JNF_AGENT_JAVA）| bundled（内置 runtime）| system
    runtime_source: Option<String>,
    java_path: Option<String>,
    java_version: Option<String>,
    /// 本次启动注入的本机鉴权 key（前端凭此携带 X-API-Key）；无鉴权模式为 None
    #[serde(skip_serializing_if = "Option::is_none")]
    api_key: Option<String>,
}

/// 落盘的运行记录：上次异常退出后据此清理遗留进程。
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentRuntimeRecord {
    pid: u32,
    port: u16,
    jar_path: String,
}

#[derive(Clone)]
struct JavaRuntime {
    path: PathBuf,
    /// custom | bundled | system
    source: String,
    version: String,
}

/// Java 探测结论：即使不可用也带上路径/版本/原因，供前端诊断展示。
struct JavaCheck {
    status: String,
    source: Option<String>,
    java_path: Option<String>,
    java_version: Option<String>,
    message: String,
    runtime: Option<JavaRuntime>,
}

struct AgentRuntime {
    child: Child,
    port: u16,
    jar_path: PathBuf,
    runtime_path: PathBuf,
    java: JavaRuntime,
    api_key: Option<String>,
}

struct AgentRuntimeState(Mutex<Option<AgentRuntime>>);

impl Drop for AgentRuntimeState {
    fn drop(&mut self) {
        shutdown_runtime(self);
    }
}

fn shutdown_runtime(state: &AgentRuntimeState) {
    let mut guard = state.0.lock().unwrap();
    if let Some(mut runtime) = guard.take() {
        let _ = runtime.child.kill();
        let _ = runtime.child.wait();
        let _ = fs::remove_file(&runtime.runtime_path);
    }
}

// ---------------------------------------------------------------------------
// 遗留进程探测与清理
// ---------------------------------------------------------------------------

// Zombie 仅在 unix 探测分支构造（Windows 无僵尸态），按平台保留全集
#[allow(dead_code)]
enum PidProbe {
    Gone,
    Zombie,
    Ours,
    Foreign(String),
}

/// 判断命令行是否是我们托管的智能体 JAR 进程。
/// 优先按 JAR 文件名精确匹配（防 PID 被无关进程复用后误杀）。
fn is_agent_command(command: &str, jar_name: &str) -> bool {
    let lower = command.to_lowercase();
    if !jar_name.is_empty() && lower.contains(&jar_name.to_lowercase()) {
        return true;
    }
    lower.contains("jnf-harness") || (lower.contains("java") && lower.contains("-jar"))
}

/// 探测 PID 实际状态。
/// 要点：kill -0 会把僵尸进程（已死、待父回收）误判为存活，导致清理逻辑对僵尸
/// 发信号永远无效；因此读取进程状态与命令行：不存在/僵尸 → 不算存活；
/// 命令行与智能体 jar 无关 → 视为 PID 复用被无关进程占用，绝不动它。
#[cfg(unix)]
fn probe_pid(pid: u32, jar_name: &str) -> PidProbe {
    let output = Command::new("ps")
        .args(["-o", "stat=,command=", "-p", &pid.to_string()])
        .output();
    match output {
        Ok(output) if output.status.success() => {
            let text = String::from_utf8_lossy(&output.stdout);
            let mut parts = text.splitn(2, char::is_whitespace);
            let stat = parts.next().unwrap_or("").trim().to_string();
            let command = parts.next().unwrap_or("").trim().to_string();
            if stat.is_empty() {
                return PidProbe::Gone;
            }
            if stat.starts_with('Z') {
                return PidProbe::Zombie;
            }
            if is_agent_command(&command, jar_name) {
                PidProbe::Ours
            } else {
                PidProbe::Foreign(command)
            }
        }
        _ => PidProbe::Gone,
    }
}

#[cfg(windows)]
fn probe_pid(pid: u32, jar_name: &str) -> PidProbe {
    // 优先读命令行（PowerShell CIM）：能精确识别「我们的 JAR 进程」，避免误杀 PID 复用者。
    let script = format!(
        "(Get-CimInstance Win32_Process -Filter 'ProcessId={pid}').CommandLine"
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output();
    if let Ok(output) = output {
        if output.status.success() {
            let command = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if command.is_empty() {
                return PidProbe::Gone;
            }
            return if is_agent_command(&command, jar_name) {
                PidProbe::Ours
            } else {
                PidProbe::Foreign(command)
            };
        }
    }

    // 兜底：CIM 查询失败时退回 tasklist，只知道映像名，按 java 视为我们的进程。
    let output = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .output();
    match output {
        Ok(output) => {
            let text = String::from_utf8_lossy(&output.stdout).to_lowercase();
            if !text.contains(&pid.to_string()) {
                PidProbe::Gone
            } else if text.contains("java") {
                PidProbe::Ours
            } else {
                PidProbe::Foreign(text)
            }
        }
        Err(_) => PidProbe::Gone,
    }
}

fn pid_is_alive(pid: u32, jar_name: &str) -> bool {
    !matches!(probe_pid(pid, jar_name), PidProbe::Gone | PidProbe::Zombie)
}

fn terminate_pid(pid: u32) {
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    #[cfg(windows)]
    {
        // /T 连子进程树一起结束（java 可能再派生子进程）
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
}

fn force_kill_pid(pid: u32) {
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-KILL", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
}

/// 等待进程退出；返回 true 表示确认退出，false 表示超时仍存活。
fn wait_pid_gone(pid: u32, jar_name: &str, attempts: usize) -> bool {
    for _ in 0..attempts {
        if !pid_is_alive(pid, jar_name) {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    !pid_is_alive(pid, jar_name)
}

/// 启动前清理上次遗留的 JAR 进程与过期运行记录。
fn cleanup_stale_runtime(runtime_path: &Path) -> Result<(), String> {
    let record = match fs::read_to_string(runtime_path) {
        Ok(contents) => serde_json::from_str::<AgentRuntimeRecord>(&contents).ok(),
        Err(_) => None,
    };

    if let Some(record) = record {
        let jar_name = Path::new(&record.jar_path)
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        match probe_pid(record.pid, &jar_name) {
            // 进程已退出或为僵尸：僵尸无法被信号终结，直接视为可清理
            PidProbe::Gone | PidProbe::Zombie => {}
            PidProbe::Foreign(command) => {
                // PID 已被无关进程复用：不动它，直接清掉过期记录继续启动
                eprintln!(
                    "[agent-runtime] 运行记录 PID {} 已被无关进程占用（{}），跳过清理",
                    record.pid, command
                );
            }
            PidProbe::Ours => {
                terminate_pid(record.pid);
                if !wait_pid_gone(record.pid, &jar_name, 30) {
                    force_kill_pid(record.pid);
                    if !wait_pid_gone(record.pid, &jar_name, 30) {
                        return Err(format!("无法清理旧智能体进程（PID {}）", record.pid));
                    }
                }
            }
        }
    }

    fs::remove_file(runtime_path)
        .or_else(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                Ok(())
            } else {
                Err(error)
            }
        })
        .map_err(|error| format!("清理智能体运行记录失败：{error}"))
}

/// 运行记录原子写（tmp + rename），避免崩溃留下半截文件。
fn persist_runtime(runtime_path: &Path, child: &Child, port: u16, jar_path: &Path) -> Result<(), String> {
    let record = AgentRuntimeRecord {
        pid: child.id(),
        port,
        jar_path: jar_path.display().to_string(),
    };
    let temporary_path = runtime_path.with_extension("json.tmp");
    let contents =
        serde_json::to_vec_pretty(&record).map_err(|error| format!("写入智能体运行记录失败：{error}"))?;
    fs::write(&temporary_path, contents).map_err(|error| format!("写入智能体运行记录失败：{error}"))?;
    fs::rename(&temporary_path, runtime_path).map_err(|error| format!("保存智能体运行记录失败：{error}"))
}

// ---------------------------------------------------------------------------
// Java 运行时选择（JNF_AGENT_JAVA → 内置 runtime → 系统 java ≥ 17）
// ---------------------------------------------------------------------------

fn java_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "java.exe"
    } else {
        "java"
    }
}

fn bundled_java_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let path = resource_dir.join("agent/runtime/bin").join(java_binary_name());
        if path.is_file() {
            return Some(path);
        }
    }

    // 开发态回退：jnf-desktop/resources/agent/runtime/
    let development_runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../resources/agent/runtime/bin")
        .join(java_binary_name());
    development_runtime.is_file().then_some(development_runtime)
}

/// 解析 `java -version` 输出 → (原始版本串, major)。
/// 兼容 "17.0.9"、"1.8.0_392"（老式 major 1.x）、"21" 等形态。
fn parse_java_version(output: &[u8]) -> Option<(String, u32)> {
    let text = String::from_utf8_lossy(output);
    let raw_version = text
        .split_once("version \"")
        .and_then(|(_, rest)| rest.split_once('"').map(|(version, _)| version.to_string()))
        .or_else(|| {
            text.split_whitespace()
                .map(|token| token.trim_matches(['"', '\'']))
                .find(|token| token.chars().next().is_some_and(|c| c.is_ascii_digit()))
                .map(ToString::to_string)
        })?;

    let major_text = raw_version
        .strip_prefix("1.")
        .unwrap_or(&raw_version)
        .split(['.', '-'])
        .next()?;
    let major = major_text.parse::<u32>().ok()?;
    Some((raw_version, major))
}

fn inspect_java(path: PathBuf, source: &str) -> JavaCheck {
    let java_path = path.display().to_string();
    let output = Command::new(&path).arg("-version").output();
    let output = match output {
        Ok(output) => output,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return JavaCheck {
                status: "missing".to_string(),
                source: Some(source.to_string()),
                java_path: (source != "system").then_some(java_path),
                java_version: None,
                message: "未检测到可用的 Java Runtime。可设置 JNF_AGENT_JAVA、执行 npm run agent:runtime 内置 Runtime，或安装系统 Java 17+。"
                    .to_string(),
                runtime: None,
            };
        }
        Err(error) => {
            return JavaCheck {
                status: "invalid".to_string(),
                source: Some(source.to_string()),
                java_path: Some(java_path.clone()),
                java_version: None,
                message: format!("Java Runtime 无法启动：{java_path}（{error}）"),
                runtime: None,
            };
        }
    };

    let version_output = [output.stdout.as_slice(), output.stderr.as_slice()].concat();
    let Some((version, major)) = parse_java_version(&version_output) else {
        return JavaCheck {
            status: "invalid".to_string(),
            source: Some(source.to_string()),
            java_path: Some(java_path.clone()),
            java_version: None,
            message: format!("无法识别 Java Runtime 版本：{java_path}"),
            runtime: None,
        };
    };

    if !output.status.success() {
        return JavaCheck {
            status: "invalid".to_string(),
            source: Some(source.to_string()),
            java_path: Some(java_path.clone()),
            java_version: Some(version),
            message: format!("Java Runtime 启动检查失败：{java_path}"),
            runtime: None,
        };
    }

    if major < 17 {
        return JavaCheck {
            status: "too_old".to_string(),
            source: Some(source.to_string()),
            java_path: Some(java_path.clone()),
            java_version: Some(version.clone()),
            message: format!("检测到 Java {version}，智能体服务需要 Java 17 或更高版本。"),
            runtime: None,
        };
    }

    let message = match source {
        "custom" => format!("已使用 JNF_AGENT_JAVA 指定的 Java {version}"),
        "bundled" => format!("已使用应用内置 Java {version} Runtime"),
        _ => format!("未找到应用内置 Runtime，当前使用系统 Java {version}：{java_path}"),
    };
    JavaCheck {
        status: "ready".to_string(),
        source: Some(source.to_string()),
        java_path: Some(java_path.clone()),
        java_version: Some(version.clone()),
        message,
        runtime: Some(JavaRuntime {
            path,
            source: source.to_string(),
            version,
        }),
    }
}

fn resolve_java(app: &tauri::AppHandle) -> JavaCheck {
    if let Ok(path) = std::env::var("JNF_AGENT_JAVA") {
        return inspect_java(PathBuf::from(path), "custom");
    }
    if let Some(path) = bundled_java_path(app) {
        return inspect_java(path, "bundled");
    }
    inspect_java(PathBuf::from("java"), "system")
}

// ---------------------------------------------------------------------------
// JAR 定位（JNF_AGENT_JAR → bundle resources → 开发回退）
// ---------------------------------------------------------------------------

/// JAR 是否真实可用：Spring Boot fat jar 至少兆级；
/// 占位文件（tauri-build 要求 bundle resource 存在而留的 stub）不算。
fn jar_usable(path: &Path) -> bool {
    path.is_file()
        && fs::metadata(path)
            .map(|meta| meta.len() >= 1024 * 1024)
            .unwrap_or(false)
}

fn locate_agent_jar(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("JNF_AGENT_JAR") {
        let path = PathBuf::from(path);
        if jar_usable(&path) {
            return Ok(path);
        }
        return Err(format!(
            "JNF_AGENT_JAR 指向的文件不存在或不是有效 JAR（小于 1 MB）：{}",
            path.display()
        ));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let path = resource_dir.join("agent/jnf-harness-app.jar");
        if jar_usable(&path) {
            return Ok(path);
        }
    }

    // 开发态回退：../jnf-harness/jnf-harness-app/target/jnf-harness-app.jar（Maven finalName）
    let development_jar = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../jnf-harness/jnf-harness-app/target/jnf-harness-app.jar");
    if jar_usable(&development_jar) {
        return Ok(development_jar);
    }

    Err("未找到智能体 JAR。请先执行 npm run agent:build && npm run agent:copy（或 npm run agent:prepare），或设置 JNF_AGENT_JAR。".to_string())
}

// ---------------------------------------------------------------------------
// 端口与 API Key
// ---------------------------------------------------------------------------

fn find_free_port() -> Result<u16, String> {
    TcpListener::bind(("127.0.0.1", 0))
        .map(|listener| listener.local_addr().map(|addr| addr.port()).unwrap_or(8090))
        .map_err(|error| format!("分配端口失败：{error}"))
}

/// 生成 256 位随机本机鉴权 key（hex），OS 随机源（/dev/urandom、BCryptGenRandom 等）。
fn generate_api_key() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| format!("生成 API Key 失败：{error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

// ---------------------------------------------------------------------------
// 状态快照
// ---------------------------------------------------------------------------

fn running_state(runtime: &AgentRuntime, message: String) -> ServiceState {
    ServiceState {
        status: "running".to_string(),
        port: Some(runtime.port),
        jar_path: Some(runtime.jar_path.display().to_string()),
        message,
        runtime_status: "ready".to_string(),
        runtime_source: Some(runtime.java.source.clone()),
        java_path: Some(runtime.java.path.display().to_string()),
        java_version: Some(runtime.java.version.clone()),
        api_key: runtime.api_key.clone(),
    }
}

fn stopped_state(
    java: &JavaCheck,
    port: Option<u16>,
    jar_path: Option<String>,
    message: String,
) -> ServiceState {
    ServiceState {
        status: "stopped".to_string(),
        port,
        jar_path,
        message,
        runtime_status: java.status.clone(),
        runtime_source: java.source.clone(),
        java_path: java.java_path.clone(),
        java_version: java.java_version.clone(),
        api_key: None,
    }
}

// ---------------------------------------------------------------------------
// Tauri 命令
// ---------------------------------------------------------------------------

#[tauri::command]
fn start_agent(app: tauri::AppHandle, state: State<AgentRuntimeState>) -> Result<ServiceState, String> {
    let mut guard = state.0.lock().unwrap();

    // 已在运行 → 幂等返回；子进程已退出 → 清理记录后重新拉起。
    if let Some(mut previous) = guard.take() {
        match previous.child.try_wait() {
            Ok(None) => {
                let snapshot = running_state(&previous, "智能体服务已在运行".to_string());
                *guard = Some(previous);
                return Ok(snapshot);
            }
            _ => {
                // 已退出或状态未知：best-effort 收尸 + 清记录，然后走全新启动
                let _ = previous.child.kill();
                let _ = previous.child.wait();
                let _ = fs::remove_file(&previous.runtime_path);
            }
        }
    }

    let java_check = resolve_java(&app);
    let java = java_check
        .runtime
        .clone()
        .ok_or_else(|| java_check.message.clone())?;
    let jar_path = locate_agent_jar(&app)?;
    let port = find_free_port()?;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    fs::create_dir_all(&data_dir).map_err(|error| format!("创建数据目录失败：{error}"))?;
    let runtime_path = data_dir.join("agent-runtime.json");
    cleanup_stale_runtime(&runtime_path)?;

    let log_dir = data_dir.join("logs");
    fs::create_dir_all(&log_dir).map_err(|error| format!("创建日志目录失败：{error}"))?;
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("agent.log"))
        .map_err(|error| format!("打开日志文件失败：{error}"))?;

    // 本机鉴权：每次启动生成随机 key 并注入后端强制校验；
    // key 生成失败时降级为无鉴权模式（保持可用性，日志告警）。
    let api_key = match generate_api_key() {
        Ok(key) => Some(key),
        Err(error) => {
            eprintln!("[agent-runtime] {error}，本次以无鉴权模式启动");
            None
        }
    };

    // 按冻结契约拉起后端：
    // java -Dserver.port=<port> -jar <jar> --spring.profiles.active=standalone --harness.auth.api-keys=<key>
    let mut start_command = Command::new(&java.path);
    start_command
        .arg(format!("-Dserver.port={port}"))
        .arg("-jar")
        .arg(&jar_path)
        .arg("--spring.profiles.active=standalone");
    if let Some(key) = &api_key {
        start_command.arg(format!("--harness.auth.api-keys={key}"));
    }

    let child = start_command
        .current_dir(&data_dir)
        .stdout(Stdio::from(
            log_file
                .try_clone()
                .map_err(|error| format!("复制日志句柄失败：{error}"))?,
        ))
        .stderr(Stdio::from(log_file))
        .spawn()
        .map_err(|error| format!("启动 JAR 失败（Java {}）：{error}", java.version))?;

    if let Err(error) = persist_runtime(&runtime_path, &child, port, &jar_path) {
        let mut child = child;
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }

    let runtime = AgentRuntime {
        child,
        port,
        jar_path: jar_path.clone(),
        runtime_path,
        java: java.clone(),
        api_key: api_key.clone(),
    };
    let snapshot = running_state(&runtime, "进程已启动，等待就绪探测（GET /actuator/health）".to_string());
    *guard = Some(runtime);
    Ok(snapshot)
}

#[tauri::command]
fn stop_agent(state: State<AgentRuntimeState>) -> Result<ServiceState, String> {
    shutdown_runtime(&state);
    let java_check = JavaCheck {
        status: "unknown".to_string(),
        source: None,
        java_path: None,
        java_version: None,
        message: String::new(),
        runtime: None,
    };
    Ok(stopped_state(&java_check, None, None, "智能体服务已停止".to_string()))
}

#[tauri::command]
fn agent_status(app: tauri::AppHandle, state: State<AgentRuntimeState>) -> ServiceState {
    let mut guard = state.0.lock().unwrap();

    let exited = match guard.as_mut() {
        Some(runtime) => match runtime.child.try_wait() {
            Ok(Some(exit_status)) => Some((exit_status, runtime.port, runtime.jar_path.display().to_string())),
            _ => None,
        },
        None => None,
    };

    if let Some((exit_status, port, jar_path)) = exited {
        if let Some(finished) = guard.take() {
            let _ = fs::remove_file(&finished.runtime_path);
        }
        let java_check = resolve_java(&app);
        return stopped_state(
            &java_check,
            Some(port),
            Some(jar_path),
            format!("智能体进程已退出：{exit_status}"),
        );
    }

    match guard.as_ref() {
        Some(runtime) => running_state(runtime, format!("HTTP 服务监听 127.0.0.1:{}", runtime.port)),
        None => {
            let java_check = resolve_java(&app);
            stopped_state(&java_check, None, None, "智能体服务未启动".to_string())
        }
    }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

pub fn run() {
    tauri::Builder::default()
        // 前端双通道 fetch 的兜底通道（原生 window.fetch 失败时经 Rust 发请求）
        .plugin(tauri_plugin_http::init())
        .manage(AgentRuntimeState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![start_agent, stop_agent, agent_status])
        .build(tauri::generate_context!())
        .expect("构建 JNF Desktop 窗口失败")
        .run(|app, event| {
            // 退出收尸（Drop 之外的第二道保险）
            if let RunEvent::Exit = event {
                shutdown_runtime(app.state::<AgentRuntimeState>().inner());
            }
        });
}

// ---------------------------------------------------------------------------
// 纯函数单测
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_modern_java_version() {
        let output = b"openjdk version \"17.0.9\" 2023-10-17\nOpenJDK Runtime Environment ...";
        let (version, major) = parse_java_version(output).unwrap();
        assert_eq!(version, "17.0.9");
        assert_eq!(major, 17);
    }

    #[test]
    fn parses_legacy_java_version() {
        let output = b"java version \"1.8.0_392\"\nJava(TM) SE Runtime Environment ...";
        let (version, major) = parse_java_version(output).unwrap();
        assert_eq!(version, "1.8.0_392");
        assert_eq!(major, 8);
    }

    #[test]
    fn parses_short_java_version() {
        let output = b"openjdk version \"21\"\n";
        let (_, major) = parse_java_version(output).unwrap();
        assert_eq!(major, 21);
    }

    #[test]
    fn generates_32_byte_hex_api_key() {
        let key = generate_api_key().unwrap();
        assert_eq!(key.len(), 64);
        assert!(key.chars().all(|c| c.is_ascii_hexdigit()));
        // 两次生成不撞车（弱随机会立刻暴露）
        assert_ne!(key, generate_api_key().unwrap());
    }

    #[test]
    fn recognizes_agent_command() {
        assert!(is_agent_command(
            "java -Dserver.port=1234 -jar /x/jnf-harness-app.jar --spring.profiles.active=standalone",
            "jnf-harness-app.jar"
        ));
        assert!(is_agent_command("java -jar /custom/agent.jar", "other.jar"));
        assert!(!is_agent_command("node server.js", "jnf-harness-app.jar"));
        assert!(!is_agent_command("python.exe worker.py", "jnf-harness-app.jar"));
    }

    #[test]
    fn runtime_record_round_trip() {
        let record = AgentRuntimeRecord {
            pid: 42,
            port: 8080,
            jar_path: "C:\\agent\\jnf-harness-app.jar".to_string(),
        };
        let json = serde_json::to_string(&record).unwrap();
        assert!(json.contains("\"jarPath\""));
        let parsed: AgentRuntimeRecord = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.pid, 42);
        assert_eq!(parsed.port, 8080);
    }
}
