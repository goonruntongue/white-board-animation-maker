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
import { deleteSelectedAnchor, revealLineSoon } from '../livePath'
import { addRevealMark } from '../engine/selection'
import { useEditor } from '../store'
import { ERASER_PRESETS, PEN_PRESETS } from './PenSizePicker'
import { Icon } from './Icon'

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

/** 続けて書いた線のまとまりを区切る（次に書く線は、新しいグループになる） */
function BreakKey({ phone }: { phone: boolean }): React.JSX.Element {
  const chaining = useEditor((s) => !!s.drawChain)
  const onClick = (): void => {
    useEditor.getState().setDrawChain(null)
    useEditor.getState().notify('次に書く線から、新しいグループになります')
  }
  return phone ? (
    <button className="pc-key text" disabled={!chaining} onClick={onClick} title="次に書く線を、新しいグループにする">
      区切る
    </button>
  ) : (
    <button className="tool-btn live-redo" disabled={!chaining} onClick={onClick} title="続けて書いた線のまとまりを区切り、次に書く線を新しいグループにする">
      <span>区切る</span>
    </button>
  )
}

const MODES = [
  { id: 'move', icon: 'move', label: '選ぶ・動かす', hint: '選ぶ・動かす：タップで選び、ドラッグで動かす。太さ・大きさも変えられます' },
  { id: 'brush', icon: 'plusPen', label: 'ブラシ', hint: 'ブラシ：何も選んでいなければ、なぞって新しいグループを描く。線を選んでいれば、そのグループに線を足す（ペンもそこを通り、表示範囲も広がる）' },
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
  const unit = useEditor((s) => s.liveUnit)
  const hasAnchor = useEditor((s) => s.livePath?.selected != null)
  const clear = (): void => useEditor.getState().setLivePart(null)
  const pathing = mode === 'path'
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
        ? 'なぞると新しいグループになります（線を選んでいれば、そのグループに足します）'
        : mode === 'erase'
          ? 'なぞった所にあるグループを消します'
          : `絵の上を押して${what}を選びます。ドラッグで動かし、太さ・大きさも変えられます`
    const brushing = mode === 'brush'
    return phone ? (
      // スマホは2段：上に操作の切り替えと大きさ、下にスライダーや案内
      <div className="pc-rows">
        <div className="pc-row">
          <ModeSwitch phone />
          {(brushing || mode === 'erase') && <SizePresets phone kind={brushing ? 'brush' : 'eraser'} />}
        </div>
        <div className="pc-row">
          {brushing || mode === 'erase' ? <SizeSlider phone kind={brushing ? 'brush' : 'eraser'} /> : <span className="pc-hint">{hint}</span>}
          {brushing && <BreakKey phone />}
        </div>
      </div>
    ) : (
      <div className="tb-group live-bar">
        <ModeSwitch phone={false} />
        {unitSwitch}
        {size ?? <span className="live-hint">{hint}</span>}
        {brushing && <BreakKey phone={false} />}
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
          {sized && <SizePresets phone kind={kind} />}
        </div>
        <div className="pc-row">
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
              <span className="pc-hint">アンカー・ハンドルをドラッグ。線の上をダブルタップでアンカー追加</span>
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
              {!whole && (
                <button className="pc-key text" onClick={applyToStroke}>
                  グループ全体に
                </button>
              )}
            </>
          )}
          <button className="pc-key" onClick={() => { const st = useEditor.getState(); whole ? st.setRerecord(live.strokeId) : st.setRerecordPart(live.strokeId, live.part) }} title={whole ? 'グループ全体を手で描き直す' : '選んだ線だけを手で描き直す'}>
            <Icon name="record" size={18} /><small>{whole ? '全体を描き直す' : '線を描き直す'}</small>
          </button>
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
      {unitSwitch}
      <span className="tb-label">{label}</span>
      <button className="tool-btn live-redo" title={whole ? 'グループ全体を手で描き直す' : '選んだ線だけを手で描き直す'} onClick={() => { const st = useEditor.getState(); whole ? st.setRerecord(live.strokeId) : st.setRerecordPart(live.strokeId, live.part) }}><Icon name="record" /><span>{whole ? '全体を描き直す' : '線を描き直す'}</span></button>
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
          <span className="live-hint">アンカー・ハンドルをドラッグ／線の上をダブルクリックで追加／Alt＋ドラッグで角に</span>
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
          {!whole && (
            <button className="icon-btn" title="この太さを、同じグループのすべての線に使う" onClick={applyToStroke}>
              <Icon name="layers" />
            </button>
          )}
        </>
      ))}
      <button className="icon-btn" title="選択を外す (Esc)" onClick={clear}>
        <Icon name="x" />
      </button>
    </div>
  )
}
