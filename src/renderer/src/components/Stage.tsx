import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { importImageDialog } from '../commands'
import { simplifyPoints, strokeFromRecording } from '../engine/project'
import type { Stroke, StrokePoint } from '../engine/types'
import { buildTimeline, WBRenderer } from '../engine/wb-engine'
import { useAssets } from '../lib/useAssets'
import { useEditor } from '../store'
import { Icon } from './Icon'

interface View {
  zoom: number
  x: number
  y: number
}

interface Recording {
  pointerId: number
  start: number
  points: StrokePoint[]
}

interface PanDrag {
  pointerId: number
  sx: number
  sy: number
  vx: number
  vy: number
}

const PADDING = 40

function distToSegment(px: number, py: number, a: StrokePoint, b: StrokePoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t))
}

function hitStroke(strokes: Stroke[], x: number, y: number, tolerance: number): Stroke | null {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i]
    const r = Math.max(s.revealWidth / 2, tolerance)
    const pts = s.points
    if (pts.length === 1 && Math.hypot(pts[0].x - x, pts[0].y - y) <= r) return s
    for (let k = 1; k < pts.length; k++) if (distToSegment(x, y, pts[k - 1], pts[k]) <= r) return s
  }
  return null
}

export function Stage({ onZoomChange }: { onZoomChange: (z: number) => void }): React.JSX.Element {
  const project = useEditor((s) => s.project)
  const tool = useEditor((s) => s.tool)
  const time = useEditor((s) => s.time)
  const viewMode = useEditor((s) => s.viewMode)
  const selectedId = useEditor((s) => s.selectedId)
  const rerecordId = useEditor((s) => s.rerecordId)
  const assets = useAssets(project)
  const image = project.image

  const containerRef = useRef<HTMLDivElement>(null)
  const renderCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<WBRenderer | null>(null)
  const recording = useRef<Recording | null>(null)
  const panDrag = useRef<PanDrag | null>(null)
  const cursor = useRef<{ x: number; y: number } | null>(null)

  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 })

  const imgW = image?.width ?? 1920
  const imgH = image?.height ?? 1080
  const fit = Math.max(0.01, Math.min((size.w - PADDING * 2) / imgW, (size.h - PADDING * 2) / imgH))
  const scale = fit * view.zoom
  const dispW = imgW * scale
  const dispH = imgH * scale
  const left = (size.w - dispW) / 2 + view.x
  const top = (size.h - dispH) / 2 + view.y

  const timeline = useMemo(() => buildTimeline(project), [project])

  useEffect(() => onZoomChange(scale), [scale, onZoomChange])

  // 画像が変わったら表示をリセット
  useEffect(() => setView({ zoom: 1, x: 0, y: 0 }), [image?.dataUrl])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // ---- レンダラー（プレビュー／カバレッジ表示） ----
  useEffect(() => {
    const canvas = renderCanvasRef.current
    if (!canvas || !image) {
      rendererRef.current = null
      return
    }
    if (!rendererRef.current || rendererRef.current.canvas !== canvas) {
      rendererRef.current = new WBRenderer(canvas, project, assets)
    }
    else {
      rendererRef.current.setAssets(assets)
      rendererRef.current.setProject(project)
    }
  }, [project, assets, image])

  useEffect(() => {
    const r = rendererRef.current
    if (!r || !image) return
    if (viewMode === 'preview') r.renderAt(time)
    // 編集表示：なぞった範囲（＝最終的に見える範囲）を全描画して、欠けを確認しやすくする
    else r.renderAt(timeline.total, { hand: false, background: false })
  }, [project, assets, time, viewMode, image, timeline])

  // ---- オーバーレイ（軌跡の中心線・番号・録画中の線・ブラシカーソル） ----
  const drawOverlay = useCallback(() => {
    const c = overlayRef.current
    if (!c || !image) return
    if (c.width !== imgW) c.width = imgW
    if (c.height !== imgH) c.height = imgH
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, imgW, imgH)
    const px = 1 / scale // 画面上の1px
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (viewMode === 'edit') {
      project.strokes.forEach((s, i) => {
        if (s.points.length === 0) return
        const selected = s.id === selectedId
        const replacing = s.id === rerecordId
        if (selected) {
          ctx.strokeStyle = s.color + '40'
          ctx.lineWidth = s.revealWidth
          polyline(ctx, s.points)
        }
        ctx.setLineDash(s.hidden || replacing ? [6 * px, 5 * px] : [])
        ctx.strokeStyle = s.hidden ? '#8a8f98' : s.color
        ctx.globalAlpha = s.hidden ? 0.6 : 1
        ctx.lineWidth = (selected ? 3 : 1.8) * px
        polyline(ctx, s.points)
        ctx.setLineDash([])
        ctx.globalAlpha = 1
        // 始点の番号
        const p0 = s.points[0]
        const r = 9 * px
        ctx.fillStyle = s.hidden ? '#8a8f98' : s.color
        ctx.beginPath()
        ctx.arc(p0.x, p0.y, r, 0, Math.PI * 2)
        ctx.fill()
        if (selected) {
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 2 * px
          ctx.stroke()
        }
        ctx.fillStyle = '#fff'
        ctx.font = `600 ${11 * px}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(i + 1), p0.x, p0.y + 0.5 * px)
        // 終点
        const pN = s.points[s.points.length - 1]
        ctx.fillStyle = s.hidden ? '#8a8f98' : s.color
        ctx.beginPath()
        ctx.arc(pN.x, pN.y, 3.5 * px, 0, Math.PI * 2)
        ctx.fill()
      })
    }

    const rec = recording.current
    if (rec && rec.points.length) {
      const w = useEditor.getState().project.settings.defaultRevealWidth
      ctx.strokeStyle = 'rgba(31,111,235,0.28)'
      ctx.lineWidth = w
      polyline(ctx, rec.points)
      ctx.strokeStyle = '#1f6feb'
      ctx.lineWidth = 2 * px
      polyline(ctx, rec.points)
    }

    const cur = cursor.current
    if (cur && tool === 'draw' && viewMode === 'edit') {
      const w = project.settings.defaultRevealWidth
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'
      ctx.lineWidth = 1 * px
      ctx.beginPath()
      ctx.arc(cur.x, cur.y, w / 2, 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      ctx.beginPath()
      ctx.arc(cur.x, cur.y, w / 2 + px, 0, Math.PI * 2)
      ctx.stroke()
    }
  }, [image, imgW, imgH, scale, viewMode, project, selectedId, rerecordId, tool])

  useEffect(() => drawOverlay(), [drawOverlay])

  // ---- 座標変換 ----
  const toImage = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = overlayRef.current!.getBoundingClientRect()
    return { x: ((clientX - rect.left) / rect.width) * imgW, y: ((clientY - rect.top) / rect.height) * imgH }
  }

  // ---- ホイールでズーム（カーソル位置を中心に） ----
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!image) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      setView((v) => {
        const oldScale = fit * v.zoom
        const zoom = Math.max(0.1, Math.min(12, v.zoom * Math.exp(-e.deltaY * 0.0015)))
        const newScale = fit * zoom
        const oldLeft = (size.w - imgW * oldScale) / 2 + v.x
        const oldTop = (size.h - imgH * oldScale) / 2 + v.y
        const ix = (mx - oldLeft) / oldScale
        const iy = (my - oldTop) / oldScale
        const newLeft = mx - ix * newScale
        const newTop = my - iy * newScale
        return { zoom, x: newLeft - (size.w - imgW * newScale) / 2, y: newTop - (size.h - imgH * newScale) / 2 }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [image, fit, size, imgW, imgH])

  // ---- ポインタ操作 ----
  const onPointerDown = (e: React.PointerEvent): void => {
    if (!image) return
    const st = useEditor.getState()
    const wantsPan = e.button === 1 || tool === 'pan' || (e.button === 0 && e.altKey)
    if (wantsPan) {
      e.preventDefault()
      panDrag.current = { pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return
    const p = toImage(e.clientX, e.clientY)
    if (tool === 'draw') {
      if (st.playing) st.setPlaying(false)
      if (st.viewMode !== 'edit') st.setViewMode('edit')
      recording.current = { pointerId: e.pointerId, start: e.timeStamp, points: [{ ...p, t: 0 }] }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      drawOverlay()
    } else if (tool === 'select') {
      const hit = hitStroke(project.strokes, p.x, p.y, 8 / scale)
      st.select(hit?.id ?? null)
    }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!image) return
    const pan = panDrag.current
    if (pan && pan.pointerId === e.pointerId) {
      setView((v) => ({ ...v, x: pan.vx + e.clientX - pan.sx, y: pan.vy + e.clientY - pan.sy }))
      return
    }
    const rec = recording.current
    if (rec && rec.pointerId === e.pointerId) {
      const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : []
      const list = events.length ? events : [e.nativeEvent]
      for (const ev of list) {
        const p = toImage(ev.clientX, ev.clientY)
        rec.points.push({ x: p.x, y: p.y, t: ev.timeStamp - rec.start })
      }
    }
    cursor.current = toImage(e.clientX, e.clientY)
    drawOverlay()
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    if (panDrag.current?.pointerId === e.pointerId) {
      panDrag.current = null
      return
    }
    const rec = recording.current
    if (!rec || rec.pointerId !== e.pointerId) return
    recording.current = null
    const st = useEditor.getState()
    if (rec.points.length > 0) {
      if (st.rerecordId) {
        const pts = simplifyPoints(rec.points)
        const recorded = pts.length > 1 ? pts[pts.length - 1].t - pts[0].t : 0
        st.updateStroke(st.rerecordId, { points: pts, duration: Math.max(300, Math.round(recorded)) })
        st.select(st.rerecordId)
        st.setRerecord(null)
        st.notify('軌跡を録り直しました')
      } else {
        st.addStroke(strokeFromRecording(st.project, rec.points, st.project.strokes.length))
      }
    }
    drawOverlay()
  }

  const onPointerLeave = (): void => {
    cursor.current = null
    drawOverlay()
  }

  const cursorClass = !image
    ? ''
    : tool === 'pan' || panDrag.current
      ? 'cur-grab'
      : tool === 'draw' && viewMode === 'edit'
        ? 'cur-none'
        : tool === 'select'
          ? 'cur-default'
          : 'cur-crosshair'

  return (
    <div
      ref={containerRef}
      className={`stage ${cursorClass}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
      onAuxClick={(e) => e.preventDefault()}
    >
      {!image ? (
        <div className="empty-state">
          <div className="empty-card">
            <div className="empty-icon">
              <Icon name="upload" size={34} />
            </div>
            <h2>ホワイトボード清書画像を読み込む</h2>
            <p>PNG / JPEG / WebP をここにドラッグ＆ドロップ</p>
            <button className="btn primary" onClick={() => void importImageDialog()}>
              <Icon name="image" /> 画像を選択…
            </button>
            <ol className="steps">
              <li>画像を読み込む</li>
              <li>「描く」ツールで描き順をなぞる</li>
              <li>再生して確認・調整</li>
              <li>HTML / 動画として書き出す</li>
            </ol>
          </div>
        </div>
      ) : (
        <div
          className="artboard"
          style={{ left, top, width: dispW, height: dispH, background: project.settings.boardColor }}
        >
          {viewMode === 'edit' && <img className="layer trace" src={image.dataUrl} alt="" draggable={false} />}
          <canvas ref={renderCanvasRef} className="layer" />
          <canvas ref={overlayRef} className="layer" />
        </div>
      )}
      {image && rerecordId && (
        <div className="stage-banner">
          録り直し中：{project.strokes.find((s) => s.id === rerecordId)?.name} をなぞってください
          <button className="btn small" onClick={() => useEditor.getState().setRerecord(null)}>
            キャンセル
          </button>
        </div>
      )}
      {image && (
        <div className="stage-tools">
          <button className="icon-btn" title="画面に合わせる" onClick={() => setView({ zoom: 1, x: 0, y: 0 })}>
            <Icon name="fit" />
          </button>
        </div>
      )}
    </div>
  )
}

function polyline(ctx: CanvasRenderingContext2D, pts: StrokePoint[]): void {
  if (pts.length === 0) return
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.stroke()
}
