# lasso-harness-desktop

`lasso-harness-desktop` 是 `lasso-harness`（Agent Runtime 服务端）的桌面壳：**TypeScript + React 19** 构建界面，**Tauri 2** 负责窗口、进程与本机能力；智能体能力不重复实现——桌面壳启动 `jnf-harness-app.jar`（Spring Boot 3.3 · DDD 六边形），前端**只经 `127.0.0.1` HTTP/SSE** 调用后端接口。

> **命名说明**：仓库对外名称为 `lasso-harness-desktop`；构建产物（`jnf-harness-app.jar`）、npm 包名、环境变量（`JNF_*`）与示例目录沿用 `jnf-*` 命名，与源码一致。

核心设计决策：**桌面端只做壳，能力由内嵌服务承载**。

1. **智能体能力内嵌而非重写**：`jnf-harness-app.jar` 作为 Tauri bundle resource 打进安装包（`resources/agent/`），ReAct 循环、工具、审批等全部由服务端实现，桌面端只是 UI 投影；
2. **standalone profile + 本地 H2**：零外部依赖，不要求先部署数据库；
3. **Rust 层托管进程**：选空闲端口、生成随机 API Key、spawn/停止 JAR 子进程、日志捕获、运行状态持久化（`<app-data>/agent-runtime.json`）、上次遗留进程清理；前端不暴露任何执行命令的安全面；
4. **本机回环通信**：UI 只访问 `127.0.0.1`，capability 只放行 `http://127.0.0.1:*`；
5. **Java 三级选择**：`JNF_AGENT_JAVA` → 应用内置 Java 17 Runtime → 系统 `java`（要求 ≥ 17），无需用户改 `JAVA_HOME`/`PATH`。

> 配套服务端仓库：[lasso-harness](https://github.com/fengbaohuo1/lasso-harness)。
> 本地联调时两仓库同级放置；构建脚本按同级目录名 `jnf-harness` 定位服务端源码（克隆后可将目录命名为 `jnf-harness`，或自行调整 `package.json` 中的相对路径）。
> **联调依赖服务端可运行**（REST/SSE 接入层 + standalone profile）。

## 目录结构

```text
lasso-harness-desktop/
├── index.html                 # 壳入口（含启动错误浮层）
├── package.json               # 构建脚本（见下）
├── vite.config.ts             # Vite（端口 1420 strictPort）
├── tsconfig.json
├── src/                       # React 前端（对话 UI / API 客户端 / SSE）
├── src-tauri/                 # Tauri Rust 壳
│   ├── src/lib.rs             # start_agent / stop_agent / agent_status + 进程托管
│   ├── tauri.conf.json        # 窗口 / bundle resources / 图标
│   └── capabilities/default.json
├── resources/agent/           # 内嵌 JAR + 可选内置 JRE（不入 Git）
├── scripts/                   # copy-agent-jar / prepare-runtime / generate-icons
└── dist/                      # 前端构建产物（不入 Git）
```

配套服务端工程：[lasso-harness](https://github.com/fengbaohuo1/lasso-harness)（本地开发时与本项目同级，目录名 `jnf-harness`）。**服务端改动后必须重新 `npm run agent:build && npm run agent:copy`**，壳才会用上新服务端。

## 构建与运行

### 前置

| 依赖 | 说明 |
| --- | --- |
| Node.js ≥ 20 | 前端构建 + 脚本 |
| Rust（cargo） | Tauri 编译（`rustup` 默认安装即可） |
| JDK 17+ / Maven | 仅构建后端 JAR 时需要（`agent:build`）；运行时 Java 见下文三级选择 |

### 开发运行

```bash
npm install
npm run agent:build     # mvn 打包 ../jnf-harness → jnf-harness-app/target/jnf-harness-app.jar
npm run agent:copy      # 复制到 resources/agent/jnf-harness-app.jar
npm run dev             # = tauri dev（自动起 Vite 于 1420）
```

开发态若 `resources/agent/` 下没有 JAR，Rust 壳会回退查找
`../jnf-harness/jnf-harness-app/target/jnf-harness-app.jar`；因此 `agent:copy` 在开发时可以省略。

### 打包发布

```bash
npm run agent:prepare   # agent:build + agent:copy + agent:runtime（下载内置 JRE 17，可裁剪）
npm run build           # = agent:verify（JAR 真实性校验）+ tauri build，出各平台安装包
```

安装包内嵌 `agent/jnf-harness-app.jar` 与（可选）`agent/runtime` 内置 JRE，装完即用、无需用户装 JDK。
构建前必须先 `agent:copy`：`tauri-build` 编译期要求 bundle resource 文件存在，因此仓库里留了**占位**
`resources/agent/jnf-harness-app.jar`（gitignored）；占位文件不是有效 JAR——
`npm run build` 的 `agent:verify` 与 Rust 壳的启动定位（≥ 1 MB 校验）都会拒绝它，不会把占位打进安装包或拿去启动。

### 环境变量

| 变量 | 作用 |
| --- | --- |
| `JNF_AGENT_JAVA` | 指定启动 JAR 用的 Java 可执行文件（优先级最高） |
| `JNF_AGENT_JAR` | 指定智能体 JAR 路径（优先级最高） |
| `JNF_JRE_VERSION` / `JNF_JRE_TARGET` | `agent:runtime` 下载内置 JRE 的版本/目标平台（如 `win32-x64`、`darwin-arm64`） |

Java 选择顺序：`JNF_AGENT_JAVA` → 内置 runtime（`resources/agent/runtime/bin/java`，打包后为 `agent/runtime/bin/java`）→ 系统 `java`（要求 major ≥ 17）。
JAR 定位顺序：`JNF_AGENT_JAR` → bundle `agent/jnf-harness-app.jar` → 开发回退 `../jnf-harness/jnf-harness-app/target/jnf-harness-app.jar`。

## 启动流程（Rust 壳）

```text
start_agent
  ├─ 已在运行 → 幂等返回；子进程已退出 → 清记录重拉
  ├─ 选 Java（三级选择，解析 java -version，major < 17 拒绝）
  ├─ 定位 JAR（三级定位）
  ├─ find_free_port（bind 127.0.0.1:0）
  ├─ 生成随机 32 字节 API Key（OS 随机源）
  ├─ 清理上次遗留 JAR 进程（读 agent-runtime.json，判僵尸/PID 复用，TERM→KILL）
  └─ spawn：java -Dserver.port=<port> -jar <jar> \
             --spring.profiles.active=standalone --harness.auth.api-keys=<key>
             日志 → <app-data>/logs/agent.log
             记录 → <app-data>/agent-runtime.json（pid/port/jarPath，原子写）
```

`stop_agent` kill + wait + 清记录；窗口关闭/进程退出时 Drop 与退出事件双保险收尸，不留孤儿 Java 进程。

## 后端接口契约（冻结）

统一响应包 `{code, info, data}`，`code`：`"00000"` 成功 / `"40000"` 参数错 / `"50000"` 内部错，HTTP 恒 200；
鉴权为可选请求头 `X-API-Key`（壳生成的 key 随 `agent_status` 返回给前端）。

| 接口 | 说明 |
| --- | --- |
| `POST /api/agent/message` | 阻塞式一轮对话，body `{agentId, message, model?, maxTokens?, temperature?, cwd?}` |
| `POST /api/agent/stream` | 同 body，SSE 事件流（`meta`/`chunk`/`step_break`/`tool_result`/`finish`/`done`/`error`，另有 `:keepalive` 注释帧） |
| `GET /api/agent/{agentId}/status` | 会话状态（对账用） |
| `POST /api/agent/{agentId}/cancel` | 取消当前 turn |
| `GET /actuator/health` | 就绪探测 |

## 诊断与常见问题

**日志位置**：`<app-data>/logs/agent.log`（Windows 为 `%APPDATA%/com.jnf.harness.desktop/logs/agent.log`）。
服务实际端口与 API Key 看 `agent_status` 返回（设置页/服务状态条展示）。

**启动报"未找到智能体 JAR"**：先 `npm run agent:build && npm run agent:copy`，或设置 `JNF_AGENT_JAR`。
**启动报"检测到 Java x，需要 17+"**：安装 JDK 17+，或 `npm run agent:runtime` 准备内置 Runtime，或设置 `JNF_AGENT_JAVA`。
**上次异常退出后启动失败（H2 文件锁/端口占用）**：壳会按 `agent-runtime.json` 清理遗留进程；若仍失败，手动结束对应 PID 的 `java` 进程后重试。
**换机器/拉新代码后报 `Failed to resolve import`**：先 `npm install`。
**改了前端代码但打包 App 不生效**：打包 App 内嵌构建时的 `dist`，需重新 `npm run build`（`__BUILD_STAMP__` 可核对产物时间）。
**停止生成的语义**：停止按钮调用 `POST /api/agent/{agentId}/cancel` 并断开 SSE；服务端取消语义以第一阶段实现为准。

## 与参照实现（dsh-java-desktop）的关系

壳职责对齐参照实现（进程托管/端口/密钥/清理/持久化/日志/打包），代码自写、内部命名沿用 jnf。有意偏离：

| 点 | 参照实现 | 本实现 |
| --- | --- | --- |
| API Key 随机源 | Windows 侧时间熵弱随机兜底 | `getrandom` OS CSPRNG，失败降级无鉴权并告警 |
| release 构建的 Java 选择 | 缺内置 runtime 时报错 | 系统 java ≥ 17 作三级兜底（便于试用） |
| 遗留进程识别 | `tasklist` 只看映像名 | Windows 读命令行（CIM）按 JAR 名精确判定，防 PID 复用误杀 |
| 自动更新/签名 | updater + CI 多平台 | 裁剪（留待第三阶段） |
| 22 个原生命令/数字人房间 | 有 | 非目标（壳只做进程托管；能力归后端） |
