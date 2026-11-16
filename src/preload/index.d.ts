import type { DesktopApi } from './index'

declare global {
  interface Window {
    /** Electron 上でのみ存在する。ブラウザ版では undefined */
    desktop?: DesktopApi
  }
}
export {}
