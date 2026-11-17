// 軌跡の中の「線」（ペンを下ろしてから上げるまでの区間）を扱う。
// 1本の軌跡は、ペンを上げた点（b: 1）で区切られた複数の線からなる。線ごとに見せる幅（ペンの太さ）を持てる：
//   ・最初の線の太さ … 軌跡の revealWidth
//   ・2本目以降の線  … その線の書き始め（b: 1 の点）の w。なければ revealWidth
// レンダラー（wb-engine の partWidth）と同じ決まりで読む。
import type { ClipRegion, ClipShape, Stroke, StrokePoint } from './types'
import { hasLineClips, prepareStroke } from './wb-engine'
import { addRevealMark, remapClipLines } from './selection'

export interface StrokePart {
  /** 線の書き始めの点の番号（最初の線は 0、ほかは b: 1 の点） */
  start: number
  /** 線の最後の点の番号 */
  end: number
  /** この線のペンの太さ（画像の px） */
  width: number
}

/** 軌跡を線に分ける */
export function strokeParts(stroke: Stroke): StrokePart[] {
  const pts = stroke.points
  const parts: StrokePart[] = []
  let start = 0
  for (let i = 1; i <= pts.length; i++) {
    if (i === pts.length || pts[i].b) {
      parts.push({ start, end: i - 1, width: start === 0 ? stroke.revealWidth : pts[start].w || stroke.revealWidth })
      start = i
    }
  }
  return parts
}

/** 点ごとの時刻（グループの書き始めからの ms）を付けた点の並び */
function timedPoints(stroke: Stroke): StrokePoint[] {
  const prep = prepareStroke(stroke)
  const duration = Math.max(50, stroke.duration)
  return stroke.points.map((p, i) => ({ ...p, t: prep.param[i] * duration }))
}

/** 「基本の太さ」を使っている2本目以降の線に、いまの太さを書き込んで固定する（基本の太さを変える前に使う） */
function pinWidths(points: StrokePoint[], base: number): StrokePoint[] {
  return points.map((p, i) => (i > 0 && p.b && p.w === undefined ? { ...p, w: base } : p))
}

/**
 * グループから1本の線を消す。ほかの線と、その描くタイミングは保つ（消した線を描いていた時間だけ詰める）。
 * 線が1本しかないときは null（グループごと消すかどうかは呼び出し側で決める）
 */
export function removeStrokePart(stroke: Stroke, partIndex: number): Stroke | null {
  const parts = strokeParts(stroke)
  const part = parts[partIndex]
  if (!part || parts.length < 2) return null
  const timed = timedPoints(stroke)
  const before = timed.slice(0, part.start)
  let after = timed.slice(part.end + 1)
  let revealWidth = stroke.revealWidth
  if (after.length) {
    const shift = after[0].t - timed[part.start].t
    after = pinWidths(after, stroke.revealWidth).map((p) => ({ ...p, t: Math.round(p.t - shift) }))
    if (partIndex === 0) {
      // 2本目の線が最初の線になる：その太さをグループの基本の太さにし、書き始めの印を外す
      revealWidth = parts[1].width
      const { b: _b, w: _w, ...head } = after[0]
      after[0] = head
    }
  }
  const points = [...before, ...after].map((p) => ({ ...p, t: Math.round(p.t) }))
  return {
    ...stroke,
    points,
    revealWidth,
    duration: Math.max(50, points[points.length - 1].t),
    useRecordedTiming: true,
    // 消した線だけに効いていた範囲は外し、後ろの線の番号を1つ詰める
    clip: remapClipLines(stroke.clip, (l) => (l === partIndex ? null : l > partIndex ? l - 1 : l))
  }
}

/**
 * グループを、partIndex 番目の線の手前で2つに分ける（結合の逆）。
 * 描くタイミングは保つ：前半の最後の線から後半の書き始めまでの移動時間は、前半の「待ち時間」になる。
 * 表示範囲は、両方とも元のグループの範囲を使う。
 */
export function splitStrokeAt(stroke: Stroke, partIndex: number, secondId: string): [Stroke, Stroke] | null {
  const parts = strokeParts(stroke)
  const part = parts[partIndex]
  if (!part || partIndex === 0) return null
  const timed = timedPoints(stroke)
  const cut = timed[part.start].t
  const prevEnd = timed[part.start - 1].t
  const firstPoints = timed.slice(0, part.start).map((p) => ({ ...p, t: Math.round(p.t) }))
  const rest = pinWidths(timed.slice(part.start), stroke.revealWidth).map((p) => ({ ...p, t: Math.round(p.t - cut) }))
  const { b: _b, w: _w, ...head } = rest[0]
  rest[0] = head
  const first: Stroke = {
    ...stroke,
    points: firstPoints,
    duration: Math.max(50, Math.round(prevEnd)),
    delayAfter: Math.max(0, Math.round(cut - prevEnd)),
    useRecordedTiming: true,
    clip: remapClipLines(stroke.clip, (l) => (l < partIndex ? l : null))
  }
  const second: Stroke = {
    ...stroke,
    id: secondId,
    name: `${stroke.name} の続き`,
    points: rest,
    revealWidth: part.width,
    duration: Math.max(50, Math.round(Math.max(50, stroke.duration) - cut)),
    delayAfter: stroke.delayAfter,
    useRecordedTiming: true,
    clip: remapClipLines(stroke.clip, (l) => (l >= partIndex ? l - partIndex : null))
  }
  return [first, second]
}

/** 1本の線だけを手描きで置き換え、他の線と元の再生時間を保つ。 */
export function replaceStrokePart(stroke: Stroke, partIndex: number, recording: StrokePoint[]): Stroke | null {
  const part = strokeParts(stroke)[partIndex]
  if (!part || !recording.length) return null
  const prep = prepareStroke(stroke)
  const duration = Math.max(50, stroke.duration)
  const timed = stroke.points.map((p, i) => ({ ...p, t: prep.param[i] * duration }))
  const start = timed[part.start].t
  const end = timed[part.end].t
  const t0 = recording[0].t
  const span = recording[recording.length - 1].t - t0
  const replacement = recording.map((p, i) => {
    const ratio = span > 0 ? (p.t - t0) / span : recording.length > 1 ? i / (recording.length - 1) : 0
    const point: StrokePoint = { x: p.x, y: p.y, t: start + (end - start) * ratio }
    if (i === 0 && part.start > 0) { point.b = 1; point.w = part.width }
    return point
  })
  return {
    ...stroke,
    points: [...timed.slice(0, part.start), ...replacement, ...timed.slice(part.end + 1)],
    useRecordedTiming: true,
    clip: addRevealMark(stroke.clip, recording, part.width, partIndex)
  }
}

/** 1本の線の太さだけを変える（ほかの線の見た目は変えない） */
export function setPartWidth(stroke: Stroke, partIndex: number, width: number): Stroke {
  const parts = strokeParts(stroke)
  const part = parts[partIndex]
  if (!part) return stroke
  const w = Math.max(1, Math.round(width))
  const points = stroke.points.map((p) => ({ ...p }))
  if (partIndex === 0) {
    // 最初の線の太さ＝軌跡の基本の太さ。ほかの線が基本の太さを使っていたら、いまの太さを書き込んで固定する
    for (const q of parts.slice(1)) if (!points[q.start].w) points[q.start].w = stroke.revealWidth
    return { ...stroke, points, revealWidth: w }
  }
  points[part.start].w = w
  return { ...stroke, points }
}

/** 軌跡のすべての線を同じ太さにする */
export function setAllPartsWidth(stroke: Stroke, width: number): Stroke {
  const w = Math.max(1, Math.round(width))
  const points = stroke.points.map((p) => {
    if (p.w === undefined) return p
    const { w: _drop, ...rest } = p
    return rest
  })
  return { ...stroke, points, revealWidth: w }
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

/**
 * (x, y) にある線を探す。ペンの太さの範囲（＋tolerance）に入っている線のうち、中心線がいちばん近いもの。
 * 再生から外した軌跡は対象にしない。
 */
export function hitPart(strokes: Stroke[], x: number, y: number, tolerance: number): { strokeId: string; part: number } | null {
  let best: { strokeId: string; part: number } | null = null
  let bestScore = Infinity
  for (const s of strokes) {
    if (s.hidden || s.points.length === 0) continue
    const parts = strokeParts(s)
    parts.forEach((part, pi) => {
      const r = part.width / 2 + tolerance
      let d = Infinity
      const pts = s.points
      if (part.end === part.start) d = Math.hypot(pts[part.start].x - x, pts[part.start].y - y)
      for (let i = part.start + 1; i <= part.end; i++) d = Math.min(d, distToSegment(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y))
      if (d > r) return
      // 中心線に近いものを選ぶ（太い線の端をかすっただけのものより、細くても真上にある線を優先）
      const score = d / Math.max(1, part.width / 2)
      if (score < bestScore) {
        bestScore = score
        best = { strokeId: s.id, part: pi }
      }
    })
  }
  return best
}

/** 線の中心（外接矩形の中心） */
export function partCenter(stroke: Stroke, partIndex: number): { x: number; y: number } | null {
  const part = strokeParts(stroke)[partIndex]
  if (!part) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let i = part.start; i <= part.end; i++) {
    const p = stroke.points[i]
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }
}

/**
 * 1本の線の点を動かす・拡大縮小する（中心 c を基準に scale 倍してから dx, dy だけずらす）。
 * 動くのはペンの通り道で、絵のインクそのものは動かない（その線で見せる場所が変わる）。
 */
export function transformPart(stroke: Stroke, partIndex: number, dx: number, dy: number, scale = 1, c?: { x: number; y: number }): Stroke {
  const part = strokeParts(stroke)[partIndex]
  if (!part) return stroke
  const center = c ?? partCenter(stroke, partIndex)!
  const r1 = (v: number): number => Math.round(v * 10) / 10
  const points = stroke.points.map((p, i) =>
    i < part.start || i > part.end ? p : { ...p, x: r1(center.x + (p.x - center.x) * scale + dx), y: r1(center.y + (p.y - center.y) * scale + dy) }
  )
  return { ...stroke, points }
}

/**
 * 2本の軌跡を1本にまとめる（first の後ろに second をつなぐ。並び順は first → second）。
 *  ・描くタイミングはそのまま：first を描く → first の待ち時間（この間にペンを上げて移動）→ second を描く
 *  ・second の書き始めはペンを上げた点になり、線ごとの太さもそのまま引き継ぐ
 *  ・表示範囲：同じなら共有。違えば、それぞれの線に元のグループの範囲だけが効くよう、線の番号を付けて並べる
 */
export function mergeStrokes(first: Stroke, second: Stroke): Stroke {
  const timed = (s: Stroke, offset: number): StrokePoint[] => {
    const prep = prepareStroke(s)
    return s.points.map((p, i) => ({ ...p, t: Math.round(offset + prep.param[i] * s.duration) }))
  }
  const a = timed(first, 0)
  const gapStart = first.duration + Math.max(0, first.delayAfter)
  const b = timed(second, gapStart).map((p, i) => {
    if (i === 0) return { ...p, b: 1 as const, w: second.revealWidth }
    // second の中で「基本の太さ」を使っていた線は、その太さを書き込んで固定する
    if (p.b && p.w === undefined) return { ...p, w: second.revealWidth }
    return p
  })
  let clip: ClipRegion | undefined
  const tagged = hasLineClips(first.clip) || hasLineClips(second.clip)
  if (!tagged && !first.clip && !second.clip) clip = undefined
  else if (!tagged && first.clip && second.clip && JSON.stringify(first.clip) === JSON.stringify(second.clip)) clip = first.clip
  else {
    // 範囲が違う：それぞれの線には、元のグループの範囲だけが効くよう線の番号を付ける
    const nA = strokeParts(first).length
    const nB = strokeParts(second).length
    const own = (c: ClipRegion | undefined, n: number, offset: number): ClipShape[] => {
      const all = Array.from({ length: n }, (_, i) => offset + i)
      if (!c || c.shapes.length === 0) return [{ kind: 'all', mode: 'add', lines: all }]
      return c.shapes.map((s) => ({ ...s, lines: s.lines ? s.lines.map((l) => l + offset) : all }))
    }
    clip = { shapes: [...own(first.clip, nA, 0), ...own(second.clip, nB, nA)] }
  }
  return {
    ...first,
    points: [...a, ...b],
    duration: Math.max(50, gapStart + second.duration),
    delayAfter: second.delayAfter,
    useRecordedTiming: true,
    clip
  }
}

/** 軌跡全体の中心（外接矩形の中心） */
export function strokeCenter(stroke: Stroke): { x: number; y: number } {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of stroke.points) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }
}

/** 軌跡全体を動かす・拡大縮小する（中心 c を基準に scale 倍してから dx, dy だけずらす） */
export function transformStroke(stroke: Stroke, dx: number, dy: number, scale = 1, c?: { x: number; y: number }): Stroke {
  const center = c ?? strokeCenter(stroke)
  const r1 = (v: number): number => Math.round(v * 10) / 10
  return {
    ...stroke,
    points: stroke.points.map((p) => ({ ...p, x: r1(center.x + (p.x - center.x) * scale + dx), y: r1(center.y + (p.y - center.y) * scale + dy) }))
  }
}

/**
 * 軌跡のすべての線の太さを、同じ割合で変える（自動で作った軌跡の、線ごとの太さの違いは保つ）。
 * 基準は最初の線の太さ（revealWidth）を width にする倍率。
 */
export function setStrokeWidthKeepRatio(stroke: Stroke, width: number): Stroke {
  const w = Math.max(1, Math.round(width))
  const f = w / Math.max(1, stroke.revealWidth)
  if (f === 1) return stroke
  const points = stroke.points.map((p) => (p.w === undefined ? p : { ...p, w: Math.max(1, Math.round(p.w * f)) }))
  return { ...stroke, points, revealWidth: w }
}
