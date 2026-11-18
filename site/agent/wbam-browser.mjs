// wbam-browser.mjs — Whiteboard Animation Maker（Web 版）をブラウザで開き、AI 連携（MCP）をオンにして待つ。
// 使い方：node wbam-browser.mjs        （開いたままにしておく。止めるときは Ctrl+C）
// 環境変数：WBAM_TOKEN（合言葉。省略時は自動で作る）/ HEADLESS=0（画面を出す）/ WBAM_CHANNEL（chrome / msedge。省略時は Playwright の Chromium）
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  ;({ chromium } = await import('playwright-core'))
}

const APP = 'https://whiteboard-animation-maker.pages.dev/app/'
const RELAY = 'https://whiteboard-mcp-relay.goonruntongue.workers.dev'
const token = process.env.WBAM_TOKEN || randomBytes(24).toString('base64url')

const browser = await chromium.launch({
  headless: process.env.HEADLESS !== '0',
  ...(process.env.WBAM_CHANNEL ? { channel: process.env.WBAM_CHANNEL } : {})
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
// アプリは合言葉と「オン」を localStorage に覚え、開いたときに自動で中継につなぐ。その仕組みを使う
await page.addInitScript((t) => {
  try {
    localStorage.setItem('wbam.mcp', JSON.stringify({ enabled: true, token: t }))
  } catch {}
}, token)
page.on('console', (m) => m.type() === 'error' && console.error('[app]', m.text()))
await page.goto(APP, { waitUntil: 'load' })

// タブが中継につながるまで待つ（最大 60 秒）
let ok = false
for (let i = 0; i < 60 && !ok; i++) {
  await new Promise((r) => setTimeout(r, 1000))
  try {
    ok = (await (await fetch(`${RELAY}/status/${token}`)).json()).tab === true
  } catch {}
}
if (!ok) {
  console.error('NOT_CONNECTED: アプリが中継につながりませんでした')
  await browser.close()
  process.exit(1)
}
const url = `${RELAY}/mcp/${token}`
await writeFile('wbam-endpoint.txt', url + '\n')
console.log('READY ' + url)
console.log('（このプロセスを止めるとアプリも閉じます。作業が終わるまで動かしたままにしてください）')
const stop = async () => {
  await browser.close().catch(() => {})
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
await new Promise(() => {})
