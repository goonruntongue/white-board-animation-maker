// ライブ編集のオプションバー。
// 選ぶ単位は「軌跡ごと」（標準）か「線ごと」（軌跡の中の、ペンを下ろしてから上げるまでの1区間）。
//  ・選ぶ・動かす：タップで選び、ドラッグで動かす。太さ・大きさを変える
//  ・ブラシで足す：なぞった所を、選んだ軌跡に足す（ペンもそこを通り、表示範囲も広がる）
//  ・消しゴム：なぞった所を、選んだ軌跡では見せない
// 絵（ステージ）は「選んだ軌跡（線）を描き終えた瞬間」を見せているので、変えるとその場で見え方が変わる。
import { ScrollRow } from './ScrollRow'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { setAutoSelect, useAutoSelect } from '../lib/autoSelect'
import { setBrushTarget, setRedoAdvance, useRedoAdvance, type BrushTarget } from '../lib/brushTarget'
import { selectedLine, useBrushWidth, useEffectiveBrushTarget } from '../lib/brushMode'
import { setKeepTracedPace, useKeepTracedPace } from '../lib/pace'
import { useEffectivePathTool, type PathTool } from '../lib/pathTool'
import { formatCombo, keyHint, keysFor, useShortcutsVersion } from '../lib/shortcuts'
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
  direct: 'アンカー・ハンドルをドラッグ／線の上をダブルクリックで追加／Alt を押しているあいだはアンカーポイントの切り替え',
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

/**
 * ブラシ・消しゴムの大きさ（[いまの値, 変える関数, 名前]）。
 * ブラシで線を選んでいるときは、その線を描き直す・その線の後ろに足すときの太さ（はじめはその線の太さ）。
 * 欄に出ている太さ＝カーソルの円の大きさ＝描かれる線の太さ
 */
function useSize(kind: 'brush' | 'eraser'): [number, (v: number) => void, string] {
  const brushW = useBrushWidth()
  const lineSelected = useEditor((s) => !!selectedLine(s))
  const eraserW = useEditor((s) => s.project.settings.eraserWidth)
  const clamp = (v: number): number => Math.max(4, Math.min(MAX, Math.round(v)))
  if (kind === 'eraser') return [eraserW, (v) => useEditor.getState().updateSettings({ eraserWidth: clamp(v) }), '消しゴムの大きさ']
  if (lineSelected) return [brushW, (v) => useEditor.getState().setLineBrushWidth(clamp(v)), '選んだ線を描く太さ']
  return [brushW, (v) => useEditor.getState().updateSettings({ defaultRevealWidth: clamp(v) }), 'ブラシの太さ']
}

/** ブラシ・消しゴムの大きさ：プリセット（細・中・太・極太・特大）。スマホはドロップダウン、PC はボタン */
function SizePresets({ phone, kind }: { phone: boolean; kind: 'brush' | 'eraser' }): React.JSX.Element {
  const [w, set, label] = useSize(kind)
  const presets = kind === 'brush' ? PEN_PRESETS : ERASER_PRESETS
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
        <button key={p.width} role="radio" aria-checked={w === p.width} className={`live-preset ${w === p.width ? 'on' : ''}`} title={`${p.label} ${p.width}px（${p.key} キー）${sizeKeysHint()}`} onClick={() => set(p.width)}>
          {p.label}
        </button>
      ))}
    </div>
  )
}

/** ツールチップ用：「［ ／ ］ キーでも小さく・大きくできます」。キーを外していれば空 */
function sizeKeysHint(): string {
  const down = keysFor('size.down')[0]
  const up = keysFor('size.up')[0]
  if (!down && !up) return ''
  if (down && up) return `。${formatCombo(down)} キーで小さく、${formatCombo(up)} キーで大きくできます`
  return down ? `。${formatCombo(down)} キーで小さくできます` : `。${formatCombo(up!)} キーで大きくできます`
}

/** ブラシ・消しゴムの大きさのスライダー（対数目盛り） */
function SizeSlider({ phone, kind }: { phone: boolean; kind: 'brush' | 'eraser' }): React.JSX.Element {
  const [w, set, sizeLabel] = useSize(kind)
  const label = kind === 'brush' ? (sizeLabel === 'ブラシの太さ' ? 'ブラシ' : '線の太さ') : '消しゴム'
  useShortcutsVersion()
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
        aria-label={sizeLabel}
        title={phone ? undefined : `${sizeLabel}${sizeKeysHint()}`}
        onChange={(e) => set(fromLog(Number(e.target.value)))}
      />
      <SizeValue phone={phone} value={w} set={set} label={sizeLabel} />
    </>
  )
}

/**
 * 大きさの数値。押すと選ばれて、マウスホイール・↑↓ キーで 1 ずつ（Shift を押しながらなら 10 ずつ）変えられる。
 * ホイールは、選ばずに数値の上に乗せただけでも効く
 */
function SizeValue({ phone, value, set, label }: { phone: boolean; value: number; set: (v: number) => void; label: string }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const latest = useRef({ value, set })
  latest.current = { value, set }
  // ホイールでページがスクロールしないよう、passive でない登録にする
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (e.deltaY === 0) return
      e.preventDefault()
      const { value: v, set: s } = latest.current
      s(v + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  const onKeyDown = (e: React.KeyboardEvent): void => {
    const step = e.shiftKey ? 10 : 1
    const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? step : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -step : e.key === 'PageUp' ? 10 : e.key === 'PageDown' ? -10 : 0
    if (!d) return
    e.preventDefault()
    e.stopPropagation() // 線の移動など、↑↓ のショートカットに渡さない
    set(value + d)
  }
  return (
    <span
      ref={ref}
      className={`${phone ? 'pc-value' : 'live-value'} size-value`}
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={4}
      aria-valuemax={MAX}
      title={`${label}：マウスホイール、または押してから ↑↓ キーで 1 ずつ変えられます（Shift で 10 ずつ）${sizeKeysHint()}`}
      onPointerDown={(e) => e.currentTarget.focus()}
      onKeyDown={onKeyDown}
    >
      {value}
    </span>
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
 * 「新しいグループ」：選択を外し、次になぞった線から新しいグループにする。
 * 新しいグループは、いま選んでいるグループのすぐ次（次のグループの前）にできる。何も選んでいなければ、押せない
 */
function NewGroupKey({ phone }: { phone: boolean }): React.JSX.Element {
  const no = useEditor((s) => s.project.strokes.findIndex((x) => x.id === s.selectedId) + 1)
  const onClick = (): void => {
    const st = useEditor.getState()
    if (st.rerecordId) st.setRerecord(null)
    st.startNewGroup()
    st.notify(`次になぞった線から、新しいグループになります（#${no} のすぐ次にできます）`)
  }
  const title = no > 0 ? `選択を外し、次になぞった線から新しいグループにします（#${no} のすぐ次にできます）` : '何も選んでいないので、なぞるとそのまま新しいグループになります'
  return phone ? (
    <button className="pc-key text" disabled={no === 0} onClick={onClick} data-tip={title}>
      <Icon name="plusPen" size={18} />
      <small>新しいグループ</small>
    </button>
  ) : (
    <button className="tool-btn live-redo" disabled={no === 0} onClick={onClick} title={title}>
      <Icon name="plusPen" />
      <span>新しいグループ</span>
    </button>
  )
}

/**
 * 「描き直す／追加」の切り替え（ブラシで線を選んでいるとき）。1回押しで切り替えられるよう、▼ のメニューに入れずに並べる。
 * PC は Shift を押しながらなぞると、その1回だけ「追加」になる
 */
/**
 * 「全部消して線1から」：選んでいるグループの線を全部消して、線1から描き直す。
 * なぞるまでは元の線を残して見えなくするだけ（キャンセルや別の線を選べば元どおり。なぞった後も ↶ で戻せる）
 */
function EmptyGroupKey({ phone }: { phone: boolean }): React.JSX.Element {
  const id = useEditor((s) => s.selectedId)
  const on = useEditor((s) => !!s.emptyGroupId)
  const name = useEditor((s) => s.project.strokes.find((x) => x.id === s.selectedId)?.name)
  const onClick = (): void => {
    const st = useEditor.getState()
    if (on) return st.startEmptyGroup(null)
    if (!id) return
    st.startEmptyGroup(id)
    st.notify(`${name} の線を全部消しました。線 1 からなぞってください（なぞるまでは、キャンセルで元に戻ります）`)
  }
  const title = on
    ? 'やめて、元の線に戻します'
    : id
      ? `${name} の線を全部消して、線 1 から描き直します（グループの名前・順番・待機はそのまま）`
      : 'グループを選ぶと押せます'
  const label = on ? '消すのをやめる' : '全部消して線1から'
  return phone ? (
    <button className={`pc-key text ${on ? 'on' : ''}`} disabled={!id && !on} onClick={onClick} data-tip={title}>
      <Icon name="eraser" size={18} />
      <small>{label}</small>
    </button>
  ) : (
    <button className={`tool-btn live-redo ${on ? 'on' : ''}`} disabled={!id && !on} onClick={onClick} title={title}>
      <Icon name="eraser" />
      <span>{label}</span>
    </button>
  )
}

function BrushTargetSeg({ phone }: { phone: boolean }): React.JSX.Element | null {
  const target = useEffectiveBrushTarget()
  const lineSelected = useEditor((s) => !!selectedLine(s))
  if (!lineSelected) return null
  const pick = (v: BrushTarget): void => {
    const st = useEditor.getState()
    // 一から描いている途中で「描き直す」を選んだら、自動の「追加」をやめる
    if (v === 'redo' && st.drawChain) st.setDrawChain(null)
    setBrushTarget(v)
  }
  const items: { id: BrushTarget; label: string; tip: string }[] = [
    { id: 'redo', label: '描き直す', tip: '描き直す：なぞると、選んでいる線が置き換わります（描き直したら次の線へ進みます）' },
    { id: 'add', label: '追加', tip: '追加：なぞった線を、選んでいる線のすぐ後ろに足します（PC は Shift を押しながらなぞっても、その1回だけ追加）' }
  ]
  return (
    <div className={phone ? 'pc-seg' : 'brush-seg'} role="radiogroup" aria-label="線を選んでいるときのブラシ">
      {items.map((it) => (
        <button
          key={it.id}
          role="radio"
          aria-checked={target === it.id}
          className={phone ? `pc-key text ${target === it.id ? 'on' : ''}` : `tool-btn mode-btn ${target === it.id ? 'on' : ''}`}
          data-tip={it.tip}
          onClick={() => pick(it.id)}
        >
          {phone ? it.label : <span>{it.label}</span>}
        </button>
      ))}
    </div>
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
  useShortcutsVersion()
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
          <button key={m.id} className={`icon-btn ${mode === m.id ? 'on' : ''}`} aria-pressed={mode === m.id} title={m.hint + keyHint(`tool.${m.id}`)} onClick={() => setMode(m.id)}>
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
  const target = useEffectiveBrushTarget()
  const selected = useEditor((s) => !!s.livePart)
  const advance = useRedoAdvance()
  const keepPace = useKeepTracedPace()
  const [menu, setMenu] = useState<DOMRect | null>(null)
  const redo = target === 'redo'
  // ボタンの表示とアイコンは、▼ で選んだ項目（描き直す／追加）にいつも合わせる
  const label = redo ? '描き直す' : '追加'
  const icon = redo ? 'penRedo' : 'plusPen'
  const hint =
    (redo
      ? 'ブラシ（描き直す）：なぞると、選んでいる線がその線に置き換わる'
      : 'ブラシ（追加）：なぞった線を、選んでいるグループの最後に足す') +
    (selected ? '' : '。線を選んでいないときは、新しいグループを描く')
  const options = [
    { id: 'redo' as const, icon: 'penRedo' as const, label: '選んだ線を描き直す', note: 'なぞると、選んでいる線が置き換わります（おすすめ）' },
    { id: 'add' as const, icon: 'plusPen' as const, label: '線を追加', note: '選んでいる線のすぐ後ろに線を足します（Shift を押しながらなぞっても）' }
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
        <button role="radio" aria-checked={on} className={`pc-key ${on ? 'on' : ''}`} data-tip={hint} onClick={onPick}>
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
            actions={[
              ...options.map((o) => ({ icon: o.icon, label: o.label, note: o.note, active: target === o.id, onSelect: () => choose(o.id) })),
              {
                icon: advance ? ('check' as const) : ('x' as const),
                label: advance ? '描き直したら次の線へ進む：オン' : '描き直したら次の線へ進む：オフ',
                note: '押すと切り替わります。グループの最後の線を描き直したら、続けてなぞると線が足されます（オフにすると、同じ線にとどまって何度も描き直せます）',
                active: advance,
                onSelect: () => setRedoAdvance(!advance)
              },
              {
                icon: keepPace ? ('check' as const) : ('x' as const),
                label: keepPace ? 'なぞった速さのまま残す：オン' : 'なぞった速さのまま残す：オフ',
                note: 'オフ（最初の状態）なら、なぞった線は自動で作った線と同じ速さで描かれます。オンなら、なぞった時間のまま',
                active: keepPace,
                onSelect: () => setKeepTracedPace(!keepPace)
              }
            ]}
          />
        )}
      </span>
    )
  }
  return (
    <span className="brush-split">
      <button className={`icon-btn ${on ? 'on' : ''}`} aria-pressed={on} title={hint + keyHint('tool.brush')} onClick={onPick}>
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
            <label className="toggle help-toggle" title="オンなら、描き直すと次の線を選びます。グループの最後の線を描き直したら、続けてなぞると線が足されます（自動で「追加」）。オフにすると、描き直したあとも同じ線にとどまり、何度でも描き直せます">
              <span>描き直したら次の線へ進む</span>
              <input type="checkbox" checked={advance} onChange={(e) => setRedoAdvance(e.target.checked)} />
              <span className="switch" />
            </label>
            <label className="toggle help-toggle" title="オフ（最初の状態）なら、なぞった線は自動で作った線と同じ速さで描かれます。オンなら、丁寧になぞった時間のまま残します">
              <span>なぞった速さのまま残す</span>
              <input type="checkbox" checked={keepPace} onChange={(e) => setKeepTracedPace(e.target.checked)} />
              <span className="switch" />
            </label>
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
  const pathTool = useEffectivePathTool()
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
        ? 'なぞると新しいグループを描きます。続けてなぞると、そのグループに線が足されます（次のグループへは「新しいグループ」）'
        : mode === 'erase'
          ? 'なぞった所にあるグループを消します'
          : `絵の上を押して${what}を選びます。ドラッグで動かし、太さ・大きさも変えられます`
    const brushing = mode === 'brush'
    return phone ? (
      // スマホは2段：上に操作の切り替えと大きさ、下にスライダーや案内
      <div className="pc-rows">
        <ScrollRow className="pc-row">
          <ModeSwitch phone />
          {mode === 'move' && <AutoSelectCheck phone />}
          {(brushing || mode === 'erase') && <SizePresets phone kind={brushing ? 'brush' : 'eraser'} />}
        </ScrollRow>
        <ScrollRow className="pc-row">
          {brushing || mode === 'erase' ? <SizeSlider phone kind={brushing ? 'brush' : 'eraser'} /> : <span className="pc-hint">{hint}</span>}
        </ScrollRow>
      </div>
    ) : (
      <div className="tb-group live-bar">
        <ModeSwitch phone={false} />
        {mode === 'move' && <AutoSelectCheck phone={false} />}
        {unitSwitch}
        {size ?? <span className="live-hint">{hint}</span>}
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
        <ScrollRow className="pc-row">
          <ModeSwitch phone />
          {mode === 'move' && <AutoSelectCheck phone />}
          {sized && <SizePresets phone kind={kind} />}
        </ScrollRow>
        <ScrollRow className="pc-row">
          {/* 選択を外す（×）・描き直す／追加・新しいグループは、横にスクロールしなくても見えるよう、先頭に置く */}
          <button className="pc-key" aria-label="選択を外す" onClick={clear}>
            <Icon name="x" size={18} />
          </button>
          {brushLike && <BrushTargetSeg phone />}
          {brushLike && <NewGroupKey phone />}
          {brushLike && <EmptyGroupKey phone />}
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
        </ScrollRow>
      </div>
    )
  }
  return (
    <div className="tb-group live-bar" title={`選んだ${what}の編集。絵は、この${what}を描き終えた瞬間を表示しています`}>
      <ModeSwitch phone={false} />
      {brushLike && <BrushTargetSeg phone={false} />}
      {brushLike && <NewGroupKey phone={false} />}
      {brushLike && <EmptyGroupKey phone={false} />}
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
