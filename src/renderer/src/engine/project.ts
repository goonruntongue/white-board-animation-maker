import { defaultHand, findPreset } from './handPresets'
import type { ClipRegion, ImageAsset, Page, Project, Stroke, StrokePoint } from './types'

export const PROJECT_EXT = 'wbanim'

const STROKE_COLORS = ['#ff6b6b', '#4dabf7', '#51cf66', '#fcc419', '#cc5de8', '#ff922b', '#20c997', '#f06595']

export function createProject(): Project {
  const penColor = '#1f6feb'
  return {
    version: 1,
    name: '無題のプロジェクト',
    image: null,
    hand: defaultHand(penColor),
    settings: {
      speed: 1,
      startDelay: 600,
      endHold: 2000,
      boardColor: '#ffffff',
      showHand: true,
      handShadow: true,
      handFollowDirection: true,
      handSize: 0.45,
      penColor,
      defaultRevealWidth: 28,
      defaultDelayAfter: 250,
      eraserWidth: 40,
      finishFull: true
    },
    strokes: [],
    pages: [{ id: newId('page'), image: null, strokes: [] }],
    pageIndex: 0
  }
}

let idCounter = 0
export function newId(prefix = 'stroke'): string {
  idCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`
}

// ---------------------------------------------------------------------------
// ページ（スライド）
// 編集中のページの内容は project.image / project.strokes にある。ほかの処理はそれだけを見ればよい。
// ---------------------------------------------------------------------------

/** 編集中のページの内容を pages に書き戻したプロジェクトを返す */
export function syncPages(p: Project): Project {
  const cur = p.pages[p.pageIndex]
  if (cur && cur.image === p.image && cur.strokes === p.strokes) return p
  const pages = p.pages.map((pg, i) => (i === p.pageIndex ? { ...pg, image: p.image, strokes: p.strokes } : pg))
  return { ...p, pages }
}

/** 最新の内容を反映した全ページ */
export function allPages(p: Project): Page[] {
  return syncPages(p).pages
}

export function switchPage(p: Project, index: number): Project {
  const s = syncPages(p)
  const i = Math.max(0, Math.min(s.pages.length - 1, index))
  return { ...s, pageIndex: i, image: s.pages[i].image, strokes: s.pages[i].strokes }
}

/** いまのページの後ろに新しいページを足して、そのページへ移る */
export function addPage(p: Project, image: ImageAsset | null, strokes: Stroke[] = []): Project {
  const s = syncPages(p)
  const pages = [...s.pages]
  const at = s.pageIndex + 1
  pages.splice(at, 0, { id: newId('page'), image, strokes })
  return { ...s, pages, pageIndex: at, image, strokes }
}

export function removePage(p: Project, index: number): Project {
  const s = syncPages(p)
  if (s.pages.length <= 1) {
    // 最後の1ページは消さずに空にする
    const pages = [{ ...s.pages[0], image: null, strokes: [] }]
    return { ...s, pages, pageIndex: 0, image: null, strokes: [] }
  }
  const pages = s.pages.filter((_, i) => i !== index)
  const next = Math.min(pages.length - 1, index < s.pageIndex ? s.pageIndex - 1 : s.pageIndex === index ? Math.min(index, pages.length - 1) : s.pageIndex)
  return { ...s, pages, pageIndex: next, image: pages[next].image, strokes: pages[next].strokes }
}

export function movePage(p: Project, from: number, to: number): Project {
  const s = syncPages(p)
  const dest = Math.max(0, Math.min(s.pages.length - 1, to))
  if (from === dest) return p
  const pages = [...s.pages]
  const [item] = pages.splice(from, 1)
  pages.splice(dest, 0, item)
  const curId = s.pages[s.pageIndex].id
  return { ...s, pages, pageIndex: pages.findIndex((pg) => pg.id === curId) }
}

export function duplicatePage(p: Project, index: number): Project {
  const s = syncPages(p)
  const src = s.pages[index]
  const copy: Page = { id: newId('page'), image: src.image, strokes: src.strokes.map((st) => ({ ...st, id: newId() })) }
  const pages = [...s.pages]
  pages.splice(index + 1, 0, copy)
  return { ...s, pages, pageIndex: index + 1, image: copy.image, strokes: copy.strokes }
}

export function strokeColor(index: number): string {
  return STROKE_COLORS[index % STROKE_COLORS.length]
}

/** 近すぎる点を間引いてデータ量を抑える */
export function simplifyPoints(points: StrokePoint[], minDist = 1.5): StrokePoint[] {
  if (points.length <= 2) return points
  const out: StrokePoint[] = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]
    const last = out[out.length - 1]
    if (Math.hypot(p.x - last.x, p.y - last.y) >= minDist) out.push(p)
  }
  out.push(points[points.length - 1])
  return out.map((p) => ({ x: round1(p.x), y: round1(p.y), t: Math.round(p.t) }))
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

export function strokeFromRecording(
  project: Project,
  points: StrokePoint[],
  index: number,
  clip: ClipRegion | null = null
): Stroke {
  const pts = simplifyPoints(points)
  const recorded = pts.length > 1 ? pts[pts.length - 1].t - pts[0].t : 0
  return {
    id: newId(),
    name: `軌跡 ${index + 1}`,
    points: pts,
    revealWidth: project.settings.defaultRevealWidth,
    duration: Math.max(300, Math.round(recorded)),
    delayAfter: project.settings.defaultDelayAfter,
    useRecordedTiming: true,
    color: strokeColor(index),
    ...(clip ? { clip } : {})
  }
}

/** 描き足すとき、前の線の終わりから次の書き始めまで手が移動する時間 (ms) */
export const LIFT_GAP_MS = 350

/**
 * 既存の軌跡に、なぞった線を描き足す（新しい軌跡は作らない）。
 * 書き始めの点に b（ペンを上げる）を付けるので、再生では前の線とつながらない。
 * 太さが軌跡の見せる幅と違えば、その部分だけ w で太さを持つ。
 * 再生時間は、軌跡の今の速さ（なぞった時間に対する倍率）を保って延ばす。
 */
export function appendToStroke(stroke: Stroke, raw: StrokePoint[], width: number): Pick<Stroke, 'points' | 'duration'> {
  const pts = simplifyPoints(raw)
  const prev = stroke.points
  const last = prev[prev.length - 1]
  const span = prev.length > 1 ? prev[prev.length - 1].t - prev[0].t : 0
  const ratio = span > 0 ? stroke.duration / span : 1
  const t0 = (last?.t ?? 0) + LIFT_GAP_MS
  const added: StrokePoint[] = pts.map((p, i) => ({
    x: p.x,
    y: p.y,
    t: Math.round(t0 + (p.t - pts[0].t)),
    ...(i === 0 ? { b: 1 as const, ...(Math.round(width) !== Math.round(stroke.revealWidth) ? { w: Math.round(width) } : {}) } : {})
  }))
  const recorded = pts.length > 1 ? pts[pts.length - 1].t - pts[0].t : 0
  return {
    points: [...prev, ...added],
    duration: Math.round(stroke.duration + (LIFT_GAP_MS + Math.max(150, recorded)) * ratio)
  }
}

/** 線の本数（描き足すたびに1本増える） */
export function countParts(stroke: Stroke): number {
  return 1 + stroke.points.filter((p) => p.b).length
}

export function serializeProject(project: Project): string {
  const p = syncPages(project)
  // 内蔵の手素材は名前だけ保存する（画像本体はアプリに入っている）
  const hand = p.hand.presetId ? { ...p.hand, dataUrl: '' } : p.hand
  // 画像と描き順は pages にだけ持つ（同じ画像を二重に保存しない）
  return JSON.stringify({ app: 'whiteboard-animation-maker', ...p, hand, image: null, strokes: [] })
}

function resolveHand(hand: Project['hand'] | undefined, fallback: Project['hand']): Project['hand'] {
  if (!hand) return fallback
  if (hand.presetId) {
    const preset = findPreset(hand.presetId)
    // 素材が見つからなければ既定の手に置き換える
    return preset ? { ...hand, dataUrl: preset.url } : fallback
  }
  return hand
}

export function parseProject(text: string): Project {
  const data = JSON.parse(text)
  if (!data || data.version !== 1 || !Array.isArray(data.strokes)) {
    throw new Error('対応していないプロジェクトファイルです')
  }
  const base = createProject()
  // ページ対応より前のファイルは、画像1枚＝1ページとして読む
  const pages: Page[] =
    Array.isArray(data.pages) && data.pages.length > 0
      ? data.pages.map((pg: Partial<Page>) => ({ id: pg.id ?? newId('page'), image: pg.image ?? null, strokes: pg.strokes ?? [] }))
      : [{ id: newId('page'), image: data.image ?? null, strokes: data.strokes }]
  const pageIndex = Math.max(0, Math.min(pages.length - 1, Number(data.pageIndex) || 0))
  return {
    version: 1,
    name: data.name ?? base.name,
    image: pages[pageIndex].image,
    hand: resolveHand(data.hand, base.hand),
    settings: { ...base.settings, ...data.settings },
    strokes: pages[pageIndex].strokes,
    pages,
    pageIndex
  }
}

export function formatTime(ms: number): string {
  const total = Math.max(0, ms) / 1000
  const m = Math.floor(total / 60)
  const s = total - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
}
