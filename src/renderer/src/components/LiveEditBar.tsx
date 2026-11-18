// ライブ編集のオプションバー。
// 選ぶ単位は「軌跡ごと」（標準）か「線ごと」（軌跡の中の、ペンを下ろしてから上げるまでの1区間）。
//  ・選ぶ・動かす：タップで選び、ドラッグで動かす。太さ・大きさを変える
//  ・ブラシで足す：なぞった所を、選んだ軌跡に足す（ペンもそこを通り、表示範囲も広がる）
//  ・消しゴム：なぞった所を、選んだ軌跡では見せない
// 絵（ステージ）は「選んだ軌跡（線）を描き終えた瞬間」を見せているので、変えるとその場で見え方が変わる。
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { setAutoSelect, useAutoSelect } from '../lib/autoSelect'
import { setBrushTarget, useBrushTarget, type BrushTarget } from '../lib/brushTarget'
import { usePathTool, type PathTool } from '../lib/pathTool'
import { ActionSheet } from './phone/ActionSheet'
import {
  setPartWidth,
  setStrokeWidthKeepRatio,
  strokeParts,
  transformPart,
  transformStroke
} from '../engine/strokeParts'
import { deleteSelectedAnchor, revealLineSoon } from '../livePath'
import { addRevealMark } from '../engine/selection'
import { useEditor } from '../store'
import { ERASER_PRESETS, PEN_PRESETS } from './PenSizePicker'
import { Icon } from './Icon'

/** パス編集のオプションバーに出す、いまの道具の使い方 */
const PATH_HINT: Record<PathTool, string> = {
  direct: 'アンカー・ハンドルをドラッグ／線の上をダブルクリックで追加／Alt＋ドラッグで角に',
  convert: 'アンカーを押すと角に／アンカーからドラッグでなめらかに／ハンドルは片側だけ動く',
  addDel: '線の上を押すとアンカーを追加／アンカーの上を押すと削除'
}
const PATH_HINT_PHONE: Record<PathTool, string> = {
  direct: 'アンカーをドラッグで調整。線をダブルタップで追加',
  convert: 'アンカーを押すと角に。引っぱるとなめらかに',
  addDel: '線の上で追加。アンカーの上で削除'
}

const MIN = 1
const MAX = 600
/** 対数目盛り：細い太さは細かく、太い太さは一気に動かせる */
const toLog = (w: number): number => Math.round((Math.log(Math.max(MIN, w) / MIN) / Math.log(MAX / MIN)) * 1000)
const fromLog = (v: number): number => Math.round(MIN * Math.pow(MAX / MIN, v / 1000))

/** 軌跡まるごとで扱うか（パス編集はいつも1本の線ごと） */
function isWhole(s: { liveUnit: 'stroke' | 'part'; liveMode: string }): boolean {
  return s.liveUnit === 'stroke' && s.liveMode !== 'path'
}

/** 選んでいる軌跡（線）の情報（なければ null）。軌跡ごとのとき width は最初の線の太さ */
function useLive(): { strokeId: string; part: number; index: number; parts: number; width: number } | null {
  const v = useEditor(
    useShallow((s) => {
      const lp = s.livePart
      const none = { strokeId: '', part: -1, index: -1, parts: 0, width: 0 }
      if (!lp) return none
      const index = s.project.strokes.findIndex((x) => x.id === lp.strokeId)
      if (index < 0) return none
      const parts = strokeParts(s.project.strokes[index])
      const part = parts[isWhole(s) ? 0 : lp.part]
      if (!part) return none
      return { strokeId: lp.strokeId, part: lp.part, index, parts: parts.length, width: part.width }
    })
  )
  return v.index < 0 ? null : v
}

/**
 * 太さを変える。軌跡ごとのときは、すべての線を同じ割合で（線ごとの太さの違いは保つ）。
 * スライダーを動かしている間の変更は、元に戻す1回分にまとめる
 */
export function setLiveWidth(width: number): void {
  const st = useEditor.getState()
  const lp = st.livePart
  if (!lp) return
  const w = Math.max(MIN, Math.min(MAX, Math.round(width)))
  const whole = isWhole(st)
  st.commit(
    (p) => ({
      ...p,
      strokes: p.strokes.map((s) => (s.id !== lp.strokeId ? s : whole ? setStrokeWidthKeepRatio(s, w) : setPartWidth(s, lp.part, w)))
    }),
    whole ? `livestroke:${lp.strokeId}` : `livepart:${lp.strokeId}:${lp.part}`
  )
  // 太くした分も見えるように、止まったら通過部分を表示する（同じ元に戻す1回分）
  revealLineSoon(lp.strokeId, whole ? -1 : lp.part, whole ? `livestroke:${lp.strokeId}` : `livepart:${lp.strokeId}:${lp.part}`)
}

/** 選んでいる軌跡（線）を、その中心を基準に拡大・縮小する（続けて押した分は、元に戻す1回分にまとめる） */
export function scaleLivePart(factor: number): void {
  const st = useEditor.getState()
  const lp = st.livePart
  if (!lp) return
  const whole = isWhole(st)
  st.commit(
    (p) => ({
      ...p,
      strokes: p.strokes.map((s) => (s.id !== lp.strokeId ? s : whole ? transformStroke(s, 0, 0, factor) : transformPart(s, lp.part, 0, 0, factor)))
    }),
    whole ? `livescale:${lp.strokeId}` : `livescale:${lp.strokeId}:${lp.part}`
  )
  revealLineSoon(lp.strokeId, whole ? -1 : lp.part, whole ? `livescale:${lp.strokeId}` : `livescale:${lp.strokeId}:${lp.part}`)
}

/** 前後へ。軌跡ごとのときは前後の軌跡、線ごとのときは前後の線（軌跡の端では、となりの軌跡の線へ） */
export function stepLivePart(dir: -1 | 1): void {
  const st = useEditor.getState()
  const lp = st.livePart
  const strokes = st.project.strokes.filter((s) => !s.hidden && s.points.length > 0)
  if (strokes.length === 0) return
  const whole = isWhole(st)
  if (!lp) {
    const s = dir > 0 ? strokes[0] : strokes[strokes.length - 1]
    st.setLivePart({ strokeId: s.id, part: whole || dir > 0 ? 0 : strokeParts(s).length - 1 })
    return
  }
  let si = strokes.findIndex((s) => s.id === lp.strokeId)
  if (si < 0) return
  if (whole) {
    si += dir
    if (si >= 0 && si < strokes.length) st.setLivePart({ strokeId: strokes[si].id, part: 0 })
    return
  }
  let part = lp.part + dir
  if (part < 0 || part >= strokeParts(strokes[si]).length) {
    si += dir
    if (si < 0 || si >= strokes.length) return
    part = dir > 0 ? 0 : strokeParts(strokes[si]).length - 1
  }
  st.setLivePart({ strokeId: strokes[si].id, part })
}

/** ブラシ・消しゴムの大きさ：プリセット（細・中・太・極太・特大）。スマホはドロップダウン、PC はボタン */
function SizePresets({ phone, kind }: { phone: boolean; kind: 'brush' | 'eraser' }): React.JSX.Element {
  const key = kind === 'brush' ? 'defaultRevealWidth' : 'eraserWidth'
  const w = useEditor((s) => s.project.settings[key])
  const presets = kind === 'brush' ? PEN_PRESETS : ERASER_PRESETS
  const set = (v: number): void => useEditor.getState().updateSettings({ [key]: Math.max(4, Math.min(MAX, Math.round(v))) })
  const label = kind === 'brush' ? 'ブラシの太さ' : '消しゴムの大きさ'
  if (phone) {
    const match = presets.find((p) => p.width === w)
    return (
      <select className="pc-select" aria-label={label} value={match ? String(match.width) : 'custom'} onChange={(e) => e.target.value !== 'custom' && set(Number(e.target.value))}>
        {presets.map((p) => (
          <option key={p.width} value={p.width}>
            {p.label}（{p.width}）
          </option>
        ))}
        {!match && <option value="custom">{w}px</option>}
      </select>
    )
  }
  return (
    <div className="live-presets" role="radiogroup" aria-label={label}>
      {presets.map((p) => (
        <button key={p.width} role="radio" aria-checked={w === p.width} className={`live-preset ${w === p.width ? 'on' : ''}`} title={`${p.label} ${p.width}px（${p.key} キー）`} onClick={() => set(p.width)}>
          {p.label}
        </button>
      ))}
    </div>
  )
}

/** ブラシ・消しゴムの大きさのスライダー（対数目盛り） */
function SizeSlider({ phone, kind }: { phone: boolean; kind: 'brush' | 'eraser' }): React.JSX.Element {
  const key = kind === 'brush' ? 'defaultRevealWidth' : 'eraserWidth'
  const w = useEditor((s) => s.project.settings[key])
  const set = (v: number): void => useEditor.getState().updateSettings({ [key]: Math.max(4, Math.min(MAX, Math.round(v))) })
  const label = kind === 'brush' ? 'ブラシ' : '消しゴム'
  return (
    <>
      {!phone && <span className="tb-label">{label}</span>}
      <input
        className={phone ? 'pc-range' : 'live-range'}
        type="range"
        min={0}
        max={1000}
        value={toLog(w)}
        style={{ '--fill': `${toLog(w) / 10}%` } as React.CSSProperties}
        aria-label={`${label}の大きさ`}
        onChange={(e) => set(fromLog(Number(e.target.value)))}
      />
      <span className={phone ? 'pc-value' : 'live-value'}>{w}</span>
    </>
  )
}

/** ブラシ・消しゴムの大きさ（PC：プリセットとスライダーを並べる） */
function ToolSize({ phone, kind }: { phone: boolean; kind: 'brush' | 'eraser' }): React.JSX.Element {
  return (
    <>
      <SizePresets phone={phone} kind={kind} />
      <SizeSlider phone={phone} kind={kind} />
    </>
  )
}

/**
 * 「同一グループ」：オンの間、描いた線を1つのグループにまとめる（オンにするたびに、新しいグループから始める）。
 * ブラシのときは、線を選んでいてもいなくても出す。線を選んでいるときにオンにすると、選択を外す（選んでいるとブラシは描き直し・追加になるため）
 */
function SameGroupKey({ phone }: { phone: boolean }): React.JSX.Element {
  const on = useEditor((s) => s.sameGroup)
  const onClick = (): void => {
    const st = useEditor.getState()
    const deselect = !on && !!st.livePart
    if (deselect) {
      if (st.rerecordId) st.setRerecord(null)
      st.setLivePart(null)
    }
    st.setSameGroup(!on)
    st.notify(
      on
        ? '同一グループをオフにしました。1本ごとに新しいグループになります'
        : deselect
          ? '線の選択を外し、同一グループをオンにしました。これから描く線を1つのグループにまとめます'
          : '同一グループをオンにしました。これから描く線を1つのグループにまとめます'
    )
  }
  const title = 'オンの間に描いた線を、1つのグループにまとめます（すでに描いた線は変わりません）。オフにすると、1本ごとに別のグループになります'
  return phone ? (
    <button className={`pc-key text ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick} title={title}>
      同一グループ
    </button>
  ) : (
    <button className={`tool-btn live-redo ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick} title={title}>
      <span>同一グループ</span>
    </button>
  )
}

const MODES = [
  { id: 'move', icon: 'move', label: '選ぶ・動かす', hint: '選ぶ・動かす：タップで選び、ドラッグで動かす。太さ・大きさも変えられます' },
  { id: 'brush', icon: 'plusPen', label: 'ブラシ', hint: 'ブラシ：何も選んでいなければ、なぞって新しいグループを描く。線を選んでいれば、その線を描き直す（▼ で「線を追加」にも切り替えられる）' },
  { id: 'erase', icon: 'eraser', label: '消しゴム', hint: '消しゴム：なぞった所を、選んでいる線でだけ見せない（同じグループのほかの線には効かない）' },
  { id: 'path', icon: 'pathPen', label: 'パス編集', hint: 'パス編集：線をアンカーとハンドルの曲線として編集する' }
] as const

/** 操作の切り替え：選ぶ・動かす ／ ブラシで足す ／ 消しゴム */
function ModeSwitch({ phone }: { phone: boolean }): React.JSX.Element {
  // 描き直し中（内部では描くツール）は、ブラシで描いている扱いで表示する
  const mode = useEditor((s) => (s.tool === 'draw' ? 'brush' : s.liveMode))
  const setMode = (m: 'move' | 'brush' | 'erase' | 'path'): void => {
    const st = useEditor.getState()
    // 描き直しの途中なら、やめてから切り替える
    if (st.rerecordId) st.setRerecord(null)
    if (st.tool !== 'live') st.setTool('live')
    st.setLiveMode(m)
  }
  if (phone) {
    return (
      <div className="pc-seg" role="radiogroup" aria-label="手描きの操作">
        {MODES.map((m) =>
          m.id === 'brush' ? (
            <BrushKey key={m.id} phone on={mode === 'brush'} onPick={() => setMode('brush')} />
          ) : (
            <button key={m.id} role="radio" aria-checked={mode === m.id} className={`pc-key ${mode === m.id ? 'on' : ''}`} onClick={() => setMode(m.id)}>
              <Icon name={m.icon} size={18} />
              <small>{m.label}</small>
            </button>
          )
        )}
      </div>
    )
  }
  return (
    <>
      {MODES.map((m) =>
        m.id === 'brush' ? (
          <BrushKey key={m.id} phone={false} on={mode === 'brush'} onPick={() => setMode('brush')} />
        ) : (
          <button key={m.id} className={`icon-btn ${mode === m.id ? 'on' : ''}`} aria-pressed={mode === m.id} title={m.hint} onClick={() => setMode(m.id)}>
            <Icon name={m.icon} />
          </button>
        )
      )}
    </>
  )
}

/** 選ぶ・動かす の「自動選択」チェック（オフにすると、いま選んでいる線から選び替えない） */
function AutoSelectCheck({ phone }: { phone: boolean }): React.JSX.Element {
  const on = useAutoSelect()
  return (
    <label
      className={`auto-select ${phone ? 'phone' : ''} ${on ? 'on' : ''}`}
      title={on ? '自動選択：押した所にある線に選び替えて動かす（外すと、いま選んでいる線だけを動かす）' : '自動選択オフ：どこをドラッグしても、いま選んでいる線を動かす'}
    >
      <input type="checkbox" checked={on} onChange={(e) => setAutoSelect(e.target.checked)} />
      <span className="auto-select-box" aria-hidden="true">
        <svg width="12" height="10" viewBox="0 0 12 10">
          <path d="M1.5 5.2 L4.6 8.2 L10.5 1.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span>自動選択</span>
    </label>
  )
}

const Caret = (): React.JSX.Element => (
  <svg width="10" height="7" viewBox="0 0 10 7" aria-hidden="true">
    <path d="M1.5 1.5 L5 5.2 L8.5 1.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * ブラシのボタンと、その横の ▼（線を選んでいるときに「描き直す」か「追加」かを選ぶ）。
 * 線を選んでいるときは、ボタンの名前が「描き直す」「線を追加」に変わり、押す前に何が起きるか分かる。
 */
function BrushKey({ phone, on, onPick }: { phone: boolean; on: boolean; onPick: () => void }): React.JSX.Element {
  const target = useBrushTarget()
  const selected = useEditor((s) => !!s.livePart)
  const [menu, setMenu] = useState<DOMRect | null>(null)
  const redo = target === 'redo'
  const label = !selected ? 'ブラシ' : redo ? '描き直す' : '線を追加'
  const icon = selected && redo ? 'record' : 'plusPen'
  const hint = !selected
    ? 'ブラシ：なぞって新しいグループを描く（線を選んでいるときの動きは ▼ で選べます）'
    : redo
      ? 'ブラシ（描き直す）：なぞると、選んでいる線がその線に置き換わる'
      : 'ブラシ（線を追加）：なぞった線を、選んでいるグループの最後に足す'
  const options = [
    { id: 'redo' as const, icon: 'record' as const, label: '選んだ線を描き直す', note: 'なぞると、選んでいる線が置き換わります（おすすめ）' },
    { id: 'add' as const, icon: 'plusPen' as const, label: '線を追加', note: '選んでいるグループの最後に線を足します' }
  ]
  const open = (e: React.MouseEvent<HTMLButtonElement>): void => setMenu(e.currentTarget.getBoundingClientRect())
  const choose = (v: BrushTarget): void => {
    setBrushTarget(v)
    setMenu(null)
    onPick()
  }

  // PC：メニューの外を押す・Esc で閉じる
  useEffect(() => {
    if (!menu || phone) return
    const onDown = (e: PointerEvent): void => {
      if (!(e.target as Element).closest?.('.brush-pop')) setMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu, phone])

  if (phone) {
    return (
      <span className="brush-split">
        <button role="radio" aria-checked={on} className={`pc-key ${on ? 'on' : ''}`} onClick={onPick}>
          <Icon name={icon} size={18} />
          <small>{label}</small>
        </button>
        <button className={`pc-key brush-caret ${on ? 'on' : ''}`} aria-label="ブラシの動きを選ぶ（描き直す／線を追加）" onClick={open}>
          <Caret />
        </button>
        {menu && (
          <ActionSheet
            title="線を選んでいるときのブラシ"
            onClose={() => setMenu(null)}
            actions={options.map((o) => ({ icon: o.icon, label: o.label, note: o.note, active: target === o.id, onSelect: () => choose(o.id) }))}
          />
        )}
      </span>
    )
  }
  return (
    <span className="brush-split">
      <button className={`icon-btn ${on ? 'on' : ''}`} aria-pressed={on} title={hint} onClick={onPick}>
        <Icon name={icon} />
      </button>
      <button className={`icon-btn brush-caret ${on ? 'on' : ''}`} title="線を選んでいるときのブラシの動き（描き直す／線を追加）" aria-haspopup="menu" aria-expanded={!!menu} onClick={(e) => (menu ? setMenu(null) : open(e))}>
        <Caret />
      </button>
      {menu &&
        createPortal(
          <div className="help-pop brush-pop" role="menu" style={{ position: 'fixed', top: menu.bottom + 6, left: Math.max(8, menu.left - 20), right: 'auto' }}>
            <div className="brush-pop-title">線を選んでいるときのブラシ</div>
            {options.map((o) => (
              <button key={o.id} role="menuitemradio" aria-checked={target === o.id} className={target === o.id ? 'on' : ''} onClick={() => choose(o.id)}>
                <Icon name={o.icon} /> {o.label}
                <small>{o.note}</small>
              </button>
            ))}
          </div>,
          document.body
        )}
    </span>
  )
}

/** スマホ：選んでいる軌跡そのものの操作（描き順の入れ替え・表示・詳しい設定・削除）。以前の「選ぶ」道具にあったもの */
function StrokeKeys({ strokeId }: { strokeId: string }): React.JSX.Element | null {
  const index = useEditor((s) => s.project.strokes.findIndex((x) => x.id === strokeId))
  const count = useEditor((s) => s.project.strokes.length)
  const hidden = useEditor((s) => !!s.project.strokes.find((x) => x.id === strokeId)?.hidden)
  if (index < 0) return null
  const { moveStroke, removeStroke, updateStroke, setMobileSheet, setLivePart } = useEditor.getState()
  return (
    <>
      <span className="pc-label">描き順</span>
      <button className="pc-key" aria-label="描き順を1つ前へ" disabled={index === 0} onClick={() => moveStroke(strokeId, index - 1)}>
        <Icon name="up" size={18} />
        <small>順を前へ</small>
      </button>
      <button className="pc-key" aria-label="描き順を1つ後ろへ" disabled={index === count - 1} onClick={() => moveStroke(strokeId, index + 1)}>
        <Icon name="down" size={18} />
        <small>順を後へ</small>
      </button>
      <button className="pc-key" aria-label={hidden ? '再生に含める' : '再生から外す'} onClick={() => updateStroke(strokeId, { hidden: !hidden })}>
        <Icon name={hidden ? 'eyeOff' : 'eye'} size={18} />
        <small>{hidden ? '非表示' : '表示'}</small>
      </button>
      <button className="pc-key" aria-label="詳しい設定" onClick={() => setMobileSheet('inspector')}>
        <Icon name="sliders" size={18} />
        <small>設定</small>
      </button>
      <button
        className="pc-key danger"
        aria-label="グループを削除"
        onClick={() => {
          setLivePart(null)
          removeStroke(strokeId)
        }}
      >
        <Icon name="trash" size={18} />
        <small>削除</small>
      </button>
    </>
  )
}

export function LiveEditBar({ phone = false }: { phone?: boolean }): React.JSX.Element {
  const live = useLive()
  const liveHasClip = useEditor((s) => !!s.project.strokes.find((stroke) => stroke.id === s.livePart?.strokeId)?.clip)
  const mode = useEditor((s) => s.liveMode)
  // 描き直し中（内部では描くツール）も、ブラシで描いている扱い
  const brushLike = useEditor((s) => s.tool === 'draw' || s.liveMode === 'brush')
  const unit = useEditor((s) => s.liveUnit)
  const hasAnchor = useEditor((s) => s.livePath?.selected != null)
  const clear = (): void => useEditor.getState().setLivePart(null)
  const pathing = mode === 'path'
  const pathTool = usePathTool()
  const whole = unit === 'stroke' && !pathing
  // 直すは、いつも1本の線ごと（単位の切り替えはない）
  const unitSwitch = null
  const what = whole ? 'グループ' : '線'
  const size = mode === 'brush' ? <ToolSize phone={phone} kind="brush" /> : mode === 'erase' ? <ToolSize phone={phone} kind="eraser" /> : null

  if (!live) {
    const hint =
      mode === 'path'
        ? '編集したい線を押して選びます'
        : mode === 'brush'
        ? 'なぞると新しいグループになります（「同一グループ」がオンなら1つにまとめます。線を選んでいれば、その線を描き直します。▼ で「線を追加」にも切り替え）'
        : mode === 'erase'
          ? 'なぞった所にあるグループを消します'
          : `絵の上を押して${what}を選びます。ドラッグで動かし、太さ・大きさも変えられます`
    const brushing = mode === 'brush'
    return phone ? (
      // スマホは2段：上に操作の切り替えと大きさ、下にスライダーや案内
      <div className="pc-rows">
        <div className="pc-row">
          <ModeSwitch phone />
          {mode === 'move' && <AutoSelectCheck phone />}
          {(brushing || mode === 'erase') && <SizePresets phone kind={brushing ? 'brush' : 'eraser'} />}
        </div>
        <div className="pc-row">
          {brushing || mode === 'erase' ? <SizeSlider phone kind={brushing ? 'brush' : 'eraser'} /> : <span className="pc-hint">{hint}</span>}
          {brushing && <SameGroupKey phone />}
        </div>
      </div>
    ) : (
      <div className="tb-group live-bar">
        <ModeSwitch phone={false} />
        {mode === 'move' && <AutoSelectCheck phone={false} />}
        {unitSwitch}
        {size ?? <span className="live-hint">{hint}</span>}
        {brushing && <SameGroupKey phone={false} />}
      </div>
    )
  }

  const label = whole ? (phone ? `#${live.index + 1}（線 ${live.parts} 本）` : `#${live.index + 1}（${live.parts}本）`) : phone ? `#${live.index + 1} の線 ${live.part + 1}/${live.parts}` : `#${live.index + 1}・線 ${live.part + 1}/${live.parts}`
  const widthTitle = whole ? 'グループの太さ（すべての線を同じ割合で。[ ] キーでも変えられます）' : '選んだ線の太さ（[ ] キーでも変えられます）'

  if (phone) {
    const sized = mode === 'brush' || mode === 'erase'
    const kind = mode === 'brush' ? 'brush' : 'eraser'
    return (
      // スマホは2段：上に操作の切り替え（と大きさ）、下に選んだ線の操作（よく使う順）
      <div className="pc-rows">
        <div className="pc-row">
          <ModeSwitch phone />
          {mode === 'move' && <AutoSelectCheck phone />}
          {sized && <SizePresets phone kind={kind} />}
        </div>
        <div className="pc-row">
          {/* 同一グループは、横にスクロールしなくても見えるよう、先頭に置く */}
          {brushLike && <SameGroupKey phone />}
          <span className="pc-label">{label}</span>
          <button className="pc-key" aria-label={`前の${what}を選ぶ`} onClick={() => stepLivePart(-1)}>
            <Icon name="up" size={18} />
            <small>前の{what}</small>
          </button>
          <button className="pc-key" aria-label={`次の${what}を選ぶ`} onClick={() => stepLivePart(1)}>
            <Icon name="down" size={18} />
            <small>次の{what}</small>
          </button>
          {pathing && (
            <>
              <button className="pc-key danger" aria-label="アンカーを削除" disabled={!hasAnchor} onClick={() => deleteSelectedAnchor()}>
                <Icon name="trash" size={18} />
                <small>アンカー削除</small>
              </button>
              <span className="pc-hint">{PATH_HINT_PHONE[pathTool]}</span>
            </>
          )}
          {sized && <SizeSlider phone kind={kind} />}
          {!pathing && !sized && (
            <>
              <span className="pc-label">太さ</span>
              <input
                className="pc-range"
                type="range"
                min={0}
                max={1000}
                value={toLog(live.width)}
                style={{ '--fill': `${toLog(live.width) / 10}%` } as React.CSSProperties}
                aria-label={widthTitle}
                onChange={(e) => setLiveWidth(fromLog(Number(e.target.value)))}
              />
              <span className="pc-value">{live.width}</span>
              <button className="pc-key" aria-label="縮小" onClick={() => scaleLivePart(1 / 1.1)}>
                <Icon name="zoomOut" size={18} />
                <small>縮小</small>
              </button>
              <button className="pc-key" aria-label="拡大" onClick={() => scaleLivePart(1.1)}>
                <Icon name="zoomIn" size={18} />
                <small>拡大</small>
              </button>
            </>
          )}
          <button className="pc-key" disabled={!liveHasClip} onClick={() => useEditor.getState().openDialog('auto')} title="選択中のグループの表示範囲を自動で作り直す">
            <Icon name="sparkle" size={18} /><small>自動で再作成</small>
          </button>
          <StrokeKeys strokeId={live.strokeId} />
          <button className="pc-key" aria-label="選択を外す" onClick={clear}>
            <Icon name="x" size={18} />
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="tb-group live-bar" title={`選んだ${what}の編集。絵は、この${what}を描き終えた瞬間を表示しています`}>
      <ModeSwitch phone={false} />
      {brushLike && <SameGroupKey phone={false} />}
      {mode === 'move' && <AutoSelectCheck phone={false} />}
      {unitSwitch}
      <span className="tb-label">{label}</span>
      <button className="tool-btn live-redo" disabled={!liveHasClip} title={liveHasClip ? '選択中のグループの表示範囲を自動で作り直す' : '自動で再作成するには、グループに表示範囲が必要です'} onClick={() => useEditor.getState().openDialog('auto')}><Icon name="sparkle" /><span>自動で再作成</span></button>
      <button className="icon-btn" title={`前の${what} (,)`} onClick={() => stepLivePart(-1)}>
        <Icon name="up" />
      </button>
      <button className="icon-btn" title={`次の${what} (.)`} onClick={() => stepLivePart(1)}>
        <Icon name="down" />
      </button>
      {pathing && (
        <>
          <button className="icon-btn" title="選んだアンカーを削除 (Delete)" disabled={!hasAnchor} onClick={() => deleteSelectedAnchor()}>
            <Icon name="trash" />
          </button>
          <span className="live-hint">{PATH_HINT[pathTool]}</span>
        </>
      )}
      {!pathing && (size ?? (
        <>
          <button className="icon-btn" title={`${what}を縮小（中心を基準に）`} onClick={() => scaleLivePart(1 / 1.1)}>
            <Icon name="zoomOut" />
          </button>
          <button className="icon-btn" title={`${what}を拡大（中心を基準に）`} onClick={() => scaleLivePart(1.1)}>
            <Icon name="zoomIn" />
          </button>
          <input
            className="live-range"
            type="range"
            min={0}
            max={1000}
            value={toLog(live.width)}
            style={{ '--fill': `${toLog(live.width) / 10}%` } as React.CSSProperties}
            aria-label={widthTitle}
            title={widthTitle}
            onChange={(e) => setLiveWidth(fromLog(Number(e.target.value)))}
          />
          <span className="live-value" title={`${what}の太さ（px）`}>
            {live.width}
          </span>
        </>
      ))}
      <button className="icon-btn" title="選択を外す (Esc)" onClick={clear}>
        <Icon name="x" />
      </button>
    </div>
  )
}
