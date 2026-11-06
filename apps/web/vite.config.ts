import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      // 后端端口跟随 server 的 PORT；Docker/Hyper-V 保留 3000 时用 WB_API_PORT=4000
      '/api': `http://127.0.0.1:${process.env.WB_API_PORT ?? '3000'}`,
    },
  },
});
