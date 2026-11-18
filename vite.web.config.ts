// ブラウザ版／PWA版のビルド設定（スマホ・タブレット向け）。
// PC 版は Electron（electron.vite.config.ts）で、こちらはホーム画面に追加して使える PWA として配布する。
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  // サブフォルダに置いても動くよう相対パスで出力する
  base: './',
  // PWA は「オリジン（localhost:ポート）＋マニフェストの id」で同じアプリかどうか判断される。
  // Vite 既定の 5173 / 4173 は他のアプリ（LabelDrop など）とも共用になり、
  // インストール済みの別アプリのアイコンや Service Worker と混ざるので、このアプリ専用のポートを使う。
  server: { port: 5310, strictPort: true },
  preview: { port: 4310, strictPort: true },
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // 登録は public/register-sw.js で行う（新しい版への切り替えを確実にするため）
      injectRegister: false,
      manifest: {
        // 同じオリジンに別のアプリがあっても混ざらないよう、固有の id を付ける
        id: 'com.goonruntongue.whiteboard-animation-maker',
        name: 'Whiteboard Animation Maker',
        short_name: 'WB Animator',
        description: '清書画像から「手が描いていく」アニメーションを作るアプリ',
        lang: 'ja',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#17181b',
        theme_color: '#2d3035',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // 本体（HTML / JS / CSS / アイコン）は最初に取り込み、オフラインでも起動できるようにする
        globPatterns: ['**/*.{html,js,css}', 'icons/*.png'],
        navigateFallback: 'index.html',
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // フォント（文字種ごとに分割）と手素材は、使ったものから順に保存する（初回の通信量を抑える）
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\.(woff2?|png|webp|svg)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'assets',
              expiration: { maxEntries: 600 }
            }
          }
        ]
      },
      devOptions: { enabled: false }
    })
  ],
  build: { outDir: resolve(__dirname, 'dist/web'), emptyOutDir: true }
})
