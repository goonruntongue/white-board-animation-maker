// 小さな ⚙ ボタン：ツアー・使い方ガイド・サンプル画像・「起動時にツアーを表示」をまとめる。
// PC はボタンの下に小さなメニュー、スマホは画面下のシートで開く。
import { useEffect, useRef, useState } from 'react'
import { importSampleImage } from '../commands'
import { setBarLayout, useBarLayout } from '../lib/barLayout'
import { isDesktop } from '../lib/platform'
import { AboutDialog } from './AboutDialog'
import { openGuide, setShowTourOnStartup, startTour, useTourPrefs } from '../lib/tour'
import { useEditor } from '../store'
import { Icon } from './Icon'
import { ActionSheet } from './phone/ActionSheet'

export function HelpMenu({ phone = false }: { phone?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  // 「このアプリについて」（Web 版だけ。デスクトップ版には出さない）
  const [about, setAbout] = useState(false)
  const aboutDialog = about && <AboutDialog onClose={() => setAbout(false)} />
  const { showOnStartup } = useTourPrefs()
  const barLayout = useBarLayout()
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
                icon: 'tipHelp',
                label: 'ボタンの説明を見るには',
                note: 'どのボタンも、長押しするとその説明が画面下に出ます（指を離すと少しして消えます）',
                onSelect: () => useEditor.getState().notify('ボタンを長押しすると、その説明が出ます')
              },
              {
                icon: showOnStartup ? 'check' : 'x',
                label: showOnStartup ? '起動時にツアーを表示：オン' : '起動時にツアーを表示：オフ',
                note: '押すと切り替わります',
                active: showOnStartup,
                onSelect: () => setShowTourOnStartup(!showOnStartup)
              },
              {
                icon: 'layers',
                label: barLayout === 'two' ? 'オプションバー：2段' : 'オプションバー：1段',
                note: barLayout === 'two' ? '押すと1段（1列に並べて横にスクロール）に切り替わります' : '押すと2段（操作の切り替えと、選んだ線の操作を分ける）に切り替わります',
                onSelect: () => setBarLayout(barLayout === 'two' ? 'one' : 'two')
              },
              ...(isDesktop
                ? []
                : [{ icon: 'info' as const, label: 'このアプリについて', note: 'アプリを開く QR コードと著作権の表示', onSelect: () => setAbout(true) }])
            ]}
          />
        )}
        {aboutDialog}
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
          {!isDesktop && (
            <>
              <hr />
              <button role="menuitem" onClick={() => run(() => setAbout(true))}>
                <Icon name="info" /> このアプリについて
              </button>
            </>
          )}
        </div>
      )}
      {aboutDialog}
    </div>
  )
}
