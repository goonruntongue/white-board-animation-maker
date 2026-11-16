// 書き出し用：全ページを順番につなげて、時刻 t の1コマを描く部品（動画書き出しで使う）。
import { allPages } from '../engine/project'
import type { Project } from '../engine/types'
import { buildTimeline, loadImage, WBRenderer } from '../engine/wb-engine'

export interface Sequence {
  /** 出力用キャンバス（幅・高さは偶数） */
  canvas: HTMLCanvasElement
  /** 全ページ合計の長さ (ms) */
  total: number
  pageCount: number
  /** 時刻 t (ms) のコマを canvas に描く */
  render: (t: number) => void
}

/** 画像のあるページだけを取り出して、1ページ＝1プロジェクトの形にする */
export function pageProjects(project: Project): Project[] {
  return allPages(project)
    .filter((pg) => pg.image)
    .map((pg) => ({ ...project, image: pg.image, strokes: pg.strokes }))
}

export async function createSequence(project: Project, maxWidth: number): Promise<Sequence> {
  const pages = pageProjects(project)
  if (pages.length === 0) throw new Error('画像が読み込まれていません')
  const [hand, ...images] = await Promise.all([loadImage(project.hand.dataUrl), ...pages.map((p) => loadImage(p.image!.dataUrl))])

  const durations = pages.map((p) => buildTimeline(p).total)
  const starts: number[] = []
  let total = 0
  for (const d of durations) {
    starts.push(total)
    total += d
  }

  // 描画は各ページの元解像度で行い、出力キャンバスへ収まるようにコピーする（大きさは1ページ目に合わせる）
  const src = document.createElement('canvas')
  const renderer = new WBRenderer(src, pages[0], { image: images[0], hand })
  let current = 0
  const first = pages[0].image!
  const scale = Math.min(1, maxWidth / first.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round((first.width * scale) / 2) * 2
  canvas.height = Math.round((first.height * scale) / 2) * 2
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'

  const render = (t: number): void => {
    let i = pages.length - 1
    while (i > 0 && t < starts[i]) i--
    if (i !== current) {
      renderer.setAssets({ image: images[i], hand })
      renderer.setProject(pages[i])
      current = i
    }
    renderer.renderAt(Math.min(durations[i], Math.max(0, t - starts[i])))
    // 縦横比が違うページは、余白をボードの色で埋めて中央に収める
    const k = Math.min(canvas.width / src.width, canvas.height / src.height)
    const w = src.width * k
    const h = src.height * k
    ctx.fillStyle = project.settings.boardColor
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(src, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h)
  }

  return { canvas, total, pageCount: pages.length, render }
}
