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
  // 線（ペンを下ろしてから上げるまで）の区切り
  const parts = []
  let start = 0
  for (let i = 1; i <= n; i++) {
    if (i === n || pts[i].b) {
      parts.push({ start: start, end: i - 1 })
      start = i
    }
  }
  return { stroke, pts, param, length, parts }
}

// ----------------------------------------------------------------------------
// 線ごとの範囲
//   範囲の図形に lines（線の番号の配列）があれば、その線を描くときだけ効く（手描きの消しゴム・通過部分の表示）。
//   lines のない図形は、グループのすべての線に効く。
// ----------------------------------------------------------------------------

/** 範囲に、線ごとの図形があるか */
export function hasLineClips(clip) {
  return !!(clip && clip.shapes && clip.shapes.some((s) => s.lines))
}

const lineClipCache = new WeakMap()
/**
 * line 番目の線に効く範囲（線ごとの図形のうち、ほかの線のものを除いたもの）。
 * 線ごとの図形がなければ clip そのもの。同じ clip・同じ線なら同じオブジェクトを返す（キャッシュが効くように）
 */
export function clipForLine(clip, line) {
  if (!hasLineClips(clip)) return clip
  let byLine = lineClipCache.get(clip)
  if (!byLine) {
    byLine = new Map()
    lineClipCache.set(clip, byLine)
  }
  let c = byLine.get(line)
  if (!c) {
    c = { shapes: clip.shapes.filter((s) => !s.lines || s.lines.indexOf(line) >= 0) }
    byLine.set(line, c)
  }
  return c
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
//              | 'rle'（画素単位の形。gw×gh の格子上の連続区間 runs = [y, x, 長さ, …]。自動生成で使う）
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

/**
 * 選択範囲を、範囲内だけ不透明なマスク画像にする。
 * opt を渡すと、画像の一部（x, y, w, h）だけを scale 倍の解像度で作る（メモリと描く手間を減らす）。
 * 省略時は画像全体を等倍で作る。
 */
export function rasterizeClip(clip, width, height, opt) {
  const s = (opt && opt.scale) || 1
  const ox = (opt && opt.x) || 0
  const oy = (opt && opt.y) || 0
  const cw = Math.max(1, Math.ceil(((opt && opt.w) || width) * s))
  const ch = Math.max(1, Math.ceil(((opt && opt.h) || height) * s))
  const layer = function () {
    const c = makeCanvas(cw, ch)
    const ctx = c.getContext('2d')
    ctx.setTransform(s, 0, 0, s, -ox * s, -oy * s)
    return { canvas: c, ctx: ctx }
  }
  const top = layer()
  drawClipInto(top.ctx, clip, width, height, layer)
  return top.canvas
}

/** 範囲の図形を ctx に描く（ctx の変換は、画像の座標 → キャンバスの画素） */
function drawClipInto(ctx, clip, width, height, layer) {
  ctx.fillStyle = '#000'
  for (const shape of clip.shapes) {
    // destination-in は、描いた図形の外側をすべて消す＝交差
    ctx.globalCompositeOperation = CLIP_OP[shape.mode] || 'source-over'
    if (shape.kind === 'region') {
      // 入れ子の範囲は、同じ大きさ・同じ変換の別キャンバスに描いてから重ねる
      const inner = layer()
      drawClipInto(inner.ctx, shape.region, width, height, layer)
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(inner.canvas, 0, 0)
      ctx.restore()
    } else if (shape.kind === 'rle') {
      // 格子上の連続区間を、画像の大きさに引き伸ばして塗る（すき間が出ないよう外側へ丸める）
      const sx = width / shape.gw
      const sy = height / shape.gh
      const d = shape.runs
      ctx.beginPath()
      for (let i = 0; i < d.length; i += 3) {
        const x0 = Math.floor(d[i + 1] * sx)
        const y0 = Math.floor(d[i] * sy)
        ctx.rect(x0, y0, Math.ceil((d[i + 1] + d[i + 2]) * sx) - x0, Math.ceil((d[i] + 1) * sy) - y0)
      }
      ctx.fill()
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
}

function shapeBox(s, width, height) {
  if (s.kind === 'all') return { x0: 0, y0: 0, x1: width, y1: height }
  if (s.kind === 'region') return boxOf(s.region, width, height)
  if (s.kind === 'rle') {
    const sx = width / s.gw
    const sy = height / s.gh
    return { x0: s.box[0] * sx, y0: s.box[1] * sy, x1: s.box[2] * sx, y1: s.box[3] * sy }
  }
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
 * opts.scale：内部の解像度（画像の大きさに対する倍率）。編集画面では画面に見える細かさまで下げて軽くする。
 *   書き出しは省略（＝等倍）。座標・太さはいつも画像の大きさで扱い、描くときだけ縮める。
 */
export class WBRenderer {
  constructor(canvas, project, assets, opts) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.assets = assets // { image: CanvasImageSource|null, hand: CanvasImageSource|null }
    this.scale = (opts && opts.scale) || 1
    this.setProject(project)
  }

  /** 内部の解像度を変える（変わったら作業用のキャンバスと範囲の画像を作り直す） */
  setScale(scale) {
    const s = scale || 1
    if (s === this.scale) return
    this.scale = s
    this.mask = null
    this.setProject(this.project)
  }

  setProject(project) {
    this.project = project
    const w = project.image ? project.image.width : 1920
    const h = project.image ? project.image.height : 1080
    this.width = w
    this.height = h
    // 実際の画素数（内部の解像度）
    const W = Math.max(1, Math.round(w * this.scale))
    const H = Math.max(1, Math.round(h * this.scale))
    this.pw = W
    this.ph = H
    if (this.canvas.width !== W) this.canvas.width = W
    if (this.canvas.height !== H) this.canvas.height = H
    if (!this.mask || this.mask.width !== W || this.mask.height !== H) {
      this.mask = makeCanvas(W, H)
      this.reveal = makeCanvas(W, H)
      this.scratch = makeCanvas(W, H)
      this.clipCache = new WeakMap()
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
    this.mctx.setTransform(1, 0, 0, 1, 0, 0)
    this.mctx.clearRect(0, 0, this.pw, this.ph)
    this.maskTime = -1
    this.revealDirty = true
  }

  /** マスクを時刻 t まで進める（巻き戻しなら作り直す） */
  advanceMask(t) {
    if (t < this.maskTime) this.resetMask()
    const from = this.maskTime
    if (t === from) return
    const m = this.mctx
    const k = this.scale
    for (const seg of this.timeline.segments) {
      if (seg.end <= from || seg.start > t) continue
      const dur = seg.end - seg.start
      const u0 = from <= seg.start ? 0 : (from - seg.start) / dur
      const u1 = t >= seg.end ? 1 : (t - seg.start) / dur
      const clip = seg.prep.stroke.clip
      if (hasLineClips(clip)) {
        // 線ごとの範囲がある：線ごとに、その線の範囲で切り抜いて描く
        const { parts, param } = seg.prep
        for (let p = 0; p < parts.length; p++) {
          const ps = param[parts[p].start]
          const pe = param[parts[p].end]
          if (pe < u0 || ps > u1) continue
          this.drawPortion(seg.prep, Math.max(u0, ps), Math.min(u1, pe), this.clipFor(clipForLine(clip, p)), parts[p])
        }
        continue
      }
      this.drawPortion(seg.prep, u0, u1, this.clipFor(clip), null)
    }
    m.setTransform(1, 0, 0, 1, 0, 0)
    this.maskTime = t
    this.revealDirty = true
  }

  /** 軌跡の u0〜u1 の部分をマスクへ足す。clip があれば、その範囲で切り抜く。range があれば、その線の点だけを描く */
  drawPortion(prep, u0, u1, clip, range) {
    const m = this.mctx
    const k = this.scale
    if (!clip) {
      m.setTransform(k, 0, 0, k, 0, 0)
      this.strokePortion(m, prep, u0, u1, range)
      return
    }
    // 選択範囲あり：作業用キャンバスに描き、範囲で切り抜いてからマスクへ足す（範囲の矩形の中だけで行う）
    const b = clip.px
    if (b.w <= 0 || b.h <= 0) return
    const sc = this.sctx
    sc.setTransform(1, 0, 0, 1, 0, 0)
    sc.clearRect(b.x, b.y, b.w, b.h)
    sc.setTransform(k, 0, 0, k, 0, 0)
    this.strokePortion(sc, prep, u0, u1, range)
    sc.setTransform(1, 0, 0, 1, 0, 0)
    sc.globalCompositeOperation = 'destination-in'
    sc.drawImage(clip.canvas, b.x, b.y)
    sc.globalCompositeOperation = 'source-over'
    m.setTransform(1, 0, 0, 1, 0, 0)
    m.drawImage(this.scratch, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h)
  }

  /** 範囲のマスク（同じ範囲はキャッシュして使い回す） */
  clipFor(clip) {
    if (!clip || !clip.shapes || clip.shapes.length === 0) return null
    // 同じ範囲オブジェクトなら作り直さない（範囲は書き換えずに作り直す決まりなので、同一性で判定できる）
    let hit = this.clipCache.get(clip)
    if (!hit) {
      // 範囲が及ぶ矩形の中だけを、内部の解像度で作る（画像全体の大きさで作ると、軌跡の数だけメモリを使う）
      const k = this.scale
      const b = clipBounds(clip, this.width, this.height)
      const x0 = Math.floor(b.x * k)
      const y0 = Math.floor(b.y * k)
      const px = {
        x: x0,
        y: y0,
        w: Math.max(0, Math.min(this.pw, Math.ceil((b.x + b.w) * k)) - x0),
        h: Math.max(0, Math.min(this.ph, Math.ceil((b.y + b.h) * k)) - y0)
      }
      const canvas = px.w > 0 && px.h > 0 ? rasterizeClip(clip, this.width, this.height, { scale: k, x: x0 / k, y: y0 / k, w: px.w / k, h: px.h / k }) : null
      hit = { canvas: canvas, px: px }
      this.clipCache.set(clip, hit)
    }
    return hit
  }

  /**
   * 軌跡の u0〜u1 の部分を太い線で描く。
   * 点に b（ペンを上げる）が付いていたら、そこで線を切る：直前の点からその点までは手が移動するだけで描かない。
   * b の点に w があれば、そこから先はその太さで描く（描き足した部分だけ太さを変えられる）。
   */
  strokePortion(m, prep, u0, u1, range) {
    const pts = prep.pts
    const base = prep.stroke.revealWidth
    m.lineCap = 'round'
    m.lineJoin = 'round'
    m.strokeStyle = '#000'
    m.fillStyle = '#000'
    let a = pointAt(prep, u0)
    let b = pointAt(prep, u1)
    if (range) {
      // 1本の線だけを描く：線の外（前後の線や、ペンを上げて移動している間）にはみ出さない
      const at = (i) => ({ x: pts[i].x, y: pts[i].y, i: i })
      if (a.i < range.start) a = at(range.start)
      if (a.i > range.end) a = at(range.end)
      if (b.i >= range.end) b = at(range.end)
      if (b.i < range.start) b = at(range.start)
    }
    const widthAt = (i) => {
      for (let k = i; k >= 0; k--) if (pts[k].b) return pts[k].w || base
      return base
    }
    // i → i+1 の区間が「ペンを上げて移動」か
    const liftedAfter = (i) => !!(pts[i + 1] && pts[i + 1].b)

    if (pts.length === 1 || (a.i === b.i && Math.hypot(b.x - a.x, b.y - a.y) < 0.01)) {
      if (liftedAfter(a.i) && !(a.x === pts[a.i].x && a.y === pts[a.i].y)) return
      const w = widthAt(a.i)
      m.beginPath()
      m.arc(b.x, b.y, w / 2, 0, Math.PI * 2)
      m.fill()
      return
    }

    let drawing = !liftedAfter(a.i)
    m.lineWidth = widthAt(a.i)
    m.beginPath()
    if (drawing) m.moveTo(a.x, a.y)
    for (let i = a.i + 1; i <= b.i; i++) {
      const p = pts[i]
      if (p.b) {
        // ここで線を区切り、新しい線を始める（つなぎ目は描かない）
        if (drawing) m.stroke()
        m.lineWidth = p.w || base
        m.beginPath()
        m.moveTo(p.x, p.y)
        m.lineTo(p.x + 0.01, p.y) // 書き始めの点（丸い端）
        drawing = true
        continue
      }
      if (drawing) m.lineTo(p.x, p.y)
    }
    if (drawing && !liftedAfter(b.i)) m.lineTo(b.x, b.y)
    if (drawing) m.stroke()
  }

  composeReveal() {
    if (!this.revealDirty) return
    const r = this.rctx
    r.setTransform(1, 0, 0, 1, 0, 0)
    r.globalCompositeOperation = 'source-over'
    r.clearRect(0, 0, this.pw, this.ph)
    if (this.assets.image) {
      r.drawImage(this.assets.image, 0, 0, this.pw, this.ph)
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
      ctx.fillRect(0, 0, this.pw, this.ph)
    } else {
      ctx.clearRect(0, 0, this.pw, this.ph)
    }
    ctx.drawImage(this.reveal, 0, 0)
    // 描き終わったら、画像全体をふわっと出す（薄い影やなぞり残しがあっても、最後は必ず元の絵になる）
    if (s.finishFull && this.assets.image && t > this.timeline.drawEnd && this.timeline.segments.length > 0) {
      ctx.globalAlpha = clamp((t - this.timeline.drawEnd) / 350, 0, 1)
      ctx.drawImage(this.assets.image, 0, 0, this.pw, this.ph)
      ctx.globalAlpha = 1
    }

    if (o.hand !== false && s.showHand && this.assets.hand && this.project.hand) {
      const st = handStateAt(this.timeline, t, this.width, this.height, s.handFollowDirection)
      // 手は画像の座標で描く（内部の解像度に合わせて縮める）
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0)
      this.drawHand(st)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
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
