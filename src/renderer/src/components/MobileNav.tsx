import { openExport } from '../commands'
import { useEditor } from '../store'
import { Icon, type IconName } from './Icon'

/** スマホ表示の下部ナビゲーション（描き順・設定のシートを開く／書き出し） */
export function MobileNav(): React.JSX.Element {
  const sheet = useEditor((s) => s.mobileSheet)
  const count = useEditor((s) => s.project.strokes.length)
  const setSheet = useEditor.getState().setMobileSheet

  const item = (id: 'strokes' | 'inspector', icon: IconName, label: string, badge?: number): React.JSX.Element => (
    <button className={`nav-btn ${sheet === id ? 'on' : ''}`} aria-pressed={sheet === id} onClick={() => setSheet(sheet === id ? null : id)}>
      <span className="nav-icon">
        <Icon name={icon} size={19} />
        {badge !== undefined && badge > 0 && <span className="nav-badge">{badge}</span>}
      </span>
      <span>{label}</span>
    </button>
  )

  return (
    <nav className="mobile-nav" aria-label="メニュー">
      {item('strokes', 'layers', '描き順', count)}
      {item('inspector', 'sliders', '設定')}
      <button className="nav-btn" onClick={() => openExport('video')}>
        <span className="nav-icon">
          <Icon name="film" size={19} />
        </span>
        <span>動画</span>
      </button>
      <button className="nav-btn primary" onClick={() => openExport('html')}>
        <span className="nav-icon">
          <Icon name="code" size={19} />
        </span>
        <span>HTML</span>
      </button>
    </nav>
  )
}

/** シート上部のつまみと「閉じる」（スマホ表示のときだけ見える） */
export function SheetBar({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="sheet-bar">
      <span className="sheet-grip" aria-hidden />
      <span className="sheet-title">{title}</span>
      <button className="icon-btn" title="閉じる" onClick={() => useEditor.getState().setMobileSheet(null)}>
        <Icon name="x" />
      </button>
    </div>
  )
}
