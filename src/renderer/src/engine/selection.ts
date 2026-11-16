// 選択範囲の操作（新規・追加・除外・反転・拡大縮小）
import type { ClipMode, ClipRegion, ClipShape } from './types'

export type SelectionOp = 'new' | 'add' | 'subtract'

/** 図形を現在の選択範囲に合成する */
export function combine(current: ClipRegion | null, shape: ClipShape, op: SelectionOp): ClipRegion | null {
  if (op === 'new' || !current) {
    // 何もない所からの「除外」は何も起きない
    if (op === 'subtract') return current
    return { shapes: [{ ...shape, mode: 'add' }] }
  }
  return { shapes: [...current.shapes, { ...shape, mode: op === 'add' ? 'add' : 'subtract' } as ClipShape] }
}

const flip = (m: ClipMode): ClipMode => (m === 'add' ? 'subtract' : 'add')

/**
 * 選択範囲を反転する。
 * 「空から順に足し引きする」列の補集合は「全体から始め、各操作の向きを逆にした列」になる。
 * 先頭が「全体」の場合はそれを取り除いて残りを反転すれば元に戻る。
 */
export function invert(current: ClipRegion | null): ClipRegion {
  if (!current || current.shapes.length === 0) return { shapes: [{ kind: 'all', mode: 'add' }] }
  const [first, ...rest] = current.shapes
  if (first.kind === 'all' && first.mode === 'add') {
    return { shapes: rest.map((s) => ({ ...s, mode: flip(s.mode) }) as ClipShape) }
  }
  return {
    shapes: [{ kind: 'all', mode: 'add' }, ...current.shapes.map((s) => ({ ...s, mode: flip(s.mode) }) as ClipShape)]
  }
}

/** 書き出し時の解像度変更に合わせて座標を拡大縮小する */
export function scaleClip(clip: ClipRegion, k: number): ClipRegion {
  return {
    shapes: clip.shapes.map((s) => {
      if (s.kind === 'all') return s
      if (s.kind === 'poly') return { ...s, points: s.points.map((p) => ({ x: p.x * k, y: p.y * k })) }
      return { ...s, x: s.x * k, y: s.y * k, w: s.w * k, h: s.h * k }
    })
  }
}

/** 幅か高さがほぼ 0 の図形（クリックしただけ等）は無視する */
export function isDegenerate(shape: ClipShape): boolean {
  if (shape.kind === 'all') return false
  if (shape.kind === 'poly') {
    if (shape.points.length < 3) return true
    const xs = shape.points.map((p) => p.x)
    const ys = shape.points.map((p) => p.y)
    return Math.max(...xs) - Math.min(...xs) < 2 || Math.max(...ys) - Math.min(...ys) < 2
  }
  return Math.abs(shape.w) < 2 || Math.abs(shape.h) < 2
}

/** 外接矩形の幅・高さを正の値にそろえる */
export function normalizeBox<T extends { x: number; y: number; w: number; h: number }>(b: T): T {
  return {
    ...b,
    x: b.w < 0 ? b.x + b.w : b.x,
    y: b.h < 0 ? b.y + b.h : b.y,
    w: Math.abs(b.w),
    h: Math.abs(b.h)
  }
}
