// 描き順の自動生成。
// 清書画像を解析して、「手が順番に書いていく」軌跡の下書きを作る（あとから手で直せる）。
//
//  1. 画像を小さくして背景色を調べ、背景と違う画素を「インク」とみなす
//  2. インクを少し太らせて、近くの文字どうしをひとかたまり（ブロック）にする
//  3. ブロックの順番を決める：枠の中にあるものは枠ごとにまとめ、上から下・左から右へ
//  4. ブロックごとに、インクの重心をたどる軌跡を作る（行が複数あればペンを上げて次の行へ）
//  5. 各軌跡の表示範囲を、そのブロック自身の形（太らせたマスク）に限定する
//     → 太いペン幅で一気に見せても、隣のブロックのインクは先に出ない
import { newId, strokeColor } from './project'
import type { ClipShape, Stroke, StrokePoint } from './types'

export type AutoDetail = 'fine' | 'normal' | 'coarse'
export type AutoSpeed = 'slow' | 'normal' | 'fast'

export interface AutoTraceOptions {
  /** かたまりの大きさ：fine = 細かく分ける / coarse = 大きくまとめる */
  detail: AutoDetail
  /** 書く速さ */
  speed: AutoSpeed
  /** 上下のごしごし（0 = なし 〜 1 = 行の高さいっぱいに上下させながら進む） */
  scrubV?: number
  /** 左右のごしごし（0 = なし 〜 1 = 大きく行ったり戻ったりしながら進む） */
  scrubH?: number
}

/** 手の動き方のおすすめの組み合わせ */
export const MOTION_PRESETS: { id: string; label: string; note: string; scrubV: number; scrubH: number }[] = [
  { id: 'smooth', label: 'なめらか', note: '文字の流れに沿ってすっと進む', scrubV: 0, scrubH: 0 },
  { id: 'vertical', label: '上下にごしごし', note: '縦に往復しながら右へ進む', scrubV: 0.8, scrubH: 0 },
  { id: 'horizontal', label: '左右にごしごし', note: '行ったり戻ったりしながら進む', scrubV: 0, scrubH: 0.7 },
  { id: 'both', label: '斜めにごしごし', note: '上下と左右の両方', scrubV: 0.6, scrubH: 0.45 }
]

export interface AutoTraceResult {
  strokes: Stroke[]
  /** 見つかったかたまりの数 */
  blocks: number
  /** インクをうまく分けられず、画像全体を1つとして扱った */
  fallback: boolean
}

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
  frame?: { x0: number; y0: number; x1: number; y1: number }
}

const GRID_W = 560 // 解析用に縮小した幅
const MERGE: Record<AutoDetail, number> = { fine: 0.008, normal: 0.016, coarse: 0.032 } // 太らせる量（幅に対する比）
const SPEED: Record<AutoSpeed, number> = { slow: 0.38, normal: 0.65, fast: 1.1 } // 1秒に進む距離（幅に対する比）
const LIFT_MS = 220 // ペンを上げて次の書き始めへ移る時間

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

  // インクがほとんど無い／画面の大半がインク（写真など）のときは、全体を1つとして扱う
  if (inkCount === 0 || inkCount / n > 0.55) {
    return { strokes: [wholeImageStroke(size, opts, startIndex)], blocks: 1, fallback: true }
  }

  // ---- 2a. 枠線を先に切り離す ----
  // 外枠やパネルの枠は文字のすぐ近くを通るうえ、枠どうし・見出しの帯とも線でつながっているので、
  // そのまま太らせると全部が1つのかたまりになってしまう。
  // そこで「大きいのに中が空いている」つながりを見つけ、その外周（四角い枠の線）だけを取り出して独立させる。
  // 取り出したあとの残りをもう一度分け直し、内側の枠にも同じことを繰り返す（外側から順にむく）。
  const content = new Uint8Array(ink) // 枠線を取り除いていく
  const frameOf = new Int32Array(n) // 枠線のインクに、その枠の番号
  const frames: { id: number; x0: number; y0: number; x1: number; y1: number; ink: number }[] = []
  for (let pass = 0; pass < 5; pass++) {
    const raw = labelComponents(content, gw, gh)
    let peeled = 0
    for (const b of raw.blocks) {
      const bw = b.x1 - b.x0 + 1
      const bh = b.y1 - b.y0 + 1
      if (!((bw > gw * 0.25 || bh > gh * 0.25) && Math.min(bw, bh) > gw * 0.05 && b.ink / (bw * bh) < 0.25)) continue
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
      if (!isFrame) continue
      const id = frames.length + 1
      for (const i of near) {
        frameOf[i] = id
        content[i] = 0
      }
      frames.push({ id, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, ink: near.length })
      peeled++
    }
    if (!peeled) break
  }

  // ---- 2b. 枠線以外を太らせて、かたまりに番号を付ける（横に大きめ：横書きの文字をつなげる） ----
  const rx = Math.max(1, Math.round(gw * MERGE[opts.detail]))
  // 縦は控えめに（行間が詰まった文章でも、行ごとに分かれるように）
  const ry = Math.max(1, Math.round(gw * MERGE[opts.detail] * 0.22))
  const fat = dilate(content, gw, gh, rx, ry)
  // 枠線は壁として扱う：太らせたかたまりが枠をまたいで隣のパネルとつながらないよう、線の上を切っておく
  for (let i = 0; i < n; i++) {
    if (!frameOf[i]) continue
    const x = i % gw
    const y = (i - x) / gw
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx
        const yy = y + dy
        if (xx >= 0 && xx < gw && yy >= 0 && yy < gh) fat[yy * gw + xx] = 0
      }
    }
  }
  const merged = labelComponents(fat, gw, gh, content)
  const labels = merged.labels
  const blocks: Block[] = merged.blocks

  // 枠線は、線のまわり2画素までを自分の範囲にする（ほかのかたまりの範囲より優先）
  for (const f of frames) {
    const id = blocks.length + 1
    const b: Block = { id, x0: gw, y0: gh, x1: 0, y1: 0, ink: f.ink, parent: 0, children: [], frame: { x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1 } }
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
    for (const b of readingOrder(list)) {
      ordered.push(b)
      visit(b.children)
    }
  }
  visit(kept.filter((b) => !b.parent))

  // ---- 4・5. かたまりごとに軌跡と表示範囲を作る ----
  const refH = Math.max(10, gw * 0.05) // 1行ぶんの高さの目安
  const step = Math.max(3, Math.round(gw * 0.012)) // 点を打つ間隔
  const gapMin = Math.max(6, Math.round(gw * 0.035)) // これ以上インクが途切れたらペンを上げる
  const speed = gw * SPEED[opts.speed] // 解析用の画素 / 秒
  const strokes: Stroke[] = []
  const done = new Uint8Array(n) // 枠の一周でなぞり終えたインク

  for (const b of ordered) {
    const pts: StrokePoint[] = []
    let t = 0
    let last: { x: number; y: number } | null = null
    /** lift: ペンを上げてここへ移動 / pace: 速さの倍率 / width: ここから先の見せる幅（解析用の画素） */
    const push = (gx: number, gy: number, lift: boolean, pace = 1, width?: number): void => {
      if (last) {
        const d = Math.hypot(gx - last.x, gy - last.y)
        // ペンを上げている間は、書くときの3倍の速さで移動する
        t += lift ? LIFT_MS + (d / (speed * 3)) * 1000 : (d / (speed * pace)) * 1000
      }
      const p: StrokePoint = { x: Math.round((gx / k) * 10) / 10, y: Math.round((gy / k) * 10) / 10, t: Math.round(t) }
      if (lift && pts.length > 0) {
        p.b = 1
        if (width) p.w = Math.round(width / k)
      }
      pts.push(p)
      last = { x: gx, y: gy }
    }
    const mine = (i: number): boolean => ink[i] === 1 && labels[i] === b.id && !done[i]

    // ---- 枠線：まず線に沿って一周する（上辺 → 右辺 → 下辺 → 左辺）。少し速めに ----
    // 一周でなぞれたインクには done を付け、残り（枠につながった見出しの帯など）は下の「行ごと」で描く
    let frameWidth = 0
    if (b.frame) {
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
    const ampV = (opts.scrubV ?? 0) * bandH * 0.42
    const bandWidth = Math.max(bandH * 0.7, bandH * 1.9 - 2 * ampV) + 10 * k

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
        if (sv <= 0.01 && sh <= 0.01) {
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
          const half = Math.max(step, bandH * 0.38) // 半周期で進む距離
          const hAmp = sh * half * 0.95
          // 往復するぶん道のりが長くなるので、手を速く動かして全体の時間を抑える
          const pace = 1 + 1.6 * Math.max(sv, sh)
          const len = xb - xa
          const count = Math.max(1, Math.round(len / half))
          for (let i = 0; i <= count; i++) {
            const xp = xa + (len * i) / count
            const dir = i % 2 === 0 ? -1 : 1
            // 書き始めと書き終わりは振らずに、行の端から端まで確実に届かせる
            const edge = i === 0 || i === count
            const x = Math.max(xa, Math.min(xb, xp + (edge ? 0 : dir * hAmp)))
            const y = Math.max(ya, Math.min(yb, (sv > 0 ? center : yAt(xp)) + (edge ? 0 : dir * ampV)))
            push(b.x0 + x + (len === 0 && i > 0 ? 1 : 0), y, first, pace, partWidth)
            first = false
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

    const index = startIndex + strokes.length
    strokes.push({
      id: newId(),
      name: `自動 ${strokes.length + 1}`,
      points: pts,
      // 行の高さより十分太くして、手が通った所の縦一列を一度に見せる（範囲の外は clip が守る）
      revealWidth: frameWidth ? Math.round(frameWidth / k) : Math.min(600, Math.round(bandWidth / k)),
      duration: Math.max(300, pts[pts.length - 1].t),
      delayAfter: 180,
      useRecordedTiming: true,
      color: strokeColor(index),
      clip: { shapes: [clip] }
    })
  }

  if (strokes.length === 0) return { strokes: [wholeImageStroke(size, opts, startIndex)], blocks: 1, fallback: true }
  return { strokes, blocks: strokes.length, fallback: false }
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

/** 上から下・左から右（同じ高さにあるものを1行とみなす） */
function readingOrder(list: Block[]): Block[] {
  const sorted = [...list].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2)
  const lines: Block[][] = []
  for (const b of sorted) {
    const cy = (b.y0 + b.y1) / 2
    const line = lines[lines.length - 1]
    if (line) {
      const y0 = Math.min(...line.map((o) => o.y0))
      const y1 = Math.max(...line.map((o) => o.y1))
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
    revealWidth: Math.min(600, Math.round(bandH * 1.15)),
    duration: Math.max(300, Math.round(t)),
    delayAfter: 180,
    useRecordedTiming: true,
    color: strokeColor(index)
  }
}
