import { useEffect, useMemo, useRef, useState } from 'react'
import { rewind, togglePlay } from '../commands'
import { formatTime } from '../engine/project'
import { buildTimeline } from '../engine/wb-engine'
import { strokeParts } from '../engine/strokeParts'
import { useEditor } from '../store'
import { Icon } from './Icon'
import { StrokeActions } from './phone/StrokeActions'
import { useLongPress } from '../lib/useLongPress'

export function Timeline(): React.JSX.Element {
  const project = useEditor((s) => s.project)
  const time = useEditor((s) => s.time)
  const playing = useEditor((s) => s.playing)
  const selectedId = useEditor((s) => s.selectedId)
  const viewMode = useEditor((s) => s.viewMode)
  const tool = useEditor((s) => s.tool)
  const livePart = useEditor((s) => s.livePart)
  const liveUnit = useEditor((s) => s.liveUnit)
  const liveMode = useEditor((s) => s.liveMode)
  const timeline = useMemo(() => buildTimeline(project), [project])
  const total = Math.max(1, timeline.total)
  const trackRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; beforeId: string | null; x: number } | null>(null)
  const [multiMode, setMultiMode] = useState(false)
  const [multiIds, setMultiIds] = useState<string[]>([])
  useEffect(() => { setMultiIds([]); setMultiMode(false) }, [project.pageIndex])
  useEffect(() => {
    const viewport = scrollRef.current
    const track = trackRef.current
    if (!playing || !viewport || !track) return
    const x = (time / total) * track.offsetWidth
    if (x < viewport.scrollLeft || x > viewport.scrollLeft + viewport.clientWidth - 20) {
      viewport.scrollLeft = Math.max(0, x - viewport.clientWidth * 0.2)
    }
  }, [playing, time, total])
  const insertBefore = useEditor((s) => s.insertBefore)

  const boundaryAt = (clientX: number, excludeId?: string): { beforeId: string | null; x: number } => {
    const rect = trackRef.current!.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * total
    const segments = timeline.segments.filter((seg) => project.strokes[seg.index].id !== excludeId)
    const next = segments.find((seg) => t < (seg.start + seg.end) / 2)
    if (next) return { beforeId: project.strokes[next.index].id, x: (next.start / total) * 100 }
    const last = segments[segments.length - 1]
    return { beforeId: null, x: last ? (last.end / total) * 100 : 0 }
  }

  const beginInsert = (): void => {
    const st = useEditor.getState()
    if (insertBefore) { st.setInsertBefore(null); return }
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const target = boundaryAt(rect.left + (time / total) * rect.width)
    st.setInsertBefore({ id: target.beforeId })
    st.setPlaying(false)
    st.setViewMode('edit')
    st.setRerecord(null)
    st.setTool('draw')
    st.notify('再生位置に近い軌跡の境目へ追加します。画像をなぞってください')
  }

  const finishDrag = (id: string, clientX: number): void => {
    const target = boundaryAt(clientX, id)
    const from = project.strokes.findIndex((s) => s.id === id)
    const remaining = project.strokes.filter((s) => s.id !== id)
    const index = target.beforeId ? remaining.findIndex((s) => s.id === target.beforeId) : remaining.length
    if (from >= 0 && index >= 0 && index !== from) useEditor.getState().moveStroke(id, index)
    setDrop(null)
  }

  const seekTo = (clientX: number): void => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * total
    const st = useEditor.getState()
    st.setPlaying(false)
    st.setViewMode('preview')
    st.setTime(t)
  }

  /**
   * 再生位置のつまみ・目盛りをなぞって、再生位置を連続的に動かす（スクラブ）。
   * タイムラインは横スクロールするので、ここだけはスクロールさせずに指の動きを再生位置にする。
   * 端まで来たら、タイムラインを少しずつ送る
   */
  const scrub = useRef<{ pointerId: number; x: number; raf: number } | null>(null)
  const scrubStep = (): void => {
    const s = scrub.current
    const vp = scrollRef.current
    if (!s || !vp) return
    const r = vp.getBoundingClientRect()
    const edge = 32
    const dx = s.x < r.left + edge ? -(r.left + edge - s.x) : s.x > r.right - edge ? s.x - (r.right - edge) : 0
    if (dx !== 0) {
      vp.scrollLeft += Math.max(-24, Math.min(24, dx * 0.5))
      seekTo(Math.max(r.left, Math.min(r.right, s.x)))
    }
    s.raf = requestAnimationFrame(scrubStep)
  }
  const scrubHandlers = {
    onPointerDown: (e: React.PointerEvent): void => {
      e.stopPropagation()
      e.preventDefault()
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        // 捕捉できなくても、なぞる操作は続けられる
      }
      if (scrub.current) cancelAnimationFrame(scrub.current.raf)
      scrub.current = { pointerId: e.pointerId, x: e.clientX, raf: requestAnimationFrame(scrubStep) }
      seekTo(e.clientX)
    },
    onPointerMove: (e: React.PointerEvent): void => {
      const s = scrub.current
      if (!s || s.pointerId !== e.pointerId) return
      e.stopPropagation()
      s.x = e.clientX
      seekTo(e.clientX)
    },
    onPointerUp: (e: React.PointerEvent): void => {
      const s = scrub.current
      if (!s || s.pointerId !== e.pointerId) return
      cancelAnimationFrame(s.raf)
      scrub.current = null
    }
  }
  useEffect(() => () => { if (scrub.current) cancelAnimationFrame(scrub.current.raf) }, [])

  // 目盛り
  const ticks = useMemo(() => {
    const sec = total / 1000
    const step = sec <= 10 ? 1 : sec <= 30 ? 2 : sec <= 90 ? 5 : sec <= 240 ? 10 : 30
    const out: number[] = []
    for (let s = 0; s <= sec; s += step) out.push(s)
    return out
  }, [total])

  const { setViewMode, select } = useEditor.getState()

  return (
    <footer className="timeline">
      <div className="transport">
        <button className="icon-btn" title="先頭へ (Home)" onClick={rewind}>
          <Icon name="rewind" />
        </button>
        <button className="icon-btn play" data-tour="play" title="再生 / 一時停止 (Space)" onClick={togglePlay}>
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>
        <Lcd time={time} total={timeline.total} playing={playing} />
        <div className="seg-toggle" role="group" aria-label="表示モード">
          <button className={viewMode === 'edit' ? 'on' : ''} onClick={() => setViewMode('edit')} title="編集表示 (Tab)">
            編集
          </button>
          <button className={viewMode === 'preview' ? 'on' : ''} onClick={() => setViewMode('preview')} title="プレビュー表示 (Tab)">
            プレビュー
          </button>
        </div>
      </div>
      <div className="track-area">
        <div className="timeline-scroll" ref={scrollRef} aria-label="タイムライン（横スクロール可能）" tabIndex={0}>
        <div
        className="timeline-track-inner"
        style={{ minWidth: `${Math.min(100000, Math.ceil(total / 1000 * 55))}px` }}
        ref={trackRef}
        onPointerDown={(e) => {
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          seekTo(e.clientX)
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) seekTo(e.clientX)
        }}
      >
        <div className="ruler scrub" title="なぞって再生位置を動かす" {...scrubHandlers} onPointerCancel={scrubHandlers.onPointerUp}>
          {ticks.map((s) => (
            <span key={s} className="tick" style={{ left: `${((s * 1000) / total) * 100}%` }}>
              {s}s
            </span>
          ))}
        </div>
        <div className="track">
          {timeline.segments.map((seg) => {
            const stroke = project.strokes[seg.index]
            const left = (seg.start / total) * 100
            const width = ((seg.end - seg.start) / total) * 100
            return (
              <TimelineClip
                key={stroke.id}
                index={seg.index}
                name={stroke.name}
                color={stroke.color}
                left={left}
                width={width}
                selected={multiIds.length ? multiIds.includes(stroke.id) : stroke.id === selectedId}
                onDrag={(x) => { if (!multiMode && multiIds.length < 2) setDrop({ id: stroke.id, ...boundaryAt(x, stroke.id) }) }}
                onDrop={(x) => { if (!multiMode && multiIds.length < 2) finishDrag(stroke.id, x); else setDrop(null) }}
                onCancel={() => setDrop(null)}
                partPositions={strokeParts(stroke).slice(1).map((part) => seg.prep.param[part.start] ?? 0)}
                onSelect={(shift) => {
                  if (shift && selectedId) {
                    const a = project.strokes.findIndex((s) => s.id === selectedId)
                    const b = seg.index
                    if (a >= 0) setMultiIds(project.strokes.slice(Math.min(a, b), Math.max(a, b) + 1).map((s) => s.id))
                    return
                  }
                  if (multiMode) {
                    setMultiIds((old) => old.includes(stroke.id) ? old.filter((id) => id !== stroke.id) : [...old, stroke.id])
                    select(stroke.id)
                    return
                  }
                  setMultiIds([])
                  select(stroke.id)
                  const st = useEditor.getState()
                  if (st.tool === 'live' && st.viewMode === 'edit') {
                    if (st.liveMode !== 'path') st.setLiveUnit('stroke')
                    st.setLivePart({ strokeId: stroke.id, part: 0 })
                  }
                }}
                onDelete={() => { if (multiIds.length > 1) useEditor.getState().notify('複数選択を解除してから削除してください'); else useEditor.getState().removeStroke(stroke.id) }}
                onDoubleClick={() => seekTo(clientXAt(trackRef.current, seg.start / total))}
                onMenu={() => {
                  select(stroke.id)
                  setMenuFor(stroke.id)
                }}
              />
            )
          })}
          {timeline.segments.length === 0 && <div className="track-empty">軌跡を追加するとここに並びます</div>}
          {drop && <div className="timeline-drop-marker" style={{ left: `${drop.x}%` }} />}
        </div>
        <div className="playhead" style={{ left: `${(time / total) * 100}%` }}>
          <div className="playhead-grip" aria-label="再生位置（なぞって動かす）" {...scrubHandlers} onPointerCancel={scrubHandlers.onPointerUp} />
        </div>
        </div>
        </div>
        {selectedId && multiIds.length < 2 && (() => {
          const stroke = project.strokes.find((s) => s.id === selectedId)
          if (!stroke) return null
          const parts = strokeParts(stroke)
          if (!parts.length) return null
          return <div className="timeline-parts" onPointerDown={(e) => e.stopPropagation()} onPointerMove={(e) => e.stopPropagation()}>
            <span className="timeline-parts-label">線 ({parts.length})</span>
            <div className="timeline-parts-list" aria-label={`${stroke.name} の線`}>
              {parts.map((_, part) => <button key={part} className={tool === 'live' && liveUnit === 'part' && livePart?.strokeId === stroke.id && livePart.part === part ? 'on' : ''} onClick={() => {
                const st = useEditor.getState()
                st.setPlaying(false)
                st.setViewMode('edit')
                st.setTool('live')
                st.setLiveUnit('part')
                st.setLivePart({ strokeId: stroke.id, part })
              }} aria-label={`${stroke.name} の線 ${part + 1}`} title={`線 ${part + 1} をライブ編集`}>{part + 1}</button>)}
            </div>
          </div>
        })()}
        <div className="timeline-actions" onPointerDown={(e) => e.stopPropagation()} onPointerMove={(e) => e.stopPropagation()}>
          {multiIds.length < 2 && selectedId && <button className="timeline-insert" onClick={() => {
            const st = useEditor.getState()
            if (st.tool === 'live' && (st.liveUnit === 'part' || st.liveMode === 'path') && st.livePart?.strokeId === selectedId) st.setRerecordPart(selectedId, st.livePart.part)
            else st.setRerecord(selectedId)
          }}>{tool === 'live' && (liveUnit === 'part' || liveMode === 'path') && livePart?.strokeId === selectedId ? '選んだ線を描き直す' : 'ブロック全体を描き直す'}</button>}
          <button className={`timeline-insert ${multiMode ? 'on' : ''}`} onClick={() => {
            if (multiMode) { setMultiMode(false); setMultiIds([]) }
            else { setMultiMode(true); setMultiIds(selectedId ? [selectedId] : []) }
          }}>{multiMode ? '複数選択を終了' : '複数選択'}</button>
          {multiIds.length > 1 && <button className="timeline-insert" onClick={() => {
            const st = useEditor.getState()
            if (st.mergeSelectedStrokes(multiIds)) { setMultiIds([]); setMultiMode(false); st.notify('選択した軌跡を結合しました') }
            else st.notify('連続した軌跡を選択してください。再生の有無が異なる軌跡は結合できません')
          }}>{multiIds.length}件を結合</button>}
          <button className={`timeline-insert ${insertBefore ? 'on' : ''}`} onClick={beginInsert} title="再生位置に近い軌跡の境目に、次の手描き軌跡を追加">
            {insertBefore ? '挿入を取消' : '＋ この位置に描く'}
          </button>
          <button className="timeline-delete" disabled={!selectedId || multiIds.length > 1} onClick={() => { if (selectedId) useEditor.getState().removeStroke(selectedId) }} title="選択した軌跡を削除（元に戻せます）">
            <Icon name="trash" size={16} /> 選択した軌跡を削除
          </button>
        </div>
      </div>
      {menuFor && <StrokeActions strokeId={menuFor} onClose={() => setMenuFor(null)} />}
    </footer>
  )
}

/** タイムライン上の1本の軌跡。タップで選択、長押し（右クリック）でメニュー */
function TimelineClip(props: {
  index: number
  name: string
  color: string
  left: number
  width: number
  selected: boolean
  onSelect: (shift: boolean) => void
  partPositions: number[]
  onDelete: () => void
  onDoubleClick: () => void
  onMenu: () => void
  onDrag: (x: number) => void
  onDrop: (x: number) => void
  onCancel: () => void
}): React.JSX.Element {
  const lp = useLongPress(props.onMenu)
  const drag = useRef<{ id: number; x: number; y: number; active: boolean } | null>(null)
  return (
    <div
      className={`clip ${props.selected ? 'selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${props.index + 1}. ${props.name}、Delete キーで削除`}
      aria-pressed={props.selected}
      style={{ left: `${props.left}%`, width: `${props.width}%`, backgroundColor: props.color }}
      title={`${props.index + 1}. ${props.name}（ドラッグで並べ替え、長押し・右クリックでメニュー）`}
      {...lp.handlers}
      onPointerDown={(e) => {
        // 時間軸のシーク（親の pointerdown）にさせない
        e.stopPropagation()
        if (e.button !== 0) return
        e.currentTarget.focus({ preventScroll: true })
        props.onSelect(e.shiftKey)
        lp.handlers.onPointerDown(e)
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, active: false }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        e.stopPropagation()
        lp.handlers.onPointerMove(e)
        const d = drag.current
        if (!d || d.id !== e.pointerId) return
        if (lp.fired()) { drag.current = null; return }
        if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) d.active = true
        if (d.active) props.onDrag(e.clientX)
      }}
      onPointerUp={(e) => {
        e.stopPropagation()
        lp.handlers.onPointerUp()
        const d = drag.current
        drag.current = null
        if (d?.active) props.onDrop(e.clientX)
      }}
      onPointerCancel={(e) => { e.stopPropagation(); lp.handlers.onPointerCancel(); drag.current = null; props.onCancel() }}
      onKeyDown={(e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          e.stopPropagation()
          props.onDelete()
        } else if (e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          props.onSelect(e.shiftKey)
        }
      }}
      onDoubleClick={props.onDoubleClick}
    >
      <span>{props.index + 1}</span>
      {props.partPositions.map((position, i) => <i key={i} className="timeline-part-mark" style={{ left: `${position * 100}%` }} />)}
    </div>
  )
}

const METER_SEGMENTS = 24

/** 液晶風の時間表示（背景に薄く「88:88.88」を敷いて、セグメント表示らしく見せる） */
function Lcd({ time, total, playing }: { time: number; total: number; playing: boolean }): React.JSX.Element {
  const lit = total > 0 ? Math.round((time / total) * METER_SEGMENTS) : 0
  return (
    <div className="lcd" aria-label={`再生位置 ${formatTime(time)} / ${formatTime(total)}`}>
      <div className="lcd-top">
        <span className={`lcd-state ${playing ? 'on' : ''}`}>{playing ? '▶ PLAY' : '■ STOP'}</span>
        <span className="lcd-total">{formatTime(total)}</span>
      </div>
      <div className="lcd-digits">
        <span className="lcd-ghost">88:88.88</span>
        <span className="lcd-value">{formatTime(time)}</span>
      </div>
      <div className="lcd-meter" aria-hidden>
        {Array.from({ length: METER_SEGMENTS }, (_, i) => (
          <i key={i} className={i < lit ? 'on' : ''} />
        ))}
      </div>
    </div>
  )
}

function clientXAt(el: HTMLDivElement | null, ratio: number): number {
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  return rect.left + rect.width * ratio
}
