// 選択範囲の操作（新規・追加・除外・反転・拡大縮小）
import type { ClipMode, ClipRegion, ClipShape } from './types'

export type SelectionOp = 'new' | 'add' | 'subtract' | 'intersect'

/** 図形を現在の選択範囲に合成する */
export function combine(current: ClipRegion | null, shape: ClipShape, op: SelectionOp): ClipRegion | null {
  if (op === 'new' || !current) {
    // 選択がない所からの「除外」は何も起きない。「交差」は新規と同じ扱い（Photoshop と同じ）
    if (op === 'subtract') return current
    return { shapes: [{ ...shape, mode: 'add' } as ClipShape] }
  }
  const mode: ClipMode = op === 'add' ? 'add' : op === 'subtract' ? 'subtract' : 'intersect'
  return { shapes: [...current.shapes, { ...shape, mode } as ClipShape] }
}

/** 選択範囲を反転する：「全体」から元の範囲をまるごと除外する。2回反転すると元に戻る */
export function invert(current: ClipRegion | null): ClipRegion {
  if (!current || current.shapes.length === 0) return { shapes: [{ kind: 'all', mode: 'add' }] }
  const [a, b] = current.shapes
  if (current.shapes.length === 2 && a.kind === 'all' && a.mode === 'add' && b.kind === 'region' && b.mode === 'subtract') {
    return b.region
  }
  return { shapes: [{ kind: 'all', mode: 'add' }, { kind: 'region', mode: 'subtract', region: current }] }
}

/** 書き出し時の解像度変更に合わせて座標を拡大縮小する */
export function scaleClip(clip: ClipRegion, k: number): ClipRegion {
  return {
    shapes: clip.shapes.map((s): ClipShape => {
      if (s.kind === 'all' || s.kind === 'rle') return s // rle は描くときに引き伸ばすので、そのままでよい
      if (s.kind === 'region') return { ...s, region: scaleClip(s.region, k) }
      if (s.kind === 'poly') return { ...s, points: s.points.map((p) => ({ x: p.x * k, y: p.y * k })) }
      if (s.kind === 'stroke') return { ...s, width: s.width * k, points: s.points.map((p) => ({ x: p.x * k, y: p.y * k })) }
      return { ...s, x: s.x * k, y: s.y * k, w: s.w * k, h: s.h * k }
    })
  }
}

/** 画面に輪郭を描くための、末端の図形一覧（入れ子を展開） */
export function flattenShapes(clip: ClipRegion): ClipShape[] {
  return clip.shapes.flatMap((s) => (s.kind === 'region' ? flattenShapes(s.region) : [s]))
}

// ---------------------------------------------------------------------------
// 消しゴム：軌跡ごとの「見せる範囲」から、なぞった線の部分を除外する
// （軌跡の道筋や時間は変えないので、手の動き・再生時間はそのまま）
// ---------------------------------------------------------------------------

/** 軌跡の表示範囲に消しゴムの跡を加える。範囲がまだなければ「全体」から始める */
export function addEraserMark(clip: ClipRegion | undefined, points: { x: number; y: number }[], width: number): ClipRegion {
  const mark: ClipShape = { kind: 'stroke', mode: 'subtract', points, width }
  const base: ClipRegion = clip && clip.shapes.length ? clip : { shapes: [{ kind: 'all', mode: 'add' }] }
  return { shapes: [...base.shapes, mark] }
}

/**
 * ブラシで足す：なぞった線の範囲を、軌跡の表示範囲に加える（消しゴムの反対）。
 * 範囲の制限がない軌跡は、もともとどこでも見せられるので何もしない。
 * 後から加えた形が優先されるので、消しゴムで消した所の上をなぞれば、また見せられる。
 */
export function addRevealMark(clip: ClipRegion | undefined, points: { x: number; y: number }[], width: number): ClipRegion | undefined {
  if (!clip || clip.shapes.length === 0) return clip
  return { shapes: [...clip.shapes, { kind: 'stroke', mode: 'add', points, width }] }
}

/**
 * 自動の「通過部分を表示」：なぞった線の範囲を表示範囲に加えるが、消しゴムの跡より下に入れる。
 * 消しゴムで消した所は、線を動かしたり太くしたりしても消えたまま（見せたいときはブラシでなぞる）
 */
export function addRevealMarkUnderErase(clip: ClipRegion | undefined, points: { x: number; y: number }[], width: number): ClipRegion | undefined {
  if (!clip || clip.shapes.length === 0) return clip
  const mark: ClipShape = { kind: 'stroke', mode: 'add', points, width }
  const at = clip.shapes.findIndex(isEraseMark)
  if (at < 0) return { shapes: [...clip.shapes, mark] }
  return { shapes: [...clip.shapes.slice(0, at), mark, ...clip.shapes.slice(at)] }
}

/** 選択範囲の形をそのまま消す（選択範囲＋Delete）。消しゴムの跡と同じく、軌跡の道筋や時間は変えない */
export function addAreaErase(clip: ClipRegion | undefined, area: ClipRegion): ClipRegion {
  const mark: ClipShape = { kind: 'region', mode: 'subtract', region: structuredClone(area), erase: true }
  const base: ClipRegion = clip && clip.shapes.length ? clip : { shapes: [{ kind: 'all', mode: 'add' }] }
  return { shapes: [...base.shapes, mark] }
}

/** 消しゴムの跡（なぞった線・選択範囲で消した所）か */
function isEraseMark(s: ClipShape): boolean {
  return (s.kind === 'stroke' && s.mode === 'subtract') || (s.kind === 'region' && s.erase === true)
}

/** 消しゴムの跡の数 */
export function countEraserMarks(clip: ClipRegion | undefined): number {
  return clip ? clip.shapes.filter(isEraseMark).length : 0
}

/** 消しゴムの跡だけを取り除く。範囲の制限が何も残らなければ undefined（制限なし） */
export function clearEraserMarks(clip: ClipRegion | undefined): ClipRegion | undefined {
  if (!clip) return undefined
  const shapes = clip.shapes.filter((s) => !isEraseMark(s))
  if (shapes.length === 0 || (shapes.length === 1 && shapes[0].kind === 'all' && shapes[0].mode === 'add')) return undefined
  return { shapes }
}

/** 幅か高さがほぼ 0 の図形（クリックしただけ等）は無視する */
export function isDegenerate(shape: ClipShape): boolean {
  if (shape.kind === 'all' || shape.kind === 'region' || shape.kind === 'stroke' || shape.kind === 'rle') return false
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
