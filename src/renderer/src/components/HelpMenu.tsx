// 小さな ⚙ ボタン：ツアー・使い方ガイド・サンプル画像・「起動時にツアーを表示」をまとめる。
// PC はボタンの下に小さなメニュー、スマホは画面下のシートで開く。
import { useEffect, useRef, useState } from 'react'
import { importSampleImage } from '../commands'
import { openGuide, setShowTourOnStartup, startTour, useTourPrefs } from '../lib/tour'
import { Icon } from './Icon'
import { ActionSheet } from './phone/ActionSheet'

export function HelpMenu({ phone = false }: { phone?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { showOnStartup } = useTourPrefs()
  const wrap = useRef<HTMLDivElement>(null)

  // メニューの外を押したら閉じる
  useEffect(() => {
    if (!open || phone) return
    const onDown = (e: PointerEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, phone])

  const run = (fn: () => void): void => {
    setOpen(false)
    fn()
  }

  if (phone) {
    return (
      <>
        <button className="pa-btn" data-tour="help" aria-label="ヘルプと設定" onClick={() => setOpen(true)}>
          <Icon name="settings" size={20} />
        </button>
        {open && (
          <ActionSheet
            title="ヘルプと設定"
            onClose={() => setOpen(false)}
            actions={[
              { icon: 'play', label: 'ツアーを始める', note: 'ボタンのそばに順番に説明を出します', onSelect: startTour },
              { icon: 'list', label: '使い方ガイド', note: '全機能を詳しく説明（検索できます）', onSelect: () => openGuide() },
              { icon: 'image', label: 'サンプル画像を使う', note: '練習用の画像をページに追加', onSelect: () => void importSampleImage() },
              {
                icon: showOnStartup ? 'check' : 'x',
                label: showOnStartup ? '起動時にツアーを表示：オン' : '起動時にツアーを表示：オフ',
                note: '押すと切り替わります',
                active: showOnStartup,
                onSelect: () => setShowTourOnStartup(!showOnStartup)
              }
            ]}
          />
        )}
      </>
    )
  }

  return (
    <div className="help-menu" ref={wrap}>
      <button
        className={`icon-btn help-btn ${open ? 'on' : ''}`}
        data-tour="help"
        title="ヘルプと設定（ツアー・使い方ガイド）"
        aria-label="ヘルプと設定"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="settings" />
      </button>
      {open && (
        <div className="help-pop" role="menu">
          <button role="menuitem" onClick={() => run(startTour)}>
            <Icon name="play" /> ツアーを始める
          </button>
          <button role="menuitem" onClick={() => run(() => openGuide())}>
            <Icon name="list" /> 使い方ガイド
            <small>全機能の説明</small>
          </button>
          <button role="menuitem" onClick={() => run(() => void importSampleImage())}>
            <Icon name="image" /> サンプル画像を使う
          </button>
          <hr />
          <label className="toggle help-toggle">
            <span>起動時にツアーを表示</span>
            <input type="checkbox" checked={showOnStartup} onChange={(e) => setShowTourOnStartup(e.target.checked)} />
            <span className="switch" />
          </label>
        </div>
      )}
    </div>
  )
}
