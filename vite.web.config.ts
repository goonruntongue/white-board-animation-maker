// ブラウザ単体で動かす検証用設定（PRD フェーズ1 のブラウザ版）
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
  plugins: [react()],
  build: { outDir: resolve(__dirname, 'dist/web'), emptyOutDir: true }
})
