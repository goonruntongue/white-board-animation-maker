// 単一HTMLの書き出し（PRD 7.1）。
// 画像・手素材・軌跡データ・再生エンジン・プレーヤーを1ファイルに内包し、オフラインで再生できる。
// ページが複数あれば、ページ送りできるスライドになる。
import engineSource from '../engine/wb-engine.js?raw'
import playerSource from './player-runtime.js?raw'
import { loadImage } from '../engine/wb-engine'
import type { HandAsset, ImageAsset, Project, ProjectSettings, Stroke } from '../engine/types'
import { reencode } from '../lib/imageTools'
import { scaleClip } from '../engine/selection'
import { pageProjects } from './sequence'

export interface HtmlExportOptions {
  title: string
  imageFormat: 'original' | 'webp' | 'jpeg'
  quality: number
  /** 出力画像の最大幅 (px)。0 で制限なし */
  maxWidth: number
  /** 再生の始め方：開いたらすぐ／クリックしたら／画面に見えたら（スライドへの埋め込み向け） */
  start: 'auto' | 'click' | 'visible'
  /** ページの進め方：描き終わったら自動で次へ／クリック・矢印キーで次へ */
  advance: 'auto' | 'click'
  loop: boolean
  showControls: boolean
  /** まわりの背景：暗い／白／透過（スライドに重ねるとき） */
  background: 'dark' | 'white' | 'transparent'
  /** マーカーの書く音 */
  sound: boolean
}

export const defaultHtmlOptions = (project: Project): HtmlExportOptions => ({
  title: project.name,
  imageFormat: 'webp',
  quality: 0.9,
  maxWidth: 1920,
  start: 'auto',
  advance: 'click',
  loop: false,
  showControls: true,
  background: 'dark',
  sound: false
})

/** 書き出したHTMLに埋め込むデータ */
interface ExportData {
  settings: ProjectSettings
  hand: HandAsset
  pages: { image: ImageAsset; strokes: Stroke[] }[]
}

/** 1ページぶん：画像を縮小・再圧縮し、座標も合わせて縮める */
async function preparePage(page: Project, o: HtmlExportOptions): Promise<{ image: ImageAsset; strokes: Stroke[] }> {
  const src = page.image!
  const img = await loadImage(src.dataUrl)
  const scale = o.maxWidth > 0 ? Math.min(1, o.maxWidth / src.width) : 1
  const w = Math.round(src.width * scale)
  const h = Math.round(src.height * scale)

  let dataUrl = src.dataUrl
  if (o.imageFormat !== 'original' || scale < 1) {
    const mime = o.imageFormat === 'jpeg' ? 'image/jpeg' : o.imageFormat === 'webp' ? 'image/webp' : 'image/png'
    dataUrl = reencode(img, w, h, mime, o.quality)
  }

  const strokes = page.strokes
    .filter((s) => !s.hidden)
    .map((s) => ({
      ...s,
      revealWidth: s.revealWidth * scale,
      ...(s.clip ? { clip: scaleClip(s.clip, scale) } : {}),
      points: s.points.map((p) => ({
        ...p,
        x: Math.round(p.x * scale * 10) / 10,
        y: Math.round(p.y * scale * 10) / 10,
        ...(p.w ? { w: p.w * scale } : {})
      }))
    }))

  return { image: { ...src, dataUrl, width: w, height: h }, strokes }
}

/**
 * 手素材を、実際に表示される大きさ（＋高解像度ディスプレイ向けの余裕）まで縮小し、
 * 透過WebPのデータURLにして埋め込む。元画像が大きくてもHTMLが重くならない。
 */
async function prepareHand(project: Project, exportHeight: number): Promise<HandAsset> {
  const hand = project.hand
  const img = await loadImage(hand.dataUrl)
  const shown = project.settings.handSize * exportHeight
  const k = Math.min(1, (shown * 1.5) / hand.height)
  const w = Math.max(1, Math.round(hand.width * k))
  const h = Math.max(1, Math.round(hand.height * k))
  const dataUrl = reencode(img, w, h, 'image/webp', 0.9)
  return { ...hand, dataUrl, width: w, height: h, tipX: hand.tipX * k, tipY: hand.tipY * k }
}

async function prepareExportData(project: Project, o: HtmlExportOptions): Promise<ExportData> {
  const sources = pageProjects(project)
  if (sources.length === 0) throw new Error('画像が読み込まれていません')
  const pages = []
  for (const src of sources) pages.push(await preparePage(src, o))
  const tallest = Math.max(...pages.map((p) => p.image.height))
  return { settings: project.settings, hand: await prepareHand(project, tallest), pages }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** <script> 内に安全に埋め込める JSON */
function safeJson(v: unknown): string {
  const BS = String.fromCharCode(92) // backslash
  return JSON.stringify(v)
    .replace(/</g, BS + 'u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), BS + 'u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), BS + 'u2029')
}

const PAGE_BG = { dark: '#1b1d22', white: '#ffffff', transparent: 'transparent' }

export async function buildStandaloneHtml(project: Project, o: HtmlExportOptions): Promise<string> {
  const data = await prepareExportData(project, o)
  const engine = engineSource.replace(/^export\s+/gm, '')
  const config = { start: o.start, advance: o.advance, loop: o.loop, showControls: o.showControls, sound: o.sound }
  const shadow = o.background === 'dark' ? '0 6px 30px rgba(0,0,0,.35)' : o.background === 'white' ? '0 2px 18px rgba(0,0,0,.12)' : 'none'

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Whiteboard Animation Maker">
<title>${escapeHtml(o.title)}</title>
<style>
  html, body { margin: 0; height: 100%; background: ${PAGE_BG[o.background]}; overflow: hidden; }
  body { display: flex; align-items: center; justify-content: center; font-family: system-ui, sans-serif; -webkit-tap-highlight-color: transparent; }
  #stage { position: relative; width: 100vw; height: 100vh; height: 100dvh; display: flex; align-items: center; justify-content: center; }
  canvas { max-width: 100%; max-height: 100%; display: block; box-shadow: ${shadow}; cursor: pointer; }
  #poster { position: absolute; inset: 0; display: none; place-items: center; cursor: pointer; }
  #poster span { width: 84px; height: 84px; border-radius: 50%; background: rgba(20,22,27,.78); display: grid; place-items: center;
    color: #fff; font-size: 34px; padding-left: 6px; box-sizing: border-box; box-shadow: 0 8px 30px rgba(0,0,0,.35); }
  #bar { position: absolute; left: 50%; bottom: max(16px, env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex; gap: 6px; align-items: center;
    background: rgba(20,22,27,.84); color: #eee; padding: 7px 12px; border-radius: 999px; backdrop-filter: blur(6px);
    opacity: 0; transition: opacity .25s; width: min(680px, calc(100vw - 24px)); box-sizing: border-box; }
  #stage:hover #bar, #bar.show, #bar:focus-within { opacity: 1; }
  #bar button { flex: none; background: none; border: 0; color: inherit; font-size: 17px; cursor: pointer; width: 34px; height: 34px; border-radius: 50%; }
  #bar button:hover:not(:disabled) { background: rgba(255,255,255,.14); }
  #bar button:disabled { opacity: .35; cursor: default; }
  #seek { flex: 1; min-width: 40px; accent-color: #ff7a2e; }
  #time, #page { font-variant-numeric: tabular-nums; font-size: 12px; opacity: .85; white-space: nowrap; }
  #page { padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,.14); }
</style>
</head>
<body>
<div id="stage">
  <canvas id="wb"></canvas>
  <div id="poster"><span>&#x25B6;</span></div>
  <div id="bar">
    <button id="prev" title="前へ (←)">&#x23EE;</button>
    <button id="play" title="再生 / 一時停止 (Space)">&#x25B6;</button>
    <button id="next" title="次へ (→)">&#x23ED;</button>
    <input id="seek" type="range" min="0" max="1000" value="0" aria-label="再生位置">
    <span id="time">0.0 / 0.0</span>
    <span id="page">1 / 1</span>
  </div>
</div>
<script type="application/json" id="wb-data">${safeJson(data)}</script>
<script type="application/json" id="wb-config">${safeJson(config)}</script>
<script>
(function () {
${engine}

${playerSource}
})();
</script>
</body>
</html>
`
}

/** スライドなどに埋め込むときの <iframe> の書き方（ファイル名は保存した名前に合わせる） */
export function embedSnippet(fileName: string, aspect: number): string {
  return `<iframe src="${fileName}" style="width:100%;aspect-ratio:${aspect.toFixed(4)};border:0" allow="autoplay"></iframe>`
}
