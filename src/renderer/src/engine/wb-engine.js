// ============================================================================
// Whiteboard Animation Engine
// ----------------------------------------------------------------------------
// エディタと「書き出したHTML」の両方で、まったく同じこのファイルを使う。
// 書き出し時は `?raw` で文字列として取り込み、`export ` を外して埋め込むため、
// このファイルは import を持たない自己完結のプレーンJSとして保つこと。
//
// 描画方式（PRD 6章）:
//   背景層  : ボード色で塗りつぶし
//   画像層  : 完成画像を、マスクで切り抜いて描く（mask に描いた所だけ見える）
//   手の層  : ペン先位置に手素材を回転・移動して重ねる
// renderAt(t) は任意の時刻へシーク可能（巻き戻し時はマスクを作り直す）。
// ============================================================================

export const ENGINE_VERSION = 1

/** 手が画面外で待機する位置（画像サイズに対する比率） */
const OFFSCREEN = { x: 1.15, y: 1.25 }

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

function easeInOut(u) {
  return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2
}

/**
 * 1本の軌跡について、進捗 u (0..1) → 座標 を引くための前計算。
 * useRecordedTiming=true なら、なぞった時の時刻 t を使って速度の緩急を再現する。
 */
export function prepareStroke(stroke) {
  const pts = stroke.points
  const n = pts.length
  const cum = new Array(n)
  cum[0] = 0
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  }
  const length = cum[n - 1] || 0
  const t0 = pts[0] ? pts[0].t : 0
  const tN = pts[n - 1] ? pts[n - 1].t : 0
  const useTime = stroke.useRecordedTiming !== false && tN - t0 > 0
  const param = new Array(n)
  for (let i = 0; i < n; i++) {
    if (useTime) param[i] = (pts[i].t - t0) / (tN - t0)
    else param[i] = length > 0 ? cum[i] / length : n > 1 ? i / (n - 1) : 0
  }
  // 時刻が単調増加でないデータへの保険
  for (let i = 1; i < n; i++) if (param[i] < param[i - 1]) param[i] = param[i - 1]
  return { stroke, pts, param, length }
}

/** 進捗 u における (x, y) と、そのときの点インデックス */
function pointAt(prep, u) {
  const { pts, param } = prep
  const n = pts.length
  if (n === 0) return { x: 0, y: 0, i: 0 }
  if (n === 1 || u <= 0) return { x: pts[0].x, y: pts[0].y, i: 0 }
  if (u >= 1) return { x: pts[n - 1].x, y: pts[n - 1].y, i: n - 1 }
  // 二分探索
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (param[mid] <= u) lo = mid
    else hi = mid
  }
  const span = param[hi] - param[lo]
  const f = span > 0 ? (u - param[lo]) / span : 1
  return {
    x: pts[lo].x + (pts[hi].x - pts[lo].x) * f,
    y: pts[lo].y + (pts[hi].y - pts[lo].y) * f,
    i: lo
  }
}

/**
 * プロジェクト全体の時間割を作る。
 * [startDelay] → 軌跡1 → [delayAfter1 + 手の移動] → 軌跡2 → … → [endHold]
 */
export function buildTimeline(project) {
  const s = project.settings
  const speed = s.speed > 0 ? s.speed : 1
  const segments = []
  let cursor = Math.max(0, s.startDelay) / speed
  project.strokes.forEach((stroke, index) => {
    if (!stroke.points || stroke.points.length === 0 || stroke.hidden) return
    const duration = Math.max(50, stroke.duration) / speed
    const gap = Math.max(0, stroke.delayAfter) / speed
    segments.push({
      index,
      prep: prepareStroke(stroke),
      start: cursor,
      end: cursor + duration,
      gapEnd: cursor + duration + gap
    })
    cursor += duration + gap
  })
  const drawEnd = segments.length ? segments[segments.length - 1].end : cursor
  const total = Math.max(drawEnd, cursor) + Math.max(0, s.endHold) / speed
  return { segments, drawEnd, total }
}

/**
 * 時刻 t における手の状態を計算する（描画とは独立した純粋関数）。
 * 戻り値 { x, y, angle, drawing, segIndex }
 */
export function handStateAt(timeline, t, width, height, followDirection) {
  const segs = timeline.segments
  const rest = { x: width * OFFSCREEN.x, y: height * OFFSCREEN.y }
  if (segs.length === 0) return { x: rest.x, y: rest.y, angle: 0, drawing: false, segIndex: -1 }

  const first = segs[0]
  if (t < first.start) {
    // 画面外 → 最初の書き始め位置へ移動
    const p = pointAt(first.prep, 0)
    const travel = Math.min(first.start, 700)
    const u = travel > 0 ? clamp((t - (first.start - travel)) / travel, 0, 1) : 1
    const e = easeInOut(u)
    return { x: rest.x + (p.x - rest.x) * e, y: rest.y + (p.y - rest.y) * e, angle: 0, drawing: false, segIndex: -1 }
  }

  for (let k = 0; k < segs.length; k++) {
    const seg = segs[k]
    if (t >= seg.start && t <= seg.end) {
      const u = (t - seg.start) / (seg.end - seg.start)
      const p = pointAt(seg.prep, u)
      let angle = 0
      if (followDirection) {
        const q = pointAt(seg.prep, Math.max(0, u - 0.04))
        const dx = p.x - q.x
        const dy = p.y - q.y
        // 進行方向に応じて、ごくわずかに手首を傾ける（大きく回すと不自然になる）
        if (Math.hypot(dx, dy) > 0.5) angle = clamp(dx * 0.004 - dy * 0.002, -0.18, 0.18)
      }
      return { x: p.x, y: p.y, angle, drawing: true, segIndex: k }
    }
    const next = segs[k + 1]
    if (t > seg.end && (!next || t < next.start)) {
      const from = pointAt(seg.prep, 1)
      const to = next ? pointAt(next.prep, 0) : rest
      const gapStart = seg.end
      const gapEnd = next ? next.start : Math.min(timeline.total, seg.end + 900)
      // 待機時間の前半は手を止め、後半で次の位置へ移動する
      const moveDur = Math.min(Math.max(gapEnd - gapStart, 0), next ? 600 : 900)
      const moveStart = gapEnd - moveDur
      const u = moveDur > 0 ? clamp((t - moveStart) / moveDur, 0, 1) : 1
      const e = easeInOut(u)
      return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, angle: 0, drawing: false, segIndex: k }
    }
  }
  return { x: rest.x, y: rest.y, angle: 0, drawing: false, segIndex: segs.length - 1 }
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

// ----------------------------------------------------------------------------
// 選択範囲（クリップ）
//   clip = { shapes: [{ kind, mode, ... }] }
//   図形を先頭から順に合成して範囲を作る（Photoshop の 新規／追加／除外／交差 と同じ考え方）。
//     mode   : 'add'（追加） | 'subtract'（除外） | 'intersect'（交差：重なった部分だけ残す）
//     kind   : 'rect' | 'ellipse'（外接矩形 {x, y, w, h}） | 'poly'（points） | 'all'（画像全体）
//              | 'stroke'（太さ width でなぞった線 points。消しゴムの跡）
//              | 'region'（入れ子の選択範囲 { region }。反転などで使う）
// ----------------------------------------------------------------------------

export function traceClipShape(ctx, shape, width, height) {
  ctx.beginPath()
  if (shape.kind === 'all') {
    ctx.rect(0, 0, width, height)
  } else if (shape.kind === 'rect') {
    ctx.rect(shape.x, shape.y, shape.w, shape.h)
  } else if (shape.kind === 'ellipse') {
    ctx.ellipse(shape.x + shape.w / 2, shape.y + shape.h / 2, Math.abs(shape.w / 2), Math.abs(shape.h / 2), 0, 0, Math.PI * 2)
  } else if ((shape.kind === 'poly' || shape.kind === 'stroke') && shape.points.length) {
    ctx.moveTo(shape.points[0].x, shape.points[0].y)
    for (let i = 1; i < shape.points.length; i++) ctx.lineTo(shape.points[i].x, shape.points[i].y)
  }
  if (shape.kind !== 'stroke') ctx.closePath()
}

const CLIP_OP = { add: 'source-over', subtract: 'destination-out', intersect: 'destination-in' }

/** 選択範囲を、範囲内だけ不透明なマスク画像にする */
export function rasterizeClip(clip, width, height) {
  const c = makeCanvas(width, height)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#000'
  for (const shape of clip.shapes) {
    // destination-in は、描いた図形の外側をすべて消す＝交差
    ctx.globalCompositeOperation = CLIP_OP[shape.mode] || 'source-over'
    if (shape.kind === 'region') {
      ctx.drawImage(rasterizeClip(shape.region, width, height), 0, 0)
    } else if (shape.kind === 'stroke') {
      // 線（消しゴムの跡）は塗りではなく太さのある線として描く
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.lineWidth = shape.width
      ctx.strokeStyle = '#000'
      if (shape.points.length === 1) {
        ctx.beginPath()
        ctx.arc(shape.points[0].x, shape.points[0].y, shape.width / 2, 0, Math.PI * 2)
        ctx.fill()
      } else {
        traceClipShape(ctx, shape, width, height)
        ctx.stroke()
      }
    } else {
      traceClipShape(ctx, shape, width, height)
      ctx.fill()
    }
  }
  ctx.globalCompositeOperation = 'source-over'
  return c
}

function shapeBox(s, width, height) {
  if (s.kind === 'all') return { x0: 0, y0: 0, x1: width, y1: height }
  if (s.kind === 'region') return boxOf(s.region, width, height)
  if (s.kind === 'poly' || s.kind === 'stroke') {
    const r = s.kind === 'stroke' ? s.width / 2 : 0
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const p of s.points) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y)
    }
    return { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r }
  }
  return { x0: Math.min(s.x, s.x + s.w), y0: Math.min(s.y, s.y + s.h), x1: Math.max(s.x, s.x + s.w), y1: Math.max(s.y, s.y + s.h) }
}

/** 範囲が及びうる矩形（追加＝和、交差＝共通部分、除外＝そのまま） */
function boxOf(clip, width, height) {
  let b = null
  for (const s of clip.shapes) {
    const sb = shapeBox(s, width, height)
    if (s.mode === 'add') {
      b = b ? { x0: Math.min(b.x0, sb.x0), y0: Math.min(b.y0, sb.y0), x1: Math.max(b.x1, sb.x1), y1: Math.max(b.y1, sb.y1) } : sb
    } else if (s.mode === 'intersect' && b) {
      b = { x0: Math.max(b.x0, sb.x0), y0: Math.max(b.y0, sb.y0), x1: Math.min(b.x1, sb.x1), y1: Math.min(b.y1, sb.y1) }
    }
  }
  return b || { x0: 0, y0: 0, x1: 0, y1: 0 }
}

/** 選択範囲が及びうる矩形（描画範囲を絞るために使う） */
export function clipBounds(clip, width, height) {
  const b = boxOf(clip, width, height)
  if (b.x1 <= b.x0 || b.y1 <= b.y0) return { x: 0, y: 0, w: 0, h: 0 }
  const x = Math.max(0, Math.floor(b.x0) - 1)
  const y = Math.max(0, Math.floor(b.y0) - 1)
  return { x, y, w: Math.max(0, Math.min(width, Math.ceil(b.x1) + 1) - x), h: Math.max(0, Math.min(height, Math.ceil(b.y1) + 1) - y) }
}

/**
 * プレビュー／書き出し共通のレンダラー。
 *   const r = new WBRenderer(canvas, project, { image, hand })
 *   r.renderAt(ms)
 */
export class WBRenderer {
  constructor(canvas, project, assets) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.assets = assets // { image: CanvasImageSource|null, hand: CanvasImageSource|null }
    this.setProject(project)
  }

  setProject(project) {
    this.project = project
    const w = project.image ? project.image.width : 1920
    const h = project.image ? project.image.height : 1080
    this.width = w
    this.height = h
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h
    if (!this.mask || this.mask.width !== w || this.mask.height !== h) {
      this.mask = makeCanvas(w, h)
      this.reveal = makeCanvas(w, h)
      this.scratch = makeCanvas(w, h)
      this.clipCache = new Map()
    }
    this.mctx = this.mask.getContext('2d')
    this.rctx = this.reveal.getContext('2d')
    this.sctx = this.scratch.getContext('2d')
    this.timeline = buildTimeline(project)
    this.resetMask()
  }

  setAssets(assets) {
    this.assets = assets
    this.revealDirty = true
  }

  get duration() {
    return this.timeline.total
  }

  resetMask() {
    this.mctx.clearRect(0, 0, this.width, this.height)
    this.maskTime = -1
    this.revealDirty = true
  }

  /** マスクを時刻 t まで進める（巻き戻しなら作り直す） */
  advanceMask(t) {
    if (t < this.maskTime) this.resetMask()
    const from = this.maskTime
    if (t === from) return
    const m = this.mctx
    for (const seg of this.timeline.segments) {
      if (seg.end <= from || seg.start > t) continue
      const dur = seg.end - seg.start
      const u0 = from <= seg.start ? 0 : (from - seg.start) / dur
      const u1 = t >= seg.end ? 1 : (t - seg.start) / dur
      const clip = this.clipFor(seg.prep.stroke)
      if (!clip) {
        this.strokePortion(m, seg.prep, u0, u1)
        continue
      }
      // 選択範囲あり：作業用キャンバスに描き、範囲で切り抜いてからマスクへ足す
      const b = clip.bounds
      if (b.w <= 0 || b.h <= 0) continue
      const sc = this.sctx
      sc.clearRect(b.x, b.y, b.w, b.h)
      this.strokePortion(sc, seg.prep, u0, u1)
      sc.globalCompositeOperation = 'destination-in'
      sc.drawImage(clip.canvas, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h)
      sc.globalCompositeOperation = 'source-over'
      m.drawImage(this.scratch, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h)
    }
    this.maskTime = t
    this.revealDirty = true
  }

  /** 軌跡の選択範囲マスク（同じ範囲はキャッシュして使い回す） */
  clipFor(stroke) {
    const clip = stroke.clip
    if (!clip || !clip.shapes || clip.shapes.length === 0) return null
    const key = JSON.stringify(clip)
    let hit = this.clipCache.get(key)
    if (!hit) {
      if (this.clipCache.size > 64) this.clipCache.clear()
      hit = { canvas: rasterizeClip(clip, this.width, this.height), bounds: clipBounds(clip, this.width, this.height) }
      this.clipCache.set(key, hit)
    }
    return hit
  }

  strokePortion(m, prep, u0, u1) {
    const w = prep.stroke.revealWidth
    m.lineCap = 'round'
    m.lineJoin = 'round'
    m.strokeStyle = '#000'
    m.fillStyle = '#000'
    m.lineWidth = w
    const a = pointAt(prep, u0)
    const b = pointAt(prep, u1)
    if (prep.pts.length === 1 || (a.i === b.i && Math.hypot(b.x - a.x, b.y - a.y) < 0.01)) {
      m.beginPath()
      m.arc(b.x, b.y, w / 2, 0, Math.PI * 2)
      m.fill()
      return
    }
    m.beginPath()
    m.moveTo(a.x, a.y)
    for (let i = a.i + 1; i <= b.i; i++) m.lineTo(prep.pts[i].x, prep.pts[i].y)
    m.lineTo(b.x, b.y)
    m.stroke()
  }

  composeReveal() {
    if (!this.revealDirty) return
    const r = this.rctx
    r.globalCompositeOperation = 'source-over'
    r.clearRect(0, 0, this.width, this.height)
    if (this.assets.image) {
      r.drawImage(this.assets.image, 0, 0, this.width, this.height)
      r.globalCompositeOperation = 'destination-in'
      r.drawImage(this.mask, 0, 0)
      r.globalCompositeOperation = 'source-over'
    }
    this.revealDirty = false
  }

  /**
   * 時刻 t (ms) のフレームを描く。
   * opts.hand=false で手を描かない / opts.background=false で背景を塗らない
   */
  renderAt(t, opts) {
    const o = opts || {}
    const s = this.project.settings
    const ctx = this.ctx
    this.advanceMask(t)
    this.composeReveal()

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    if (o.background !== false) {
      ctx.fillStyle = s.boardColor || '#ffffff'
      ctx.fillRect(0, 0, this.width, this.height)
    } else {
      ctx.clearRect(0, 0, this.width, this.height)
    }
    ctx.drawImage(this.reveal, 0, 0)

    if (o.hand !== false && s.showHand && this.assets.hand && this.project.hand) {
      const st = handStateAt(this.timeline, t, this.width, this.height, s.handFollowDirection)
      this.drawHand(st)
    }
  }

  drawHand(st) {
    const ctx = this.ctx
    const hand = this.project.hand
    const s = this.project.settings
    const scale = (s.handSize * this.height) / hand.height
    ctx.save()
    ctx.translate(st.x, st.y)
    ctx.rotate(st.angle)
    if (s.handShadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.28)'
      ctx.shadowBlur = 24 * scale
      ctx.shadowOffsetX = 14 * scale
      ctx.shadowOffsetY = 20 * scale
    }
    ctx.drawImage(this.assets.hand, -hand.tipX * scale, -hand.tipY * scale, hand.width * scale, hand.height * scale)
    ctx.restore()
  }
}

/** data URL から HTMLImageElement を読み込む */
export function loadImage(src) {
  return new Promise(function (resolve, reject) {
    const img = new Image()
    img.onload = function () {
      resolve(img)
    }
    img.onerror = function () {
      reject(new Error('画像を読み込めませんでした'))
    }
    img.src = src
  })
}
