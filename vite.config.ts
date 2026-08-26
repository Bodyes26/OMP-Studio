// @ts-nocheck
import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [sveltekit()],

  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: isSsrBuild
        ? {}
        : {
            manualChunks(id) {
              if (id.includes('node_modules')) {
                if (id.includes('monaco-editor')) {
                  return 'vendor-monaco';
                }
                if (id.includes('@xterm')) {
                  return 'vendor-xterm';
                }
                if (
                  id.includes('mermaid') ||
                  id.includes('d3') ||
                  id.includes('dagre') ||
                  id.includes('khroma') ||
                  id.includes('stylis')
                ) {
                  return 'vendor-mermaid';
                }
                if (id.includes('marked') || id.includes('dompurify')) {
                  return 'vendor-markdown';
                }
              }
            }
          }
    }
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
