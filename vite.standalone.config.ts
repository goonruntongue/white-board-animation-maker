import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  publicDir: false,
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
  plugins: [
    react(),
    {
      name: 'standalone-html',
      transformIndexHtml(html) {
        return html
          .replace(/\s*<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '')
          .replace(/\s*<link rel="(?:apple-touch-icon|icon)"[^>]*\/>/g, '')
          // 1ファイル版には Service Worker はない（PWA の更新用スクリプトを外す）
          .replace(/\s*<!--[^>]*PWA[^>]*-->\s*<script src="\.\/register-sw\.js"><\/script>/, '')
      }
    },
    viteSingleFile()
  ],
  build: {
    outDir: resolve(__dirname, 'dist/standalone'),
    emptyOutDir: true,
    assetsInlineLimit: 100000000,
    rollupOptions: { output: { inlineDynamicImports: true } }
  }
})
