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
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2017",
    chunkSizeWarningLimit: 1500,
    minify: "esbuild",
    sourcemap: false,
  },
});
