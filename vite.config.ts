/// <reference types="vite/client" />
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch:{
      ignored: ['**/.DS_Store'],
    }
  },
  envPrefix: ['VITE_', 'TAURI_'],
  resolve: {
    alias: {
      'onnxruntime-web/webgpu': 'onnxruntime-web/wasm',
    },
    conditions: ['onnxruntime-web-use-extern-wasm'],
  },
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13'
  }
});
