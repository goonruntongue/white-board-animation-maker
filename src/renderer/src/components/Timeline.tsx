import { useMemo, useRef, useState } from 'react'
import { rewind, togglePlay } from '../commands'
import { formatTime } from '../engine/project'
import { buildTimeline } from '../engine/wb-engine'
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
  const timeline = useMemo(() => buildTimeline(project), [project])
  const total = Math.max(1, timeline.total)
  const trackRef = useRef<HTMLDivElement>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)

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
      <div
        className="track-area"
        ref={trackRef}
        onPointerDown={(e) => {
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          seekTo(e.clientX)
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) seekTo(e.clientX)
        }}
      >
        <div className="ruler">
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
                selected={stroke.id === selectedId}
                onSelect={() => select(stroke.id)}
                onDoubleClick={() => seekTo(clientXAt(trackRef.current, seg.start / total))}
                onMenu={() => {
                  select(stroke.id)
                  setMenuFor(stroke.id)
                }}
              />
            )
          })}
          {timeline.segments.length === 0 && <div className="track-empty">軌跡を追加するとここに並びます</div>}
        </div>
        <div className="playhead" style={{ left: `${(time / total) * 100}%` }} />
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
  onSelect: () => void
  onDoubleClick: () => void
  onMenu: () => void
}): React.JSX.Element {
  const lp = useLongPress(props.onMenu)
  return (
    <div
      className={`clip ${props.selected ? 'selected' : ''}`}
      style={{ left: `${props.left}%`, width: `${props.width}%`, backgroundColor: props.color }}
      title={`${props.index + 1}. ${props.name}（長押し・右クリックでメニュー）`}
      {...lp.handlers}
      onPointerDown={(e) => {
        // 時間軸のシーク（親の pointerdown）にさせない
        e.stopPropagation()
        props.onSelect()
        lp.handlers.onPointerDown(e)
      }}
      onDoubleClick={props.onDoubleClick}
    >
      <span>{props.index + 1}</span>
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
