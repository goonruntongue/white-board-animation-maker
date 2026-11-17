import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { captureImage, importImageDialog, importSampleImage, openAutoTrace } from '../commands'
import { appendToStroke, simplifyPoints, strokeFromRecording } from '../engine/project'
import { hitPart, strokeParts, transformPart } from '../engine/strokeParts'
import { addEraserMark, combine, flattenShapes, isDegenerate, normalizeBox, type SelectionOp } from '../engine/selection'
import type { ClipShape, Stroke, StrokePoint } from '../engine/types'
import { buildTimeline, rasterizeClip, traceClipShape, WBRenderer } from '../engine/wb-engine'
import { CANVAS_FONT_FAMILY } from '../fonts'
import { useAssets } from '../lib/useAssets'
import { haptic, useIsPhone } from '../lib/useMedia'
import { SELECTION_TOOLS, useEditor } from '../store'
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
  /** 描き足し先の軌跡（なければ新しい軌跡になる） */
  appendTo?: string
}

interface PanDrag {
  pointerId: number
  sx: number
  sy: number
  vx: number
  vy: number
}

type Pt = { x: number; y: number }

/** 作成途中の選択範囲 */
type Draft =
  | { kind: 'rect' | 'ellipse'; op: SelectionOp; pointerId: number; start: Pt; cur: Pt }
  | {
      kind: 'lasso'
      op: SelectionOp
      points: Pt[]
      /** 押している間のポインタ（多角形モードで離している間は null） */
      pointerId: number | null
      downClient: Pt
      /** ドラッグで自由に描いているか（false ならクリックで頂点を打つ多角形モード） */
      freehand: boolean
    }

const PADDING = 40
const PADDING_SMALL = 14 // スマホなど狭い画面
const LOUPE = 128 // ルーペの直径（画面px）
const LOUPE_ZOOM = 2.2 // ルーペの拡大率（いまの表示に対して）

/** 2本指操作（ピンチでズーム・ドラッグで移動）の開始時の状態 */
interface Pinch {
  dist0: number
  mid0: Pt
  zoom0: number
  /** 開始時に2本指の中点の下にあった画像上の点 */
  imgPt: Pt
}
const DRAG_THRESHOLD = 4 // 画面px。これ未満の移動はクリックとみなす
const CLOSE_RADIUS = 9 // 画面px。多角形の始点にこれだけ近づいたら閉じる

function distToSegment(px: number, py: number, a: Pt, b: Pt): number {
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
    for (let k = 1; k < pts.length; k++) {
      if (pts[k].b) continue // ペンを上げて移動しただけの区間は線ではない
      if (distToSegment(x, y, pts[k - 1], pts[k]) <= r) return s
    }
  }
  return null
}

/** Shift=追加 / Alt=除外 / Shift+Alt=交差（Photoshop と同じ）。修飾キーがなければオプションバーのモード */
/** ポインタを要素に固定する（端末やタイミングによって失敗しても操作は続ける） */
function capture(e: React.PointerEvent): void {
  try {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  } catch {
    /* 既に離れたポインタなど */
  }
}

function opFromEvent(e: { shiftKey: boolean; altKey: boolean }, mode: SelectionOp): SelectionOp {
  if (e.shiftKey && e.altKey) return 'intersect'
  if (e.altKey) return 'subtract'
  if (e.shiftKey) return 'add'
  return mode
}

function draftShape(d: Draft): ClipShape | null {
  if (d.kind === 'lasso') return { kind: 'poly', mode: 'add', points: d.points }
  return normalizeBox({ kind: d.kind, mode: 'add' as const, x: d.start.x, y: d.start.y, w: d.cur.x - d.start.x, h: d.cur.y - d.start.y })
}

export function Stage({ onZoomChange }: { onZoomChange: (z: number) => void }): React.JSX.Element {
  const project = useEditor((s) => s.project)
  const tool = useEditor((s) => s.tool)
  const time = useEditor((s) => s.time)
  const viewMode = useEditor((s) => s.viewMode)
  const selectedId = useEditor((s) => s.selectedId)
  const rerecordId = useEditor((s) => s.rerecordId)
  const selection = useEditor((s) => s.selection)
  const livePart = useEditor((s) => s.livePart)
  const liveMode = useEditor((s) => s.liveMode)
  /** ライブ編集で線をドラッグして動かしている途中（動かす前の軌跡を持っておき、そこからのずれで動かす） */
  const liveDrag = useRef<{ pointerId: number; start: Pt; startClient: Pt; stroke: Stroke; part: number; moved: boolean; key: string } | null>(null)
  const assets = useAssets(project)
  const image = project.image

  const containerRef = useRef<HTMLDivElement>(null)
  const renderCanvasRef = useRef<HTMLCanvasElement>(null)
  const dimRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<WBRenderer | null>(null)
  const recording = useRef<Recording | null>(null)
  // 消しゴムでなぞっている途中の線
  const erasing = useRef<{ pointerId: number; points: Pt[] } | null>(null)
  const panDrag = useRef<PanDrag | null>(null)
  // タッチ操作：画面に触れている指、ピンチ中の状態、ピンチ後に指が離れきるまで描画を止めるフラグ
  const touches = useRef(new Map<number, Pt>())
  const pinch = useRef<Pinch | null>(null)
  const gestureLock = useRef(false)
  const draft = useRef<Draft | null>(null)
  const cursor = useRef<Pt | null>(null)
  const loupeRef = useRef<HTMLCanvasElement>(null)
  const isPhone = useIsPhone()
  const antsOffset = useRef(0)
  const scratch = useRef<HTMLCanvasElement | null>(null)
  const [hasDraft, setHasDraft] = useState(false)

  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 })

  const imgW = image?.width ?? 1920
  const imgH = image?.height ?? 1080
  const pad = size.w < 640 ? PADDING_SMALL : PADDING
  const fit = Math.max(0.01, Math.min((size.w - pad * 2) / imgW, (size.h - pad * 2) / imgH))
  const scale = fit * view.zoom
  const dispW = imgW * scale
  const dispH = imgH * scale
  const left = (size.w - dispW) / 2 + view.x
  const top = (size.h - dispH) / 2 + view.y
  const isSelTool = SELECTION_TOOLS.includes(tool)

  const timeline = useMemo(() => buildTimeline(project), [project])
  const selMask = useMemo(() => (selection && image ? rasterizeClip(selection, imgW, imgH) : null), [selection, image, imgW, imgH])
  const selectedStroke = project.strokes.find((s) => s.id === selectedId)
  const selectedClipMask = useMemo(
    () => (selectedStroke?.clip && image ? rasterizeClip(selectedStroke.clip, imgW, imgH) : null),
    [selectedStroke?.clip, image, imgW, imgH]
  )

  const liveErasing = tool === 'live' && liveMode === 'erase'
  // ライブ編集：選んだ線を描き終えた瞬間の絵を見せる（線の太さを変えると、その線の見え方がその場で変わる）。
  // 線を選んでいないときは、全部描き終えた直後（最後に全体をふわっと出す前）＝ペンで見える範囲だけの絵
  const live = tool === 'live' && viewMode === 'edit'
  const liveTime = useMemo(() => {
    if (!livePart) return timeline.drawEnd
    const idx = project.strokes.findIndex((s) => s.id === livePart.strokeId)
    const seg = timeline.segments.find((g) => g.index === idx)
    const part = idx >= 0 ? strokeParts(project.strokes[idx])[livePart.part] : undefined
    if (!seg || !part) return timeline.drawEnd
    return seg.start + (seg.end - seg.start) * (seg.prep.param[part.end] ?? 1)
  }, [livePart, project.strokes, timeline])

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

  // ツールを切り替えたら作成途中の選択はやめる
  useEffect(() => {
    draft.current = null
    setHasDraft(false)
  }, [tool])

  // ---- レンダラー（プレビュー／カバレッジ表示） ----
  useEffect(() => {
    const canvas = renderCanvasRef.current
    if (!canvas || !image) {
      rendererRef.current = null
      return
    }
    if (!rendererRef.current || rendererRef.current.canvas !== canvas) {
      rendererRef.current = new WBRenderer(canvas, project, assets)
    } else {
      rendererRef.current.setAssets(assets)
      rendererRef.current.setProject(project)
    }
  }, [project, assets, image])

  useEffect(() => {
    const r = rendererRef.current
    if (!r || !image) return
    if (viewMode === 'preview') r.renderAt(time)
    else if (live) r.renderAt(liveTime, { hand: false })
    // 編集表示：なぞった範囲（＝最終的に見える範囲）を全描画して、欠けを確認しやすくする
    else r.renderAt(timeline.total, { hand: false, background: false })
  }, [project, assets, time, viewMode, image, timeline, live, liveTime])

  // ---- 選択範囲の外を暗くする層 ----
  useEffect(() => {
    const c = dimRef.current
    if (!c || !image) return
    if (c.width !== imgW) c.width = imgW
    if (c.height !== imgH) c.height = imgH
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, imgW, imgH)
    if (!selMask || viewMode !== 'edit') return
    ctx.fillStyle = 'rgba(12, 18, 32, 0.42)'
    ctx.fillRect(0, 0, imgW, imgH)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.drawImage(selMask, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
  }, [selMask, viewMode, image, imgW, imgH])

  /** 範囲で切り抜いた帯を描く（録画中の線・選択中の軌跡の幅表示） */
  const drawClippedBand = useCallback(
    (ctx: CanvasRenderingContext2D, pts: StrokePoint[], width: number, color: string, mask: CanvasImageSource | null, partWidths = false) => {
      if (!mask) {
        ctx.strokeStyle = color
        ctx.lineWidth = width
        polyline(ctx, pts, partWidths ? width : undefined)
        return
      }
      let sc = scratch.current
      if (!sc) sc = scratch.current = document.createElement('canvas')
      if (sc.width !== imgW) sc.width = imgW
      if (sc.height !== imgH) sc.height = imgH
      const s = sc.getContext('2d')!
      s.clearRect(0, 0, imgW, imgH)
      s.lineCap = 'round'
      s.lineJoin = 'round'
      s.strokeStyle = color
      s.lineWidth = width
      polyline(s, pts, partWidths ? width : undefined)
      s.globalCompositeOperation = 'destination-in'
      s.drawImage(mask, 0, 0)
      s.globalCompositeOperation = 'source-over'
      ctx.drawImage(sc, 0, 0)
    },
    [imgW, imgH]
  )

  // ---- オーバーレイ（軌跡・番号・録画中の線・選択範囲・ブラシカーソル） ----
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

    // ライブ編集：選んだ線のペンの太さ（見える範囲）を薄く重ね、中心線を引く
    if (live && livePart) {
      const s = project.strokes.find((x) => x.id === livePart.strokeId)
      const part = s ? strokeParts(s)[livePart.part] : undefined
      if (s && part) {
        const pts = s.points.slice(part.start, part.end + 1).map((p, i) => (i === 0 ? { x: p.x, y: p.y } : p))
        ctx.strokeStyle = 'rgba(255, 122, 26, 0.28)'
        ctx.lineWidth = part.width
        polyline(ctx, pts)
        ctx.strokeStyle = 'rgba(255, 122, 26, 0.95)'
        ctx.lineWidth = 2 * px
        polyline(ctx, pts)
        ctx.fillStyle = '#ff7a1a'
        ctx.beginPath()
        ctx.arc(pts[0].x, pts[0].y, 4.5 * px, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    if (viewMode === 'edit' && !live) {
      project.strokes.forEach((s, i) => {
        if (s.points.length === 0) return
        const selected = s.id === selectedId
        const replacing = s.id === rerecordId
        if (selected) drawClippedBand(ctx, s.points, s.revealWidth, s.color + '40', selectedClipMask, true)
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
        ctx.font = `700 ${11 * px}px ${CANVAS_FONT_FAMILY}`
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
      const target = rec.appendTo ? project.strokes.find((s) => s.id === rec.appendTo) : undefined
      // 描き足しは、描き足し先の軌跡の色で見せる（範囲の制限も、その軌跡のものを使う）
      drawClippedBand(ctx, rec.points, w, target ? target.color + '55' : 'rgba(31,111,235,0.32)', target ? selectedClipMask : selMask)
      ctx.strokeStyle = target ? target.color : '#1f6feb'
      ctx.lineWidth = 2 * px
      polyline(ctx, rec.points)
    }

    // 消しゴムでなぞっている線
    const er = erasing.current
    if (er && er.points.length) {
      const w = useEditor.getState().project.settings.eraserWidth
      ctx.strokeStyle = 'rgba(255, 70, 70, 0.4)'
      ctx.lineWidth = w
      polyline(ctx, er.points)
      ctx.strokeStyle = 'rgba(255, 70, 70, 0.9)'
      ctx.lineWidth = 1.5 * px
      polyline(ctx, er.points)
    }

    // 選択範囲の点線（動く点線）
    if (viewMode === 'edit') {
      if (selection) for (const shape of flattenShapes(selection)) drawAnts(ctx, shape, imgW, imgH, px, antsOffset.current)
      const d = draft.current
      if (d) {
        const shape = draftShape(d)
        if (shape) {
          if (d.kind === 'lasso') drawAntsPath(ctx, d.points, false, px, antsOffset.current)
          else drawAnts(ctx, shape, imgW, imgH, px, antsOffset.current)
        }
        // 多角形モード：カーソルまでの仮の辺と、始点の目印
        if (d.kind === 'lasso' && !d.freehand && d.points.length) {
          const cur = cursor.current
          if (cur) drawAntsPath(ctx, [d.points[d.points.length - 1], cur], false, px, antsOffset.current)
          const p0 = d.points[0]
          const near = cur && Math.hypot(cur.x - p0.x, cur.y - p0.y) <= CLOSE_RADIUS * px && d.points.length >= 3
          ctx.fillStyle = near ? '#ffd43b' : '#fff'
          ctx.strokeStyle = '#000'
          ctx.lineWidth = 1 * px
          ctx.beginPath()
          ctx.arc(p0.x, p0.y, (near ? 6 : 4) * px, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        }
      }
    }

    const cur = cursor.current
    if (cur && (tool === 'draw' || tool === 'erase' || liveErasing) && viewMode === 'edit') {
      const erasing = tool === 'erase' || liveErasing
      const w = erasing ? project.settings.eraserWidth : project.settings.defaultRevealWidth
      if (erasing) ctx.setLineDash([4 * px, 3 * px])
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'
      ctx.lineWidth = 1 * px
      ctx.beginPath()
      ctx.arc(cur.x, cur.y, w / 2, 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      ctx.beginPath()
      ctx.arc(cur.x, cur.y, w / 2 + px, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }, [image, imgW, imgH, scale, viewMode, project, selectedId, rerecordId, tool, selection, selMask, selectedClipMask, drawClippedBand, live, livePart, liveErasing])

  useEffect(() => drawOverlay(), [drawOverlay])

  // 選択範囲があるあいだ、点線を動かす
  useEffect(() => {
    if ((!selection && !hasDraft) || viewMode !== 'edit') return
    const id = setInterval(() => {
      antsOffset.current = (antsOffset.current + 1) % 1000
      if (!recording.current) drawOverlay()
    }, 90)
    return () => clearInterval(id)
  }, [selection, hasDraft, viewMode, drawOverlay])

  // ---- 選択範囲の確定 ----
  const finishDraft = useCallback(() => {
    const d = draft.current
    draft.current = null
    setHasDraft(false)
    if (!d) return
    const st = useEditor.getState()
    const shape = draftShape(d)
    if (!shape || isDegenerate(shape)) {
      // クリックしただけなら選択解除（Photoshop と同じ）
      if (d.op === 'new') st.setSelection(null)
      drawOverlay()
      return
    }
    st.setSelection(combine(st.selection, shape, d.op))
    haptic()
  }, [drawOverlay])

  // 多角形投げ縄の Enter（確定）/ Esc（取り消し）/ Backspace（1つ戻る）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const d = draft.current
      if (!d || d.kind !== 'lasso' || d.freehand) return
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopImmediatePropagation()
        finishDraft()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        draft.current = null
        setHasDraft(false)
        drawOverlay()
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        e.stopImmediatePropagation()
        d.points.pop()
        if (d.points.length === 0) {
          draft.current = null
          setHasDraft(false)
        }
        drawOverlay()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [finishDraft, drawOverlay])

  // ---- 座標変換 ----
  const toImage = (clientX: number, clientY: number): Pt => {
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

  // ---- 2本指のピンチ・移動（スマホ・タブレット） ----
  const containerPoint = (pt: Pt): Pt => {
    const rect = containerRef.current!.getBoundingClientRect()
    return { x: pt.x - rect.left, y: pt.y - rect.top }
  }

  // ---- ルーペ：指でなぞると指先が隠れるので、指の上に拡大表示する ----
  const showLoupe = (clientX: number, clientY: number): void => {
    const lc = loupeRef.current
    const container = containerRef.current
    if (!lc || !container || !image) return
    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const size = Math.round(LOUPE * dpr)
    if (lc.width !== size) lc.width = lc.height = size
    const ctx = lc.getContext('2d')!
    const p = toImage(clientX, clientY)
    const half = LOUPE / 2 / (scale * LOUPE_ZOOM) // 画像上で見せる範囲（半径）
    const sx = p.x - half
    const sy = p.y - half
    const sw = half * 2
    ctx.save()
    ctx.clearRect(0, 0, size, size)
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2 - dpr, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = project.settings.boardColor
    ctx.fillRect(0, 0, size, size)
    const layer = (src: CanvasImageSource | null | undefined, alpha = 1): void => {
      if (!src) return
      ctx.globalAlpha = alpha
      ctx.drawImage(src, sx, sy, sw, sw, 0, 0, size, size)
    }
    if (viewMode === 'edit') layer(assets.image, 0.22)
    layer(renderCanvasRef.current)
    layer(dimRef.current)
    layer(overlayRef.current)
    ctx.globalAlpha = 1
    // 中心の十字（ペン先の位置）
    ctx.strokeStyle = 'rgba(255,90,31,0.95)'
    ctx.lineWidth = 1.5 * dpr
    const c = size / 2
    const r = 7 * dpr
    ctx.beginPath()
    ctx.moveTo(c - r, c)
    ctx.lineTo(c + r, c)
    ctx.moveTo(c, c - r)
    ctx.lineTo(c, c + r)
    ctx.stroke()
    ctx.restore()
    // 指の左上に出す（上が足りなければ下へ）。画面からはみ出さないように寄せる
    const fx = clientX - rect.left
    const fy = clientY - rect.top
    let x = fx - LOUPE * 0.75
    let y = fy - LOUPE - 36
    if (y < 6) y = fy + 40
    x = Math.max(6, Math.min(rect.width - LOUPE - 6, x))
    lc.style.transform = `translate(${x}px, ${y}px)`
    lc.style.display = 'block'
  }
  const hideLoupe = (): void => {
    if (loupeRef.current) loupeRef.current.style.display = 'none'
  }

  const startPinch = (): void => {
    hideLoupe()
    const [a, b] = [...touches.current.values()]
    // 1本目の指で始めていた線や選択は取り消す（ピンチのつもりの誤描画を防ぐ）
    recording.current = null
    erasing.current = null
    const d = draft.current
    if (d && d.pointerId !== null) {
      if (d.kind === 'lasso' && !d.freehand && d.points.length > 1) {
        d.points.pop()
        d.pointerId = null
      } else {
        draft.current = null
        setHasDraft(false)
      }
    }
    panDrag.current = null
    gestureLock.current = true
    const mid = containerPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    const scale0 = fit * view.zoom
    const left0 = (size.w - imgW * scale0) / 2 + view.x
    const top0 = (size.h - imgH * scale0) / 2 + view.y
    pinch.current = {
      dist0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      mid0: mid,
      zoom0: view.zoom,
      imgPt: { x: (mid.x - left0) / scale0, y: (mid.y - top0) / scale0 }
    }
    drawOverlay()
  }

  const updatePinch = (): void => {
    const pz = pinch.current
    if (!pz) return
    const [a, b] = [...touches.current.values()]
    const mid = containerPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    const zoom = Math.max(0.1, Math.min(12, (pz.zoom0 * Math.hypot(a.x - b.x, a.y - b.y)) / pz.dist0))
    const newScale = fit * zoom
    // 指の中点の下に、最初と同じ画像上の点が来るように動かす
    const newLeft = mid.x - pz.imgPt.x * newScale
    const newTop = mid.y - pz.imgPt.y * newScale
    setView({ zoom, x: newLeft - (size.w - imgW * newScale) / 2, y: newTop - (size.h - imgH * newScale) / 2 })
  }

  // ---- ポインタ操作 ----
  const onPointerDown = (e: React.PointerEvent): void => {
    // ステージ上のボタンへのタップを描画として扱うと、ポインタ捕捉によって
    // ボタンのクリックが失われ、短い軌跡まで追加されてしまう。
    if (e.target instanceof Element && e.target.closest('button, a, input, select, textarea, [role="button"]')) return
    if (!image) return
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      capture(e)
      if (touches.current.size === 2) {
        startPinch()
        return
      }
      if (touches.current.size > 2 || gestureLock.current) return
    }
    const st = useEditor.getState()
    // 選択ツールでは Alt は「除外」に使うので、移動は中ボタン／移動ツールのみ
    const wantsPan = e.button === 1 || tool === 'pan' || (e.button === 0 && e.altKey && !isSelTool)
    if (wantsPan) {
      e.preventDefault()
      panDrag.current = { pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }
      capture(e)
      return
    }
    if (e.button !== 0) return
    const p = toImage(e.clientX, e.clientY)

    if (isSelTool) {
      if (st.playing) st.setPlaying(false)
      if (st.viewMode !== 'edit') st.setViewMode('edit')
      capture(e)
      const d = draft.current
      if (tool === 'lasso' && d && d.kind === 'lasso' && !d.freehand) {
        // 多角形モード：頂点を追加。始点の近くなら閉じる
        const p0 = d.points[0]
        if (d.points.length >= 3 && Math.hypot(p.x - p0.x, p.y - p0.y) <= CLOSE_RADIUS / scale) {
          finishDraft()
          return
        }
        d.points.push(p)
        d.pointerId = e.pointerId
        d.downClient = { x: e.clientX, y: e.clientY }
        drawOverlay()
        return
      }
      const op = opFromEvent(e, st.selectionMode)
      if (tool === 'lasso') {
        draft.current = { kind: 'lasso', op, points: [p], pointerId: e.pointerId, downClient: { x: e.clientX, y: e.clientY }, freehand: false }
      } else {
        draft.current = { kind: tool as 'rect' | 'ellipse', op, pointerId: e.pointerId, start: p, cur: p }
      }
      setHasDraft(true)
      drawOverlay()
      return
    }

    if (tool === 'erase') {
      if (st.playing) st.setPlaying(false)
      if (st.viewMode !== 'edit') st.setViewMode('edit')
      erasing.current = { pointerId: e.pointerId, points: [p] }
      capture(e)
      if (e.pointerType === 'touch') requestAnimationFrame(() => showLoupe(e.clientX, e.clientY))
      drawOverlay()
      return
    }

    if (tool === 'draw') {
      if (st.playing) st.setPlaying(false)
      if (st.viewMode !== 'edit') st.setViewMode('edit')
      // Shift＋ドラッグ、または「描き足す」がオンのときは、選んでいる軌跡に描き足す
      const wantAppend = !st.rerecordId && (e.shiftKey || st.appendMode)
      const appendTo = wantAppend ? st.project.strokes.find((s) => s.id === st.selectedId)?.id : undefined
      if (st.appendMode && !e.shiftKey && !appendTo && !st.rerecordId) {
        st.notify('描き足す軌跡を選んでください（描き順・タイムライン・「選ぶ」ツールから）', 'error')
        return
      }
      recording.current = { pointerId: e.pointerId, start: e.timeStamp, points: [{ ...p, t: 0 }], appendTo }
      if (e.pointerType === 'touch') requestAnimationFrame(() => showLoupe(e.clientX, e.clientY))
      capture(e)
      drawOverlay()
    } else if (tool === 'select') {
      // 指でのタップは当たり判定を広めにする
      const hit = hitStroke(project.strokes, p.x, p.y, (e.pointerType === 'touch' ? 18 : 8) / scale)
      st.select(hit?.id ?? null)
    } else if (tool === 'live') {
      if (st.viewMode !== 'edit') st.setViewMode('edit')
      if (st.liveMode === 'erase') {
        // 消しゴム：選んでいる線の軌跡を消す（線を選んでいなければ、消し始めの所にある線の軌跡）
        if (!st.livePart) {
          const hit = hitPart(project.strokes, p.x, p.y, Math.max(st.project.settings.eraserWidth / 2, (e.pointerType === 'touch' ? 14 : 5) / scale))
          if (hit) st.setLivePart(hit)
        }
        erasing.current = { pointerId: e.pointerId, points: [p] }
        capture(e)
        if (e.pointerType === 'touch') requestAnimationFrame(() => showLoupe(e.clientX, e.clientY))
        drawOverlay()
        return
      }
      // タップした所にある線を選ぶ（何もない所なら選択を外す）。そのままドラッグすると、その線を動かす
      const hit = hitPart(project.strokes, p.x, p.y, (e.pointerType === 'touch' ? 14 : 5) / scale)
      st.setLivePart(hit)
      if (hit) {
        haptic()
        const stroke = st.project.strokes.find((x) => x.id === hit.strokeId)!
        liveDrag.current = { pointerId: e.pointerId, start: p, startClient: { x: e.clientX, y: e.clientY }, stroke, part: hit.part, moved: false, key: `livemove:${Date.now()}` }
        capture(e)
      }
    }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!image) return
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pinch.current && touches.current.size >= 2) {
        updatePinch()
        return
      }
      if (gestureLock.current) return
    }
    const pan = panDrag.current
    if (pan && pan.pointerId === e.pointerId) {
      setView((v) => ({ ...v, x: pan.vx + e.clientX - pan.sx, y: pan.vy + e.clientY - pan.sy }))
      return
    }
    const p = toImage(e.clientX, e.clientY)
    const ld = liveDrag.current
    if (ld && ld.pointerId === e.pointerId) {
      // 少し動かしてから（タップのつもりの小さなぶれでは動かさない）
      if (!ld.moved && Math.hypot(e.clientX - ld.startClient.x, e.clientY - ld.startClient.y) < DRAG_THRESHOLD * 2) return
      ld.moved = true
      const dx = p.x - ld.start.x
      const dy = p.y - ld.start.y
      const moved = transformPart(ld.stroke, ld.part, dx, dy)
      useEditor.getState().commit((proj) => ({ ...proj, strokes: proj.strokes.map((s) => (s.id === ld.stroke.id ? { ...s, points: moved.points } : s)) }), ld.key)
      return
    }
    const d = draft.current
    if (d) {
      if (d.kind !== 'lasso') {
        if (d.pointerId === e.pointerId) d.cur = p
      } else if (d.pointerId === e.pointerId) {
        // 押したまま動かしたら自由な投げ縄
        if (!d.freehand && d.points.length === 1 && Math.hypot(e.clientX - d.downClient.x, e.clientY - d.downClient.y) >= DRAG_THRESHOLD) {
          d.freehand = true
        }
        if (d.freehand) {
          const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : []
          for (const ev of events.length ? events : [e.nativeEvent]) d.points.push(toImage(ev.clientX, ev.clientY))
        }
      }
    }
    const er = erasing.current
    if (er && er.pointerId === e.pointerId) {
      const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : []
      for (const ev of events.length ? events : [e.nativeEvent]) er.points.push(toImage(ev.clientX, ev.clientY))
    }
    const rec = recording.current
    if (rec && rec.pointerId === e.pointerId) {
      const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : []
      const list = events.length ? events : [e.nativeEvent]
      for (const ev of list) {
        const q = toImage(ev.clientX, ev.clientY)
        rec.points.push({ x: q.x, y: q.y, t: ev.timeStamp - rec.start })
      }
    }
    cursor.current = e.pointerType === 'touch' ? null : p
    drawOverlay()
    const held =
      recording.current?.pointerId === e.pointerId ||
      draft.current?.pointerId === e.pointerId ||
      erasing.current?.pointerId === e.pointerId
    if (e.pointerType === 'touch' && held) showLoupe(e.clientX, e.clientY)
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    hideLoupe()
    if (e.pointerType === 'touch') {
      touches.current.delete(e.pointerId)
      if (touches.current.size < 2) pinch.current = null
      if (gestureLock.current) {
        // ピンチの指がすべて離れるまでは描画・選択を再開しない
        if (touches.current.size === 0) gestureLock.current = false
        return
      }
    }
    if (panDrag.current?.pointerId === e.pointerId) {
      panDrag.current = null
      return
    }
    const d = draft.current
    if (d && d.pointerId === e.pointerId) {
      if (d.kind === 'lasso' && !d.freehand) {
        // クリックだった：多角形モードを続ける（頂点はクリックごとに追加）
        d.pointerId = null
        drawOverlay()
        return
      }
      finishDraft()
      return
    }
    const ld = liveDrag.current
    if (ld && ld.pointerId === e.pointerId) {
      liveDrag.current = null
      if (ld.moved) haptic()
      return
    }
    const er = erasing.current
    if (er && er.pointerId === e.pointerId) {
      erasing.current = null
      finishErase(er.points)
      drawOverlay()
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
        const prev = st.project.strokes.find((s) => s.id === st.rerecordId)
        st.updateStroke(st.rerecordId, {
          points: pts,
          duration: Math.max(300, Math.round(recorded)),
          // 選択範囲があればそれを使い、なければ元の範囲を残す
          clip: st.selection ?? prev?.clip
        })
        st.select(st.rerecordId)
        st.setRerecord(null)
        st.notify('軌跡を録り直しました')
      } else if (rec.appendTo) {
        const target = st.project.strokes.find((s) => s.id === rec.appendTo)
        if (target) {
          st.updateStroke(target.id, appendToStroke(target, rec.points, st.project.settings.defaultRevealWidth))
          st.select(target.id)
          haptic()
        }
      } else {
        st.addStroke(strokeFromRecording(st.project, rec.points, st.project.strokes.length, st.selection))
        haptic()
      }
    }
    drawOverlay()
  }

  /** 消しゴムの線を、選んでいる軌跡（なければ書き始めの位置にある軌跡）の表示範囲から除外する */
  const finishErase = (raw: Pt[]): void => {
    const st = useEditor.getState()
    const w = st.project.settings.eraserWidth
    const target =
      st.project.strokes.find((s) => s.id === st.selectedId) ?? hitStroke(st.project.strokes, raw[0].x, raw[0].y, w / 2)
    if (!target) {
      st.notify('消しゴムをかける軌跡を選んでください（「選ぶ」ツール・描き順・タイムラインから）', 'error')
      return
    }
    // 近すぎる点を間引く
    const pts: Pt[] = []
    for (const p of raw) {
      const last = pts[pts.length - 1]
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 1.5) pts.push({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })
    }
    st.updateStroke(target.id, { clip: addEraserMark(target.clip, pts, w) })
    st.select(target.id)
    haptic()
  }

  const popVertex = (): void => {
    const d = draft.current
    if (!d || d.kind !== 'lasso') return
    d.points.pop()
    if (d.points.length === 0) {
      draft.current = null
      setHasDraft(false)
    }
    drawOverlay()
  }
  const cancelDraft = (): void => {
    draft.current = null
    setHasDraft(false)
    drawOverlay()
  }

  const onDoubleClick = (): void => {
    const d = draft.current
    if (d && d.kind === 'lasso' && !d.freehand) {
      // ダブルクリックの2回目で打たれた重複点を除いて確定
      const n = d.points.length
      if (n >= 2 && Math.hypot(d.points[n - 1].x - d.points[n - 2].x, d.points[n - 1].y - d.points[n - 2].y) < 1) d.points.pop()
      finishDraft()
    }
  }

  const onPointerLeave = (): void => {
    cursor.current = null
    drawOverlay()
  }

  const cursorClass = !image
    ? ''
    : tool === 'pan' || panDrag.current
      ? 'cur-grab'
      : (tool === 'draw' || tool === 'erase' || liveErasing) && viewMode === 'edit'
        ? 'cur-none'
        : tool === 'select' || tool === 'live'
          ? 'cur-default'
          : 'cur-crosshair'

  const lassoPolyActive = hasDraft && draft.current?.kind === 'lasso' && !draft.current.freehand

  return (
    <div
      ref={containerRef}
      className={`stage ${cursorClass}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
      onDoubleClick={onDoubleClick}
      onAuxClick={(e) => e.preventDefault()}
    >
      {!image ? (
        <div className="empty-state">
          <div className="empty-card">
            <div className="empty-icon">
              <Icon name="upload" size={34} />
            </div>
            <h2>画像を読み込む</h2>
            <p>{isPhone ? 'PNG / JPEG / WebP、またはカメラで撮影' : 'PNG / JPEG / WebP をここにドラッグ＆ドロップ'}</p>
            <div className="empty-actions">
              <button className="btn primary" data-tour="import" onClick={() => void importImageDialog()}>
                <Icon name="image" /> 画像を選ぶ
              </button>
              <button className="btn" onClick={() => void importSampleImage()}>
                サンプル画像を使う
              </button>
              {isPhone && (
                <button className="btn" onClick={() => void captureImage()}>
                  <Icon name="camera" /> 写真を撮る
                </button>
              )}
            </div>
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
          <canvas ref={dimRef} className="layer" />
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
      {image && !rerecordId && lassoPolyActive && (
        <div className="stage-banner info lasso-banner">
          <span>
            {isPhone ? 'タップで頂点を追加 ・ 始点をタップで確定' : 'クリックで頂点を追加 ・ 始点クリック / ダブルクリック / Enter で確定'}
          </span>
          <span className="banner-actions">
            <button className="btn small" onClick={popVertex}>
              1つ戻る
            </button>
            <button className="btn small" onClick={cancelDraft}>
              取消
            </button>
            <button className="btn small primary" onClick={finishDraft}>
              確定
            </button>
          </span>
        </div>
      )}
      {image && !rerecordId && !lassoPolyActive && selection && viewMode === 'edit' && (
        <div className="stage-banner info" title="この状態で描いた軌跡に、選択範囲が記録されます">
          <span>{isPhone ? '範囲を選択中' : '選択範囲の中だけ表示されます'}</span>
          <button className="btn small primary" data-tour={isPhone ? 'auto-phone' : undefined} onClick={openAutoTrace}>
            <Icon name="sparkle" size={13} /> 自動で作る
          </button>
          <button className="btn small" onClick={() => useEditor.getState().setSelection(null)}>
            {isPhone ? '解除' : '選択解除 (Ctrl+D)'}
          </button>
        </div>
      )}
      <canvas ref={loupeRef} className="loupe" style={{ width: LOUPE, height: LOUPE, display: 'none' }} aria-hidden />
      {image && isPhone && !rerecordId && !selection && !lassoPolyActive && viewMode === 'edit' && (
        <div className="coach-chip">
          <span>
            <Icon name="pen" size={14} /> 描き順を作る
          </span>
          <button className="btn small primary" data-tour="auto-phone" onClick={openAutoTrace}>
            <Icon name="sparkle" size={13} /> 自動で作る
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

/**
 * 点列を線で描く。b（ペンを上げる）の点で線を切り、つなぎ目は描かない。
 * baseWidth を渡すと、描き足した部分の太さ（w）も反映する。
 */
function polyline(ctx: CanvasRenderingContext2D, pts: (Pt & { b?: 1; w?: number })[], baseWidth?: number): void {
  if (pts.length === 0) return
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  ctx.lineTo(pts[0].x + 0.01, pts[0].y)
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]
    if (p.b) {
      ctx.stroke()
      if (baseWidth !== undefined) ctx.lineWidth = p.w ?? baseWidth
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.x + 0.01, p.y)
      continue
    }
    ctx.lineTo(p.x, p.y)
  }
  ctx.stroke()
}

/** 白黒の動く点線で図形の輪郭を描く */
function drawAnts(ctx: CanvasRenderingContext2D, shape: ClipShape, w: number, h: number, px: number, offset: number): void {
  if (shape.kind === 'region' || shape.kind === 'stroke' || shape.kind === 'rle') return
  ctx.save()
  if (shape.kind === 'all') {
    // 画像の縁の内側に描いて、点線が見えるようにする
    ctx.beginPath()
    ctx.rect(px, px, w - 2 * px, h - 2 * px)
  } else {
    traceClipShape(ctx, shape, w, h)
  }
  strokeAnts(ctx, px, offset, shape.mode !== 'add')
  ctx.restore()
}

function drawAntsPath(ctx: CanvasRenderingContext2D, pts: Pt[], close: boolean, px: number, offset: number): void {
  if (pts.length < 2) return
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  if (close) ctx.closePath()
  strokeAnts(ctx, px, offset, false)
  ctx.restore()
}

function strokeAnts(ctx: CanvasRenderingContext2D, px: number, offset: number, subtract: boolean): void {
  ctx.lineWidth = 1.2 * px
  ctx.setLineDash([])
  ctx.strokeStyle = subtract ? 'rgba(255,120,120,0.95)' : '#fff'
  ctx.stroke()
  ctx.setLineDash([5 * px, 4 * px])
  ctx.lineDashOffset = -offset * px
  ctx.strokeStyle = '#000'
  ctx.stroke()
}

