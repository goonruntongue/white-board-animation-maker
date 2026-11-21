import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { rewind, togglePlay } from '../commands'
import { formatTime } from '../engine/project'
import { buildTimeline } from '../engine/wb-engine'
import { strokeParts } from '../engine/strokeParts'
import { useEditor } from '../store'
import { Icon } from './Icon'
import { ScrollRow } from './ScrollRow'
import { useIsPhone } from '../lib/useMedia'
import { StrokeActions } from './phone/StrokeActions'
import { useLongPress } from '../lib/useLongPress'
import { BASE_PX_PER_SEC, ZOOM_MAX, commitTimelineZoom, onTimelineZoomRequest, requestTimelineZoom, useTimelineZoom } from '../lib/timelineZoom'
import { keyHint, useShortcutsVersion } from '../lib/shortcuts'

const SKIP_KEY = 'wbam.skipLastLineConfirm'
function readSkip(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === '1'
  } catch {
    return false
  }
}
function writeSkip(): void {
  try {
    localStorage.setItem(SKIP_KEY, '1')
  } catch {
    // 保存できなくても、次回もう一度聞くだけ
  }
}

/**
 * タイムラインの下に置く、つかみやすいスクロールバー（ブラウザの細いバーの代わり）。
 * つまみをドラッグすると横に送れる。バーの空いた所をタップすると、そこへ移る。収まっているときは出さない
 */
function TimelineScrollbar({ viewport, total }: { viewport: React.RefObject<HTMLDivElement | null>; total: number }): React.JSX.Element | null {
  const barRef = useRef<HTMLDivElement>(null)
  const [geo, setGeo] = useState({ ratio: 1, pos: 0 })
  const drag = useRef<{ pointerId: number; offset: number } | null>(null)

  useEffect(() => {
    const vp = viewport.current
    if (!vp) return
    const update = (): void => {
      const max = vp.scrollWidth - vp.clientWidth
      const ratio = vp.scrollWidth > 0 ? vp.clientWidth / vp.scrollWidth : 1
      const pos = max > 0 ? vp.scrollLeft / max : 0
      setGeo((g) => (Math.abs(g.ratio - ratio) < 0.001 && Math.abs(g.pos - pos) < 0.001 ? g : { ratio, pos }))
    }
    update()
    vp.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(vp)
    if (vp.firstElementChild) ro.observe(vp.firstElementChild)
    return () => {
      vp.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [viewport, total])

  if (geo.ratio >= 0.995) return null
  const thumbPct = Math.max(12, geo.ratio * 100)
  const leftPct = (100 - thumbPct) * geo.pos

  /** バーの上の x（画面座標）から、つまみの左端の位置 0..1 を出してスクロールする */
  const scrollToX = (clientX: number, offset: number): void => {
    const vp = viewport.current
    const bar = barRef.current
    if (!vp || !bar) return
    const r = bar.getBoundingClientRect()
    const thumbW = (r.width * thumbPct) / 100
    const free = r.width - thumbW
    const f = free > 0 ? Math.max(0, Math.min(1, (clientX - r.left - offset) / free)) : 0
    vp.scrollLeft = f * (vp.scrollWidth - vp.clientWidth)
  }

  return (
    <div
      ref={barRef}
      className="tl-scrollbar"
      role="scrollbar"
      aria-orientation="horizontal"
      aria-label="タイムラインを横に送る"
      aria-valuenow={Math.round(geo.pos * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.preventDefault()
        const bar = barRef.current!
        const r = bar.getBoundingClientRect()
        const thumbW = (r.width * thumbPct) / 100
        const thumbLeft = r.left + (r.width * leftPct) / 100
        // つまみをつかんだら、その位置のまま動かす。空いた所なら、つまみの真ん中をそこへ
        const offset = e.clientX >= thumbLeft && e.clientX <= thumbLeft + thumbW ? e.clientX - thumbLeft : thumbW / 2
        drag.current = { pointerId: e.pointerId, offset }
        try {
          bar.setPointerCapture(e.pointerId)
        } catch {
          // 捕捉できなくても動かせる
        }
        scrollToX(e.clientX, offset)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d || d.pointerId !== e.pointerId) return
        e.stopPropagation()
        scrollToX(e.clientX, d.offset)
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <div className={`tl-scrollbar-thumb ${drag.current ? 'dragging' : ''}`} style={{ left: `${leftPct}%`, width: `${thumbPct}%` }}>
        <span className="tl-scrollbar-grip" aria-hidden="true" />
      </div>
    </div>
  )
}

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
  // ---- 表示倍率（100% ＝ 1秒が 55px。下限は全体が見える倍率） ----
  const [vpW, setVpW] = useState(0)
  useEffect(() => {
    const vp = scrollRef.current
    if (!vp) return
    const update = (): void => setVpW(vp.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(vp)
    return () => ro.disconnect()
  }, [])
  const storedZoom = useTimelineZoom()
  const sec = total / 1000
  const fitZoom = vpW > 0 ? Math.min(ZOOM_MAX, Math.max(0.01, (vpW - 8) / (sec * BASE_PX_PER_SEC))) : 1
  const zoom = Math.max(storedZoom, fitZoom)
  const trackWidth = Math.min(200000, Math.ceil(sec * BASE_PX_PER_SEC * zoom))
  // 倍率を変える前の「目印の位置の時刻」。描き直した後に、その時刻が同じ所に来るようにスクロールする
  const zoomAnchor = useRef<{ ratio: number; ax: number } | null>(null)
  const zoomLatest = useRef({ zoom, fitZoom, total })
  zoomLatest.current = { zoom, fitZoom, total }
  useEffect(
    () =>
      onTimelineZoomRequest(({ zoom: want, anchorX }) => {
        const { zoom: cur, fitZoom: fz, total: tot } = zoomLatest.current
        const next = want <= 0 ? fz : Math.max(fz, Math.min(ZOOM_MAX, want))
        const vp = scrollRef.current
        const track = trackRef.current
        if (vp && track && track.offsetWidth > 0) {
          const r = vp.getBoundingClientRect()
          const playX = (useEditor.getState().time / Math.max(1, tot)) * track.offsetWidth - vp.scrollLeft
          // 目印：ホイールならカーソルの所、それ以外は再生位置（見えていれば）か、まん中
          const ax = anchorX !== undefined ? anchorX - r.left : playX >= 0 && playX <= vp.clientWidth ? playX : vp.clientWidth / 2
          zoomAnchor.current = { ratio: (vp.scrollLeft + ax) / track.offsetWidth, ax }
        }
        // 下限（全体表示）は表示の側で当てはめるので、覚えるのは求められた倍率のまま
        commitTimelineZoom(next)
        if (Math.abs(next - cur) < 1e-9) zoomAnchor.current = null
      }),
    []
  )
  useLayoutEffect(() => {
    const a = zoomAnchor.current
    const vp = scrollRef.current
    const track = trackRef.current
    if (!a || !vp || !track) return
    zoomAnchor.current = null
    vp.scrollLeft = Math.max(0, a.ratio * track.offsetWidth - a.ax)
  }, [trackWidth])
  // Ctrl（Mac は ⌘）＋ホイールで拡大・縮小（トラックパッドのピンチも、ここに届く）
  useEffect(() => {
    const vp = scrollRef.current
    if (!vp) return
    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.deltaY === 0) return
      e.preventDefault()
      requestTimelineZoom({ zoom: zoomLatest.current.zoom * Math.exp(-e.deltaY * 0.0025), anchorX: e.clientX })
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [])
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
  // 線を選んだら（絵の上で選ぶ・前／次の線・線の番号・グループのタップ）、その線を描き始める時刻へ再生位置を移し、
  // タイムラインもその線が見える所まで送る（選んでいる線とタイムラインの表示を連動させる）
  const latest = useRef({ timeline, total })
  latest.current = { timeline, total }
  const lineKey = livePart ? `${livePart.strokeId}:${livePart.part}` : ''
  useEffect(() => {
    if (!livePart) return
    const st = useEditor.getState()
    if (st.playing) return
    const { timeline: tl, total: tot } = latest.current
    const index = st.project.strokes.findIndex((s) => s.id === livePart.strokeId)
    const seg = tl.segments.find((s) => s.index === index)
    if (!seg) return
    const part = seg.prep.parts[livePart.part]
    if (!part) return
    const dur = seg.end - seg.start
    const start = seg.start + dur * (seg.prep.param[part.start] ?? 0)
    const end = seg.start + dur * (seg.prep.param[part.end] ?? 1)
    st.setTime(start)
    const viewport = scrollRef.current
    const track = trackRef.current
    if (!viewport || !track) return
    const x0 = (start / tot) * track.offsetWidth
    const x1 = (end / tot) * track.offsetWidth
    const left = viewport.scrollLeft
    const right = left + viewport.clientWidth
    // すでに見えていれば動かさない。見えていなければ、線の書き始めが左から2割の所に来るように送る
    if (x0 < left + 8 || x1 > right - 8) {
      viewport.scrollTo({ left: Math.max(0, x0 - viewport.clientWidth * 0.2), behavior: 'smooth' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineKey])
  const insertBefore = useEditor((s) => s.insertBefore)
  /** 選んでいる線（選んでいるグループの中の線だけ） */
  const selectedLine = livePart && livePart.strokeId === selectedId ? livePart : null
  /** 線が1本だけのグループを消すときの確認（グループの id） */
  const [confirmLast, setConfirmLast] = useState<string | null>(null)
  const [skipNext, setSkipNext] = useState(false)
  const deleteLine = (): void => {
    if (!selectedLine) return
    const st = useEditor.getState()
    const stroke = st.project.strokes.find((x) => x.id === selectedLine.strokeId)
    if (!stroke) return
    if (strokeParts(stroke).length <= 1 && !readSkip()) {
      setSkipNext(false)
      setConfirmLast(stroke.id)
      return
    }
    st.removeLine(stroke.id, selectedLine.part)
  }

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
    // 直すのブラシで、何も選ばずになぞる＝新しいグループ
    st.setTool('live')
    st.setLiveMode('brush')
    st.setLivePart(null)
    st.notify('再生位置に近いグループの境目へ、新しいグループを追加します。画像をなぞってください')
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

  // 目盛り：表示倍率に合わせて、目盛りどうしが 50px 以上あく刻みにする
  const ticks = useMemo(() => {
    const pps = Math.max(trackWidth, vpW) / Math.max(0.001, sec)
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
    const step = steps.find((x) => x * pps >= 50) ?? 600
    const out: number[] = []
    for (let i = 0; i * step <= sec + 1e-9; i++) out.push(Math.round(i * step * 1000) / 1000)
    return out
  }, [sec, trackWidth, vpW])

  const { setViewMode, select } = useEditor.getState()
  const isPhone = useIsPhone()
  // スマホ：選んだグループの線の番号（下の操作の行の先頭に入れる）
  let partsInline: React.ReactNode = null

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
        style={{ minWidth: `${trackWidth}px` }}
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
              {Number.isInteger(s) ? s : s.toFixed(Math.round(s * 10) === s * 10 ? 1 : 2)}s
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
                  // グループを選ぶと、その最初の線も選ばれる（線は、下の番号か、直すで絵の上をタップして選び直せる）
                  select(stroke.id)
                  useEditor.getState().setLivePart({ strokeId: stroke.id, part: 0 })
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
          {timeline.segments.length === 0 && <div className="track-empty">グループを追加するとここに並びます</div>}
          {drop && <div className="timeline-drop-marker" style={{ left: `${drop.x}%` }} />}
        </div>
        <div className="playhead" style={{ left: `${(time / total) * 100}%` }}>
          <div className="playhead-grip" aria-label="再生位置（なぞって動かす）" {...scrubHandlers} onPointerCancel={scrubHandlers.onPointerUp} />
        </div>
        </div>
        </div>
        <TimelineScrollbar viewport={scrollRef} total={total} />
        {(() => {
          const stroke = selectedId && multiIds.length < 2 ? project.strokes.find((s) => s.id === selectedId) : undefined
          const parts = stroke ? strokeParts(stroke) : []
          if (!stroke || !parts.length) return null
          const buttons = parts.map((_, part) => <button key={part} className={livePart?.strokeId === stroke.id && livePart.part === part ? 'on' : ''} onClick={() => {
                const st = useEditor.getState()
                st.setPlaying(false)
                st.setViewMode('edit')
                st.setTool('live')
                st.setLivePart({ strokeId: stroke.id, part })
              }} aria-label={`${stroke.name} の線 ${part + 1}`} title={`線 ${part + 1} を選ぶ`}>{part + 1}</button>)
          // スマホは縦の場所が足りないので、線の番号は下の操作と同じ1行に並べる（はみ出したら横スクロール）
          if (isPhone) {
            partsInline = (
              <>
                <span className="timeline-parts-label">線 ({parts.length})</span>
                <span className="timeline-parts-list inline">{buttons}</span>
                <span className="tl-divider" aria-hidden="true" />
              </>
            )
            return null
          }
          return <div className="timeline-parts" onPointerDown={(e) => e.stopPropagation()} onPointerMove={(e) => e.stopPropagation()}>
            <span className="timeline-parts-label">線 ({parts.length})</span>
            <ScrollRow className="timeline-parts-list" label={`${stroke.name} の線`}>
              {buttons}
            </ScrollRow>
          </div>
        })()}
        {/* はみ出したら横にスクロール（端に矢印が出る） */}
        <ScrollRow className="timeline-actions" label="タイムラインの操作" onPointerDown={(e) => e.stopPropagation()} onPointerMove={(e) => e.stopPropagation()}>
          {!isPhone && <TimelineZoom zoom={zoom} min={fitZoom} />}
          {partsInline}
          {multiIds.length < 2 && selectedLine && selectedLine.part > 0 && <button className="timeline-insert" title="選んだ線の手前で、グループを2つに分ける（描くタイミングはそのまま）" onClick={() => {
            const st = useEditor.getState()
            st.splitGroup(selectedLine.strokeId, selectedLine.part)
            st.notify('グループを2つに分けました（元に戻す（↶）で取り消せます）')
          }}>ここで分ける</button>}
          <button className={`timeline-insert ${multiMode ? 'on' : ''}`} onClick={() => {
            if (multiMode) { setMultiMode(false); setMultiIds([]) }
            else { setMultiMode(true); setMultiIds(selectedId ? [selectedId] : []) }
          }}>{multiMode ? '複数選択を終了' : '複数選択'}</button>
          {multiIds.length > 1 && <button className="timeline-insert" onClick={() => {
            const st = useEditor.getState()
            if (st.mergeSelectedStrokes(multiIds)) { setMultiIds([]); setMultiMode(false); st.notify('選択したグループを結合しました') }
            else st.notify('連続したグループを選択してください。再生の有無が異なるグループは結合できません')
          }}>{multiIds.length}件を結合</button>}
          <button className={`timeline-insert ${insertBefore ? 'on' : ''}`} onClick={beginInsert} title="再生位置に近いグループの境目に、手描きの新しいグループを追加">
            {insertBefore ? '挿入を取消' : '＋ この位置に描く'}
          </button>
          <button className="timeline-delete" disabled={!selectedLine || multiIds.length > 1} onClick={deleteLine} title="選択した線を削除（元に戻せます）">
            <Icon name="trash" size={16} /> 選択した線を削除
          </button>
          {isPhone && <TimelineZoom zoom={zoom} min={fitZoom} />}
        </ScrollRow>
      </div>
      {menuFor && <StrokeActions strokeId={menuFor} onClose={() => setMenuFor(null)} />}
      {confirmLast && (
        <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setConfirmLast(null)}>
          <div className="modal confirm-modal" role="dialog" aria-modal aria-label="グループを削除">
            <header>
              <h2>グループごと削除します</h2>
            </header>
            <div className="modal-body">
              <p>このグループには線が1本しかないため、線を削除すると、このグループごと削除されます。よろしいですか？（元に戻す（↶）で取り消せます）</p>
              <label className="confirm-skip">
                <input type="checkbox" checked={skipNext} onChange={(e) => setSkipNext(e.target.checked)} /> 次回から表示しない
              </label>
            </div>
            <footer className="modal-footer">
              <button className="btn" onClick={() => setConfirmLast(null)}>キャンセル</button>
              <button
                className="btn danger"
                onClick={() => {
                  if (skipNext) writeSkip()
                  useEditor.getState().removeLine(confirmLast, 0)
                  setConfirmLast(null)
                }}
              >
                削除する
              </button>
            </footer>
          </div>
        </div>
      )}
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

/** 小さい山・大きい山（Photoshop のナビゲーターと同じ印） */
const Mountain = ({ size }: { size: 'small' | 'large' }): React.JSX.Element =>
  size === 'small' ? (
    <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true">
      <path d="M1 9 L5 4 L7.5 6.5 L9.5 4.5 L13 9 Z" fill="currentColor" />
    </svg>
  ) : (
    <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true">
      <path d="M1 13 L8 3 L12 8 L15 5 L21 13 Z" fill="currentColor" />
    </svg>
  )

/**
 * タイムラインの表示倍率（Photoshop のナビゲーターのように：倍率の数値・縮小・スライダー・拡大）。
 * 数値の上でホイール、押して選んで ↑↓ キーでも変えられる。下限は全体が見える倍率
 */
function TimelineZoom({ zoom, min }: { zoom: number; min: number }): React.JSX.Element {
  useShortcutsVersion()
  const max = ZOOM_MAX
  const lo = Math.log(Math.min(min, max))
  const hi = Math.log(max)
  const span = hi - lo
  const pos = span > 0 ? Math.round(((Math.log(zoom) - lo) / span) * 1000) : 0
  const valueRef = useRef<HTMLSpanElement>(null)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const set = (z: number): void => requestTimelineZoom({ zoom: z })
  useEffect(() => {
    const el = valueRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (e.deltaY === 0) return
      e.preventDefault()
      requestTimelineZoom({ zoom: zoomRef.current * (e.deltaY < 0 ? 1.25 : 0.8) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  const pct = zoom * 100
  const label = pct >= 100 ? `${Math.round(pct)}%` : `${pct.toFixed(pct >= 10 ? 1 : 2)}%`
  return (
    <div className="tl-zoom" role="group" aria-label="タイムラインの表示倍率">
      <span
        ref={valueRef}
        className="tl-zoom-value size-value"
        role="spinbutton"
        tabIndex={0}
        aria-label="タイムラインの表示倍率"
        aria-valuenow={Math.round(pct)}
        title="タイムラインの表示倍率：マウスホイール、または押してから ↑↓ キーで変えられます（タイムラインの上で Ctrl＋ホイールでも）"
        onPointerDown={(e) => e.currentTarget.focus()}
        onKeyDown={(e) => {
          const f = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1.25 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? 0.8 : 0
          if (!f) return
          e.preventDefault()
          e.stopPropagation()
          set(zoom * f)
        }}
      >
        {label}
      </span>
      <button className="tl-zoom-btn" title={`縮小${keyHint('timeline.zoomOut')}`} aria-label="タイムラインを縮小" disabled={zoom <= min * 1.001} onClick={() => set(zoom / 1.5)}>
        <Mountain size="small" />
      </button>
      <input
        className="tl-zoom-range"
        type="range"
        min={0}
        max={1000}
        value={pos}
        disabled={span <= 0}
        style={{ '--fill': `${pos / 10}%` } as React.CSSProperties}
        aria-label="タイムラインの表示倍率"
        title={`ドラッグで拡大・縮小。左端で全体表示${keyHint('timeline.fit')}`}
        onChange={(e) => set(Math.exp(lo + (Number(e.target.value) / 1000) * span))}
      />
      <button className="tl-zoom-btn" title={`拡大${keyHint('timeline.zoomIn')}`} aria-label="タイムラインを拡大" disabled={zoom >= max * 0.999} onClick={() => set(zoom * 1.5)}>
        <Mountain size="large" />
      </button>
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
