// ライブ編集のオプションバー。
// 選ぶ単位は「軌跡ごと」（標準）か「線ごと」（軌跡の中の、ペンを下ろしてから上げるまでの1区間）。
//  ・選ぶ・動かす：タップで選び、ドラッグで動かす。太さ・大きさを変える
//  ・ブラシで足す：なぞった所を、選んだ軌跡に足す（ペンもそこを通り、表示範囲も広がる）
//  ・消しゴム：なぞった所を、選んだ軌跡では見せない
// 絵（ステージ）は「選んだ軌跡（線）を描き終えた瞬間」を見せているので、変えるとその場で見え方が変わる。
import { useShallow } from 'zustand/react/shallow'
import {
  setAllPartsWidth,
  setPartWidth,
  setStrokeWidthKeepRatio,
  strokeParts,
  transformPart,
  transformStroke
} from '../engine/strokeParts'
import { useEditor } from '../store'
import { Icon } from './Icon'

const MIN = 1
const MAX = 600
/** 対数目盛り：細い太さは細かく、太い太さは一気に動かせる */
const toLog = (w: number): number => Math.round((Math.log(Math.max(MIN, w) / MIN) / Math.log(MAX / MIN)) * 1000)
const fromLog = (v: number): number => Math.round(MIN * Math.pow(MAX / MIN, v / 1000))

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
      const part = parts[s.liveUnit === 'stroke' ? 0 : lp.part]
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
  const whole = st.liveUnit === 'stroke'
  st.commit(
    (p) => ({
      ...p,
      strokes: p.strokes.map((s) => (s.id !== lp.strokeId ? s : whole ? setStrokeWidthKeepRatio(s, w) : setPartWidth(s, lp.part, w)))
    }),
    whole ? `livestroke:${lp.strokeId}` : `livepart:${lp.strokeId}:${lp.part}`
  )
}

/** 線ごと：選んでいる線の太さを、その軌跡のすべての線に使う */
function applyToStroke(): void {
  const st = useEditor.getState()
  const lp = st.livePart
  if (!lp) return
  const stroke = st.project.strokes.find((s) => s.id === lp.strokeId)
  const part = stroke ? strokeParts(stroke)[lp.part] : undefined
  if (!stroke || !part) return
  st.commit((p) => ({ ...p, strokes: p.strokes.map((s) => (s.id === lp.strokeId ? setAllPartsWidth(s, part.width) : s)) }))
  st.notify(`#${st.project.strokes.indexOf(stroke) + 1} のすべての線を ${part.width}px にしました`)
}

/** 選んでいる軌跡（線）を、その中心を基準に拡大・縮小する（続けて押した分は、元に戻す1回分にまとめる） */
export function scaleLivePart(factor: number): void {
  const st = useEditor.getState()
  const lp = st.livePart
  if (!lp) return
  const whole = st.liveUnit === 'stroke'
  st.commit(
    (p) => ({
      ...p,
      strokes: p.strokes.map((s) => (s.id !== lp.strokeId ? s : whole ? transformStroke(s, 0, 0, factor) : transformPart(s, lp.part, 0, 0, factor)))
    }),
    whole ? `livescale:${lp.strokeId}` : `livescale:${lp.strokeId}:${lp.part}`
  )
}

/** 前後へ。軌跡ごとのときは前後の軌跡、線ごとのときは前後の線（軌跡の端では、となりの軌跡の線へ） */
export function stepLivePart(dir: -1 | 1): void {
  const st = useEditor.getState()
  const lp = st.livePart
  const strokes = st.project.strokes.filter((s) => !s.hidden && s.points.length > 0)
  if (strokes.length === 0) return
  const whole = st.liveUnit === 'stroke'
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

/** ブラシ・消しゴムの大きさ */
function ToolSize({ phone, kind }: { phone: boolean; kind: 'brush' | 'eraser' }): React.JSX.Element {
  const key = kind === 'brush' ? 'defaultRevealWidth' : 'eraserWidth'
  const w = useEditor((s) => s.project.settings[key])
  const set = (v: number): void => useEditor.getState().updateSettings({ [key]: Math.max(4, Math.min(MAX, Math.round(v))) })
  const label = kind === 'brush' ? 'ブラシ' : '消しゴム'
  return (
    <>
      <span className={phone ? 'pc-label' : 'tb-label'}>{label}</span>
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

const MODES = [
  { id: 'move', icon: 'move', label: '選ぶ・動かす', hint: '選ぶ・動かす：タップで選び、ドラッグで動かす。太さ・大きさも変えられます' },
  { id: 'brush', icon: 'plusPen', label: 'ブラシで足す', hint: 'ブラシで足す：なぞった所を、選んだ軌跡に足す（ペンもそこを通り、表示範囲も広がる）' },
  { id: 'erase', icon: 'eraser', label: '消しゴム', hint: '消しゴム：なぞった所を、選んだ軌跡では見せない' }
] as const

/** 操作の切り替え：選ぶ・動かす ／ ブラシで足す ／ 消しゴム */
function ModeSwitch({ phone }: { phone: boolean }): React.JSX.Element {
  const mode = useEditor((s) => s.liveMode)
  const setMode = useEditor.getState().setLiveMode
  if (phone) {
    return (
      <div className="pc-seg" role="radiogroup" aria-label="ライブ編集の操作">
        {MODES.map((m) => (
          <button key={m.id} role="radio" aria-checked={mode === m.id} className={`pc-key ${mode === m.id ? 'on' : ''}`} onClick={() => setMode(m.id)}>
            <Icon name={m.icon} size={18} />
            <small>{m.label}</small>
          </button>
        ))}
      </div>
    )
  }
  return (
    <>
      {MODES.map((m) => (
        <button key={m.id} className={`icon-btn ${mode === m.id ? 'on' : ''}`} aria-pressed={mode === m.id} title={m.hint} onClick={() => setMode(m.id)}>
          <Icon name={m.icon} />
        </button>
      ))}
    </>
  )
}

/** 選ぶ単位の切り替え：軌跡ごと ／ 線ごと */
function UnitSwitch({ phone }: { phone: boolean }): React.JSX.Element {
  const unit = useEditor((s) => s.liveUnit)
  const setUnit = useEditor.getState().setLiveUnit
  const units = [
    { id: 'stroke', label: '軌跡ごと', short: '軌跡', hint: '軌跡ごと：タップした所の軌跡をまるごと選ぶ' },
    { id: 'part', label: '線ごと', short: '線', hint: '線ごと：軌跡の中の1本の線（ペンを下ろしてから上げるまで）だけを選ぶ' }
  ] as const
  return (
    <div className={phone ? 'pc-seg' : 'live-unit'} role="radiogroup" aria-label="選ぶ単位">
      {units.map((u) => (
        <button
          key={u.id}
          role="radio"
          aria-checked={unit === u.id}
          className={phone ? `pc-key text ${unit === u.id ? 'on' : ''}` : `live-unit-btn ${unit === u.id ? 'on' : ''}`}
          title={u.hint}
          onClick={() => setUnit(u.id)}
        >
          {phone ? u.label : u.short}
        </button>
      ))}
    </div>
  )
}

export function LiveEditBar({ phone = false }: { phone?: boolean }): React.JSX.Element {
  const live = useLive()
  const mode = useEditor((s) => s.liveMode)
  const unit = useEditor((s) => s.liveUnit)
  const clear = (): void => useEditor.getState().setLivePart(null)
  const whole = unit === 'stroke'
  const what = whole ? '軌跡' : '線'
  const size = mode === 'brush' ? <ToolSize phone={phone} kind="brush" /> : mode === 'erase' ? <ToolSize phone={phone} kind="eraser" /> : null

  if (!live) {
    const hint =
      mode === 'brush'
        ? '足したい軌跡の上からなぞり始めます'
        : mode === 'erase'
          ? 'なぞった所にある軌跡を消します'
          : `絵の上を押して${what}を選びます。ドラッグで動かし、太さ・大きさも変えられます`
    return phone ? (
      <>
        <ModeSwitch phone />
        <UnitSwitch phone />
        {size ?? <span className="pc-hint">{hint}</span>}
      </>
    ) : (
      <div className="tb-group live-bar">
        <ModeSwitch phone={false} />
        <UnitSwitch phone={false} />
        {size ?? <span className="live-hint">{hint}</span>}
      </div>
    )
  }

  const label = whole ? (phone ? `#${live.index + 1}（線 ${live.parts} 本）` : `#${live.index + 1}（${live.parts}本）`) : phone ? `#${live.index + 1} の線 ${live.part + 1}/${live.parts}` : `#${live.index + 1}・線 ${live.part + 1}/${live.parts}`
  const widthTitle = whole ? '軌跡の太さ（すべての線を同じ割合で。[ ] キーでも変えられます）' : '選んだ線の太さ（[ ] キーでも変えられます）'

  if (phone) {
    return (
      <>
        <ModeSwitch phone />
        <UnitSwitch phone />
        <span className="pc-label">{label}</span>
        <button className="pc-key" aria-label={`前の${what}`} onClick={() => stepLivePart(-1)}>
          <Icon name="up" size={18} />
          <small>前の{what}</small>
        </button>
        <button className="pc-key" aria-label={`次の${what}`} onClick={() => stepLivePart(1)}>
          <Icon name="down" size={18} />
          <small>次の{what}</small>
        </button>
        {size ?? (
          <>
            <button className="pc-key" aria-label="縮小" onClick={() => scaleLivePart(1 / 1.1)}>
              <Icon name="zoomOut" size={18} />
              <small>縮小</small>
            </button>
            <button className="pc-key" aria-label="拡大" onClick={() => scaleLivePart(1.1)}>
              <Icon name="zoomIn" size={18} />
              <small>拡大</small>
            </button>
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
            {!whole && (
              <button className="pc-key text" onClick={applyToStroke}>
                軌跡全体に
              </button>
            )}
          </>
        )}
        <button className="pc-key" aria-label="選択を外す" onClick={clear}>
          <Icon name="x" size={18} />
        </button>
      </>
    )
  }
  return (
    <div className="tb-group live-bar" title={`選んだ${what}の編集。絵は、この${what}を描き終えた瞬間を表示しています`}>
      <ModeSwitch phone={false} />
      <UnitSwitch phone={false} />
      <span className="tb-label">{label}</span>
      <button className="icon-btn" title={`前の${what} (,)`} onClick={() => stepLivePart(-1)}>
        <Icon name="up" />
      </button>
      <button className="icon-btn" title={`次の${what} (.)`} onClick={() => stepLivePart(1)}>
        <Icon name="down" />
      </button>
      {size ?? (
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
          {!whole && (
            <button className="icon-btn" title="この太さを、同じ軌跡のすべての線に使う" onClick={applyToStroke}>
              <Icon name="layers" />
            </button>
          )}
        </>
      )}
      <button className="icon-btn" title="選択を外す (Esc)" onClick={clear}>
        <Icon name="x" />
      </button>
    </div>
  )
}
