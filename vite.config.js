import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  root: 'web',
  plugins: [vue()],
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: { port: 5179, proxy: { '/api': 'http://127.0.0.1:5178' } },
});
