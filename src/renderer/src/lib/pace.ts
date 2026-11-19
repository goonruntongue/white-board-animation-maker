// なぞった線の速さ：既定では、自動で線を作ったときと同じペンの速さに直す（線の長さ ÷ 自動の速さ。線の中の緩急はそのまま）。
// ブラシの ▼ の「なぞった速さのまま残す」をオンにすると、なぞった時間をそのまま使う。端末ごとに localStorage に覚えておく。
import { useSyncExternalStore } from 'react'
import { autoPenSpeed, type AutoSpeed } from '../engine/autoTrace'
import type { StrokePoint } from '../engine/types'

const KEY = 'wbam.keepTracedPace'
const listeners = new Set<() => void>()
let keep = ((): boolean => {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
})()

export function getKeepTracedPace(): boolean {
  return keep
}

export function setKeepTracedPace(v: boolean): void {
  keep = v
  try {
    localStorage.setItem(KEY, v ? 'on' : 'off')
  } catch {
    // 保存できなくても、切り替え自体は行う
  }
  listeners.forEach((l) => l())
}

export function useKeepTracedPace(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => keep
  )
}

/** 自動で線を作るときのペンの速さ（画像の px / 秒）。「自動」の画面で前回選んだ速さを使う */
export function autoPace(imageWidth: number): number {
  let speed: AutoSpeed = 'normal'
  try {
    const s = (JSON.parse(localStorage.getItem('wbam.autoTrace') ?? '{}') as { speed?: AutoSpeed }).speed
    if (s === 'slow' || s === 'normal' || s === 'fast') speed = s
  } catch {
    // 読めなければ「ふつう」
  }
  return autoPenSpeed(imageWidth, speed)
}

/** 点の並びの長さ（画像の px） */
export function pathLength(points: { x: number; y: number }[]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  return len
}

/** なぞった線を描く時間（ms）：既定は自動の速さ、「なぞった速さのまま残す」ならなぞった時間 */
export function tracedDrawMs(points: StrokePoint[], imageWidth: number): number {
  if (keep) return Math.max(100, points.length > 1 ? points[points.length - 1].t - points[0].t : 0)
  return Math.max(100, Math.round((pathLength(points) / autoPace(imageWidth)) * 1000))
}

/** なぞった線の時刻を、描く時間が tracedDrawMs になるよう一様に縮める・伸ばす（線の中の緩急はそのまま） */
export function pacedRecording(points: StrokePoint[], imageWidth: number): StrokePoint[] {
  if (points.length < 2) return points
  const t0 = points[0].t
  const span = points[points.length - 1].t - t0
  const target = tracedDrawMs(points, imageWidth)
  if (span <= 0) {
    // 時間の幅がない：長さの割合で時刻を振る
    const len = pathLength(points)
    let acc = 0
    return points.map((p, i) => {
      if (i > 0) acc += Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y)
      return { ...p, t: t0 + (len > 0 ? (acc / len) * target : (i / (points.length - 1)) * target) }
    })
  }
  const k = target / span
  return points.map((p) => ({ ...p, t: t0 + (p.t - t0) * k }))
}
