// 単一HTMLの書き出し（PRD 7.1）。
// 画像・手素材・軌跡データ・再生エンジンを1ファイルに内包し、オフラインで再生できる。
import engineSource from '../engine/wb-engine.js?raw'
import { loadImage } from '../engine/wb-engine'
import type { Project } from '../engine/types'
import { reencode } from '../lib/imageTools'
import { scaleClip } from '../engine/selection'

export interface HtmlExportOptions {
  title: string
  imageFormat: 'original' | 'webp' | 'jpeg'
  quality: number
  /** 出力画像の最大幅 (px)。0 で制限なし */
  maxWidth: number
  autoplay: boolean
  loop: boolean
  showControls: boolean
}

export const defaultHtmlOptions = (project: Project): HtmlExportOptions => ({
  title: project.name,
  imageFormat: 'webp',
  quality: 0.9,
  maxWidth: 1920,
  autoplay: true,
  loop: false,
  showControls: true
})

/** 出力用に画像を縮小・再圧縮し、座標も合わせて縮める */
async function prepareProjectForExport(project: Project, o: HtmlExportOptions): Promise<Project> {
  if (!project.image) throw new Error('画像が読み込まれていません')
  const img = await loadImage(project.image.dataUrl)
  const srcW = project.image.width
  const scale = o.maxWidth > 0 ? Math.min(1, o.maxWidth / srcW) : 1
  const w = Math.round(srcW * scale)
  const h = Math.round(project.image.height * scale)

  let dataUrl = project.image.dataUrl
  if (o.imageFormat !== 'original' || scale < 1) {
    const mime = o.imageFormat === 'jpeg' ? 'image/jpeg' : o.imageFormat === 'webp' ? 'image/webp' : 'image/png'
    dataUrl = reencode(img, w, h, mime, o.quality)
  }

  const strokes = project.strokes
    .filter((s) => !s.hidden)
    .map((s) => ({
      ...s,
      revealWidth: s.revealWidth * scale,
      ...(s.clip ? { clip: scaleClip(s.clip, scale) } : {}),
      points: s.points.map((p) => ({ x: Math.round(p.x * scale * 10) / 10, y: Math.round(p.y * scale * 10) / 10, t: p.t }))
    }))

  return { ...project, image: { ...project.image, dataUrl, width: w, height: h }, strokes }
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

export async function buildStandaloneHtml(project: Project, o: HtmlExportOptions): Promise<string> {
  const p = await prepareProjectForExport(project, o)
  const engine = engineSource.replace(/^export\s+/gm, '')
  const config = { autoplay: o.autoplay, loop: o.loop, showControls: o.showControls }

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Whiteboard Animation Maker">
<title>${escapeHtml(o.title)}</title>
<style>
  html, body { margin: 0; height: 100%; background: #1b1d22; overflow: hidden; }
  body { display: flex; align-items: center; justify-content: center; font-family: system-ui, sans-serif; }
  #stage { position: relative; width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; }
  canvas { max-width: 100%; max-height: 100%; display: block; box-shadow: 0 6px 30px rgba(0,0,0,.35); }
  #bar { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; gap: 10px; align-items: center;
    background: rgba(20,22,27,.82); color: #eee; padding: 8px 14px; border-radius: 999px; backdrop-filter: blur(6px);
    opacity: 0; transition: opacity .25s; width: min(640px, calc(100vw - 32px)); box-sizing: border-box; }
  #stage:hover #bar, #bar.show { opacity: 1; }
  #bar button { background: none; border: 0; color: inherit; font-size: 18px; cursor: pointer; width: 32px; height: 32px; border-radius: 50%; }
  #bar button:hover { background: rgba(255,255,255,.12); }
  #seek { flex: 1; accent-color: #4dabf7; }
  #time { font-variant-numeric: tabular-nums; font-size: 12px; opacity: .8; min-width: 92px; text-align: right; }
</style>
</head>
<body>
<div id="stage">
  <canvas id="wb"></canvas>
  <div id="bar">
    <button id="rew" title="最初へ (Home)">&#x23EE;</button>
    <button id="play" title="再生 / 一時停止 (Space)">&#x25B6;</button>
    <input id="seek" type="range" min="0" max="1000" value="0">
    <span id="time">0.0 / 0.0</span>
  </div>
</div>
<script type="application/json" id="wb-data">${safeJson(p)}</script>
<script type="application/json" id="wb-config">${safeJson(config)}</script>
<script>
(function () {
${engine}

  var project = JSON.parse(document.getElementById('wb-data').textContent);
  var config = JSON.parse(document.getElementById('wb-config').textContent);
  var canvas = document.getElementById('wb');
  var bar = document.getElementById('bar');
  var playBtn = document.getElementById('play');
  var seek = document.getElementById('seek');
  var timeEl = document.getElementById('time');
  if (!config.showControls) bar.style.display = 'none';

  Promise.all([loadImage(project.image.dataUrl), loadImage(project.hand.dataUrl)]).then(function (a) {
    var r = new WBRenderer(canvas, project, { image: a[0], hand: a[1] });
    var t = 0, playing = false, last = 0;
    function fmt(ms) { return (ms / 1000).toFixed(1); }
    function draw() {
      r.renderAt(t);
      seek.value = String(Math.round((t / r.duration) * 1000));
      timeEl.textContent = fmt(t) + ' / ' + fmt(r.duration);
      playBtn.innerHTML = playing ? '&#x23F8;' : '&#x25B6;';
    }
    function frame(now) {
      if (!playing) return;
      t += now - last; last = now;
      if (t >= r.duration) {
        if (config.loop) { t = 0; } else { t = r.duration; playing = false; }
      }
      draw();
      if (playing) requestAnimationFrame(frame);
    }
    function play() {
      if (t >= r.duration) t = 0;
      playing = true; last = performance.now(); requestAnimationFrame(frame);
    }
    function pause() { playing = false; draw(); }
    function toggle() { playing ? pause() : play(); }
    function rewind() { t = 0; draw(); }
    playBtn.onclick = toggle;
    document.getElementById('rew').onclick = rewind;
    seek.oninput = function () { t = (Number(seek.value) / 1000) * r.duration; draw(); };
    canvas.onclick = toggle;
    window.addEventListener('keydown', function (e) {
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      if (e.code === 'Home') { e.preventDefault(); rewind(); }
    });
    // 外部（HyperFrames などのスライド）から制御できるようにする
    window.wbPlayer = { play: play, pause: pause, rewind: rewind, seek: function (ms) { t = ms; draw(); }, get duration() { return r.duration; } };
    draw();
    if (config.autoplay) play();
  });
})();
</script>
</body>
</html>
`
}
