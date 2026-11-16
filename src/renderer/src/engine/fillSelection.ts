import { newId, strokeColor } from './project'
import { clipBounds, rasterizeClip } from './wb-engine'
import type { ClipRegion, Stroke, StrokePoint } from './types'

export type FillDirection = 'horizontal' | 'vertical'
export type FillMotion = 'smooth' | 'vertical' | 'horizontal'

/** Generate editable scan lines and keep their reveal constrained to the selection. */
export function fillSelection(clip: ClipRegion, size: { width: number; height: number }, width: number, direction: FillDirection, motion: FillMotion, speed: number, index: number, amplitudeV: number, amplitudeH: number, cycles: number, tilt: number): Stroke {
  const bounds = clipBounds(clip, size.width, size.height)
  if (!bounds.w || !bounds.h) throw new Error('選択範囲が空です')
  const mask = rasterizeClip(clip, size.width, size.height)
  const ctx = mask.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  const data = ctx.getImageData(bounds.x, bounds.y, bounds.w, bounds.h).data
  const horizontal = direction === 'horizontal'
  const along = horizontal ? bounds.w : bounds.h
  const across = horizontal ? bounds.h : bounds.w
  const step = Math.max(1, width * 0.5)
  const count = Math.max(1, Math.ceil(across / step))
  if (count > 4000) throw new Error('範囲に対してペンが細すぎます。太さを大きくしてください')
  const points: StrokePoint[] = []
  let t = 0
  let previous: StrokePoint | undefined
  const push = (x: number, y: number, lift = false): void => {
    if (previous) t += Math.max(lift ? 120 : 1, Math.hypot(x - previous.x, y - previous.y) / speed * 1000)
    const p: StrokePoint = { x, y, t: Math.round(t), ...(lift ? { b: 1 as const } : {}) }
    points.push(p); previous = p
  }
  for (let row = 0; row < count; row++) {
    const cross = Math.min(across - 0.5, (row + 0.5) * across / count)
    // Include a strip as wide as the pen, so narrow and irregular selection edges are covered.
    let first = along, last = -1
    const c0 = Math.max(0, Math.floor(cross - width / 2)), c1 = Math.min(across - 1, Math.ceil(cross + width / 2))
    for (let c = c0; c <= c1; c++) for (let a = 0; a < along; a++) {
      const x = horizontal ? a : c, y = horizontal ? c : a
      if (data[(y * bounds.w + x) * 4 + 3]) { first = Math.min(first, a); last = Math.max(last, a) }
    }
    if (last < first) continue
    const segments = motion === 'smooth' ? 1 : Math.max(2, Math.min(200, Math.round(cycles * 2)))
    if (points.length + segments + 1 > 200000) throw new Error('軌跡の点が多すぎます。振動数を減らすか、ペンを太くしてください')
    for (let i = 0; i <= segments; i++) {
      const a = first + (last - first) * i / segments
      const wave = i === 0 || i === segments || motion === 'smooth' ? 0 : (i % 2 ? 1 : -1)
      const x = bounds.x + (horizontal ? a : cross) + (motion === 'horizontal' ? wave * size.width * Math.max(0, Math.min(1, amplitudeH)) / 2 : wave * size.height * Math.max(0, Math.min(1, amplitudeV)) / 2 * tilt)
      const y = bounds.y + (horizontal ? cross : a) + (motion === 'vertical' ? wave * size.height * Math.max(0, Math.min(1, amplitudeV)) / 2 : 0)
      push(Math.max(0, Math.min(size.width - 1, x)), Math.max(0, Math.min(size.height - 1, y)), points.length > 0 && i === 0)
    }
  }
  if (!points.length) throw new Error('選択範囲が空です')
  return { id: newId(), name: '自動（選択範囲）', points, revealWidth: width, duration: Math.max(300, Math.round(t)), delayAfter: 180, useRecordedTiming: true, clip: structuredClone(clip), color: strokeColor(index) }
}
