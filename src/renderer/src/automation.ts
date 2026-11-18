// AI（MCP）から届いた道具の呼び出しを、アプリの操作として実行する。
// 道具の一覧は src/shared/mcp.ts。ここは画面側（renderer）なので、操作はそのまま画面に表示され、元に戻すでも取り消せる。
import type { ToolOutcome } from '../../shared/mcp'
import { autoTrace, MOTION_PRESETS, type AutoDetail, type AutoSpeed } from './engine/autoTrace'
import { createProject, LIFT_GAP_MS, newId, PROJECT_EXT, serializeProject, strokeColor } from './engine/project'
import { mergeStrokes, strokeParts } from './engine/strokeParts'
import type { Stroke, StrokePoint } from './engine/types'
import { buildTimeline, loadImage, WBRenderer } from './engine/wb-engine'
import { buildStandaloneHtml, defaultHtmlOptions } from './export/exportHtml'
import { exportGif } from './export/exportGif'
import { canExportMp4, exportMp4, exportWebm } from './export/exportVideo'
import { pageProjects } from './export/sequence'
import { setImageFromDataUrl } from './commands'
import { useEditor } from './store'

type Args = Record<string, unknown>
const get = useEditor.getState

const text = (t: string): ToolOutcome => ({ content: [{ type: 'text', text: t }] })
const json = (v: unknown): ToolOutcome => text(JSON.stringify(v, null, 1))
const fail = (t: string): ToolOutcome => ({ content: [{ type: 'text', text: t }], isError: true })

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const r1 = (v: number): number => Math.round(v * 10) / 10

function requireImage(): void {
  if (!get().project.image) throw new Error('画像が読み込まれていません。先に load_image で画像を読み込んでください')
}

function findStroke(id: unknown): Stroke {
  const s = get().project.strokes.find((x) => x.id === id)
  if (!s) throw new Error(`グループ ${String(id)} が見つかりません（list_groups で id を確かめてください）`)
  return s
}

/** グループの範囲（見せる幅も含めた外接矩形） */
function bounds(s: Stroke): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of s.points) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y)
  }
  if (!Number.isFinite(x0)) return [0, 0, 0, 0]
  const h = s.revealWidth / 2
  return [Math.round(x0 - h), Math.round(y0 - h), Math.round(x1 + h), Math.round(y1 + h)]
}

function summary(s: Stroke, index: number): Record<string, unknown> {
  return {
    index,
    id: s.id,
    name: s.name,
    bbox: bounds(s),
    lines: strokeParts(s).length,
    duration_ms: s.duration,
    delay_after_ms: s.delayAfter,
    reveal_width: s.revealWidth,
    ...(s.hidden ? { hidden: true } : {}),
    ...(s.clip ? { limited_area: true } : {})
  }
}

/** 点を間引く（等間隔に max 個まで。端は残す） */
function thin<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr
  const out: T[] = []
  for (let i = 0; i < max; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (max - 1))])
  return out
}

type PartInput = { points: number[][]; width?: number }

/**
 * AI が渡した線（parts）を、軌跡の点の並びにする。
 * t がなければ、長さに比例した時刻を付ける（一定の速さ）。線と線のあいだはペンを上げて移動する（LIFT_GAP_MS）。
 */
function partsToPoints(parts: unknown, baseWidth: number): { points: StrokePoint[]; drawn: number } {
  if (!Array.isArray(parts) || parts.length === 0) throw new Error('parts に線を1本以上入れてください')
  const SPEED = 0.6 // px / ms（t を省いたときの速さ）
  const points: StrokePoint[] = []
  let clock = 0
  parts.forEach((raw, k) => {
    const part = raw as PartInput
    if (!Array.isArray(part?.points) || part.points.length < 2) throw new Error(`parts[${k}] の points は2点以上必要です`)
    const pts = part.points.map((p, i) => {
      if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') throw new Error(`parts[${k}].points[${i}] は [x, y] の形で入れてください`)
      return p
    })
    const start = clock + (k === 0 ? 0 : LIFT_GAP_MS)
    let t = 0
    const hasT = pts.every((p) => typeof p[2] === 'number')
    pts.forEach((p, i) => {
      if (i > 0 && !hasT) t += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) / SPEED
      const tt = hasT ? p[2] - pts[0][2] : t
      const w = num(part.width)
      points.push({
        x: r1(p[0]),
        y: r1(p[1]),
        t: Math.round(start + Math.max(0, tt)),
        ...(i === 0 && k > 0 ? { b: 1 as const, ...(w !== undefined && Math.round(w) !== Math.round(baseWidth) ? { w: Math.round(w) } : {}) } : {})
      })
    })
    clock = points[points.length - 1].t
  })
  return { points, drawn: clock }
}

function applyGroupFields(s: Stroke, a: Args): Stroke {
  const next = { ...s }
  if (str(a.name) !== undefined) next.name = str(a.name)!
  if (num(a.duration_ms) !== undefined) next.duration = Math.max(50, Math.round(num(a.duration_ms)!))
  if (num(a.delay_after_ms) !== undefined) next.delayAfter = Math.max(0, Math.round(num(a.delay_after_ms)!))
  if (num(a.reveal_width) !== undefined) next.revealWidth = Math.max(1, Math.round(num(a.reveal_width)!))
  if (typeof a.hidden === 'boolean') next.hidden = a.hidden || undefined
  return next
}

/** 画像（または作品の1コマ）を、幅 maxWidth 以下の PNG（base64）にする */
function canvasPng(c: HTMLCanvasElement): string {
  return c.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
}

async function getImage(a: Args): Promise<ToolOutcome> {
  requireImage()
  const { project } = get()
  const img = await loadImage(project.image!.dataUrl)
  const maxW = Math.max(64, Math.min(2048, num(a.max_width) ?? 1024))
  const k = Math.min(1, maxW / project.image!.width)
  const c = document.createElement('canvas')
  c.width = Math.round(project.image!.width * k)
  c.height = Math.round(project.image!.height * k)
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0, c.width, c.height)
  if (a.show_groups) {
    ctx.lineWidth = 2
    ctx.font = `bold ${Math.max(12, Math.round(c.width / 60))}px sans-serif`
    project.strokes.forEach((s, i) => {
      const [x0, y0, x1, y1] = bounds(s).map((v) => v * k)
      ctx.strokeStyle = s.color
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)
      const label = String(i + 1)
      const w = ctx.measureText(label).width + 8
      ctx.fillStyle = s.color
      ctx.fillRect(x0, y0 - 2, w, parseInt(ctx.font.match(/(\d+)px/)![1]) + 4)
      ctx.fillStyle = '#fff'
      ctx.fillText(label, x0 + 4, y0 + parseInt(ctx.font.match(/(\d+)px/)![1]) - 1)
    })
  }
  return {
    content: [
      { type: 'image', data: canvasPng(c), mimeType: 'image/png' },
      {
        type: 'text',
        text: `画像の大きさ ${project.image!.width}×${project.image!.height}px（この画像は ${c.width}×${c.height} に縮小。座標は元の大きさで指定してください）` +
          (a.show_groups ? '。枠の番号は list_groups の index + 1' : '')
      }
    ]
  }
}

async function renderFrame(a: Args): Promise<ToolOutcome> {
  requireImage()
  const { project } = get()
  const [img, hand] = await Promise.all([loadImage(project.image!.dataUrl), loadImage(project.hand.dataUrl)])
  const maxW = Math.max(64, Math.min(2048, num(a.max_width) ?? 768))
  const scale = Math.min(1, maxW / project.image!.width)
  const c = document.createElement('canvas')
  const r = new WBRenderer(c, project, { image: img, hand }, { scale })
  const total = r.duration
  const t = num(a.time_ms) ?? (num(a.progress) !== undefined ? num(a.progress)! * total : total)
  r.renderAt(Math.max(0, Math.min(total, t)), { hand: a.hand !== false, background: true })
  return {
    content: [
      { type: 'image', data: canvasPng(r.canvas), mimeType: 'image/png' },
      { type: 'text', text: `${Math.round(t)}ms / ${Math.round(total)}ms のコマ` }
    ]
  }
}

async function runAutoTrace(a: Args): Promise<ToolOutcome> {
  requireImage()
  const { project } = get()
  const motion = MOTION_PRESETS.find((m) => m.id === (str(a.motion) ?? 'smooth')) ?? MOTION_PRESETS[0]
  const mode = str(a.mode) === 'group' ? 'group' : 'natural'
  const append = a.append === true
  const result = autoTrace(
    await loadImage(project.image!.dataUrl),
    project.image!,
    project.settings.boardColor,
    {
      detail: (['fine', 'normal', 'coarse'].includes(str(a.detail) ?? '') ? a.detail : 'normal') as AutoDetail,
      pathMode: mode,
      speed: (['slow', 'normal', 'fast'].includes(str(a.speed) ?? '') ? a.speed : 'normal') as AutoSpeed,
      scrubV: motion.scrubV,
      scrubH: motion.scrubH,
      revealWidth: project.settings.defaultRevealWidth
    },
    append ? project.strokes.length : 0
  )
  if (result.strokes.length === 0) return fail('グループを作れませんでした（元のグループはそのままです）')
  get().commit((p) => ({ ...p, strokes: append ? [...p.strokes, ...result.strokes] : result.strokes }))
  get().select(null)
  get().setTime(0)
  const st = get()
  return json({
    message: result.fallback ? '文字や図をうまく分けられず、画像全体を1つのグループにしました' : `${result.strokes.length} 個のグループを作りました`,
    total_ms: Math.round(buildTimeline(st.project).total),
    groups: st.project.strokes.map(summary)
  })
}

async function runExport(a: Args): Promise<ToolOutcome> {
  const { project } = get()
  const format = str(a.format)
  const base = project.name || 'whiteboard'
  if (format === 'project') {
    const data = new TextEncoder().encode(serializeProject(project))
    return { content: [{ type: 'text', text: '編集用プロジェクトを書き出しました' }], file: { name: `${base}.${PROJECT_EXT}`, mimeType: 'application/json', data } }
  }
  if (pageProjects(project).length === 0) throw new Error('画像のあるページがありません')
  if (format === 'html') {
    const html = await buildStandaloneHtml(project, defaultHtmlOptions(project))
    return { content: [{ type: 'text', text: 'HTML を書き出しました（1ファイルでオフライン再生できます）' }], file: { name: `${base}.html`, mimeType: 'text/html', data: new TextEncoder().encode(html) } }
  }
  const fps = num(a.fps)
  let blob: Blob
  if (format === 'gif') {
    blob = await exportGif(project, { fps: fps ?? 10, maxWidth: num(a.max_width) ?? 640, repeat: true }, () => {}).promise
  } else if (format === 'mp4') {
    if (!(await canExportMp4())) throw new Error('この環境では MP4 を作れません。webm か gif を選んでください')
    blob = await exportMp4(project, { fps: fps ?? 30, maxWidth: num(a.max_width) ?? 1920, bitrateMbps: 4 }, () => {}).promise
  } else if (format === 'webm') {
    blob = await exportWebm(project, { fps: fps ?? 30, maxWidth: num(a.max_width) ?? 1920, bitrateMbps: 4 }, () => {}).promise
  } else {
    throw new Error('format は project / mp4 / webm / gif / html のどれかです')
  }
  const ext = format === 'webm' && blob.type.includes('mp4') ? 'mp4' : format
  return {
    content: [{ type: 'text', text: `${ext.toUpperCase()} を書き出しました（${Math.round(blob.size / 1024)}KB）` }],
    file: { name: `${base}.${ext}`, mimeType: blob.type || `video/${ext}`, data: new Uint8Array(await blob.arrayBuffer()) }
  }
}

/** 道具を1つ実行する */
export async function runTool(name: string, a: Args): Promise<ToolOutcome> {
  const st = get()
  switch (name) {
    case 'get_status': {
      const p = st.project
      return json({
        name: p.name,
        page: { index: p.pageIndex, count: p.pages.length },
        image: p.image ? { name: p.image.name, width: p.image.width, height: p.image.height } : null,
        groups: p.strokes.length,
        page_total_ms: p.image ? Math.round(buildTimeline(p).total) : 0,
        settings: {
          speed: p.settings.speed,
          start_delay_ms: p.settings.startDelay,
          end_hold_ms: p.settings.endHold,
          board_color: p.settings.boardColor,
          show_hand: p.settings.showHand,
          hand_size: p.settings.handSize,
          finish_full: p.settings.finishFull,
          default_reveal_width: p.settings.defaultRevealWidth
        },
        unsaved_changes: st.dirty
      })
    }
    case 'new_project': {
      const p = createProject()
      if (str(a.name)) p.name = str(a.name)!
      st.loadProject(p, null)
      return text('新しい作品を始めました')
    }
    case 'load_image': {
      let dataUrl = str(a.data)
      const url = str(a.url)
      if (!dataUrl && url) {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`画像を取得できませんでした（${res.status}）`)
        const blob = await res.blob()
        dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(String(r.result))
          r.onerror = () => reject(r.error)
          r.readAsDataURL(blob)
        })
      }
      if (!dataUrl) return fail('data か url のどちらかを渡してください')
      if (!dataUrl.startsWith('data:')) {
        const head = atob(dataUrl.slice(0, 16))
        const mime = head.startsWith('\x89PNG') ? 'image/png' : head.startsWith('RIFF') ? 'image/webp' : 'image/jpeg'
        dataUrl = `data:${mime};base64,${dataUrl}`
      }
      const before = st.project.pages.length
      await setImageFromDataUrl(str(a.name) ?? 'image.png', dataUrl, a.replace === true)
      const p = get().project
      if (!p.image) return fail('画像を読み込めませんでした')
      return text(
        `${p.pages.length > before ? `ページ ${p.pageIndex + 1} として` : ''}画像を読み込みました（${p.image.width}×${p.image.height}px）。次は get_image で絵を見るか、auto_trace で下書きを作ります`
      )
    }
    case 'get_image':
      return getImage(a)
    case 'auto_trace':
      return runAutoTrace(a)
    case 'list_groups':
      return json({ total_ms: st.project.image ? Math.round(buildTimeline(st.project).total) : 0, groups: st.project.strokes.map(summary) })
    case 'get_group': {
      const s = findStroke(a.id)
      const max = Math.max(4, Math.min(400, num(a.max_points) ?? 60))
      const lines = strokeParts(s).map((part) => ({
        width: part.width,
        points: thin(s.points.slice(part.start, part.end + 1), max).map((p) => [r1(p.x), r1(p.y)])
      }))
      return json({ ...summary(s, st.project.strokes.indexOf(s)), parts: lines })
    }
    case 'add_group': {
      requireImage()
      const width = Math.max(1, Math.round(num(a.reveal_width) ?? st.project.settings.defaultRevealWidth))
      const { points, drawn } = partsToPoints(a.parts, width)
      const count = st.project.strokes.length
      const index = Math.max(0, Math.min(count, Math.round(num(a.index) ?? count)))
      let s: Stroke = {
        id: newId(),
        name: `グループ ${count + 1}`,
        points,
        revealWidth: width,
        duration: Math.max(300, Math.round(drawn)),
        delayAfter: st.project.settings.defaultDelayAfter,
        useRecordedTiming: true,
        color: strokeColor(count)
      }
      s = applyGroupFields(s, a)
      st.commit((p) => {
        const strokes = [...p.strokes]
        strokes.splice(index, 0, s)
        return { ...p, strokes }
      })
      return json({ message: 'グループを作りました', group: summary(s, index) })
    }
    case 'update_group': {
      const s = findStroke(a.id)
      let next = applyGroupFields(s, a)
      if (a.parts !== undefined) {
        const { points, drawn } = partsToPoints(a.parts, next.revealWidth)
        next = { ...next, points, useRecordedTiming: true, duration: num(a.duration_ms) !== undefined ? next.duration : Math.max(300, Math.round(drawn)) }
      }
      st.commit((p) => ({ ...p, strokes: p.strokes.map((x) => (x.id === s.id ? next : x)) }))
      return json({ message: '更新しました', group: summary(next, get().project.strokes.findIndex((x) => x.id === s.id)) })
    }
    case 'reorder_groups': {
      const order = Array.isArray(a.order) ? a.order.map(String) : []
      const byId = new Map(st.project.strokes.map((s) => [s.id, s]))
      const unknown = order.filter((id) => !byId.has(id))
      if (unknown.length) return fail(`見つからない id があります: ${unknown.join(', ')}`)
      const seen = new Set<string>()
      const first = order.filter((id) => !seen.has(id) && seen.add(id)).map((id) => byId.get(id)!)
      const rest = st.project.strokes.filter((s) => !seen.has(s.id))
      st.commit((p) => ({ ...p, strokes: [...first, ...rest] }))
      return json({ message: '並べ替えました', order: get().project.strokes.map((s, i) => `${i + 1}:${s.id}`) })
    }
    case 'delete_groups': {
      const ids = new Set(Array.isArray(a.ids) ? a.ids.map(String) : [])
      const n = st.project.strokes.filter((s) => ids.has(s.id)).length
      if (n === 0) return fail('消すグループが見つかりません')
      st.commit((p) => ({ ...p, strokes: p.strokes.filter((s) => !ids.has(s.id)) }))
      st.select(null)
      return text(`${n} 個のグループを消しました`)
    }
    case 'merge_groups': {
      const ids = Array.isArray(a.ids) ? a.ids.map(String) : []
      const list = ids.map((id) => findStroke(id))
      if (list.length < 2) return fail('2つ以上の id を渡してください')
      const merged = list.slice(1).reduce((acc, s) => mergeStrokes(acc, s), list[0])
      const firstIndex = st.project.strokes.findIndex((s) => s.id === list[0].id)
      const drop = new Set(ids)
      st.commit((p) => {
        const rest = p.strokes.filter((s) => !drop.has(s.id))
        rest.splice(Math.min(firstIndex, rest.length), 0, merged)
        return { ...p, strokes: rest }
      })
      return json({ message: 'まとめました', group: summary(merged, get().project.strokes.findIndex((s) => s.id === merged.id)) })
    }
    case 'update_settings': {
      const patch: Record<string, unknown> = {}
      if (num(a.speed) !== undefined) patch.speed = Math.max(0.1, Math.min(10, num(a.speed)!))
      if (num(a.start_delay_ms) !== undefined) patch.startDelay = Math.max(0, num(a.start_delay_ms)!)
      if (num(a.end_hold_ms) !== undefined) patch.endHold = Math.max(0, num(a.end_hold_ms)!)
      if (str(a.board_color)) patch.boardColor = str(a.board_color)
      if (typeof a.show_hand === 'boolean') patch.showHand = a.show_hand
      if (num(a.hand_size) !== undefined) patch.handSize = Math.max(0.05, Math.min(2, num(a.hand_size)!))
      if (typeof a.finish_full === 'boolean') patch.finishFull = a.finish_full
      st.updateSettings(patch)
      return text('設定を変えました')
    }
    case 'goto_page': {
      const i = Math.round(num(a.index) ?? -1)
      if (i < 0 || i >= st.project.pages.length) return fail(`ページは 0〜${st.project.pages.length - 1} です`)
      st.gotoPage(i)
      return text(`ページ ${i + 1} に切り替えました`)
    }
    case 'render_frame':
      return renderFrame(a)
    case 'undo':
      st.undo()
      return text('直前の操作を取り消しました')
    case 'export':
      return runExport(a)
    default:
      return fail(`知らない道具です: ${name}`)
  }
}

/** 道具を実行し、画面にも何をしたかを短く知らせる（AI が操作していることが利用者に分かるように） */
export async function runToolForAi(name: string, args: Args): Promise<ToolOutcome> {
  try {
    const r = await runTool(name, args)
    if (!['get_status', 'list_groups', 'get_group', 'get_image', 'render_frame'].includes(name)) {
      get().notify(`AI：${(r.content.find((c) => c.type === 'text') as { text: string } | undefined)?.text.split('\n')[0].slice(0, 60) ?? name}`)
    }
    return r
  } catch (e) {
    return fail('エラー: ' + (e instanceof Error ? e.message : String(e)))
  }
}
