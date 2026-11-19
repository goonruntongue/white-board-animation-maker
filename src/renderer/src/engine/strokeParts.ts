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
export function replaceStrokePart(stroke: Stroke, partIndex: number, recording: StrokePoint[], width?: number): Stroke | null {
  const part = strokeParts(stroke)[partIndex]
  if (!part || !recording.length) return null
  // 描き直す太さ（省略時は元の線の太さ）
  const w = Math.max(1, Math.round(width ?? part.width))
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
    if (i === 0 && part.start > 0) { point.b = 1; point.w = w }
    return point
  })
  const result: Stroke = {
    ...stroke,
    points: [...timed.slice(0, part.start), ...replacement, ...timed.slice(part.end + 1)],
    useRecordedTiming: true,
    clip: addRevealMark(stroke.clip, recording, w, partIndex)
  }
  // 最初の線の太さはグループの基本の太さなので、ほかの線の見た目を変えずに付け替える
  return partIndex === 0 && w !== Math.round(stroke.revealWidth) ? setPartWidth(result, 0, w) : result
}

/**
 * 線を、partIndex 番目の線のすぐ後ろに入れる（ブラシの「追加」）。入れた線は partIndex + 1 番目になる。
 * 時刻は、前の線を描き終えてから少し間をあけ（ペンを上げて移動する時間）、なぞった速さで描く。後ろの線はその分だけ遅れる。
 * 線ごとの表示範囲（消しゴムの跡など）の番号も1つずらす。
 */
export function insertStrokePartAfter(stroke: Stroke, partIndex: number, recording: StrokePoint[], width: number): Stroke | null {
  const parts = strokeParts(stroke)
  const part = parts[partIndex]
  if (!part || recording.length === 0) return null
  const LIFT = 350
  const w = Math.max(1, Math.round(width))
  const timed = pinWidths(timedPoints(stroke), stroke.revealWidth)
  const startT = timed[part.end].t + LIFT
  const t0 = recording[0].t
  const span = Math.max(150, recording[recording.length - 1].t - t0)
  const inserted: StrokePoint[] = recording.map((p, i) => ({
    x: Math.round(p.x * 10) / 10,
    y: Math.round(p.y * 10) / 10,
    t: Math.round(startT + Math.max(0, p.t - t0)),
    ...(i === 0 ? { b: 1 as const, ...(w !== Math.round(stroke.revealWidth) ? { w } : {}) } : {})
  }))
  if (inserted.length === 1) inserted.push({ ...inserted[0], x: inserted[0].x + 0.1, t: inserted[0].t + 50, b: undefined, w: undefined })
  const shift = LIFT + span
  const after = timed.slice(part.end + 1).map((p) => ({ ...p, t: Math.round(p.t + shift) }))
  const points = [...timed.slice(0, part.end + 1).map((p) => ({ ...p, t: Math.round(p.t) })), ...inserted, ...after].map((p) => {
    const { b, w: pw, ...rest } = p
    return { ...rest, ...(b ? { b } : {}), ...(pw !== undefined ? { w: pw } : {}) } as StrokePoint
  })
  const at = partIndex + 1
  const marks = recording.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }))
  return {
    ...stroke,
    points,
    duration: Math.max(50, Math.round(stroke.duration + shift)),
    useRecordedTiming: true,
    clip: addRevealMark(remapClipLines(stroke.clip, (l) => (l >= at ? l + 1 : l)), marks, w, at)
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

/** 線ごとの時間（ms）。draw：その線を描く時間 / gap：前の線を描き終えてから、この線を描き始めるまで（最初の線は 0） */
export interface PartTiming {
  draw: number
  gap: number
}

/** いまの再生での、線ごとの時間（グループの再生時間を、点の時刻の割合で分けたもの） */
export function partTimings(stroke: Stroke): PartTiming[] {
  const prep = prepareStroke(stroke)
  const d = stroke.duration
  return prep.parts.map((part, i) => ({
    draw: Math.max(0, (prep.param[part.end] - prep.param[part.start]) * d),
    gap: i === 0 ? 0 : Math.max(0, (prep.param[part.start] - prep.param[prep.parts[i - 1].end]) * d)
  }))
}

/**
 * 線ごとの時間を決める。点の時刻を付け直し（線の中の緩急はそのまま）、グループの再生時間をその合計にする。
 * 時刻とミリ秒が 1:1 になるので、決めた秒数どおりに再生される（作品全体の速さの倍率はかかる）。
 */
export function setPartTimings(stroke: Stroke, timings: PartTiming[]): Stroke {
  return applyPartTimings(stroke, timings)
}

/** 線の長さ（ペンが実際に動いた道のり。画像の px） */
export function partLength(stroke: Stroke, partIndex: number): number {
  const part = strokeParts(stroke)[partIndex]
  if (!part) return 0
  let len = 0
  for (let j = part.start + 1; j <= part.end; j++) len += Math.hypot(stroke.points[j].x - stroke.points[j - 1].x, stroke.points[j].y - stroke.points[j - 1].y)
  return len
}

/** ペンの速さ（px / 秒）で描いたときの、その長さの線を描く時間（ms）。点のように短い線でも 0.1 秒は取る */
export function drawMsAt(length: number, pxPerSec: number): number {
  return Math.max(100, Math.round((length / Math.max(1, pxPerSec)) * 1000))
}

/** 1本の線の描く時間だけを変える（線の中の緩急・ほかの線の時間・線と線の間はそのまま。後ろの線はずれる） */
export function setPartDraw(stroke: Stroke, partIndex: number, drawMs: number): Stroke {
  const timings = partTimings(stroke)
  if (!timings[partIndex]) return stroke
  timings[partIndex] = { ...timings[partIndex], draw: drawMs }
  return applyPartTimings(stroke, timings)
}

/** グループのすべての線を、ペンの速さ（px / 秒）にそろえる（線と線の間はそのまま） */
export function paceAllParts(stroke: Stroke, pxPerSec: number): Stroke {
  const timings = partTimings(stroke).map((tm, i) => ({ ...tm, draw: drawMsAt(partLength(stroke, i), pxPerSec) }))
  return applyPartTimings(stroke, timings)
}

function applyPartTimings(stroke: Stroke, timings: PartTiming[]): Stroke {
  const prep = prepareStroke(stroke)
  const pts = stroke.points
  const points: StrokePoint[] = pts.map((p) => ({ ...p }))
  let clock = 0
  prep.parts.forEach((part, i) => {
    const tm = timings[i] ?? { draw: 300, gap: 0 }
    const draw = Math.max(50, tm.draw)
    if (i > 0) clock += Math.max(0, tm.gap)
    const p0 = prep.param[part.start]
    const span = prep.param[part.end] - p0
    // 線の中の位置（0〜1）：いまの緩急を保つ。時間の幅がない線は長さの割合で
    let len = 0
    const cum = [0]
    for (let j = part.start + 1; j <= part.end; j++) {
      len += Math.hypot(pts[j].x - pts[j - 1].x, pts[j].y - pts[j - 1].y)
      cum.push(len)
    }
    for (let j = part.start; j <= part.end; j++) {
      const u = span > 1e-9 ? (prep.param[j] - p0) / span : len > 0 ? cum[j - part.start] / len : part.end > part.start ? (j - part.start) / (part.end - part.start) : 0
      points[j].t = Math.round(clock + u * draw)
    }
    clock += draw
  })
  return { ...stroke, points, duration: Math.max(50, Math.round(clock)), useRecordedTiming: true }
}
