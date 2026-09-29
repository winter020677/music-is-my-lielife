// 管理画面を作る（ビルドする）ための設定
//   npm run build     … dist/admin に管理画面を作る（setup.bat が実行する）
//   npm run dev:admin … 開発用。http://localhost:5173 で開き、書き換えるとすぐ反映される
//                        （本体を npm run dev で起動しておくこと）

import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const BACKEND = 'http://127.0.0.1:3939';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../../dist/admin', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // 開発中は、APIとWebSocketを本体へ中継する（本体は自分のページからの操作しか受け付けないので、送り元を本体に合わせる）
    proxy: {
      '/api': {
        target: BACKEND,
        changeOrigin: true,
        configure: (proxy) => proxy.on('proxyReq', (req) => req.setHeader('origin', BACKEND)),
      },
      '/ws': {
        target: BACKEND,
        ws: true,
        changeOrigin: true,
        configure: (proxy) => proxy.on('proxyReqWs', (req) => req.setHeader('origin', BACKEND)),
      },
      '/overlay': { target: BACKEND, changeOrigin: true },
    },
  },
});
