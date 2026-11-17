// ライブ編集のオプションバー：選んだ線（軌跡の中の、ペンを下ろしてから上げるまでの区間）の太さを、その場で変える。
// 絵（ステージ）は「選んだ線を描き終えた瞬間」を見せているので、太さを変えると見え方がすぐ変わる。
import { setAllPartsWidth, setPartWidth, strokeParts, transformPart } from '../engine/strokeParts'
import { useShallow } from 'zustand/react/shallow'
import { useEditor } from '../store'
import { Icon } from './Icon'

const MIN = 1
const MAX = 600
/** 対数目盛り：細い太さは細かく、太い太さは一気に動かせる */
const toLog = (w: number): number => Math.round((Math.log(Math.max(MIN, w) / MIN) / Math.log(MAX / MIN)) * 1000)
const fromLog = (v: number): number => Math.round(MIN * Math.pow(MAX / MIN, v / 1000))

/** 選んでいる線の情報（なければ null） */
function useLive(): { strokeId: string; part: number; index: number; parts: number; width: number } | null {
  const v = useEditor(
    useShallow((s) => {
      const lp = s.livePart
      if (!lp) return { strokeId: '', part: -1, index: -1, parts: 0, width: 0 }
      const index = s.project.strokes.findIndex((x) => x.id === lp.strokeId)
      const part = index >= 0 ? strokeParts(s.project.strokes[index])[lp.part] : undefined
      if (!part) return { strokeId: '', part: -1, index: -1, parts: 0, width: 0 }
      return { strokeId: lp.strokeId, part: lp.part, index, parts: strokeParts(s.project.strokes[index]).length, width: part.width }
    })
  )
  return v.index < 0 ? null : v
}
/** 選んでいる線の太さを変える（スライダーを動かしている間の変更は、元に戻す1回分にまとめる） */
export function setLiveWidth(width: number): void {
  const st = useEditor.getState()
  const lp = st.livePart
  if (!lp) return
  const w = Math.max(MIN, Math.min(MAX, Math.round(width)))
  st.commit(
    (p) => ({ ...p, strokes: p.strokes.map((s) => (s.id === lp.strokeId ? setPartWidth(s, lp.part, w) : s)) }),
    `livepart:${lp.strokeId}:${lp.part}`
  )
}

/** 選んでいる線の太さを、その軌跡のすべての線に使う */
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

/** 選んでいる線を、その中心を基準に拡大・縮小する（続けて押した分は、元に戻す1回分にまとめる） */
export function scaleLivePart(factor: number): void {
  const st = useEditor.getState()
  const lp = st.livePart
  if (!lp) return
  st.commit(
    (p) => ({ ...p, strokes: p.strokes.map((s) => (s.id === lp.strokeId ? transformPart(s, lp.part, 0, 0, factor) : s)) }),
    `livescale:${lp.strokeId}:${lp.part}`
  )
}

/** 消しゴムの大きさ */
function EraserSize({ phone }: { phone: boolean }): React.JSX.Element {
  const w = useEditor((s) => s.project.settings.eraserWidth)
  const set = (v: number): void => useEditor.getState().updateSettings({ eraserWidth: Math.max(4, Math.min(MAX, Math.round(v))) })
  return (
    <>
      <span className={phone ? 'pc-label' : 'tb-label'}>消しゴム</span>
      <input
        className={phone ? 'pc-range' : 'live-range'}
        type="range"
        min={0}
        max={1000}
        value={toLog(w)}
        style={{ '--fill': `${toLog(w) / 10}%` } as React.CSSProperties}
        aria-label="消しゴムの大きさ"
        onChange={(e) => set(fromLog(Number(e.target.value)))}
      />
      <span className={phone ? 'pc-value' : 'live-value'}>{w}</span>
    </>
  )
}

/** 操作の切り替え：線を動かす ⇔ 消しゴム */
function ModeSwitch({ phone }: { phone: boolean }): React.JSX.Element {
  const mode = useEditor((s) => s.liveMode)
  const setMode = useEditor.getState().setLiveMode
  if (phone) {
    return (
      <div className="pc-seg" role="radiogroup" aria-label="ライブ編集の操作">
        <button role="radio" aria-checked={mode === 'move'} className={`pc-key ${mode === 'move' ? 'on' : ''}`} onClick={() => setMode('move')}>
          <Icon name="move" size={18} />
          <small>選ぶ・動かす</small>
        </button>
        <button role="radio" aria-checked={mode === 'erase'} className={`pc-key ${mode === 'erase' ? 'on' : ''}`} onClick={() => setMode('erase')}>
          <Icon name="eraser" size={18} />
          <small>消しゴム</small>
        </button>
      </div>
    )
  }
  return (
    <>
      <button className={`icon-btn ${mode === 'move' ? 'on' : ''}`} aria-pressed={mode === 'move'} title="選ぶ・動かす：線をクリックして選び、ドラッグで動かす" onClick={() => setMode('move')}>
        <Icon name="move" />
      </button>
      <button className={`icon-btn ${mode === 'erase' ? 'on' : ''}`} aria-pressed={mode === 'erase'} title="消しゴム：選んだ線の軌跡を、なぞった所だけ消す" onClick={() => setMode('erase')}>
        <Icon name="eraser" />
      </button>
    </>
  )
}

/** 前後の線へ（軌跡の端では、となりの軌跡の線へ移る） */
export function stepLivePart(dir: -1 | 1): void {
  const st = useEditor.getState()
  const lp = st.livePart
  const strokes = st.project.strokes.filter((s) => !s.hidden && s.points.length > 0)
  if (strokes.length === 0) return
  if (!lp) {
    const s = dir > 0 ? strokes[0] : strokes[strokes.length - 1]
    st.setLivePart({ strokeId: s.id, part: dir > 0 ? 0 : strokeParts(s).length - 1 })
    return
  }
  let si = strokes.findIndex((s) => s.id === lp.strokeId)
  if (si < 0) return
  let part = lp.part + dir
  if (part < 0 || part >= strokeParts(strokes[si]).length) {
    si += dir
    if (si < 0 || si >= strokes.length) return
    part = dir > 0 ? 0 : strokeParts(strokes[si]).length - 1
  }
  st.setLivePart({ strokeId: strokes[si].id, part })
}

export function LiveEditBar({ phone = false }: { phone?: boolean }): React.JSX.Element {
  const live = useLive()
  const mode = useEditor((s) => s.liveMode)
  const clear = (): void => useEditor.getState().setLivePart(null)

  if (!live) {
    const hint = mode === 'erase' ? 'なぞった所にある線の軌跡を消します' : '絵の上の線を押して選びます。ドラッグで動かし、太さ・大きさも変えられます'
    return phone ? (
      <>
        <ModeSwitch phone />
        {mode === 'erase' ? <EraserSize phone /> : <span className="pc-hint">{hint}</span>}
      </>
    ) : (
      <div className="tb-group live-bar">
        <ModeSwitch phone={false} />
        {mode === 'erase' ? <EraserSize phone={false} /> : <span className="live-hint">{hint}</span>}
      </div>
    )
  }

  const label = phone ? `#${live.index + 1} の線 ${live.part + 1}/${live.parts}` : `#${live.index + 1}・線 ${live.part + 1}/${live.parts}`
  if (phone) {
    return (
      <>
        <ModeSwitch phone />
        <span className="pc-label">{label}</span>
        <button className="pc-key" aria-label="前の線" onClick={() => stepLivePart(-1)}>
          <Icon name="up" size={18} />
          <small>前の線</small>
        </button>
        <button className="pc-key" aria-label="次の線" onClick={() => stepLivePart(1)}>
          <Icon name="down" size={18} />
          <small>次の線</small>
        </button>
        {mode === 'erase' ? (
          <EraserSize phone />
        ) : (
          <>
        <button className="pc-key" aria-label="線を縮小" onClick={() => scaleLivePart(1 / 1.1)}>
          <Icon name="zoomOut" size={18} />
          <small>縮小</small>
        </button>
        <button className="pc-key" aria-label="線を拡大" onClick={() => scaleLivePart(1.1)}>
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
          aria-label="選んだ線の太さ"
          onChange={(e) => setLiveWidth(fromLog(Number(e.target.value)))}
        />
        <span className="pc-value">{live.width}</span>
        <button className="pc-key text" onClick={applyToStroke}>
          軌跡全体に
        </button>
          </>
        )}
        <button className="pc-key" aria-label="選択を外す" onClick={clear}>
          <Icon name="x" size={18} />
        </button>
      </>
    )
  }
  return (
    <div className="tb-group live-bar" title="選んだ線の編集。絵は、この線を描き終えた瞬間を表示しています">
      <ModeSwitch phone={false} />
      <span className="tb-label">{label}</span>
      <button className="icon-btn" title="前の線 (,)" onClick={() => stepLivePart(-1)}>
        <Icon name="up" />
      </button>
      <button className="icon-btn" title="次の線 (.)" onClick={() => stepLivePart(1)}>
        <Icon name="down" />
      </button>
      {mode === 'erase' ? (
        <EraserSize phone={false} />
      ) : (
        <>
          <button className="icon-btn" title="線を縮小（中心を基準に）" onClick={() => scaleLivePart(1 / 1.1)}>
            <Icon name="zoomOut" />
          </button>
          <button className="icon-btn" title="線を拡大（中心を基準に）" onClick={() => scaleLivePart(1.1)}>
            <Icon name="zoomIn" />
          </button>
          <input
            className="live-range"
            type="range"
            min={0}
            max={1000}
            value={toLog(live.width)}
            style={{ '--fill': `${toLog(live.width) / 10}%` } as React.CSSProperties}
            aria-label="選んだ線の太さ"
            title="選んだ線の太さ（[ ] キーでも変えられます）"
            onChange={(e) => setLiveWidth(fromLog(Number(e.target.value)))}
          />
          <span className="live-value" title="選んだ線の太さ（px）">{live.width}</span>
          <button className="icon-btn" title="この太さを、同じ軌跡のすべての線に使う" onClick={applyToStroke}>
            <Icon name="layers" />
          </button>
        </>
      )}
      <button className="icon-btn" title="選択を外す (Esc)" onClick={clear}>
        <Icon name="x" />
      </button>
    </div>
  )
}
