// 描き順の自動生成。
// 清書画像を解析して、「手が順番に書いていく」軌跡の下書きを作る（あとから手で直せる）。
//
// 役割は2つに分かれている：
//  A. どこから描くか（共通）… 自然に描く・インクの線をたどる・選択範囲の中を見分けて描く で同じものを使う
//     1. 画像を小さくして背景色を調べ、背景と違う画素を「インク」とみなす（選択範囲があれば、その中だけ）
//     2. 枠（四角・雲形・丸など、ほかを囲む輪郭）を切り離し、文字の高さに合わせて残りをかたまりにする
//     3. 近いかたまりを「領域」にまとめ、枠 → 中身、領域ごとに上から下・左から右の順に並べる
//     4. かたまりの中は splitIntoParts で列・行の「部分」に分ける（段組みは列ごとに書き切る）
//  B. その部分をどう描くか（描き方ごと）
//     ・自然に描く（natural）… 行は1回で左→右、背の高い図は縦の列ごとに上→下。枠は輪郭に沿って一周
//     ・インクの線をたどる（ink）… 部分の中で、細線化した線の中心をたどる
//     ・かたまりを描く（group）… 従来の方式（幅に対する固定のしきい値・帯で見せる・ごしごし）
//  各軌跡の表示範囲は、そのかたまり自身の形（＋選択範囲）に限定する
//     → 太いペン幅で一気に見せても、隣のかたまりのインクは先に出ない
import { newId, strokeColor } from './project'
import { rasterizeClip } from './wb-engine'
import type { ClipRegion, ClipShape, Stroke, StrokePoint } from './types'

export type AutoDetail = 'fine' | 'normal' | 'coarse'
export type AutoSpeed = 'slow' | 'normal' | 'fast'

export interface AutoTraceOptions {
  /** かたまりの大きさ：fine = 細かく分ける / coarse = 大きくまとめる */
  revealWidth?: number
  detail: AutoDetail
  /**
   * group = かたまりを帯で見せる（従来） / ink = 線の中心をたどる（試験版）
   * natural = 文字の大きさから区切りを決め、近いまとまりを書き切りながら、行は1回で左→右・図は上→下に書く
   */
  pathMode?: 'group' | 'ink' | 'natural'
  /** 書く速さ */
  speed: AutoSpeed
  /** 上下のごしごし（0 = なし、1 = 従来の上限、2 = 最大） */
  scrubV?: number
  /** 左右の傾き（-2 = 左最大、0 = 中央、2 = 右最大） */
  scrubH?: number
  /** 1つの区間あたりの往復回数 */
  scrubCycles?: number
  scrubTilt?: number
  /**
   * 選択範囲：これを渡すと、範囲の中のインクだけを見分けて描く（範囲の外は背景として扱い、表示もしない）。
   * 「どこから描くか」は自然に描くと同じ。動きは pathMode に従う
   */
  within?: ClipRegion
}

/** 手の動き方のおすすめの組み合わせ */
export const MOTION_PRESETS: { id: string; label: string; note: string; scrubV: number; scrubH: number }[] = [
  { id: 'smooth', label: 'なめらか', note: '文字の流れに沿ってすっと進む', scrubV: 0, scrubH: 0 },
  { id: 'vertical', label: '上下にごしごし', note: '縦に往復しながら右へ進む', scrubV: 0.12, scrubH: 0 },
  { id: 'horizontal', label: '左右にごしごし', note: '行ったり戻ったりしながら進む', scrubV: 0, scrubH: 0.12 },
  { id: 'both', label: '斜めにごしごし', note: '上下と左右の両方', scrubV: 0.12, scrubH: 0.12 }
]

export interface AutoTraceResult {
  strokes: Stroke[]
  /** 見つかったかたまりの数 */
  blocks: number
  /** インクをうまく分けられず、画像全体を1つとして扱った */
  fallback: boolean
  /** natural で推定した文字の高さ（解析用の画素。確認用） */
  charH?: number
}

type Box = { x0: number; y0: number; x1: number; y1: number }

interface Block {
  id: number
  x0: number
  y0: number
  x1: number
  y1: number
  ink: number
  parent: number
  children: Block[]
  /** 枠線（外枠・パネルの枠など、大きくて中が空いている線）。インクそのものの外接矩形を持つ */
  frame?: { x0: number; y0: number; x1: number; y1: number; id: number }
}

const GRID_W = 560 // 解析用に縮小した幅
const MERGE: Record<AutoDetail, number> = { fine: 0.008, normal: 0.016, coarse: 0.032 } // 太らせる量（幅に対する比）
const SPEED: Record<AutoSpeed, number> = { slow: 0.38, normal: 0.65, fast: 1.1 } // 1秒に進む距離（幅に対する比）
const LIFT_MS = 220 // ペンを上げて次の書き始めへ移る時間
/** natural：横に太らせる量（文字の高さに対する比）。0.7 なら字間はつながり、単語より広い間はつながりにくい */
const NATURAL_MERGE: Record<AutoDetail, number> = { fine: 0.35, normal: 0.7, coarse: 1.4 }

/**
 * 枠の輪郭を、中心から見た角度ごとにまとめて一周の点列にする（上の真ん中から時計回り）。
 * span：輪郭の太さ（角度ごとの内側〜外側の幅）の目安
 */
function polarContour(
  frameOf: Int32Array,
  gw: number,
  f: { id: number; x0: number; y0: number; x1: number; y1: number }
): { points: [number, number][]; trace: [number, number][]; span: number; coverage: number } {
  const cx = (f.x0 + f.x1) / 2
  const cy = (f.y0 + f.y1) / 2
  const N = 120
  const rMin = new Float32Array(N).fill(Infinity)
  const rMax = new Float32Array(N).fill(-1)
  for (let y = f.y0; y <= f.y1; y++) {
    for (let x = f.x0; x <= f.x1; x++) {
      if (frameOf[y * gw + x] !== f.id) continue
      const a = Math.atan2(y - cy, x - cx) + Math.PI / 2
      const q = Math.floor(((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * N) % N
      const r = Math.hypot(x - cx, y - cy)
      if (r < rMin[q]) rMin[q] = r
      if (r > rMax[q]) rMax[q] = r
    }
  }
  const spans: number[] = []
  const points: [number, number][] = []
  for (let q = 0; q <= N; q++) {
    const qq = q % N
    if (rMax[qq] < 0) continue
    if (q < N) spans.push(rMax[qq] - rMin[qq])
    const a = ((qq + 0.5) / N) * Math.PI * 2 - Math.PI / 2
    const r = (rMin[qq] + rMax[qq]) / 2
    points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  const sorted = [...spans].sort((a, c) => a - c)
  const span = sorted.length ? sorted[Math.floor(sorted.length * 0.6)] : 4
  // なぞる道筋：輪郭が厚い（丸数字が重なっている・二重線など）角度では、内側と外側を行き来して取りこぼさない
  const trace: [number, number][] = []
  let outside = false
  for (let q = 0; q <= N; q++) {
    const qq = q % N
    if (rMax[qq] < 0) continue
    const a = ((qq + 0.5) / N) * Math.PI * 2 - Math.PI / 2
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    if (rMax[qq] - rMin[qq] > span + 4) {
      const inner = rMin[qq] + span / 2
      const outer = rMax[qq] - span / 2
      const [r1, r2] = outside ? [outer, inner] : [inner, outer]
      trace.push([cx + cos * r1, cy + sin * r1], [cx + cos * r2, cy + sin * r2])
      outside = !outside
    } else {
      const r = (rMin[qq] + rMax[qq]) / 2
      trace.push([cx + cos * r, cy + sin * r])
    }
  }
  return { points, trace, span, coverage: spans.length / N }
}

// ================================================================
//  共通：どこから描くか（まとまりの中を「部分」に分け、描く順に並べる）
// ================================================================
/**
 * かたまりの中を、余白で「列」と「行」に分けていく（XY-cut）。描く順に並んだ部分のリストを返す。
 *  ・となり合う行が同じ位置に縦の空きを持つ（段組み）なら、左の列を上から下まで書き切ってから右の列へ
 *  ・ほぼ空の横の行で上下に分ける（飾りの点や線が少しかかっていても分けられる）
 *  ・1行の中で大きく空いていれば左右に分ける（離れた語句・図）
 * 分け目は余白の真ん中にとるので、余白に残った少しのインクもどれかの部分が受け持つ（取りこぼさない）。
 * has(i)：画素 i が、このかたまりのまだ描いていないインクか
 */
function splitIntoParts(box: Box, has: (i: number) => boolean, gw: number, charH: number): Box[] {
  const leaves: { x0: number; y0: number; x1: number; y1: number }[] = []
  const colGapMin = Math.max(3, Math.round(charH * 1.5))
  const minSeg = Math.max(2, charH * 0.4)
  /** 値が gap 以下の並びが minRun 以上続く所の、真ん中の位置（両端は除く） */
  const gapsOf = (ink: Int32Array, gap: number, minRun: number): number[] => {
    const out: number[] = []
    let run = 0
    for (let i = 0; i < ink.length; i++) {
      if (ink[i] <= gap) run++
      else {
        if (run >= minRun && i - run > 0) out.push(i - Math.ceil(run / 2))
        run = 0
      }
    }
    return out
  }
  /** 列ごとのインク量から、幅 minW 以上の「ほぼ空の列」の区間を返す（両端は除く） */
  const emptyCols = (col: Int32Array, gap: number, minW: number): [number, number][] => {
    const out: [number, number][] = []
    let s0 = -1
    for (let i = 0; i <= col.length; i++) {
      if (i < col.length && col[i] <= gap) {
        if (s0 < 0) s0 = i
      } else if (s0 >= 0) {
        if (s0 > 0 && i < col.length && i - s0 >= minW) out.push([s0, i - 1])
        s0 = -1
      }
    }
    return out
  }
  const cut = (x0: number, y0: number, x1: number, y1: number, depth: number): void => {
    const rowInk = new Int32Array(y1 - y0 + 1)
    const colInk = new Int32Array(x1 - x0 + 1)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (has(y * gw + x)) { rowInk[y - y0]++; colInk[x - x0]++ }
    // インクのある範囲まで縮める
    let a = 0
    while (a < rowInk.length && !rowInk[a]) a++
    if (a === rowInk.length) return
    let z = rowInk.length - 1
    while (!rowInk[z]) z--
    let l = 0
    while (!colInk[l]) l++
    let r = colInk.length - 1
    while (!colInk[r]) r--
    if (a > 0 || z < rowInk.length - 1 || l > 0 || r < colInk.length - 1) return cut(x0 + l, y0 + a, x0 + r, y0 + z, depth)
    if (depth > 12) {
      leaves.push({ x0, y0, x1, y1 })
      return
    }
    // 1) ほぼ空の横の行で、上下の帯に分ける
    let rowMax = 0
    for (const v of rowInk) if (v > rowMax) rowMax = v
    const rowGap = Math.floor(rowMax * 0.06)
    const bounds = [-1, ...gapsOf(rowInk, rowGap, 1), rowInk.length - 1]
    // 点・濁点・下線のかけらなど、インクのある行が少なすぎる帯は、となりとまとめる
    const solid = (i0: number, i1: number): number => {
      let c = 0
      for (let i = i0; i <= i1; i++) if (rowInk[i] > rowGap) c++
      return c
    }
    for (let i = 1; i < bounds.length - 1; ) {
      if (solid(bounds[i - 1] + 1, bounds[i]) < minSeg || solid(bounds[i] + 1, bounds[i + 1]) < minSeg) bounds.splice(i, 1)
      else i++
    }
    // 帯が1つだけ：横に大きく空いていれば左右に分ける（離れた語句・図）。でなければ、これ以上分けない
    if (bounds.length <= 2) {
      const vCuts = gapsOf(colInk, 0, colGapMin)
      if (!vCuts.length) {
        leaves.push({ x0, y0, x1, y1 })
        return
      }
      let s = x0
      for (const c of vCuts) {
        cut(s, y0, x0 + c, y1, depth + 1)
        s = x0 + c + 1
      }
      cut(s, y0, x1, y1, depth + 1)
      return
    }
    // 2) 段組み：となり合う帯が「同じ位置に縦の空き」を持つなら、その帯の集まりを左右の列に分ける。
    //    左の列を上から下まで書き切ってから、右の列へ進む（行ごとに左右を行き来しない）
    const minW = Math.max(3, Math.round(charH * 1.0))
    const bands = []
    for (let i = 0; i + 1 < bounds.length; i++) {
      const by0 = y0 + bounds[i] + 1
      const by1 = y0 + bounds[i + 1]
      const col = new Int32Array(x1 - x0 + 1)
      for (let y = by0; y <= by1; y++) for (let x = x0; x <= x1; x++) if (has(y * gw + x)) col[x - x0]++
      bands.push({ y0: by0, y1: by1, gaps: emptyCols(col, 1, minW) })
    }
    const intersect = (p: [number, number][], q: [number, number][]): [number, number][] => {
      const out: [number, number][] = []
      for (const [a0, a1] of p) for (const [b0, b1] of q) {
        const s0 = Math.max(a0, b0)
        const s1 = Math.min(a1, b1)
        if (s1 - s0 + 1 >= minW) out.push([s0, s1])
      }
      return out
    }
    let gi = 0
    while (gi < bands.length) {
      let common = bands[gi].gaps
      let gj = gi + 1
      while (gj < bands.length) {
        const next = intersect(common, bands[gj].gaps)
        if (!next.length) break
        common = next
        gj++
      }
      const gy0 = bands[gi].y0
      const gy1 = bands[gj - 1].y1
      if (gj - gi >= 2 && common.length) {
        let s = x0
        for (const [c0, c1] of common) {
          const c = Math.floor((c0 + c1) / 2)
          cut(s, gy0, x0 + c, gy1, depth + 1)
          s = x0 + c + 1
        }
        cut(s, gy0, x1, gy1, depth + 1)
      } else {
        for (let i = gi; i < gj; i++) cut(x0, bands[i].y0, x1, bands[i].y1, depth + 1)
      }
      gi = gj
    }
  }
  cut(box.x0, box.y0, box.x1, box.y1, 0)
  return leaves
}

/** インクの画素ごとに、いちばん近い紙（インクでない画素）までの距離（およそユークリッド距離。縁の画素は 1） */
function distanceToPaper(ink: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e6
  const d = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) d[i] = ink[i] ? INF : 0
  const A = 1
  const B = Math.SQRT2
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x
    if (!d[i]) continue
    let v = d[i]
    v = Math.min(v, x > 0 ? d[i - 1] + A : A, y > 0 ? d[i - w] + A : A)
    v = Math.min(v, x > 0 && y > 0 ? d[i - w - 1] + B : B, x < w - 1 && y > 0 ? d[i - w + 1] + B : B)
    d[i] = v
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x
    if (!d[i]) continue
    let v = d[i]
    v = Math.min(v, x < w - 1 ? d[i + 1] + A : A, y < h - 1 ? d[i + w] + A : A)
    v = Math.min(v, x < w - 1 && y < h - 1 ? d[i + w + 1] + B : B, x > 0 && y < h - 1 ? d[i + w - 1] + B : B)
    d[i] = v
  }
  return d
}

/** 文字の高さの目安：小さなかたまり（文字・部首・単語）の高さの、やや大きめの中央値 */
function estimateCharHeight(mask: Uint8Array, w: number, h: number): number {
  const { blocks } = labelComponents(mask, w, h)
  const hs = blocks
    .filter((b) => b.ink >= 3 && b.x1 - b.x0 + 1 < w * 0.25 && b.y1 - b.y0 + 1 < h * 0.25)
    .map((b) => b.y1 - b.y0 + 1)
    .sort((a, b) => a - b)
  if (hs.length === 0) return Math.max(6, w * 0.03)
  return Math.max(4, Math.min(h * 0.2, hs[Math.floor(hs.length * 0.6)]))
}

// 細線化したインクの中心線を、分岐ではペンを上げてたどる。
function skeletonize(source: Uint8Array, w: number, h: number): Uint8Array {
  const a = source.slice()
  const remove: number[] = []
  for (let pass = 0; pass < 80; pass++) {
    let changed = false
    for (let phase = 0; phase < 2; phase++) {
      remove.length = 0
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        if (!a[i]) continue
        const p = [a[i-w], a[i-w+1], a[i+1], a[i+w+1], a[i+w], a[i+w-1], a[i-1], a[i-w-1]]
        const count = p.reduce((sum, v) => sum + v, 0)
        if (count < 2 || count > 6) continue
        let transitions = 0
        for (let j = 0; j < 8; j++) if (!p[j] && p[(j+1)%8]) transitions++
        if (transitions !== 1) continue
        if (phase === 0 ? p[0]*p[2]*p[4] || p[2]*p[4]*p[6] : p[0]*p[2]*p[6] || p[0]*p[4]*p[6]) continue
        remove.push(i)
      }
      if (remove.length) changed = true
      for (const i of remove) a[i] = 0
    }
    if (!changed) break
  }
  return a
}

export function autoTrace(
  img: CanvasImageSource,
  size: { width: number; height: number },
  boardColor: string,
  opts: AutoTraceOptions,
  startIndex: number
): AutoTraceResult {
  const gw = Math.min(GRID_W, size.width)
  const k = gw / size.width
  const gh = Math.max(1, Math.round(size.height * k))
  const n = gw * gh

  // ---- 1. 縮小して画素を読む（透過部分はボードの色で埋める） ----
  const c = document.createElement('canvas')
  c.width = gw
  c.height = gh
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = boardColor
  ctx.fillRect(0, 0, gw, gh)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, gw, gh)
  const px = ctx.getImageData(0, 0, gw, gh).data

  // 背景色：画像の縁でいちばん多い色
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>()
  const sample = (x: number, y: number): void => {
    const i = (y * gw + x) * 4
    const key = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4)
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    bin.n++
    bin.r += px[i]
    bin.g += px[i + 1]
    bin.b += px[i + 2]
    bins.set(key, bin)
  }
  for (let x = 0; x < gw; x++) {
    sample(x, 0)
    sample(x, gh - 1)
  }
  for (let y = 0; y < gh; y++) {
    sample(0, y)
    sample(gw - 1, y)
  }
  let top = { n: 0, r: 0, g: 0, b: 0 }
  for (const bin of bins.values()) if (bin.n > top.n) top = bin
  const bg = { r: top.r / top.n, g: top.g / top.n, b: top.b / top.n }

  // インク：背景と十分に色が違う画素
  const ink = new Uint8Array(n)
  let inkCount = 0
  for (let i = 0; i < n; i++) {
    const d = Math.max(Math.abs(px[i * 4] - bg.r), Math.abs(px[i * 4 + 1] - bg.g), Math.abs(px[i * 4 + 2] - bg.b))
    if (d > 18) {
      ink[i] = 1
      inkCount++
    }
  }

  // 選択範囲があるときは、範囲の外のインクを無いものとして扱う
  let withinArea = n
  if (opts.within) {
    const m = document.createElement('canvas')
    m.width = gw
    m.height = gh
    const mctx = m.getContext('2d', { willReadFrequently: true })!
    mctx.drawImage(rasterizeClip(opts.within, size.width, size.height), 0, 0, gw, gh)
    const md = mctx.getImageData(0, 0, gw, gh).data
    withinArea = 0
    for (let i = 0; i < n; i++) {
      if (md[i * 4 + 3] >= 128) withinArea++
      else if (ink[i]) {
        ink[i] = 0
        inkCount--
      }
    }
    if (inkCount === 0) throw new Error('選択範囲の中に文字や図が見つかりませんでした')
  }

  // インクがほとんど無い／画面の大半がインク（写真など）のときは、全体を1つとして扱う
  if (inkCount === 0 || inkCount / Math.max(1, withinArea) > 0.55) {
    if (opts.within) throw new Error('選択範囲の中で文字や図を見分けられませんでした。「範囲全体を塗る」をお試しください')
    return { strokes: [wholeImageStroke(size, opts, startIndex)], blocks: 1, fallback: true }
  }

  // ---- 2a. 枠線を先に切り離す ----
  // 外枠やパネルの枠は文字のすぐ近くを通るうえ、枠どうし・見出しの帯とも線でつながっているので、
  // そのまま太らせると全部が1つのかたまりになってしまう。
  // そこで「大きいのに中が空いている」つながりを見つけ、その外周（四角い枠の線）だけを取り出して独立させる。
  // 取り出したあとの残りをもう一度分け直し、内側の枠にも同じことを繰り返す（外側から順にむく）。
  const content = new Uint8Array(ink) // 枠線を取り除いていく
  const frameOf = new Int32Array(n) // 枠線のインクに、その枠の番号
  const natural = opts.pathMode === 'natural'
  // 線をたどる場合も、自然に描く場合と同じ領域分け・順序を使う。
  // 実際の軌跡は下で skeleton を使うため、線の中心に沿う動きは維持する。
  const structured = natural || opts.pathMode === 'ink'
  /** loop：四角ではなく「ほかを囲む輪郭」として見つけた枠（natural のみ） */
  const frames: { id: number; x0: number; y0: number; x1: number; y1: number; ink: number; loop?: boolean }[] = []
  for (let pass = 0; pass < 5; pass++) {
    const raw = labelComponents(content, gw, gh)
    let peeled = 0
    for (const b of raw.blocks) {
      const bw = b.x1 - b.x0 + 1
      const bh = b.y1 - b.y0 + 1
      // natural では、ほかのインクを囲んでいる中くらいの輪郭（雲形・丸・角丸の枠など）も枠として扱う
      const big = structured
        ? bw > gw * 0.08 && bh > gh * 0.08
        : (bw > gw * 0.25 || bh > gh * 0.25) && Math.min(bw, bh) > gw * 0.05
      if (!(big && b.ink / (bw * bh) < 0.25)) continue
      // 外接矩形の周上（少し内側）にあるインクを集める
      const m = 1.5
      const rx0 = b.x0 + m
      const ry0 = b.y0 + m
      const rx1 = b.x1 - m
      const ry1 = b.y1 - m
      const near: number[] = []
      const sides = [0, 0, 0, 0] // 上・下・左・右の辺に乗っているインクの数
      for (let y = b.y0; y <= b.y1; y++) {
        for (let x = b.x0; x <= b.x1; x++) {
          const i = y * gw + x
          if (!content[i] || raw.labels[i] !== b.id) continue
          const dx = x < rx0 ? rx0 - x : x > rx1 ? x - rx1 : 0
          const dy = y < ry0 ? ry0 - y : y > ry1 ? y - ry1 : 0
          const d = [Math.abs(y - ry0) + dx, Math.abs(y - ry1) + dx, Math.abs(x - rx0) + dy, Math.abs(x - rx1) + dy]
          const side = d.indexOf(Math.min(...d))
          if (d[side] <= 5) {
            near.push(i)
            sides[side]++
          }
        }
      }
      // 4辺とも、辺の長さの6割以上に線が乗っていれば「四角い枠」とみなす
      const isFrame = sides[0] > bw * 0.6 && sides[1] > bw * 0.6 && sides[2] > bh * 0.6 && sides[3] > bh * 0.6
      if (!isFrame) {
        if (!structured) continue
        // 四角でなくても、ほかのかたまりを内側に囲んでいれば「枠」：つながっているインクを丸ごと枠にする
        const encloses = raw.blocks.some(
          (o) => o !== b && o.ink >= 3 && o.x0 > b.x0 && o.y0 > b.y0 && o.x1 < b.x1 && o.y1 < b.y1 && o.y1 - o.y0 + 1 >= 2
        )
        if (!encloses) continue
        near.length = 0
        for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
          const i = y * gw + x
          if (content[i] && raw.labels[i] === b.id) near.push(i)
        }
      }
      const id = frames.length + 1
      for (const i of near) {
        frameOf[i] = id
        content[i] = 0
      }
      frames.push({ id, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, ink: near.length, loop: !isFrame })
      peeled++
    }
    if (!peeled) break
  }

  // ---- 2b. 枠線以外を太らせて、かたまりに番号を付ける（横に大きめ：横書きの文字をつなげる） ----
  // natural：しきい値を画像の幅ではなく「文字の高さ」から決める（大きな見出しも小さな文字も同じ感覚で区切る）
  const charH = structured ? estimateCharHeight(content, gw, gh) : 0
  if (structured) {
    // 矢印などのために途中が切れている枠（上下2つに分かれた雲形など）は、1つの枠にまとめる。
    // 入れ子（枠の中の丸数字など）はまとめない：縦の重なりが小さく、上下に並んでいるものだけ
    for (let merged = true; merged; ) {
      merged = false
      for (let i = 0; i < frames.length && !merged; i++) {
        for (let j = 0; j < frames.length && !merged; j++) {
          if (i === j) continue
          const a = frames[i]
          const o = frames[j]
          const xOver = Math.min(a.x1, o.x1) - Math.max(a.x0, o.x0)
          const minW = Math.min(a.x1 - a.x0, o.x1 - o.x0)
          const yOver = Math.min(a.y1, o.y1) - Math.max(a.y0, o.y0)
          const minH = Math.min(a.y1 - a.y0, o.y1 - o.y0)
          // 切れ目の大きさは、文字の高さか、かけらの高さの3割の大きい方まで（選択範囲の中だけを見て文字が小さく測られても、雲形の切れ目をつなげる）
          if (xOver < minW * 0.6 || yOver > minH * 0.2 || yOver < -Math.max(charH * 1.2, minH * 0.3)) continue
          // どちらも「閉じていない」（一周の一部しかない）ときだけ
          if (polarContour(frameOf, gw, a).coverage > 0.85 || polarContour(frameOf, gw, o).coverage > 0.85) continue
          for (let y = o.y0; y <= o.y1; y++) for (let x = o.x0; x <= o.x1; x++) if (frameOf[y * gw + x] === o.id) frameOf[y * gw + x] = a.id
          a.x0 = Math.min(a.x0, o.x0)
          a.y0 = Math.min(a.y0, o.y0)
          a.x1 = Math.max(a.x1, o.x1)
          a.y1 = Math.max(a.y1, o.y1)
          a.ink += o.ink
          frames.splice(j, 1)
          merged = true
        }
      }
    }
    // まとめても一周にならない枠のかけら（飾りの線がついた一部分など）は、枠ではなく普通のインクに戻す
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i]
      if (!f.loop || polarContour(frameOf, gw, f).coverage >= 0.75) continue
      for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) {
        const q = y * gw + x
        if (frameOf[q] === f.id) {
          frameOf[q] = 0
          content[q] = 1
        }
      }
      frames.splice(i, 1)
    }
  }
  const rx = structured
    ? Math.max(1, Math.round(charH * NATURAL_MERGE[opts.detail]))
    : Math.max(1, Math.round(gw * MERGE[opts.detail]))
  // 縦は控えめに（行間が詰まった文章でも、行ごとに分かれるように）
  const ry = structured ? Math.max(1, Math.round(charH * 0.12)) : Math.max(1, Math.round(gw * MERGE[opts.detail] * 0.22))
  // 枠線は壁として扱う：太らせたかたまりが枠をまたいで隣のパネルとつながらないよう、線の上を切っておく
  const cutFrames = (mask: Uint8Array): void => {
    if (walls) for (let i = 0; i < n; i++) if (walls[i]) mask[i] = 0
    for (let i = 0; i < n; i++) {
      if (!frameOf[i]) continue
      const x = i % gw
      const y = (i - x) / gw
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx >= 0 && xx < gw && yy >= 0 && yy < gh) mask[yy * gw + xx] = 0
        }
      }
    }
  }
  // natural：枠の輪郭を一周つないだ線も壁にする（矢印のための切れ目などから、中身が外とつながらないように）
  let walls: Uint8Array | null = null
  if (structured && frames.length) {
    const wc = document.createElement('canvas')
    wc.width = gw
    wc.height = gh
    const wctx = wc.getContext('2d', { willReadFrequently: true })!
    wctx.strokeStyle = '#000'
    wctx.lineWidth = 3
    wctx.lineJoin = 'round'
    for (const f of frames) {
      const pts = polarContour(frameOf, gw, f).points
      if (pts.length < 3) continue
      wctx.beginPath()
      pts.forEach(([x, y], i) => (i ? wctx.lineTo(x, y) : wctx.moveTo(x, y)))
      wctx.closePath()
      wctx.stroke()
    }
    const wd = wctx.getImageData(0, 0, gw, gh).data
    walls = new Uint8Array(n)
    for (let i = 0; i < n; i++) if (wd[i * 4 + 3] > 64) walls[i] = 1
  }
  const fat = dilate(content, gw, gh, rx, ry)
  cutFrames(fat)
  const merged = labelComponents(fat, gw, gh, content)
  const labels = merged.labels
  const blocks: Block[] = merged.blocks
  if (walls) {
    // 壁の上で切ったインク（枠をまたぐ矢印など）は、となりのかたまりに入れる
    for (let i = 0; i < n; i++) {
      if (!content[i] || labels[i]) continue
      const x = i % gw
      const y = (i - x) / gw
      search: for (let r = 1; r <= 3; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue
          const l = labels[yy * gw + xx]
          if (l && fat[yy * gw + xx]) {
            labels[i] = l
            const b = blocks[l - 1]
            b.ink++
            if (x < b.x0) b.x0 = x
            if (x > b.x1) b.x1 = x
            if (y < b.y0) b.y0 = y
            if (y > b.y1) b.y1 = y
            break search
          }
        }
      }
    }
  }

  // natural：もっと大きく太らせて「領域」（段落・段組みの列・図とその説明など、近いものの集まり）を作る。
  // 領域の中を書き切ってから次の領域へ進む
  const regionOf = new Int32Array(blocks.length + 1)
  if (structured) {
    const wide = dilate(content, gw, gh, Math.max(rx + 1, Math.round(charH * 1.8)), Math.max(ry + 1, Math.round(charH * 0.8)))
    cutFrames(wide)
    const region = labelComponents(wide, gw, gh, content).labels
    for (let i = 0; i < n; i++) if (content[i] && labels[i] && region[i]) regionOf[labels[i]] = region[i]
  }

  // 枠線は、線のまわり2画素までを自分の範囲にする（ほかのかたまりの範囲より優先）
  for (const f of frames) {
    const id = blocks.length + 1
    const b: Block = { id, x0: gw, y0: gh, x1: 0, y1: 0, ink: f.ink, parent: 0, children: [], frame: { x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1, id: f.id } }
    for (let y = f.y0; y <= f.y1; y++) {
      for (let x = f.x0; x <= f.x1; x++) {
        if (frameOf[y * gw + x] !== f.id) continue
        for (let dy = -2; dy <= 2; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= gh) continue
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= gw) continue
            const q = yy * gw + xx
            if (frameOf[q] && frameOf[q] !== f.id) continue // 別の枠線のインクは奪わない
            labels[q] = id
            if (xx < b.x0) b.x0 = xx
            if (xx > b.x1) b.x1 = xx
            if (yy < b.y0) b.y0 = yy
            if (yy > b.y1) b.y1 = yy
          }
        }
      }
    }
    blocks.push(b)
  }
  // ごく小さいゴミは除く
  const minInk = Math.max(4, Math.round(n * 0.00003))
  const kept = blocks.filter((b) => b.ink >= minInk)
  if (kept.length === 0) return { strokes: [wholeImageStroke(size, opts, startIndex)], blocks: 1, fallback: true }

  // ---- 3. 順番：枠（ほかを囲むかたまり）→ その中身、の順。きょうだいは上から下・左から右 ----
  const area = (b: Block): number => (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1)
  const tol = rx + 3
  for (const b of kept) {
    let best: Block | null = null
    for (const o of kept) {
      if (o === b || area(o) <= area(b)) continue
      // 太らせた分だけ枠からはみ出すことがあるので、少し余裕を持って「中にある」と判定する
      if (o.x0 - tol <= b.x0 && o.y0 - tol <= b.y0 && o.x1 + tol >= b.x1 && o.y1 + tol >= b.y1 && (!best || area(o) < area(best))) best = o
    }
    if (best) {
      b.parent = best.id
      best.children.push(b)
    }
  }
  const ordered: Block[] = []
  const visit = (list: Block[]): void => {
    const emit = (b: Block): void => {
      ordered.push(b)
      visit(b.children)
    }
    if (!structured) {
      for (const b of readingOrder(list)) emit(b)
      return
    }
    // natural：領域ごとにまとめ、領域どうし → 領域の中の行、の順に「上から下・左から右」
    const groups = new Map<number, Block[]>()
    for (const b of list) {
      const key = regionOf[b.id] || -b.id // 枠線などは、それだけで1つの領域
      const g = groups.get(key)
      if (g) g.push(b)
      else groups.set(key, [b])
    }
    const units = [...groups.values()].map((items) => ({
      items,
      x0: Math.min(...items.map((o) => o.x0)),
      y0: Math.min(...items.map((o) => o.y0)),
      x1: Math.max(...items.map((o) => o.x1)),
      y1: Math.max(...items.map((o) => o.y1))
    }))
    for (const u of readingOrder(units, true)) for (const b of readingOrder(u.items, true)) emit(b)
  }
  visit(kept.filter((b) => !b.parent))

  // ---- 4・5. かたまりごとに軌跡と表示範囲を作る ----
  const refH = Math.max(10, gw * 0.05) // 1行ぶんの高さの目安
  const step = Math.max(3, Math.round(gw * 0.012)) // 点を打つ間隔
  const gapMin = Math.max(6, Math.round(gw * 0.035)) // これ以上インクが途切れたらペンを上げる
  const speed = gw * SPEED[opts.speed] // 解析用の画素 / 秒
  const strokes: Stroke[] = []
  const done = new Uint8Array(n) // 枠の一周でなぞり終えたインク
  const skeleton = opts.pathMode === 'ink' ? skeletonize(ink, gw, gh) : null
  // 線の太さを測るための「紙までの距離」（インクの画素ごと）。中心線の上の値 ×2 が、その場所の線の太さ
  const inkDist = skeleton ? distanceToPaper(ink, gw, gh) : null
  const edges = skeleton ? new Uint8Array(n) : null

  let pen = { x: 0, y: 0 }
  const pending = [...ordered]
  while (pending.length) {
    // 領域順を崩して全体から最も近いブロックを選び直すと、
    // 隣の段やパネルに飛んでから戻ってくるため、決定済みの順番を守る。
    const b = pending.shift()!
    const pts: StrokePoint[] = []
    let t = 0
    let last: { x: number; y: number } | null = null
    /** natural：ペンを上げて移る前の「間」。文字の列の間は短く、単語の間は少し、行の間は長めに */
    let liftMs = LIFT_MS
    /** natural：最初の部分の見せる幅（以降の部分は、ペンを上げた点ごとに持つ） */
    let firstWidth = 0
    /** lift: ペンを上げてここへ移動 / pace: 速さの倍率 / width: ここから先の見せる幅（解析用の画素） */
    const push = (gx: number, gy: number, lift: boolean, pace = 1, width?: number): void => {
      if (last) {
        const d = Math.hypot(gx - last.x, gy - last.y)
        // ペンを上げている間は、書くときの3倍の速さで移動する
        t += lift ? (opts.pathMode === 'ink' ? 40 : natural ? liftMs : LIFT_MS) + (d / (speed * 3)) * 1000 : (d / (speed * pace)) * 1000
      }
      const p: StrokePoint = { x: Math.round((gx / k) * 10) / 10, y: Math.round((gy / k) * 10) / 10, t: Math.round(t) }
      if (lift && pts.length > 0) {
        p.b = 1
        if (width) p.w = opts.revealWidth || Math.round(width / k)
      }
      pts.push(p)
      last = { x: gx, y: gy }
    }
    const mine = (i: number): boolean => ink[i] === 1 && labels[i] === b.id && !done[i]

    // ---- 枠線：まず線に沿って一周する（上辺 → 右辺 → 下辺 → 左辺）。少し速めに ----
    // 一周でなぞれたインクには done を付け、残り（枠につながった見出しの帯など）は下の「行ごと」で描く
    let frameWidth = 0
    let bandWidth = 0
    if (skeleton && edges) {
      const dx = [1, 1, 0, -1, -1, -1, 0, 1]
      const dy = [0, 1, 1, 1, 0, -1, -1, -1]
      // 線をたどるときも「どこから描くか」は自然に描くと同じ：かたまりを部分に分け、部分ごとに描き切る。
      // その部分の中だけで線の中心をたどる（部分の外の線は、その部分の番が来てから）
      let part: Box = b
      const belongs = (x: number, y: number): boolean =>
        x >= part.x0 && y >= part.y0 && x <= part.x1 && y <= part.y1 && skeleton[y * gw + x] === 1 && labels[y * gw + x] === b.id
      // 斜めの両端が直角の線でもつながっている場合は、重複する斜め辺を作らない。
      const connected = (x: number, y: number, d: number): boolean => {
        if (!belongs(x + dx[d], y + dy[d])) return false
        return !(dx[d] && dy[d] && (belongs(x + dx[d], y) || belongs(x, y + dy[d])))
      }
      const available = (x: number, y: number, d: number): boolean => !(edges[y * gw + x] & (1 << d)) && connected(x, y, d)
      // 太い線もなるべく残さず表示する。表示範囲は元のブロックに限定する。
      bandWidth = Math.max(5, Math.min(36, gw * 0.025))
      const trails: { x: number; y: number }[][] = []
      const walk = (sx: number, sy: number): void => {
        let x = sx, y = sy, previous = -1, steps = 0
        const trail = [{ x, y }]
        while (true) {
          let best = -1, score = -Infinity
          for (let d = 0; d < 8; d++) if (available(x, y, d)) {
            const value = previous < 0 ? 0 : dx[d] * dx[previous] + dy[d] * dy[previous]
            if (value > score) { best = d; score = value }
          }
          if (best < 0) break
          const i = y * gw + x
          edges[i] |= 1 << best
          x += dx[best]; y += dy[best]
          edges[y * gw + x] |= 1 << ((best + 4) % 8)
          previous = best
          if (++steps % 3 === 0) trail.push({ x, y })
        }
        if (steps % 3 !== 0) trail.push({ x, y })
        trails.push(trail)
      }
      const parts = structured ? splitIntoParts(b, mine, gw, charH) : [b]
      let tip = pen
      // ペンが通って見えた所。すでに見えている線（太い線を細線化したときに出るひげ・二重線・塗りの中の線など）はなぞらない
      const covered = new Uint8Array(n)
      const stamp = (cx: number, cy: number, r: number): void => {
        const ri = Math.ceil(r)
        for (let yy = Math.max(0, Math.floor(cy) - ri); yy <= Math.min(gh - 1, Math.ceil(cy) + ri); yy++)
          for (let xx = Math.max(0, Math.floor(cx) - ri); xx <= Math.min(gw - 1, Math.ceil(cx) + ri); xx++)
            if ((xx - cx) * (xx - cx) + (yy - cy) * (yy - cy) <= r * r) covered[yy * gw + xx] = 1
      }
      for (const pp of parts) {
      part = pp
      // この部分のペンの太さ：中心線の上で測った線の太さの、太め（上位1割）に合わせる。
      // ＋2 は、にじみ（アンチエイリアスの薄い縁）の分。これで1回なぞれば線の幅全体が見える
      const radii: number[] = []
      for (let y = part.y0; y <= part.y1; y++) for (let x = part.x0; x <= part.x1; x++) if (belongs(x, y)) radii.push(inkDist![y * gw + x])
      radii.sort((a, c) => a - c)
      const r90 = radii.length ? radii[Math.floor(radii.length * 0.9)] : 1
      const partWidth = Math.max(3, Math.min(gw * 0.15, r90 * 2 + 2))
      if (!firstWidth) firstWidth = partWidth
      bandWidth = partWidth
      let partStart = true
      let penWidth = partWidth
      // 端点を先に処理し、残る分岐や閉じた線を後から処理する。
      for (let phase = 0; phase < 2; phase++) for (let y = part.y0; y <= part.y1; y++) for (let x = part.x0; x <= part.x1; x++) {
        if (!belongs(x, y)) continue
        let degree = 0
        for (let d = 0; d < 8; d++) if (connected(x, y, d)) degree++
        if (phase === 0 && degree !== 1) continue
        let any = false
        for (let d = 0; d < 8; d++) if (available(x, y, d)) { any = true; break }
        if (any) walk(x, y)
        else if (phase === 1 && degree === 0) trails.push([{ x, y }, { x: x + 0.1, y }])
      }
      // 開始点と終了点を比べ、今のペン先から近い端で次の線を描き始める。
      while (trails.length > 0) {
        let next = 0
        let reverse = false
        let nearest = Infinity
        for (let i = 0; i < trails.length; i++) {
          const trail = trails[i]
          for (let end = 0; end < 2; end++) {
            const fromEnd = end === 1
            const point = trail[fromEnd ? trail.length - 1 : 0]
            const finish = trail[fromEnd ? 0 : trail.length - 1]
            const dx = finish.x - point.x
            const dy = finish.y - point.y
            // 主方向が横なら左→右、縦なら上→下を優先する。
            const backwards = Math.abs(dx) >= Math.abs(dy) ? dx < 0 : dy < 0
            const distance = Math.hypot(point.x - tip.x, point.y - tip.y)
              + (backwards ? Math.hypot(dx, dy) * 1.5 : 0)
            if (distance >= nearest) continue
            nearest = distance
            next = i
            reverse = fromEnd
          }
        }
        const trail = trails[next]
        trails[next] = trails[trails.length - 1]
        trails.pop()
        // もう見えている線は、ペンを運ばずに飛ばす（時間の大半はこうした短い線への移動だった）。
        // 短い線（ひげ・点のかけら）は、8割見えていれば十分とみなす
        let open = 0
        for (const { x, y } of trail) if (!covered[Math.round(y) * gw + Math.round(x)]) open++
        const tLen = Math.hypot(trail[trail.length - 1].x - trail[0].x, trail[trail.length - 1].y - trail[0].y)
        if (open === 0 || (tLen <= partWidth * 3 && open <= trail.length * 0.2)) continue
        if (reverse) trail.reverse()
        // 塗りつぶしや線の交わりなど、この線だけ部分の太さより太いときは、この線の間だけペンを太くする
        let maxR = 0
        for (const { x, y } of trail) maxR = Math.max(maxR, inkDist![Math.round(y) * gw + Math.round(x)])
        const width = Math.max(partWidth, Math.min(gw * 0.15, maxR * 2 + 2))
        const r = width / 2 - 0.5
        const switchWidth = width !== penWidth
        if (pts.length === 0) firstWidth = width // 軌跡の最初の太さは、軌跡全体の基本の太さとして持つ
        penWidth = width
        trail.forEach(({ x, y }, i) => {
          // 部分の最初や、太さを変えるときは、ペンを上げた点にして太さを切り替える
          // 次の線の書き始めがペン先のすぐそば（ペンの太さ以内）なら、ペンを上げずにそのまま続ける（間を置かない）
          const near = Math.hypot(x - tip.x, y - tip.y) <= width
          push(x, y, i === 0 && (partStart || switchWidth || !near), 1, width)
          if (i > 0) stamp((x + trail[i - 1].x) / 2, (y + trail[i - 1].y) / 2, r)
          stamp(x, y, r)
        })
        partStart = false
        tip = trail[trail.length - 1]
      }
      }
    } else {
    if (b.frame && natural) {
      // natural：枠は形に沿って一筆で一周する（上の真ん中から時計回り）。雲形・丸・四角のどれでも使える
      const f = b.frame
      for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) if (frameOf[y * gw + x] === f.id) done[y * gw + x] = 1
      const contour = polarContour(frameOf, gw, f)
      frameWidth = Math.min(Math.max(f.x1 - f.x0, f.y1 - f.y0) * 0.3, contour.span + 6)
      contour.trace.forEach(([x, y], i) => push(x, y, i === 0, 2))
      liftMs = 160
    } else if (b.frame) {
      const f = b.frame
      const m = 1.5
      const rx0 = f.x0 + m
      const ry0 = f.y0 + m
      const rx1 = f.x1 - m
      const ry1 = f.y1 - m
      const w = 12
      let total = 0
      const near: number[] = []
      for (let y = f.y0; y <= f.y1; y++) {
        for (let x = f.x0; x <= f.x1; x++) {
          const i = y * gw + x
          if (!ink[i] || labels[i] !== b.id) continue
          total++
          const dEdge = Math.min(
            Math.abs(y - ry0) + (x < rx0 ? rx0 - x : x > rx1 ? x - rx1 : 0),
            Math.abs(y - ry1) + (x < rx0 ? rx0 - x : x > rx1 ? x - rx1 : 0),
            Math.abs(x - rx0) + (y < ry0 ? ry0 - y : y > ry1 ? y - ry1 : 0),
            Math.abs(x - rx1) + (y < ry0 ? ry0 - y : y > ry1 ? y - ry1 : 0)
          )
          if (dEdge <= w / 2 - 1) near.push(i)
        }
      }
      // インクの4割以上が四角の周上にあれば「枠」として一周する
      if (total > 0 && near.length / total >= 0.4) {
        for (const i of near) done[i] = 1
        const corners: [number, number][] = [
          [rx0, ry0],
          [rx1, ry0],
          [rx1, ry1],
          [rx0, ry1],
          [rx0, ry0]
        ]
        for (let cI = 0; cI < corners.length - 1; cI++) {
          const [ax, ay] = corners[cI]
          const [bx, by] = corners[cI + 1]
          const len = Math.hypot(bx - ax, by - ay)
          const count = Math.max(1, Math.round(len / (step * 2)))
          for (let q = cI === 0 ? 0 : 1; q <= count; q++) push(ax + ((bx - ax) * q) / count, ay + ((by - ay) * q) / count, false, 2)
        }
        frameWidth = w
      }
    }

    if (natural) {
      // ---- natural：かたまりの中を、余白で「列」と「行」に分けていく（XY-cut） ----
      //  ・上から下まで通る縦の余白（段組みの境目）があれば、先に左右に分ける → 左の列を書き切ってから右の列へ
      //  ・なければ、インクがほぼ無い横の行で上下に分ける（飾りの点や線が少しかかっていても分けられる）
      //  ・それ以上分けられないもの（1行・1つの図）を、行なら1回で左→右、背の高い図は縦の列ごとに上→下に書く
      // 分け目は余白の真ん中にとるので、余白に残った少しのインクもどれかの部分が受け持つ（取りこぼさない）
      const leaves = splitIntoParts(b, mine, gw, charH)

      const wordGap = Math.max(3, Math.round(charH * 0.6))
      let prevLeaf: { x0: number; y0: number; x1: number; y1: number } | null = null
      for (const L of leaves) {
        const h = L.y1 - L.y0 + 1
        const lw = L.x1 - L.x0 + 1
        const cnt = new Uint16Array(lw)
        const sum = new Float32Array(lw)
        const top = new Int32Array(lw).fill(-1)
        const bot = new Int32Array(lw).fill(-1)
        for (let y = L.y0; y <= L.y1; y++) {
          for (let x = L.x0; x <= L.x1; x++) {
            if (!mine(y * gw + x)) continue
            const c = x - L.x0
            cnt[c]++
            sum[c] += y
            if (top[c] < 0) top[c] = y
            bot[c] = y
          }
        }
        const lineLike = h <= charH * 2.2 || lw >= h * 3
        // 間の取り方：同じ高さで右へ続くときは短く、次の行（下）へ移るときは長め
        liftMs = !prevLeaf ? 120 : L.y0 > prevLeaf.y1 - charH * 0.5 && L.x0 < prevLeaf.x1 ? 260 : 150
        prevLeaf = L

        if (lineLike) {
          // 行：インクの重心をたどって、1回で左から右へ。単語の切れ目ではペンを上げて少し間を置く
          const width = Math.min(600 * k, h * 1.3 + 4)
          if (!firstWidth) firstWidth = width
          const center = (L.y0 + L.y1) / 2
          const runs: [number, number][] = []
          let runStart = -1
          let lastInk = -1
          for (let x = 0; x < lw; x++) {
            if (!cnt[x]) continue
            if (runStart < 0) runStart = x
            else if (x - lastInk > wordGap) {
              runs.push([runStart, lastInk])
              runStart = x
            }
            lastInk = x
          }
          if (runStart >= 0) runs.push([runStart, lastInk])
          for (let ri = 0; ri < runs.length; ri++) {
            const [xa, xb] = runs[ri]
            if (ri > 0) liftMs = 110
            let prevY = center
            const yAt = (x: number): number => {
              let cn = 0
              let cs = 0
              for (let q = Math.max(xa, x - step); q <= Math.min(xb, x + step); q++) {
                cn += cnt[q]
                cs += sum[q]
              }
              if (cn > 0) prevY = (cs / cn) * 0.5 + center * 0.5
              return prevY
            }
            let first = true
            for (let x = xa; x < xb; x += step) {
              push(L.x0 + x, yAt(x), first, 1, width)
              first = false
            }
            push(L.x0 + xb + (xa === xb ? 1 : 0), yAt(xb), first, 1, width)
          }
        } else {
          // 背の高いもの（図・大きな記号）：縦の列に分け、左の列から順に、各列は上から下へ
          const cw = Math.max(3, Math.round(charH * 1.1))
          const width = Math.min(600 * k, cw * 1.5 + 4)
          if (!firstWidth) firstWidth = width
          for (let cx = 0; cx < lw; cx += cw) {
            let t0 = Infinity
            let t1 = -1
            let xs = 0
            let xn = 0
            for (let x = cx; x < Math.min(lw, cx + cw); x++) {
              if (!cnt[x]) continue
              t0 = Math.min(t0, top[x])
              t1 = Math.max(t1, bot[x])
              xs += x * cnt[x]
              xn += cnt[x]
            }
            if (t1 < 0) continue
            const xm = L.x0 + xs / xn
            const len = t1 - t0
            const count = Math.max(1, Math.round(len / step))
            for (let q = 0; q <= count; q++) push(xm, t0 + (len * q) / count, q === 0, 1.6, width)
            liftMs = 40 // 隣の列へはすぐ移る
          }
        }
      }
    } else {
    // ---- 残りのインクを、行（バンド）ごとに左から右へ ----
    let inkTop = -1
    let inkBottom = -1
    for (let y = b.y0; y <= b.y1 && inkTop < 0; y++) for (let x = b.x0; x <= b.x1; x++) if (mine(y * gw + x)) { inkTop = y; break }
    for (let y = b.y1; y >= b.y0 && inkBottom < 0; y--) for (let x = b.x0; x <= b.x1; x++) if (mine(y * gw + x)) { inkBottom = y; break }
    const inkH = inkTop < 0 ? 0 : inkBottom - inkTop + 1
    const bands = inkTop < 0 ? 0 : Math.max(1, Math.round(inkH / refH))
    const bandH = bands ? inkH / bands : 0
    // 見せる幅：行の高さより十分太く（範囲の外は clip が守る）。
    // 上下にごしごしする分だけ線が上下に動くので、その分は細くしても行全体が見える
    const ampV = Math.max(0, Math.min(1, opts.scrubV ?? 0)) * gh / 2
    bandWidth = bandH * 1.9 + 10 * k

    for (let j = 0; j < bands; j++) {
      const ya = Math.round(inkTop + j * bandH)
      const yb = Math.min(inkBottom, Math.round(inkTop + (j + 1) * bandH) - 1)
      const center = (ya + yb) / 2
      // 列ごとのインク量と重心
      const w = b.x1 - b.x0 + 1
      const cnt = new Uint16Array(w)
      const sum = new Float32Array(w)
      for (let y = ya; y <= yb; y++) {
        for (let x = b.x0; x <= b.x1; x++) {
          if (mine(y * gw + x)) {
            cnt[x - b.x0]++
            sum[x - b.x0] += y
          }
        }
      }
      // インクが続いている列の区間（短い切れ目はつなぐ）
      const runs: [number, number][] = []
      let runStart = -1
      let lastInk = -1
      for (let x = 0; x < w; x++) {
        if (!cnt[x]) continue
        if (runStart < 0) runStart = x
        else if (x - lastInk > gapMin) {
          runs.push([runStart, lastInk])
          runStart = x
        }
        lastInk = x
      }
      if (runStart >= 0) runs.push([runStart, lastInk])

      for (const [xa, xb] of runs) {
        let prevY = center
        const yAt = (x: number): number => {
          let cn = 0
          let cs = 0
          for (let q = Math.max(xa, x - step); q <= Math.min(xb, x + step); q++) {
            cn += cnt[q]
            cs += sum[q]
          }
          if (cn > 0) prevY = (cs / cn) * 0.65 + center * 0.35 // 重心をたどりつつ、暴れすぎないよう行の中心に寄せる
          return prevY
        }
        let first = true
        // 枠を一周したあとの部分は、太さを行の高さに合わせて切り替える
        const partWidth = frameWidth ? bandWidth : undefined
        const sv = opts.scrubV ?? 0
        const sh = opts.scrubH ?? 0
        if (sv <= 0.01 && Math.abs(sh) <= 0.01) {
          // なめらか：インクの重心をたどって進む
          for (let x = xa; x < xb; x += step) {
            push(b.x0 + x, yAt(x), first, 1, partWidth)
            first = false
          }
          push(b.x0 + xb + (xa === xb ? 1 : 0), yAt(xb), first, 1, partWidth)
        } else {
          // ごしごし：半周期ごとに、上下（sv）と左右（sh）に振りながら右へ進む。
          //   上下：行の中心から ±ampV
          //   左右：進む位置の前後に ±hAmp。半周期の進みより大きいと、手が少し戻ってまた進む動きになる
          const hAmp = Math.max(0, Math.min(1, Math.abs(sh))) * gw / 2
          const pace = 1 + 1.6 * Math.min(1, Math.max(sv, Math.abs(sh)))
          const len = xb - xa
          const count = Math.max(2, Math.min(200, Math.round((opts.scrubCycles ?? 8) * 2)))
          for (let i = 0; i <= count; i++) {
            const xp = xa + (len * i) / count
            const dir = i % 2 === 0 ? -1 : 1
            const edge = i === 0 || i === count
            const x = b.x0 + xp + (edge ? 0 : -dir * hAmp * Math.sign(sh || 1) + dir * ampV * (opts.scrubTilt ?? 0))
            const y = (sv > 0 ? center : yAt(xp)) + (edge ? 0 : dir * ampV)
            push(Math.max(0, Math.min(gw - 1, x + (len === 0 && i > 0 ? 1 : 0))), Math.max(0, Math.min(gh - 1, y)), first, pace, partWidth)
            first = false
          }
        }
      }
    }
    }
    }
    if (pts.length === 0) continue
    if (pts.length === 1) pts.push({ x: pts[0].x + 1, y: pts[0].y, t: pts[0].t + 120 })

    // 表示範囲：このかたまりの太らせた形（行ごとの連続区間で持つ）
    const runsOut: number[] = []
    for (let y = b.y0; y <= b.y1; y++) {
      let x = b.x0
      while (x <= b.x1) {
        if (labels[y * gw + x] !== b.id) {
          x++
          continue
        }
        const s = x
        while (x <= b.x1 && labels[y * gw + x] === b.id) x++
        runsOut.push(y, s, x - s)
      }
    }
    const clip: ClipShape = { kind: 'rle', mode: 'add', gw, gh, runs: runsOut, box: [b.x0, b.y0, b.x1 + 1, b.y1 + 1] }
    // 選択範囲があるときは、表示もその範囲の中に限る（太らせたかたまりが範囲の外へはみ出しても見せない）
    const shapes: ClipShape[] = opts.within ? [clip, { kind: 'region', mode: 'intersect', region: structuredClone(opts.within) }] : [clip]

    pen = { x: pts[pts.length - 1].x * k, y: pts[pts.length - 1].y * k }
    const index = startIndex + strokes.length
    strokes.push({
      id: newId(),
      name: `自動 ${strokes.length + 1}`,
      points: pts,
      // 行の高さより十分太くして、手が通った所の縦一列を一度に見せる（範囲の外は clip が守る）
      revealWidth:
        opts.revealWidth ||
        (frameWidth ? Math.round(frameWidth / k) : (natural || skeleton) && firstWidth ? Math.round(firstWidth / k) : Math.min(600, Math.round(bandWidth / k))),
      duration: Math.max(300, pts[pts.length - 1].t),
      // natural：同じ領域の中は短い間、次の領域へ移るときは少し長めの間
      delayAfter: natural ? (pending.length && (regionOf[pending[0].id] || -pending[0].id) === (regionOf[b.id] || -b.id) ? 140 : 380) : 180,
      useRecordedTiming: true,
      color: strokeColor(index),
      clip: { shapes }
    })
  }

  if (strokes.length === 0) return { strokes: [wholeImageStroke(size, opts, startIndex)], blocks: 1, fallback: true }
  return { strokes, blocks: strokes.length, fallback: false, charH: natural ? charH : undefined }
}

/**
 * つながっている画素に同じ番号を付ける（斜めもつながりとみなす）。
 * inkOf を渡すと、各かたまりのインク量をその画素で数える（太らせたマスクに番号を付けるとき用）。
 */
function labelComponents(mask: Uint8Array, w: number, h: number, inkOf: Uint8Array = mask): { labels: Int32Array; blocks: Block[] } {
  const n = w * h
  const labels = new Int32Array(n)
  const blocks: Block[] = []
  const stack = new Int32Array(n)
  for (let s = 0; s < n; s++) {
    if (!mask[s] || labels[s]) continue
    const id = blocks.length + 1
    const b: Block = { id, x0: w, y0: h, x1: 0, y1: 0, ink: 0, parent: 0, children: [] }
    let sp = 0
    stack[sp++] = s
    labels[s] = id
    while (sp > 0) {
      const p = stack[--sp]
      const x = p % w
      const y = (p - x) / w
      if (x < b.x0) b.x0 = x
      if (x > b.x1) b.x1 = x
      if (y < b.y0) b.y0 = y
      if (y > b.y1) b.y1 = y
      if (inkOf[p]) b.ink++
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const q = yy * w + xx
          if (mask[q] && !labels[q]) {
            labels[q] = id
            stack[sp++] = q
          }
        }
      }
    }
    blocks.push(b)
  }
  return { labels, blocks }
}

/** 横に rx、縦に ry だけ太らせる */
function dilate(src: Uint8Array, w: number, h: number, rx: number, ry: number): Uint8Array {
  const tmp = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    let lastInk = -1e9
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (src[row + x]) lastInk = x
      if (x - lastInk <= rx) tmp[row + x] = 1
    }
    lastInk = 1e9
    for (let x = w - 1; x >= 0; x--) {
      if (src[row + x]) lastInk = x
      if (lastInk - x <= rx) tmp[row + x] = 1
    }
  }
  const out = new Uint8Array(w * h)
  for (let x = 0; x < w; x++) {
    let lastInk = -1e9
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) lastInk = y
      if (y - lastInk <= ry) out[y * w + x] = 1
    }
    lastInk = 1e9
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) lastInk = y
      if (lastInk - y <= ry) out[y * w + x] = 1
    }
  }
  return out
}

/**
 * 上から下・左から右（同じ高さにあるものを1行とみなす）
 * strict：行の範囲を「足し合わせ」ではなく平均で見る（背の高いものが下の行を次々に飲み込まないように）
 */
function readingOrder<T extends { x0: number; y0: number; x1: number; y1: number }>(list: T[], strict = false): T[] {
  const sorted = [...list].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2)
  const lines: T[][] = []
  for (const b of sorted) {
    const cy = (b.y0 + b.y1) / 2
    const line = lines[lines.length - 1]
    if (line) {
      const y0 = strict ? line.reduce((s, o) => s + o.y0, 0) / line.length : Math.min(...line.map((o) => o.y0))
      const y1 = strict ? line.reduce((s, o) => s + o.y1, 0) / line.length : Math.max(...line.map((o) => o.y1))
      const overlap = Math.min(y1, b.y1) - Math.max(y0, b.y0)
      // 中心が行の範囲に入るか、縦の重なりが小さい方の高さの半分以上なら同じ行
      if ((cy >= y0 && cy <= y1) || overlap >= 0.5 * Math.min(y1 - y0, b.y1 - b.y0)) {
        line.push(b)
        continue
      }
    }
    lines.push([b])
  }
  return lines.flatMap((line) => line.sort((a, b) => a.x0 - b.x0))
}

/** 予備：画像全体を左から右へ、上から順に見せていく1本の軌跡 */
function wholeImageStroke(size: { width: number; height: number }, opts: AutoTraceOptions, index: number): Stroke {
  const rows = 6
  const bandH = size.height / rows
  const speed = size.width * SPEED[opts.speed]
  const pts: StrokePoint[] = []
  let t = 0
  for (let j = 0; j < rows; j++) {
    const y = Math.round(bandH * (j + 0.5))
    if (j > 0) t += LIFT_MS
    for (let i = 0; i <= 12; i++) {
      const p: StrokePoint = { x: Math.round((size.width * i) / 12), y, t: Math.round(t) }
      if (j > 0 && i === 0) p.b = 1
      pts.push(p)
      if (i < 12) t += (size.width / 12 / speed) * 1000
    }
  }
  return {
    id: newId(),
    name: '自動（全体）',
    points: pts,
    revealWidth: opts.revealWidth || Math.min(600, Math.round(bandH * 1.15)),
    duration: Math.max(300, Math.round(t)),
    delayAfter: 180,
    useRecordedTiming: true,
    color: strokeColor(index)
  }
}
