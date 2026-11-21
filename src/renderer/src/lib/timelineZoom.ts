// タイムラインの表示倍率（100% ＝ 1秒が 55px）。端末ごとに localStorage に覚える。
// 下限は「全体が見える倍率」（タイムラインの側で決めて、ここへは要求だけを送る）
import { useSyncExternalStore } from 'react'

export const BASE_PX_PER_SEC = 55
export const ZOOM_MAX = 16
const KEY = 'wbam.timelineZoom'
const listeners = new Set<() => void>()

function read(): number {
  try {
    const v = Number(localStorage.getItem(KEY))
    return Number.isFinite(v) && v > 0 ? v : 1
  } catch {
    return 1
  }
}

let zoom = read()

export function getTimelineZoom(): number {
  return zoom
}

/** 倍率を変える。anchorX は、その位置（画面の x）の時刻を動かさずに拡大・縮小する目印（なければ再生位置かまん中） */
export type ZoomRequest = { zoom: number; anchorX?: number }
const requestListeners = new Set<(r: ZoomRequest) => void>()

export function requestTimelineZoom(r: ZoomRequest): void {
  if (requestListeners.size === 0) commitTimelineZoom(r.zoom)
  requestListeners.forEach((f) => f(r))
}

/** いまの倍率に掛ける（ショートカット用） */
export function stepTimelineZoom(factor: number): void {
  requestTimelineZoom({ zoom: zoom * factor })
}

/** 全体が見える倍率にする（下限まで縮める） */
export function fitTimelineZoom(): void {
  requestTimelineZoom({ zoom: 0 })
}

export function onTimelineZoomRequest(f: (r: ZoomRequest) => void): () => void {
  requestListeners.add(f)
  return () => void requestListeners.delete(f)
}

/** タイムラインが下限・上限を当てはめた後の値を確定して覚える */
export function commitTimelineZoom(v: number): void {
  const next = Math.max(0.01, Math.min(ZOOM_MAX, v))
  if (next === zoom) return
  zoom = next
  try {
    localStorage.setItem(KEY, String(next))
  } catch {
    // 覚えられなくても、表示は変わる
  }
  listeners.forEach((f) => f())
}

export function useTimelineZoom(): number {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => void listeners.delete(f)
    },
    () => zoom
  )
}
