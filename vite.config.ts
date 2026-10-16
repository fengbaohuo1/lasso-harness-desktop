import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 桌面壳前端构建配置。
// 端口 1420 与 src-tauri/tauri.conf.json 的 devUrl 严格对应，strictPort 防止端口漂移后 Tauri 连错页面。
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // 构建时间戳：注入前端产物，用于核对「运行中的 App 是否包含本次修改」——
  // 打包 App 内嵌的是构建时的 dist，改代码不重新打包就永远跑旧代码。
  define: {
    __BUILD_STAMP__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // src-tauri 由 cargo 自己监听（Tauri CLI 会重启应用）。
      // 另两种是编辑器/工具原子写盘时的临时目录（`.App.tsx.1234.xxxx.tmpdir/`）：
      // 它们存在时间极短，被 chokidar 抓到会以 EBUSY 崩掉整个 dev server（实测过），必须挡掉。
      ignored: ["**/src-tauri/**", "**/*.tmpdir/**", "**/*.tmp"],
    },
  },
  build: {
    target: "es2017",
    chunkSizeWarningLimit: 1500,
    minify: "esbuild",
    sourcemap: false,
  },
});
