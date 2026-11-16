// スマホ用の操作部品。
//   上部バー     … メニュー・作品名・元に戻す／やり直す（よく使うものだけ）
//   オプションバー … いま選んでいる道具の設定（ペン先／範囲の合成モード／選んだ軌跡の操作）
//   ドック       … 親指が届く画面下に、道具と「描き順」「設定」「書き出し」
import { useState } from 'react'
import {
  captureImage,
  deselect,
  importHandDialog,
  importImageDialog,
  invertSelection,
  newProject,
  openExport,
  openProject,
  saveProject,
  selectAll
} from '../../commands'
import type { SelectionOp } from '../../engine/selection'
import { haptic } from '../../lib/useMedia'
import { setThemePref, useTheme } from '../../lib/theme'
import { useEditor, type Tool } from '../../store'
import { Icon, type IconName } from '../Icon'
import { PEN_PRESETS, PEN_MAX, PEN_MIN, penDotSize } from '../PenSizePicker'

const toLog = (w: number): number => (Math.log(Math.max(PEN_MIN, Math.min(PEN_MAX, w)) / PEN_MIN) / Math.log(PEN_MAX / PEN_MIN)) * 1000
const fromLog = (t: number): number => Math.round(PEN_MIN * Math.pow(PEN_MAX / PEN_MIN, t / 1000))
import { ActionSheet, type SheetAction } from './ActionSheet'

type Menu = 'app' | 'export' | 'shape' | null

const SHAPES: { id: 'rect' | 'ellipse' | 'lasso'; icon: IconName; label: string; note: string }[] = [
  { id: 'rect', icon: 'selRect', label: '長方形', note: 'ドラッグで四角く囲む' },
  { id: 'ellipse', icon: 'selEllipse', label: '楕円形', note: 'ドラッグで丸く囲む' },
  { id: 'lasso', icon: 'lasso', label: '投げ縄', note: 'なぞって囲む／タップで頂点を打つ' }
]

// ---------------------------------------------------------------------------
// 上部バー
// ---------------------------------------------------------------------------
export function PhoneAppBar(): React.JSX.Element {
  const name = useEditor((s) => s.project.name)
  const dirty = useEditor((s) => s.dirty)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const hasImage = useEditor((s) => !!s.project.image)
  const { undo, redo } = useEditor.getState()
  const { theme } = useTheme()
  const [menu, setMenu] = useState<Menu>(null)

  const appActions: SheetAction[] = [
    { icon: 'image', label: '画像を選ぶ', note: 'カメラロール・ファイルから', onSelect: () => void importImageDialog() },
    { icon: 'camera', label: '写真を撮る', note: 'カメラで撮影して読み込む', onSelect: () => void captureImage() },
    { icon: 'save', label: 'プロジェクトを保存', note: '.wbanim（あとで続きを編集できる）', onSelect: () => void saveProject() },
    { icon: 'folder', label: 'プロジェクトを開く', onSelect: () => void openProject() },
    { icon: 'upload', label: '手・ペン素材を読み込む', note: '透過 PNG / WebP / SVG', onSelect: () => void importHandDialog() },
    {
      icon: theme === 'dark' ? 'sun' : 'moon',
      label: theme === 'dark' ? 'ライトモードにする' : 'ダークモードにする',
      onSelect: () => setThemePref(theme === 'dark' ? 'light' : 'dark')
    },
    { icon: 'file', label: '新規プロジェクト', onSelect: newProject, danger: true }
  ]

  return (
    <header className="phone-appbar">
      <button className="pa-btn" aria-label="メニュー" onClick={() => setMenu('app')}>
        <Icon name="menu" size={20} />
      </button>
      <div className="pa-title">
        <span>{hasImage ? name : 'Whiteboard Animation'}</span>
        {dirty && <i className="dirty-dot" title="未保存" />}
      </div>
      <button className="pa-btn" aria-label="元に戻す" disabled={!canUndo} onClick={undo}>
        <Icon name="undo" size={20} />
      </button>
      <button className="pa-btn" aria-label="やり直す" disabled={!canRedo} onClick={redo}>
        <Icon name="redo" size={20} />
      </button>
      {menu === 'app' && <ActionSheet title="メニュー" actions={appActions} onClose={() => setMenu(null)} />}
    </header>
  )
}

// ---------------------------------------------------------------------------
// オプションバー（道具ごとの設定）
// ---------------------------------------------------------------------------
const MODES: { id: SelectionOp; label: string }[] = [
  { id: 'new', label: '新規' },
  { id: 'add', label: '追加' },
  { id: 'subtract', label: '除外' },
  { id: 'intersect', label: '交差' }
]

export function PhoneContextBar(): React.JSX.Element | null {
  const tool = useEditor((s) => s.tool)
  const hasImage = useEditor((s) => !!s.project.image)
  if (!hasImage) return null
  return (
    <div className="phone-context" role="toolbar" aria-label="道具の設定">
      {tool === 'draw' && <PenOptions />}
      {(tool === 'rect' || tool === 'ellipse' || tool === 'lasso') && <SelectionOptions />}
      {tool === 'select' && <StrokeOptions />}
      {tool === 'pan' && <span className="pc-hint">ドラッグで表示位置を移動（2本指でも移動・拡大できます）</span>}
    </div>
  )
}

function PenOptions(): React.JSX.Element {
  const width = useEditor((s) => s.project.settings.defaultRevealWidth)
  const set = (w: number): void =>
    useEditor.getState().updateSettings({ defaultRevealWidth: Math.max(PEN_MIN, Math.min(PEN_MAX, Math.round(w))) })
  return (
    <>
      <span className="pc-label">ペン先</span>
      {PEN_PRESETS.map((p) => (
        <button key={p.width} className={`pc-key ${width === p.width ? 'on' : ''}`} aria-label={`${p.label} ${p.width}px`} onClick={() => set(p.width)}>
          <span className="pen-dot" style={{ width: penDotSize(p.width, 20), height: penDotSize(p.width, 20) }} />
          <small>{p.label}</small>
        </button>
      ))}
      {/* 対数目盛り：細いサイズは細かく、600px まで一気に動かせる */}
      <input
        className="pc-range"
        type="range"
        min={0}
        max={1000}
        value={toLog(width)}
        style={{ '--fill': `${toLog(width) / 10}%` } as React.CSSProperties}
        aria-label="ペン先のサイズ"
        onChange={(e) => set(fromLog(Number(e.target.value)))}
      />
      <span className="pc-value">{width}</span>
    </>
  )
}

function SelectionOptions(): React.JSX.Element {
  const mode = useEditor((s) => s.selectionMode)
  const hasSelection = useEditor((s) => !!s.selection)
  const setMode = useEditor.getState().setSelectionMode
  return (
    <>
      <div className="pc-seg" role="radiogroup" aria-label="合成モード">
        {MODES.map((m) => (
          <button key={m.id} role="radio" aria-checked={mode === m.id} className={`pc-key text ${mode === m.id ? 'on' : ''}`} onClick={() => setMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <button className="pc-key" aria-label="全体を選択" onClick={selectAll}>
        <Icon name="selectAll" size={18} />
        <small>全体</small>
      </button>
      <button className="pc-key" aria-label="選択範囲を反転" disabled={!hasSelection} onClick={invertSelection}>
        <Icon name="invert" size={18} />
        <small>反転</small>
      </button>
      <button className="pc-key" aria-label="選択を解除" disabled={!hasSelection} onClick={deselect}>
        <Icon name="deselect" size={18} />
        <small>解除</small>
      </button>
    </>
  )
}

function StrokeOptions(): React.JSX.Element {
  const stroke = useEditor((s) => s.project.strokes.find((x) => x.id === s.selectedId))
  const index = useEditor((s) => s.project.strokes.findIndex((x) => x.id === s.selectedId))
  const count = useEditor((s) => s.project.strokes.length)
  const { moveStroke, removeStroke, setRerecord, updateStroke, setMobileSheet } = useEditor.getState()
  if (!stroke) return <span className="pc-hint">軌跡をタップして選びます</span>
  return (
    <>
      <span className="pc-label">#{index + 1}</span>
      <button className="pc-key" aria-label="前へ" disabled={index === 0} onClick={() => moveStroke(stroke.id, index - 1)}>
        <Icon name="up" size={18} />
        <small>前へ</small>
      </button>
      <button className="pc-key" aria-label="後ろへ" disabled={index === count - 1} onClick={() => moveStroke(stroke.id, index + 1)}>
        <Icon name="down" size={18} />
        <small>後へ</small>
      </button>
      <button className="pc-key" aria-label="録り直す" onClick={() => setRerecord(stroke.id)}>
        <Icon name="record" size={18} />
        <small>録り直し</small>
      </button>
      <button className="pc-key" aria-label="詳しい設定" onClick={() => setMobileSheet('inspector')}>
        <Icon name="sliders" size={18} />
        <small>設定</small>
      </button>
      <button className="pc-key" aria-label={stroke.hidden ? '再生に含める' : '再生から外す'} onClick={() => updateStroke(stroke.id, { hidden: !stroke.hidden })}>
        <Icon name={stroke.hidden ? 'eyeOff' : 'eye'} size={18} />
        <small>{stroke.hidden ? '非表示' : '表示'}</small>
      </button>
      <button className="pc-key danger" aria-label="削除" onClick={() => removeStroke(stroke.id)}>
        <Icon name="trash" size={18} />
        <small>削除</small>
      </button>
    </>
  )
}

// ---------------------------------------------------------------------------
// ドック（画面下）
// ---------------------------------------------------------------------------
export function PhoneDock(): React.JSX.Element {
  const tool = useEditor((s) => s.tool)
  const lastSel = useEditor((s) => s.lastSelTool)
  const sheet = useEditor((s) => s.mobileSheet)
  const count = useEditor((s) => s.project.strokes.length)
  const hasImage = useEditor((s) => !!s.project.image)
  const { setTool, setMobileSheet } = useEditor.getState()
  const [menu, setMenu] = useState<Menu>(null)
  const isSel = tool === 'rect' || tool === 'ellipse' || tool === 'lasso'
  const shape = SHAPES.find((s) => s.id === (isSel ? tool : lastSel))!

  const pick = (t: Tool): void => {
    haptic()
    setTool(t)
    if (sheet) setMobileSheet(null)
  }

  const exportActions: SheetAction[] = [
    { icon: 'code', label: 'HTML として書き出す', note: '1ファイルでオフライン再生（スライドにも埋め込める）', onSelect: () => openExport('html') },
    { icon: 'film', label: '動画として書き出す', note: '再生時間と同じだけかかります', onSelect: () => openExport('video') },
    { icon: 'save', label: 'プロジェクトを保存', note: 'あとで続きを編集する', onSelect: () => void saveProject() }
  ]

  const key = (opts: {
    id: string
    icon: IconName
    label: string
    on: boolean
    onClick: () => void
    badge?: number
    disabled?: boolean
    more?: boolean
  }): React.JSX.Element => (
    <button
      key={opts.id}
      className={`dock-key ${opts.on ? 'on' : ''}`}
      aria-pressed={opts.on}
      disabled={opts.disabled}
      onClick={opts.onClick}
    >
      <span className="dock-icon">
        <Icon name={opts.icon} size={22} />
        {opts.badge !== undefined && opts.badge > 0 && <span className="nav-badge">{opts.badge}</span>}
        {opts.more && <span className="dock-more" aria-hidden />}
      </span>
      <span className="dock-label">{opts.label}</span>
    </button>
  )

  return (
    <nav className="phone-dock" aria-label="道具とメニュー">
      {key({ id: 'draw', icon: 'pen', label: '描く', on: tool === 'draw', disabled: !hasImage, onClick: () => pick('draw') })}
      {key({
        id: 'sel',
        icon: shape.icon,
        label: '範囲',
        on: isSel,
        more: true,
        disabled: !hasImage,
        // 範囲ツールを使っているときにもう一度押すと、形を選べる
        onClick: () => (isSel ? setMenu('shape') : pick(lastSel))
      })}
      {key({ id: 'select', icon: 'cursor', label: '選ぶ', on: tool === 'select', disabled: !hasImage, onClick: () => pick('select') })}
      <span className="dock-sep" aria-hidden />
      {key({
        id: 'strokes',
        icon: 'list',
        label: '描き順',
        on: sheet === 'strokes',
        badge: count,
        onClick: () => setMobileSheet(sheet === 'strokes' ? null : 'strokes')
      })}
      {key({
        id: 'inspector',
        icon: 'sliders',
        label: '設定',
        on: sheet === 'inspector',
        onClick: () => setMobileSheet(sheet === 'inspector' ? null : 'inspector')
      })}
      {key({ id: 'export', icon: 'share', label: '書き出し', on: false, disabled: !hasImage, onClick: () => setMenu('export') })}

      {menu === 'export' && <ActionSheet title="書き出し・保存" actions={exportActions} onClose={() => setMenu(null)} />}
      {menu === 'shape' && (
        <ActionSheet
          title="範囲の形"
          actions={SHAPES.map((s) => ({ icon: s.icon, label: s.label, note: s.note, active: tool === s.id, onSelect: () => pick(s.id) }))}
          onClose={() => setMenu(null)}
        />
      )}
    </nav>
  )
}
