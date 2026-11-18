// 「このアプリについて」（Web 版だけ。歯車のメニューから開く）。
// アプリの URL の QR コード（スマホで読み取って開ける）と、著作権の表示。
import { useEffect, useState } from 'react'
import logoUrl from '../assets/flashmelody-logo.svg'
import qrUrl from '../assets/qr-app.svg'
import { Icon } from './Icon'

export const APP_URL = 'https://whiteboard-animation-maker.pages.dev/app/'

export function Copyright(): React.JSX.Element {
  return (
    <p className="about-copy">
      &copy; 2026 FlashMelody K.Murakami
      <img src={logoUrl} alt="FlashMelody" />
    </p>
  )
}

export function AboutDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(APP_URL)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // コピーできない環境では、URL を選んでもらう
    }
  }

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal about-modal" role="dialog" aria-modal aria-label="このアプリについて">
        <header>
          <h2>このアプリについて</h2>
          <span className="modal-head-actions">
            <button className="icon-btn" onClick={onClose} title="閉じる (Esc)" aria-label="閉じる">
              <Icon name="x" />
            </button>
          </span>
        </header>
        <div className="modal-body about-body">
          <h3 className="about-name">Whiteboard Animation Maker</h3>
          <p className="about-lead">ホワイトボードの清書画像から、手が少しずつ描いていくアニメーションを作るアプリです。</p>
          <img className="about-qr" src={qrUrl} alt={`このアプリの QR コード（${APP_URL}）`} />
          <p className="about-hint">スマホのカメラで読み取ると、このアプリを開けます</p>
          <div className="about-url">
            <code>{APP_URL}</code>
            <button className="btn small" onClick={() => void copy()}>
              <Icon name={copied ? 'check' : 'share'} size={13} /> {copied ? 'コピーしました' : 'コピー'}
            </button>
          </div>
          <Copyright />
        </div>
      </div>
    </div>
  )
}
