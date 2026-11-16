import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initHandPresets } from './engine/handPresets'
import { initTheme } from './lib/theme'
import './styles.css'

// 手素材の一覧（サイズ・ペン先位置）を先に調べてから、状態とUIを作る
async function start(): Promise<void> {
  initTheme()
  await initHandPresets()
  const { default: App } = await import('./App')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void start()
