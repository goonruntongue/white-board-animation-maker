import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { captureImage, importImageDialog, importSampleImage, openAutoTrace, togglePlay } from '../commands'
import { appendToStroke, simplifyPoints, strokeFromRecording } from '../engine/project'
import { getAutoSelect } from '../lib/autoSelect'
import { getBrushTarget } from '../lib/brushTarget'
import { getPathTool } from '../lib/pathTool'
import { hitPart, replaceStrokePart, strokeParts, transformPart, transformStroke } from '../engine/strokeParts'
import { fitPath, fitTolerance, insertAnchor, nearestOnPath, partPoints, removeAnchor, type PathNode } from '../engine/pathEdit'
import { revealLine, updatePathNodes } from '../livePath'
import { addEraserMark, addRevealMark, combine, flattenShapes, isDegenerate, normalizeBox, untagClipLines, type SelectionOp } from '../engine/selection'
import type { ClipShape, Stroke, StrokePoint } from '../engine/types'
import { buildTimeline, clipForLine, hasLineClips, rasterizeClip, traceClipShape, WBRenderer } from '../engine/wb-engine'
import { CANVAS_FONT_FAMILY } from '../fonts'
import { useAssets } from '../lib/useAssets'
import { haptic, useIsPhone } from '../lib/useMedia'
import { SELECTION_TOOLS, useEditor } from '../store'
import { Icon } from './Icon'
import { PathPalette } from './PathPalette'
import { RangeButton } from './phone/RangeButton'

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
  /** ライブ編集の「ブラシで足す」：描き足すうえに、なぞった所を軌跡の表示範囲にも加える */
  liveBrush?: boolean
  /** ブラシの「描き直す」：appendTo のグループの、この番号の線を置き換える */
  redoPart?: number
  /** 何も選ばずにブラシで続けて書いた線：直前に描いたグループへ入れる（選択はしない） */
  chain?: boolean
}

/** 続けて書いた線を同じグループにまとめる条件：前の線を書き終えてからの時間と、書き始めの近さ（画像の対角線に対する割合） */

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
/** 再生の層の内部解像度の段階（画像の大きさに対する倍率） */
const RENDER_LEVELS = [0.25, 0.375, 0.5, 0.625, 0.75, 1]
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
  const rerecordPart = useEditor((s) => s.rerecordPart)
  const selection = useEditor((s) => s.selection)
  const livePart = useEditor((s) => s.livePart)
  const liveMode = useEditor((s) => s.liveMode)
  const liveUnit = useEditor((s) => s.liveUnit)
  const livePath = useEditor((s) => s.livePath)
  /** パス編集でアンカー・ハンドルをドラッグしている途中 */
  /** パス編集のダブルクリック（ダブルタップ）判定用：前回押した時刻と画面上の位置 */
  const lastTap = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 })
  const pathDrag = useRef<{
    pointerId: number
    /** pull：アンカーポイントの切り替えで、アンカーからハンドルを引き出す */
    kind: 'anchor' | 'in' | 'out' | 'pull'
    index: number
    start: Pt
    startClient: Pt
    moved: boolean
    nodes: PathNode[]
    alt: boolean
    key: string
  } | null>(null)
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
  /** スマホの「描き順を作る」案内を閉じたか（画像を読み込み直したら、また出す） */
  const [coachClosed, setCoachClosed] = useState(false)
  /** スマホの絵の左下に、再生ボタンを出すか（描き直し中は出さない） */
  const quickBar = useEditor((s) => !s.rerecordId)
  const playingNow = useEditor((s) => s.playing)
  const timelineHidden = useEditor((s) => s.timelineHidden)

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
  // 拡大縮小・移動の途中は、画像の大きさや解像度は作り直さず、決まった表示（settled）を CSS の変形で
  // 動かすだけにする（大きなキャンバスの作り直し・描き直しを毎コマ行うと、スマホでは固まる）。
  // 指を離して少し経ったら、いまの表示で作り直す
  const [settled, setSettled] = useState<View>(view)
  const gesturing = useRef(false)
  const sScale = fit * settled.zoom
  const sLeft = (size.w - imgW * sScale) / 2 + settled.x
  const sTop = (size.h - imgH * sScale) / 2 + settled.y
  const viewMoving = settled !== view
  useEffect(() => {
    if (settled === view) return
    const id = window.setTimeout(() => {
      if (!gesturing.current) setSettled(view)
    }, 180)
    return () => window.clearTimeout(id)
  }, [view, settled])
  const isSelTool = SELECTION_TOOLS.includes(tool)

  const timeline = useMemo(() => buildTimeline(project), [project])
  const selMask = useMemo(() => (selection && image ? rasterizeClip(selection, imgW, imgH) : null), [selection, image, imgW, imgH])
  const selectedStroke = project.strokes.find((s) => s.id === selectedId)
  const selectedClipMask = useMemo(
    () => (selectedStroke?.clip && image ? rasterizeGroupClip(selectedStroke, imgW, imgH) : null),
    [selectedStroke?.clip, selectedStroke?.points, image, imgW, imgH]
  )
  const liveStroke = project.strokes.find((s) => s.id === livePart?.strokeId)
  // 手描きでは、選んでいる線に効く範囲を見せる（線ごとの消しゴムの跡を含む）
  const liveClipMask = useMemo(
    () => (liveStroke?.clip && image ? rasterizeClip(clipForLine(liveStroke.clip, livePart?.part ?? 0), imgW, imgH) : null),
    [liveStroke?.clip, livePart?.part, image, imgW, imgH]
  )

  const liveErasing = tool === 'live' && liveMode === 'erase'
  const liveBrushing = tool === 'live' && liveMode === 'brush'
  const livePathing = tool === 'live' && liveMode === 'path'
  /** 軌跡まるごとで扱うか（パス編集はいつも1本の線） */
  const liveWhole = liveUnit === 'stroke' && liveMode !== 'path'
  // ライブ編集：選んだ線を描き終えた瞬間の絵を見せる（線の太さを変えると、その線の見え方がその場で変わる）。
  // 線を選んでいないときは、全部描き終えた直後（最後に全体をふわっと出す前）＝ペンで見える範囲だけの絵
  const live = tool === 'live' && viewMode === 'edit'
  const liveTime = useMemo(() => {
    if (!livePart) return timeline.drawEnd
    const idx = project.strokes.findIndex((s) => s.id === livePart.strokeId)
    const seg = timeline.segments.find((g) => g.index === idx)
    const part = idx >= 0 ? strokeParts(project.strokes[idx])[livePart.part] : undefined
    if (!seg || !part) return timeline.drawEnd
    // 軌跡ごとのときは、その軌跡を描き終えた瞬間
    if (liveWhole) return seg.end
    return seg.start + (seg.end - seg.start) * (seg.prep.param[part.end] ?? 1)
  }, [livePart, liveWhole, project.strokes, timeline])

  // パス編集：選んだ線から曲線（アンカーとハンドル）を作る。元に戻すなどで線が変わったときも作り直す
  useEffect(() => {
    if (!livePathing || !livePart) return
    const st = useEditor.getState()
    const stroke = project.strokes.find((s) => s.id === livePart.strokeId)
    if (!stroke || !strokeParts(stroke)[livePart.part]) {
      if (st.livePath) st.setLivePath(null)
      return
    }
    const lp = st.livePath
    if (lp && lp.strokeId === stroke.id && lp.part === livePart.part && lp.pointsRef === stroke.points) return
    const nodes = fitPath(partPoints(stroke, livePart.part), fitTolerance(stroke, livePart.part))
    st.setLivePath({ strokeId: stroke.id, part: livePart.part, nodes, pointsRef: stroke.points, selected: null })
  }, [livePathing, livePart, project.strokes])

  useEffect(() => onZoomChange(scale), [scale, onZoomChange])

  // 画像が変わったら表示をリセット
  useEffect(() => {
    setView({ zoom: 1, x: 0, y: 0 })
    setCoachClosed(false)
  }, [image?.dataUrl])

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
  // 内部の解像度：画面に見える細かさまで下げる（スマホで画像を等倍で描くと、メモリも時間も足りなくなる）。
  // 拡大すると段階的に上がる。画素密度は2倍までで十分（それ以上は見た目がほぼ変わらない）
  const renderScale = useMemo(() => {
    const need = sScale * Math.min(2, window.devicePixelRatio || 1)
    return RENDER_LEVELS.find((l) => l >= need) ?? 1
  }, [sScale])

  useEffect(() => {
    const canvas = renderCanvasRef.current
    if (!canvas || !image) {
      rendererRef.current = null
      return
    }
    if (!rendererRef.current || rendererRef.current.canvas !== canvas) {
      rendererRef.current = new WBRenderer(canvas, project, assets, { scale: renderScale })
    } else {
      rendererRef.current.setAssets(assets)
      rendererRef.current.setScale(renderScale)
      rendererRef.current.setProject(project)
    }
  }, [project, assets, image, renderScale])

  // 描き直しは1コマに1回まとめる（スライダーやドラッグで続けて変わっても、描くのは最後の状態だけ）。
  // 予約済みの描画は取り消さず、中身だけ最新に差し替える（取り消すと、再生中のように毎コマ変わるときに
  // 一度も描かれなくなる）
  const renderFrame = useRef(0)
  const renderJob = useRef<(() => void) | null>(null)
  useEffect(
    () => () => {
      cancelAnimationFrame(renderFrame.current)
      renderFrame.current = 0
    },
    []
  )
  useEffect(() => {
    renderJob.current = () => {
    const r = rendererRef.current
    if (!r || !image) return
    if (viewMode === 'preview') r.renderAt(time)
    else if (rerecordId && rerecordPart !== null) {
      const index = project.strokes.findIndex((s) => s.id === rerecordId)
      const seg = timeline.segments.find((s) => s.index === index)
      const part = index >= 0 ? strokeParts(project.strokes[index])[rerecordPart] : undefined
      const start = seg && part ? seg.start + (seg.end - seg.start) * (seg.prep.param[part.start] ?? 0) : 0
      r.renderAt(Math.max(0, start - 0.01), { hand: false, background: false })
    }
    // ライブ編集：背景を塗らずに重ね、まだ見えていない（マスクされている）所は下の薄い下絵で見せる＝下絵をなぞりやすい
    else if (live) r.renderAt(liveTime, { hand: false, background: false })
    // 編集表示：なぞった範囲（＝最終的に見える範囲）を全描画して、欠けを確認しやすくする
    else r.renderAt(timeline.total, { hand: false, background: false })
    }
    if (!renderFrame.current) {
      renderFrame.current = requestAnimationFrame(() => {
        renderFrame.current = 0
        renderJob.current?.()
      })
    }
  }, [project, assets, time, viewMode, image, timeline, live, liveTime, rerecordId, rerecordPart, renderScale])

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
    const px = 1 / sScale // 画面上の1px（キャンバスを作り直した時点の表示で）
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // ライブ編集：選んだ線のペンの太さ（見える範囲）を薄く重ね、中心線を引く
    if (live && livePart) {
      const s = project.strokes.find((x) => x.id === livePart.strokeId)
      const part = s ? strokeParts(s)[livePart.part] : undefined
      if (s && liveWhole) {
        // 軌跡まるごと：線ごとの太さで、ペンが通る範囲を重ねる
        drawClippedBand(ctx, s.points, s.revealWidth, 'rgba(255, 122, 26, 0.28)', liveClipMask, true)
        ctx.strokeStyle = 'rgba(255, 122, 26, 0.95)'
        ctx.lineWidth = 2 * px
        polyline(ctx, s.points)
        ctx.fillStyle = '#ff7a1a'
        ctx.beginPath()
        ctx.arc(s.points[0].x, s.points[0].y, 4.5 * px, 0, Math.PI * 2)
        ctx.fill()
      } else if (s && part) {
        const pts = s.points.slice(part.start, part.end + 1).map((p, i) => (i === 0 ? { ...p, move: false } : p))
        drawClippedBand(ctx, pts, part.width, 'rgba(255, 122, 26, 0.28)', liveClipMask)
        ctx.strokeStyle = 'rgba(255, 122, 26, 0.95)'
        ctx.lineWidth = 2 * px
        polyline(ctx, pts)
        ctx.fillStyle = '#ff7a1a'
        ctx.beginPath()
        ctx.arc(pts[0].x, pts[0].y, 4.5 * px, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // パス編集：曲線、アンカー（四角）、選んだアンカーと両どなりのハンドル
    if (live && livePathing && livePath && livePart && livePath.strokeId === livePart.strokeId && livePath.part === livePart.part) {
      const nodes = livePath.nodes
      ctx.strokeStyle = '#1f6feb'
      ctx.lineWidth = 2 * px
      ctx.beginPath()
      ctx.moveTo(nodes[0].x, nodes[0].y)
      for (let i = 0; i + 1 < nodes.length; i++) ctx.bezierCurveTo(nodes[i].outX, nodes[i].outY, nodes[i + 1].inX, nodes[i + 1].inY, nodes[i + 1].x, nodes[i + 1].y)
      ctx.stroke()
      const sel = livePath.selected
      if (sel !== null) {
        const handles: { n: PathNode; hx: number; hy: number }[] = []
        const add = (i: number, side: 'in' | 'out'): void => {
          const n = nodes[i]
          if (!n || (side === 'in' && i === 0) || (side === 'out' && i === nodes.length - 1)) return
          handles.push({ n, hx: side === 'in' ? n.inX : n.outX, hy: side === 'in' ? n.inY : n.outY })
        }
        add(sel, 'in')
        add(sel, 'out')
        add(sel - 1, 'out')
        add(sel + 1, 'in')
        for (const h of handles) {
          ctx.strokeStyle = 'rgba(31,111,235,0.85)'
          ctx.lineWidth = 1.2 * px
          ctx.beginPath()
          ctx.moveTo(h.n.x, h.n.y)
          ctx.lineTo(h.hx, h.hy)
          ctx.stroke()
          ctx.fillStyle = '#fff'
          ctx.beginPath()
          ctx.arc(h.hx, h.hy, 4 * px, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        }
      }
      nodes.forEach((n, i) => {
        const r = (i === sel ? 5 : 4) * px
        ctx.fillStyle = i === sel ? '#1f6feb' : '#fff'
        ctx.strokeStyle = '#1f6feb'
        ctx.lineWidth = 1.5 * px
        ctx.fillRect(n.x - r, n.y - r, r * 2, r * 2)
        ctx.strokeRect(n.x - r, n.y - r, r * 2, r * 2)
      })
    }

    if (viewMode === 'edit' && !live && !rerecordId) {
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
      const replacing = rerecordId && rerecordPart !== null ? project.strokes.find((s) => s.id === rerecordId) : undefined
      const w = replacing ? (strokeParts(replacing)[rerecordPart!]?.width ?? replacing.revealWidth) : useEditor.getState().project.settings.defaultRevealWidth
      const target = rec.appendTo ? project.strokes.find((s) => s.id === rec.appendTo) : undefined
      // 描き足しは、描き足し先の軌跡の色で見せる（範囲の制限も、その軌跡のものを使う）
      // ブラシで足すときは、範囲を広げるので制限なしで見せる
      if (replacing && assets.image) {
        let sc = scratch.current
        if (!sc) sc = scratch.current = document.createElement('canvas')
        if (sc.width !== imgW) sc.width = imgW
        if (sc.height !== imgH) sc.height = imgH
        const s = sc.getContext('2d')!
        s.clearRect(0, 0, imgW, imgH)
        s.lineCap = 'round'
        s.lineJoin = 'round'
        s.strokeStyle = '#000'
        s.lineWidth = w
        polyline(s, rec.points)
        s.globalCompositeOperation = 'source-in'
        s.drawImage(assets.image, 0, 0, imgW, imgH)
        s.globalCompositeOperation = 'source-over'
        ctx.drawImage(sc, 0, 0)
      } else {
        drawClippedBand(ctx, rec.points, w, target ? target.color + '55' : 'rgba(31,111,235,0.32)', rec.liveBrush ? null : target ? selectedClipMask : selMask)
        ctx.strokeStyle = target ? target.color : '#1f6feb'
        ctx.lineWidth = 2 * px
        polyline(ctx, rec.points)
      }
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
    if (cur && (tool === 'draw' || tool === 'erase' || liveErasing || liveBrushing) && viewMode === 'edit') {
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
  }, [image, assets.image, imgW, imgH, sScale, viewMode, project, selectedId, rerecordId, rerecordPart, tool, selection, selMask, selectedClipMask, liveClipMask, drawClippedBand, live, livePart, liveErasing, liveBrushing, liveWhole, livePathing, livePath])

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
    // k：その層の画素数が画像の何倍か（再生の層は内部の解像度を下げている）
    const layer = (src: CanvasImageSource | null | undefined, alpha = 1, k = 1): void => {
      if (!src) return
      ctx.globalAlpha = alpha
      ctx.drawImage(src, sx * k, sy * k, sw * k, sw * k, 0, 0, size, size)
    }
    if (viewMode === 'edit') layer(assets.image, 0.22)
    layer(renderCanvasRef.current, 1, rendererRef.current?.scale ?? 1)
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
  /**
   * パス編集のドラッグ中：動かしたアンカーが描き直されてから拡大鏡を更新する（1フレームに1回）。
   * 指を離したあとに遅れて出ないよう、まだつまんでいるときだけ出す
   */
  const loupeFrame = useRef(0)
  const loupeSoon = (pointerId: number, clientX: number, clientY: number): void => {
    cancelAnimationFrame(loupeFrame.current)
    loupeFrame.current = requestAnimationFrame(() => {
      if (pathDrag.current?.pointerId === pointerId) showLoupe(clientX, clientY)
    })
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
    gesturing.current = true
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
    if (e.target instanceof Element && e.target.closest('button, a, input, select, textarea, [role="button"], .path-palette')) return
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
      // PC：Shift＋ドラッグで、選んでいる軌跡に描き足す（軌跡に線を足すのは、ふだんは「直す」の「ブラシで足す」で行う）
      const wantAppend = !st.rerecordId && e.shiftKey
      const appendTo = wantAppend ? st.project.strokes.find((s) => s.id === st.selectedId)?.id : undefined
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
        // 線が決まらなければ消さない（前に選んでいたグループ全体に効いてしまわないように）
        if (!st.livePart || !st.project.strokes.some((x) => x.id === st.livePart!.strokeId)) {
          const hit = hitPart(project.strokes, p.x, p.y, Math.max(st.project.settings.eraserWidth / 2, (e.pointerType === 'touch' ? 14 : 5) / scale))
          if (!hit) {
            st.notify('消す線を選んでください（線の上から消し始めると、その線を選びます）', 'error')
            return
          }
          st.setLivePart(hit)
        }
        erasing.current = { pointerId: e.pointerId, points: [p] }
        capture(e)
        if (e.pointerType === 'touch') requestAnimationFrame(() => showLoupe(e.clientX, e.clientY))
        drawOverlay()
        return
      }
      if (st.liveMode === 'path') {
        const lp = st.livePath
        const R = (e.pointerType === 'touch' ? 16 : 8) / scale
        if (lp && st.livePart && lp.strokeId === st.livePart.strokeId && lp.part === st.livePart.part) {
          // ハンドル（選んだアンカーと両どなり）→ アンカーの順に当たりを調べる
          const nodes = lp.nodes
          const sel = lp.selected
          const ptool = getPathTool()
          // アンカーポイントの追加・削除：アンカーの上なら消し、線の上ならアンカーを足す（それ以外は何もしない）
          if (ptool === 'addDel') {
            let hitAnchor = -1
            let best = R
            for (let i = 0; i < nodes.length; i++) {
              const d = Math.hypot(nodes[i].x - p.x, nodes[i].y - p.y)
              if (d <= best) {
                best = d
                hitAnchor = i
              }
            }
            if (hitAnchor >= 0) {
              if (nodes.length <= 2) st.notify('アンカーが2つしかないので、これ以上は消せません', 'error')
              else {
                updatePathNodes(removeAnchor(nodes, hitAnchor), undefined, null)
                haptic()
              }
              return
            }
            const near = nearestOnPath(nodes, p.x, p.y)
            if (near && near.dist <= R * 1.5) {
              updatePathNodes(insertAnchor(nodes, near.seg, near.t), undefined, near.seg + 1)
              haptic()
            }
            return
          }
          // ハンドルとアンカーのうち、押した所にいちばん近いものをつかむ（縮小表示で重なっていても、狙ったものが取れるように）
          let grab: { kind: 'anchor' | 'in' | 'out'; index: number } | null = null
          let grabDist = R
          if (sel !== null) {
            const cand: { kind: 'in' | 'out'; index: number }[] = [
              { kind: 'in', index: sel },
              { kind: 'out', index: sel },
              { kind: 'out', index: sel - 1 },
              { kind: 'in', index: sel + 1 }
            ]
            for (const c of cand) {
              const n = nodes[c.index]
              if (!n || (c.kind === 'in' && c.index === 0) || (c.kind === 'out' && c.index === nodes.length - 1)) continue
              const hx = c.kind === 'in' ? n.inX : n.outX
              const hy = c.kind === 'in' ? n.inY : n.outY
              const d = Math.hypot(hx - p.x, hy - p.y)
              if (d <= grabDist && Math.hypot(hx - n.x, hy - n.y) > 0.5) {
                grab = c
                grabDist = d
              }
            }
          }
          for (let i = 0; i < nodes.length; i++) {
            const d = Math.hypot(nodes[i].x - p.x, nodes[i].y - p.y)
            // 同じ近さならハンドルを優先（アンカーの真上に重なったハンドルも引き出せるように）
            if (d < grabDist || (d <= grabDist && !grab)) {
              grabDist = d
              grab = { kind: 'anchor', index: i }
            }
          }
          if (grab) {
            st.setLivePath({ ...lp, selected: grab.kind === 'anchor' ? grab.index : lp.selected })
            // アンカーポイントの切り替え：アンカーからはハンドルを引き出す（押すだけなら角にする）。ハンドルは片側だけ動かす
            const convert = ptool === 'convert'
            const kind = convert && grab.kind === 'anchor' ? 'pull' : grab.kind
            pathDrag.current = {
              pointerId: e.pointerId,
              kind,
              index: grab.index,
              start: p,
              startClient: { x: e.clientX, y: e.clientY },
              moved: false,
              nodes,
              alt: e.altKey || convert,
              key: `path:${Date.now()}`
            }
            capture(e)
            // 指でつまんだアンカー・ハンドルは指に隠れるので、拡大鏡で見せる
            if (e.pointerType === 'touch') loupeSoon(e.pointerId, e.clientX, e.clientY)
            return
          }
          // 線の上をダブルクリック（ダブルタップ）：アンカーを足す
          // pointerdown の detail は回数を持たないので、前回押した時刻と位置で判定する
          const prevTap = lastTap.current
          const isDouble = ptool === 'direct' && e.timeStamp - prevTap.time < 400 && Math.hypot(e.clientX - prevTap.x, e.clientY - prevTap.y) < 12
          lastTap.current = { time: isDouble ? 0 : e.timeStamp, x: e.clientX, y: e.clientY }
          const near = nearestOnPath(nodes, p.x, p.y)
          if (near && near.dist <= R * 1.5) {
            if (isDouble) {
              updatePathNodes(insertAnchor(nodes, near.seg, near.t), undefined, near.seg + 1)
              haptic()
            } else st.setLivePath({ ...lp, selected: null })
            return
          }
        }
        // 線を選んでいるときは、ほかの線へ選び替えない（選んでいる線のパスだけを直す）。
        // 線の外を押したら、アンカーの選択だけ外す。何も選んでいないときだけ、押した所の線を選ぶ
        if (st.livePart && st.project.strokes.some((x) => x.id === st.livePart!.strokeId)) {
          if (lp && lp.strokeId === st.livePart.strokeId && lp.part === st.livePart.part && lp.selected != null) st.setLivePath({ ...lp, selected: null })
          return
        }
        const hit = hitPart(project.strokes, p.x, p.y, (e.pointerType === 'touch' ? 14 : 5) / scale)
        st.setLivePart(hit)
        if (!hit) st.setLivePath(null)
        else haptic()
        return
      }
      if (st.liveMode === 'brush') {
        // ブラシ：線を選んでいれば、そのグループに線を足す（ペンもそこを通り、表示範囲も広がる）。
        // 何も選んでいなければ、なぞった線で新しいグループを作る（なぞった速さで再生。範囲を選んでいれば、その範囲に限る）
        if (st.playing) st.setPlaying(false)
        const targetId = st.livePart?.strokeId
        const chain = st.drawChain
        const chainTo =
          !targetId && st.sameGroup && chain && !st.insertBefore && st.project.strokes.some((x) => x.id === chain.id)
            ? chain.id
            : undefined
        // 線を選んでいて「描き直す」なら、その線を置き換える。「追加」なら、グループの最後に足す
        const redoPart = targetId && getBrushTarget() === 'redo' ? st.livePart?.part : undefined
        recording.current = targetId
          ? redoPart !== undefined
            ? { pointerId: e.pointerId, start: e.timeStamp, points: [{ ...p, t: 0 }], appendTo: targetId, redoPart }
            : { pointerId: e.pointerId, start: e.timeStamp, points: [{ ...p, t: 0 }], appendTo: targetId, liveBrush: true }
          : chainTo
            ? { pointerId: e.pointerId, start: e.timeStamp, points: [{ ...p, t: 0 }], appendTo: chainTo, chain: true }
            : { pointerId: e.pointerId, start: e.timeStamp, points: [{ ...p, t: 0 }] }
        capture(e)
        if (e.pointerType === 'touch') requestAnimationFrame(() => showLoupe(e.clientX, e.clientY))
        drawOverlay()
        return
      }
      // 自動選択オン：タップした所にある線（軌跡ごとのときは、その線の軌跡）を選ぶ。何もない所なら選択を外す。そのままドラッグすると動かす
      // 自動選択オフ：いま選んでいる線から選び替えず、どこをドラッグしてもその線を動かす（何も選んでいないときだけ、押した所の線を選ぶ）
      const keep = !getAutoSelect() && st.livePart && st.project.strokes.some((x) => x.id === st.livePart!.strokeId) ? st.livePart : null
      const hit = keep ?? hitPart(project.strokes, p.x, p.y, (e.pointerType === 'touch' ? 14 : 5) / scale)
      if (!keep) st.setLivePart(hit && st.liveUnit === 'stroke' ? { strokeId: hit.strokeId, part: 0 } : hit)
      if (hit) {
        haptic()
        const stroke = st.project.strokes.find((x) => x.id === hit.strokeId)!
        liveDrag.current = {
          pointerId: e.pointerId,
          start: p,
          startClient: { x: e.clientX, y: e.clientY },
          stroke,
          part: st.liveUnit === 'stroke' ? -1 : hit.part,
          moved: false,
          key: `livemove:${Date.now()}`
        }
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
    const pd = pathDrag.current
    if (pd && pd.pointerId === e.pointerId) {
      const dx = p.x - pd.start.x
      const dy = p.y - pd.start.y
      const nodes = pd.nodes.map((n) => ({ ...n }))
      const n = nodes[pd.index]
      if (pd.kind === 'pull') {
        // 押しただけ（小さなぶれ）では引き出さない。離したときに角にする
        if (!pd.moved && Math.hypot(e.clientX - pd.startClient.x, e.clientY - pd.startClient.y) < 4) return
        pd.moved = true
        // 出ていく側のハンドルを指の所へ、入ってくる側は反対向きに同じ長さ（なめらかなアンカーになる）
        Object.assign(n, { outX: p.x, outY: p.y, inX: 2 * n.x - p.x, inY: 2 * n.y - p.y })
        updatePathNodes(nodes, pd.key)
        if (e.pointerType === 'touch') loupeSoon(e.pointerId, e.clientX, e.clientY)
        return
      }
      pd.moved = true
      if (pd.kind === 'anchor') {
        // アンカーを動かすと、両側のハンドルも一緒に動く
        Object.assign(n, { x: n.x + dx, y: n.y + dy, inX: n.inX + dx, inY: n.inY + dy, outX: n.outX + dx, outY: n.outY + dy })
      } else {
        const o = pd.nodes[pd.index]
        const hx = (pd.kind === 'in' ? o.inX : o.outX) + dx
        const hy = (pd.kind === 'in' ? o.inY : o.outY) + dy
        if (pd.kind === 'in') Object.assign(n, { inX: hx, inY: hy })
        else Object.assign(n, { outX: hx, outY: hy })
        // 反対側のハンドルも向きをそろえる（なめらかなまま）。Alt を押しながらなら片側だけ（角にする）
        const hasOther = pd.kind === 'in' ? pd.index < nodes.length - 1 : pd.index > 0
        if (!pd.alt && !e.altKey && hasOther) {
          const len = pd.kind === 'in' ? Math.hypot(o.outX - o.x, o.outY - o.y) : Math.hypot(o.inX - o.x, o.inY - o.y)
          const vx = n.x - hx
          const vy = n.y - hy
          const vl = Math.hypot(vx, vy) || 1
          if (pd.kind === 'in') Object.assign(n, { outX: n.x + (vx / vl) * len, outY: n.y + (vy / vl) * len })
          else Object.assign(n, { inX: n.x + (vx / vl) * len, inY: n.y + (vy / vl) * len })
        }
      }
      updatePathNodes(nodes, pd.key)
      if (e.pointerType === 'touch') loupeSoon(e.pointerId, e.clientX, e.clientY)
      return
    }
    const ld = liveDrag.current
    if (ld && ld.pointerId === e.pointerId) {
      // 少し動かしてから（タップのつもりの小さなぶれでは動かさない）
      if (!ld.moved && Math.hypot(e.clientX - ld.startClient.x, e.clientY - ld.startClient.y) < DRAG_THRESHOLD * 2) return
      ld.moved = true
      const dx = p.x - ld.start.x
      const dy = p.y - ld.start.y
      // part が -1 なら軌跡まるごと
      const moved = ld.part < 0 ? transformStroke(ld.stroke, dx, dy) : transformPart(ld.stroke, ld.part, dx, dy)
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
      if (touches.current.size < 2 && pinch.current) {
        pinch.current = null
        gesturing.current = false
        // 指を離したので、いまの表示で作り直す（少し待ってから。続けてつまみ直しても固まらない）
        setView((v) => ({ ...v }))
      }
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
    const pdEnd = pathDrag.current
    if (pdEnd?.pointerId === e.pointerId) {
      pathDrag.current = null
      const lp = useEditor.getState().livePath
      if (pdEnd.kind === 'pull' && !pdEnd.moved) {
        // アンカーポイントの切り替えで押しただけ：両側のハンドルをアンカーに戻して角にする
        const nodes = pdEnd.nodes.map((n, i) => (i === pdEnd.index ? { ...n, inX: n.x, inY: n.y, outX: n.x, outY: n.y } : n))
        updatePathNodes(nodes, undefined, pdEnd.index)
        haptic()
        return
      }
      // パス編集で形を変えたら、線が通る所を表示する（ドラッグと同じ、元に戻す1回分）
      if (lp && pdEnd.moved) revealLine(lp.strokeId, lp.part, pdEnd.key)
      return
    }
    const ld = liveDrag.current
    if (ld && ld.pointerId === e.pointerId) {
      liveDrag.current = null
      if (ld.moved) {
        // 動かした先で、線が通る所を表示する
        revealLine(ld.stroke.id, ld.part, ld.key)
        haptic()
      }
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
        if (prev && st.rerecordPart !== null) {
          const updated = replaceStrokePart(prev, st.rerecordPart, pts)
          if (updated) {
            const part = st.rerecordPart
            st.updateStroke(prev.id, updated)
            st.setRerecord(null)
            st.setTool('live')
            st.setLiveUnit('part')
            st.setLivePart({ strokeId: prev.id, part })
            st.notify('選んだ線を描き直しました')
          } else { st.setRerecord(null); st.notify('線が見つかりませんでした') }
        } else {
        st.updateStroke(st.rerecordId, {
          points: pts,
          duration: Math.max(300, Math.round(recorded)),
          // 選択範囲があればそれを使い、なければ元の範囲を残す
          // 線の数が変わるので、線ごとの範囲はグループ全体に効くものに戻す
          clip: st.selection ?? untagClipLines(prev?.clip)
        })
        st.select(st.rerecordId)
        st.setRerecord(null)
        st.notify('グループを録り直しました')
        }
      } else if (rec.appendTo) {
        const target = st.project.strokes.find((s) => s.id === rec.appendTo)
        if (target && rec.redoPart !== undefined) {
          // ブラシで描き直す：選んでいる線を、なぞった線に置き換える（選んだまま。続けてなぞれば、また描き直す）
          const updated = replaceStrokePart(target, rec.redoPart, simplifyPoints(rec.points))
          if (updated) {
            st.updateStroke(target.id, updated)
            st.setLivePart({ strokeId: target.id, part: rec.redoPart })
            st.notify(`線 ${rec.redoPart + 1} を描き直しました`)
            haptic()
          } else st.notify('線が見つかりませんでした')
        } else if (target && rec.liveBrush) {
          // ブラシで足す：ペンの通り道を足し、表示範囲もなぞった所まで広げる
          const w = st.project.settings.defaultRevealWidth
          const marks: Pt[] = []
          for (const q of rec.points) {
            const last = marks[marks.length - 1]
            if (!last || Math.hypot(q.x - last.x, q.y - last.y) >= 1.5) marks.push({ x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 })
          }
          // 足した線（グループの最後の線）だけに効く表示範囲にする
          st.updateStroke(target.id, { ...appendToStroke(target, rec.points, w), clip: addRevealMark(target.clip, marks, w, strokeParts(target).length) })
          haptic()
        } else if (target && rec.chain) {
          // 「同一グループ」で描いた線：同じグループに入れ、選ばない（続けて描けば、また同じグループへ）
          st.updateStroke(target.id, appendToStroke(target, rec.points, st.project.settings.defaultRevealWidth))
          haptic()
        } else if (target) {
          st.updateStroke(target.id, appendToStroke(target, rec.points, st.project.settings.defaultRevealWidth))
          st.select(target.id)
          haptic()
        }
      } else {
        const created = strokeFromRecording(st.project, rec.points, st.project.strokes.length, st.selection)
        st.addStroke(created)
        // 手描きのブラシで描いたときは、何も選ばない状態に戻す。「同一グループ」がオンなら、次に描く線もこのグループに入る
        if (st.tool === 'live') {
          st.select(null)
          st.setDrawChain(st.sameGroup ? { id: created.id } : null)
        }
        haptic()
      }
    }
    drawOverlay()
  }

  /** 消しゴムの線を、選んでいる軌跡（なければ書き始めの位置にある軌跡）の表示範囲から除外する */
  const finishErase = (raw: Pt[]): void => {
    const st = useEditor.getState()
    const w = st.project.settings.eraserWidth
    // 手描きの消しゴムは、選んでいる線のグループだけ（線が決まっていなければ何もしない）
    const live = st.tool === 'live'
    const target = live
      ? st.project.strokes.find((s) => s.id === st.livePart?.strokeId)
      : (st.project.strokes.find((s) => s.id === st.selectedId) ?? hitStroke(st.project.strokes, raw[0].x, raw[0].y, w / 2))
    if (live && !target) {
      st.notify('消す線を選んでください', 'error')
      return
    }
    if (!target) {
      st.notify('消しゴムをかけるグループを選んでください（「手描き」・描き順・タイムラインから）', 'error')
      return
    }
    // 近すぎる点を間引く
    const pts: Pt[] = []
    for (const p of raw) {
      const last = pts[pts.length - 1]
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 1.5) pts.push({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })
    }
    // 手描きの消しゴムは、選んでいる線だけに効く（「範囲」の消しゴムは、グループのすべての線に効く）
    const line = st.tool === 'live' && st.livePart?.strokeId === target.id ? st.livePart.part : undefined
    st.updateStroke(target.id, { clip: addEraserMark(target.clip, pts, w, line) })
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
      : (tool === 'draw' || tool === 'erase' || liveErasing || liveBrushing) && viewMode === 'edit'
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
              <li>「自動」で作るか、「手描き」のブラシで描き順をなぞる</li>
              <li>再生して確認・調整</li>
              <li>HTML / 動画として書き出す</li>
            </ol>
          </div>
        </div>
      ) : (
        <div
          className={`artboard ${viewMoving ? 'moving' : ''}`}
          style={{
            left: sLeft,
            top: sTop,
            width: imgW * sScale,
            height: imgH * sScale,
            background: project.settings.boardColor,
            // 決まった表示からのずれを変形で見せる（左上を基準に拡大してから移動）
            transform: viewMoving ? `translate(${left - sLeft}px, ${top - sTop}px) scale(${scale / sScale})` : undefined
          }}
        >
          {viewMode === 'edit' && <img className="layer trace" src={image.dataUrl} alt="" draggable={false} />}
          <canvas ref={renderCanvasRef} className="layer" />
          <canvas ref={dimRef} className="layer" />
          <canvas ref={overlayRef} className="layer" />
        </div>
      )}
      {image && rerecordId && (
        <div className="stage-banner">
          <span>
            描き直し中：{project.strokes.find((s) => s.id === rerecordId)?.name}{rerecordPart !== null ? ` の線 ${rerecordPart + 1}` : ' 全体'}をなぞってください
            <small className="stage-banner-sub">2本指でつまむと拡大・移動できます</small>
          </span>
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
        <div className="stage-banner info" title="この状態で描いた線に、選択範囲が記録されます">
          <span>範囲の中だけに効きます</span>
          <button className="btn small primary" data-tour={isPhone ? 'auto-phone' : undefined} onClick={openAutoTrace}>
            <Icon name="sparkle" size={13} /> 自動で作る
          </button>
          <button className="btn small" onClick={() => useEditor.getState().setSelection(null)}>
            {isPhone ? '解除' : '選択解除 (Ctrl+D)'}
          </button>
        </div>
      )}
      <canvas ref={loupeRef} className="loupe" style={{ width: LOUPE, height: LOUPE, display: 'none' }} aria-hidden />
      {/* 描き始めの案内：軌跡がまだ1本もないときだけ。✕で閉じられる（自動作成はドック・メニューからもできる） */}
      {image && isPhone && !coachClosed && project.strokes.length === 0 && !rerecordId && !selection && !lassoPolyActive && viewMode === 'edit' && (
        <div className="coach-chip">
          <span>
            <Icon name="pen" size={14} /> 描き順を作る
          </span>
          <button className="btn small primary" data-tour="auto-phone" onClick={openAutoTrace}>
            <Icon name="sparkle" size={13} /> 自動で作る
          </button>
          <button
            className="btn small"
            onClick={() => {
              const st = useEditor.getState()
              st.setTool('live')
              st.setLiveMode('brush')
              st.setLivePart(null)
              setCoachClosed(true)
              st.notify('ブラシで画像をなぞると描けます。1本ごとに新しいグループになります（「同一グループ」をオンにすると、描いた線を1つのグループにまとめます）。2本指で拡大・移動できます')
            }}
          >
            <Icon name="pen" size={13} /> 自分で描く
          </button>
          <button className="coach-close" aria-label="この案内を閉じる" onClick={() => setCoachClosed(true)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      {image && isPhone && quickBar && timelineHidden && (
        // タイムラインを隠しているとき（スマホ）：絵の左下で再生・一時停止（出し入れは境目の取っ手で）
        <div className="stage-quick">
          <button className="stage-quick-btn" aria-label={playingNow ? '一時停止' : '再生して確かめる'} title={playingNow ? '一時停止' : '再生して確かめる'} onClick={() => togglePlay()}>
            <Icon name={playingNow ? 'pause' : 'play'} size={18} />
          </button>
        </div>
      )}
      {image && livePathing && viewMode === 'edit' && <PathPalette />}
      {image && (
        <div className="stage-tools">
          {viewMode === 'edit' && !rerecordId && <RangeButton phone={isPhone} />}
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

/** グループの範囲のマスク。線ごとの範囲があれば、すべての線の範囲を合わせたもの */
function rasterizeGroupClip(stroke: Stroke, w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  const clip = stroke.clip!
  if (!hasLineClips(clip)) return rasterizeClip(clip, w, h)
  const out = rasterizeClip({ shapes: [] }, w, h)
  const ctx = out.getContext('2d') as CanvasRenderingContext2D
  const n = strokeParts(stroke).length
  // 同じ図形の組み合わせになる線は、1回だけ描く（線の多いグループでも重くしない）
  const seen = new Set<string>()
  for (let i = 0; i < n; i++) {
    const key = clip.shapes.map((s, k) => (!s.lines || s.lines.includes(i) ? k : '')).join(',')
    if (seen.has(key)) continue
    seen.add(key)
    ctx.drawImage(rasterizeClip(clipForLine(clip, i), w, h) as CanvasImageSource, 0, 0)
  }
  return out
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

