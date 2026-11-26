import { useEffect, useState } from 'react'
import { SERVER_INFO } from '../../../shared/mcp'

// デスクトップ版だけ：起動したとき（と、開きっぱなしなら6時間おき）に GitHub の最新リリースを確かめ、
// いまの版より新しければ右下に知らせる。ブラウザ版は Service Worker で自動で切り替わるので出さない。
const REPO = 'goonruntongue/white-board-animation-maker'
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASE_PAGE = `https://github.com/${REPO}/releases/latest`
const SKIP_KEY = 'wbam.update.skip'
const FIRST_DELAY = 4000
const INTERVAL = 6 * 60 * 60 * 1000

/** "v0.1.15" → [0, 1, 15] */
function parse(v: string): number[] {
  return v.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
}
export function isNewer(latest: string, current: string): boolean {
  const a = parse(latest)
  const b = parse(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d) return d > 0
  }
  return false
}
function readSkip(): string | null {
  try {
    return localStorage.getItem(SKIP_KEY)
  } catch {
    return null
  }
}

export function UpdateNotice(): React.JSX.Element | null {
  const [latest, setLatest] = useState<string | null>(null)

  useEffect(() => {
    if (!window.desktop) return
    let stopped = false
    const check = async (): Promise<void> => {
      try {
        const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' })
        if (!res.ok) return
        const tag = String(((await res.json()) as { tag_name?: string }).tag_name ?? '')
        if (stopped || !tag || !isNewer(tag, SERVER_INFO.version)) return
        if (readSkip() === tag) return
        setLatest(tag)
      } catch {
        // オフラインなどは黙って次の機会に
      }
    }
    const first = setTimeout(() => void check(), FIRST_DELAY)
    const timer = setInterval(() => void check(), INTERVAL)
    return () => {
      stopped = true
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [])

  if (!latest) return null
  const skip = (): void => {
    try {
      localStorage.setItem(SKIP_KEY, latest)
    } catch {
      // 保存できなくても閉じるだけ
    }
    setLatest(null)
  }
  return (
    <div className="update-notice" role="status">
      <div className="update-title">
        <span className="led" />
        新しい版（{latest}）があります
      </div>
      <p className="muted-text small">
        いまの版は v{SERVER_INFO.version} です。ダウンロードの画面から新しいインストーラーを入れ直すと更新できます（作ったファイルや設定はそのまま残ります）。
      </p>
      <div className="btn-row">
        <button
          className="btn primary small"
          onClick={() => {
            window.open(RELEASE_PAGE, '_blank')
            setLatest(null)
          }}
        >
          ダウンロードの画面を開く
        </button>
        <button className="btn small" onClick={() => setLatest(null)}>
          あとで
        </button>
        <button className="btn small" onClick={skip} title="この版については、もう知らせません（次の版が出たらまた知らせます）">
          この版は知らせない
        </button>
      </div>
    </div>
  )
}
