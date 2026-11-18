// パス編集：軌跡の中の1本の線（点の並び）を、アンカーポイントとハンドルを持つ曲線（3次ベジェ）として扱う。
//  ・fitPath     … 点の並びを間引いてアンカーにし、なめらかにつながるハンドルを付ける
//  ・applyPath   … 曲線に沿って点を作り直し、線を描く時間はそのまま、長さに沿って配り直す
//  ・insertAnchor / removeAnchor … アンカーの追加・削除（形はできるだけ保つ）
// 曲線そのものは保存しない（保存されるのは作り直した点の並び）。もう一度パス編集を始めると、点の並びから作り直す。
import { strokeParts } from './strokeParts'
import type { Stroke, StrokePoint } from './types'

export interface PathNode {
  x: number
  y: number
  /** 入ってくる側のハンドル（絶対座標） */
  inX: number
  inY: number
  /** 出ていく側のハンドル（絶対座標） */
  outX: number
  outY: number
}

type Pt = { x: number; y: number }

/** 線の点を間引く（Ramer–Douglas–Peucker）。残す点の番号を返す */
function simplify(points: Pt[], eps: number): number[] {
  const n = points.length
  if (n <= 2) return points.map((_, i) => i)
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const A = points[a]
    const B = points[b]
    const dx = B.x - A.x
    const dy = B.y - A.y
    const len = Math.hypot(dx, dy)
    let best = -1
    let bestD = eps
    for (let i = a + 1; i < b; i++) {
      const P = points[i]
      const d = len > 0 ? Math.abs(dy * P.x - dx * P.y + B.x * A.y - B.y * A.x) / len : Math.hypot(P.x - A.x, P.y - A.y)
      if (d > bestD) {
        bestD = d
        best = i
      }
    }
    if (best >= 0) {
      keep[best] = 1
      stack.push([a, best], [best, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i)
  return out
}

/** 点の並びから、アンカーとハンドルを作る（Catmull-Rom の接線で、なめらかにつなぐ） */
export function fitPath(points: Pt[], eps: number): PathNode[] {
  const pts = points.length === 1 ? [points[0], { x: points[0].x + 1, y: points[0].y }] : points
  const idx = simplify(pts, Math.max(0.5, eps))
  // 長い直線区間でも曲げられるよう、アンカーの間隔が広すぎるときは間に足す
  const anchors: Pt[] = []
  for (let k = 0; k < idx.length; k++) {
    const P = pts[idx[k]]
    if (k > 0) {
      const Q = anchors[anchors.length - 1]
      const gap = Math.hypot(P.x - Q.x, P.y - Q.y)
      const extra = Math.min(6, Math.floor(gap / (eps * 40)))
      for (let e = 1; e <= extra; e++) {
        // 元の点列の上から選ぶ（直線上に並べるより、線の形に沿う）
        const j = Math.round(idx[k - 1] + ((idx[k] - idx[k - 1]) * e) / (extra + 1))
        anchors.push({ x: pts[j].x, y: pts[j].y })
      }
    }
    anchors.push({ x: P.x, y: P.y })
  }
  return anchors.map((p, i) => {
    const prev = anchors[i - 1]
    const next = anchors[i + 1]
    // 端は、となりへ向かう方向に短いハンドル
    const tx = prev && next ? (next.x - prev.x) / 6 : next ? (next.x - p.x) / 3 : prev ? (p.x - prev.x) / 3 : 0
    const ty = prev && next ? (next.y - prev.y) / 6 : next ? (next.y - p.y) / 3 : prev ? (p.y - prev.y) / 3 : 0
    return {
      x: p.x,
      y: p.y,
      inX: prev ? p.x - tx : p.x,
      inY: prev ? p.y - ty : p.y,
      outX: next ? p.x + tx : p.x,
      outY: next ? p.y + ty : p.y
    }
  })
}

function bez(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d
}

/** 曲線に沿って点を打つ（およそ step px おき） */
export function samplePath(nodes: PathNode[], step = 3): Pt[] {
  if (nodes.length === 0) return []
  const out: Pt[] = [{ x: nodes[0].x, y: nodes[0].y }]
  for (let i = 0; i + 1 < nodes.length; i++) {
    const A = nodes[i]
    const B = nodes[i + 1]
    const approx =
      Math.hypot(A.outX - A.x, A.outY - A.y) + Math.hypot(B.inX - A.outX, B.inY - A.outY) + Math.hypot(B.x - B.inX, B.y - B.inY)
    const count = Math.max(1, Math.min(400, Math.ceil(approx / step)))
    for (let k = 1; k <= count; k++) {
      const t = k / count
      out.push({ x: bez(A.x, A.outX, B.inX, B.x, t), y: bez(A.y, A.outY, B.inY, B.y, t) })
    }
  }
  return out
}

/** 線の点（パス編集の元になる点の並び） */
export function partPoints(stroke: Stroke, partIndex: number): Pt[] {
  const part = strokeParts(stroke)[partIndex]
  if (!part) return []
  return stroke.points.slice(part.start, part.end + 1).map((p) => ({ x: p.x, y: p.y }))
}

/** アンカーにする間引きの細かさ：ペンの太さに合わせる（細い線ほど細かく） */
export function fitTolerance(stroke: Stroke, partIndex: number): number {
  const part = strokeParts(stroke)[partIndex]
  return Math.max(1.5, Math.min(10, (part?.width ?? stroke.revealWidth) * 0.12))
}

/**
 * 曲線に沿って作った点で、線の点を置き換える。
 * 線を描く時間（最初の点〜最後の点の時刻）はそのまま、曲線の長さに沿って配り直す。
 * 書き始めの点の「ペンを上げる」「太さ」の印も引き継ぐ。
 */
export function applyPath(stroke: Stroke, partIndex: number, nodes: PathNode[]): Stroke {
  const part = strokeParts(stroke)[partIndex]
  if (!part || nodes.length === 0) return stroke
  const sampled = samplePath(nodes)
  const first = stroke.points[part.start]
  const t0 = first.t
  const t1 = stroke.points[part.end].t
  const cum = [0]
  for (let i = 1; i < sampled.length; i++) cum.push(cum[i - 1] + Math.hypot(sampled[i].x - sampled[i - 1].x, sampled[i].y - sampled[i - 1].y))
  const total = cum[cum.length - 1] || 1
  const r1 = (v: number): number => Math.round(v * 10) / 10
  const replaced: StrokePoint[] = sampled.map((p, i) => {
    const q: StrokePoint = { x: r1(p.x), y: r1(p.y), t: Math.round(t0 + ((t1 - t0) * cum[i]) / total) }
    if (i === 0) {
      if (first.b) q.b = 1
      if (first.w !== undefined) q.w = first.w
    }
    return q
  })
  if (replaced.length === 1) replaced.push({ x: replaced[0].x + 0.1, y: replaced[0].y, t: t1 })
  const points = [...stroke.points.slice(0, part.start), ...replaced, ...stroke.points.slice(part.end + 1)]
  return { ...stroke, points }
}

/** 曲線の上で (x, y) にいちばん近い所：区間の番号と、区間の中の位置 t */
export function nearestOnPath(nodes: PathNode[], x: number, y: number): { seg: number; t: number; dist: number } | null {
  let best: { seg: number; t: number; dist: number } | null = null
  for (let i = 0; i + 1 < nodes.length; i++) {
    const A = nodes[i]
    const B = nodes[i + 1]
    for (let k = 0; k <= 40; k++) {
      const t = k / 40
      const d = Math.hypot(bez(A.x, A.outX, B.inX, B.x, t) - x, bez(A.y, A.outY, B.inY, B.y, t) - y)
      if (!best || d < best.dist) best = { seg: i, t, dist: d }
    }
  }
  return best
}

/** 区間 seg の位置 t にアンカーを足す（ド・カステリョの分割で、形を変えない） */
export function insertAnchor(nodes: PathNode[], seg: number, t: number): PathNode[] {
  const A = nodes[seg]
  const B = nodes[seg + 1]
  if (!A || !B) return nodes
  const lerp = (p: Pt, q: Pt): Pt => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
  const p0 = { x: A.x, y: A.y }
  const p1 = { x: A.outX, y: A.outY }
  const p2 = { x: B.inX, y: B.inY }
  const p3 = { x: B.x, y: B.y }
  const a = lerp(p0, p1)
  const b = lerp(p1, p2)
  const c = lerp(p2, p3)
  const d = lerp(a, b)
  const e = lerp(b, c)
  const m = lerp(d, e)
  const out = nodes.map((n) => ({ ...n }))
  out[seg] = { ...out[seg], outX: a.x, outY: a.y }
  out[seg + 1] = { ...out[seg + 1], inX: c.x, inY: c.y }
  out.splice(seg + 1, 0, { x: m.x, y: m.y, inX: d.x, inY: d.y, outX: e.x, outY: e.y })
  return out
}

/** 区間 seg（nodes[seg]→nodes[seg+1]）の上の点を n 個取る（端は含めない） */
function segmentSamples(A: PathNode, B: PathNode, n: number): Pt[] {
  const out: Pt[] = []
  for (let k = 1; k < n; k++) {
    const t = k / n
    out.push({ x: bez(A.x, A.outX, B.inX, B.x, t), y: bez(A.y, A.outY, B.inY, B.y, t) })
  }
  return out
}

/**
 * 端 A・B と、その向き（tA：A から出る向き、tB：B へ入る向きの逆＝B から A 側へ出る向き）を保ったまま、
 * 点の並び pts にいちばん近くなるハンドルの長さを求める（最小二乗。Illustrator・Schneider の方法と同じ考え方）。
 */
function fitHandles(A: Pt, B: Pt, tA: Pt, tB: Pt, pts: Pt[]): [number, number] {
  const all = [A, ...pts, B]
  // 弦の長さで各点の位置 t を決め、ニュートン法で少しずつ曲線上のいちばん近い所へ寄せる
  const cum = [0]
  for (let i = 1; i < all.length; i++) cum.push(cum[i - 1] + Math.hypot(all[i].x - all[i - 1].x, all[i].y - all[i - 1].y))
  const total = cum[cum.length - 1] || 1
  const ts = cum.map((c) => c / total)
  const chord = Math.hypot(B.x - A.x, B.y - A.y)
  let alpha: [number, number] = [chord / 3, chord / 3]
  for (let iter = 0; iter < 4; iter++) {
    let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0
    for (let i = 0; i < all.length; i++) {
      const t = ts[i]
      const u = 1 - t
      const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t
      const a1 = { x: tA.x * b1, y: tA.y * b1 }
      const a2 = { x: tB.x * b2, y: tB.y * b2 }
      c00 += a1.x * a1.x + a1.y * a1.y
      c01 += a1.x * a2.x + a1.y * a2.y
      c11 += a2.x * a2.x + a2.y * a2.y
      const rx = all[i].x - (A.x * (b0 + b1) + B.x * (b2 + b3))
      const ry = all[i].y - (A.y * (b0 + b1) + B.y * (b2 + b3))
      x0 += a1.x * rx + a1.y * ry
      x1 += a2.x * rx + a2.y * ry
    }
    const det = c00 * c11 - c01 * c01
    let a = Math.abs(det) > 1e-9 ? (x0 * c11 - x1 * c01) / det : chord / 3
    let b = Math.abs(det) > 1e-9 ? (c00 * x1 - c01 * x0) / det : chord / 3
    // 向きが逆になる・長すぎる答えは、形が崩れるので使わない
    if (!(a > chord * 0.02) || !(b > chord * 0.02) || a > chord * 2 || b > chord * 2) {
      a = chord / 3
      b = chord / 3
    }
    alpha = [a, b]
    // t を曲線上のいちばん近い所へ寄せる（ニュートン法 1 歩）
    const P1 = { x: A.x + tA.x * a, y: A.y + tA.y * a }
    const P2 = { x: B.x + tB.x * b, y: B.y + tB.y * b }
    for (let i = 1; i < all.length - 1; i++) {
      const t = ts[i]
      const u = 1 - t
      const qx = u * u * u * A.x + 3 * u * u * t * P1.x + 3 * u * t * t * P2.x + t * t * t * B.x
      const qy = u * u * u * A.y + 3 * u * u * t * P1.y + 3 * u * t * t * P2.y + t * t * t * B.y
      const d1x = 3 * (u * u * (P1.x - A.x) + 2 * u * t * (P2.x - P1.x) + t * t * (B.x - P2.x))
      const d1y = 3 * (u * u * (P1.y - A.y) + 2 * u * t * (P2.y - P1.y) + t * t * (B.y - P2.y))
      const d2x = 6 * (u * (P2.x - 2 * P1.x + A.x) + t * (B.x - 2 * P2.x + P1.x))
      const d2y = 6 * (u * (P2.y - 2 * P1.y + A.y) + t * (B.y - 2 * P2.y + P1.y))
      const ex = qx - all[i].x
      const ey = qy - all[i].y
      const den = d1x * d1x + d1y * d1y + ex * d2x + ey * d2y
      if (Math.abs(den) > 1e-9) ts[i] = Math.max(0, Math.min(1, t - (ex * d1x + ey * d1y) / den))
    }
  }
  return alpha
}

const unit = (x: number, y: number): Pt | null => {
  const l = Math.hypot(x, y)
  return l > 1e-6 ? { x: x / l, y: y / l } : null
}

/**
 * アンカーを消す（2つ未満にはしない）。
 * 途中のアンカーを消すときは、消す前の曲線の形にできるだけ沿うよう、両どなりのハンドルの長さを計算し直す
 * （ハンドルをそのままにすると、短いハンドルで長い区間を結ぶことになり、アンカーの所だけ急に曲がる折れ線のような形になる）。
 */
export function removeAnchor(nodes: PathNode[], index: number): PathNode[] {
  if (nodes.length <= 2 || index < 0 || index >= nodes.length) return nodes
  if (index > 0 && index < nodes.length - 1) {
    const A = nodes[index - 1]
    const M = nodes[index]
    const B = nodes[index + 1]
    // 消す前の2つの区間に沿った点（形の手本）
    const pts = [...segmentSamples(A, M, 24), { x: M.x, y: M.y }, ...segmentSamples(M, B, 24)]
    // 向き：ハンドルの向きを保つ（ハンドルがない角のアンカーは、手本の最初・最後の点の向き）
    const tA = unit(A.outX - A.x, A.outY - A.y) ?? unit(pts[0].x - A.x, pts[0].y - A.y) ?? unit(B.x - A.x, B.y - A.y) ?? { x: 1, y: 0 }
    const last = pts[pts.length - 1]
    const tB = unit(B.inX - B.x, B.inY - B.y) ?? unit(last.x - B.x, last.y - B.y) ?? unit(A.x - B.x, A.y - B.y) ?? { x: -1, y: 0 }
    const [a, b] = fitHandles(A, B, tA, tB, pts)
    const out = nodes.map((n) => ({ ...n }))
    out[index - 1] = { ...out[index - 1], outX: A.x + tA.x * a, outY: A.y + tA.y * a }
    out[index + 1] = { ...out[index + 1], inX: B.x + tB.x * b, inY: B.y + tB.y * b }
    // なめらかなアンカー（反対側のハンドルと一直線）は、反対側の長さはそのままで向きだけそろったまま
    out.splice(index, 1)
    return out
  }
  const out = nodes.filter((_, i) => i !== index)
  // 端のアンカーを消したときは、新しい端の外側のハンドルをアンカーに戻す
  if (index === 0) out[0] = { ...out[0], inX: out[0].x, inY: out[0].y }
  if (index === nodes.length - 1) {
    const L = out.length - 1
    out[L] = { ...out[L], outX: out[L].x, outY: out[L].y }
  }
  return out
}
