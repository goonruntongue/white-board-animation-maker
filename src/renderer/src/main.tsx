import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initHandPresets } from './engine/handPresets'
import { initTheme } from './lib/theme'
import './fonts'
import './styles.css'

// 起動中の表示（index.html の LED 進捗バー）へ進み具合を知らせる。表示がない環境では何もしない
declare global {
  interface Window {
    wbBoot?: { step: (value: number, text?: string) => void; done: () => void }
  }
}
const boot = (value: number, text?: string): void => window.wbBoot?.step(value, text)

// iPhone のホーム画面から開いたとき（PWA）の印。画面いっぱいに固定する CSS に使う（display-mode が効かない版への保険）
if ((navigator as Navigator & { standalone?: boolean }).standalone) document.documentElement.classList.add('ios-standalone')

// 手素材の一覧（サイズ・ペン先位置）を先に調べてから、状態とUIを作る
async function start(): Promise<void> {
  boot(20, '起動中')
  initTheme()
  await initHandPresets((done, total) => boot(20 + Math.round((done / Math.max(1, total)) * 62), `手の素材を読み込み中 ${done}/${total}`))
  boot(84, '画面を準備中')
  const { default: App } = await import('./App')
  boot(92, '画面を準備中')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
  // 最初の画面が描かれてから、起動中の表示を消す
  requestAnimationFrame(() => requestAnimationFrame(() => window.wbBoot?.done()))
}

void start()
