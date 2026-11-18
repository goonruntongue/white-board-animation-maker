// wbam.mjs — Whiteboard Animation Maker の MCP エンドポイントを、HTTP（JSON-RPC）で直接呼ぶ小さな道具。Node 18 以上。
// 使い方：
//   node wbam.mjs tools                          道具の一覧
//   node wbam.mjs <道具の名前> '<JSON の引数>'    道具を呼ぶ（例：node wbam.mjs get_image '{"show_groups":true}'）
//   node wbam.mjs load_image '{"file":"./whiteboard-test.png"}'   手元の画像を読み込ませる（file はこの道具が base64 にして送る）
//   node wbam.mjs add_group @args.json          引数を JSON のファイルから読む（長い引数や、Windows の PowerShell のとき）
// エンドポイント：環境変数 WBAM_URL、なければ ./wbam-endpoint.txt
// 返ってきた画像は ./wbam-out/ に PNG で保存し、その場所を表示する。書き出したファイルも自動でダウンロードして ./wbam-out/ に保存する
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

const OUT = process.env.WBAM_OUT || 'wbam-out'
const UA = 'wbam-agent-client/1.0' // 名前のない機械的なアクセスは Cloudflare に弾かれることがあるので名乗る
const url = process.env.WBAM_URL || (existsSync('wbam-endpoint.txt') ? (await readFile('wbam-endpoint.txt', 'utf-8')).trim() : '')
if (!/^https?:\/\/.+\/mcp\/[A-Za-z0-9_-]{24,64}$/.test(url)) {
  console.error('エンドポイントの URL がありません。WBAM_URL を設定するか、wbam-endpoint.txt に書いてください')
  process.exit(2)
}
const [, , tool, argText = '{}'] = process.argv
if (!tool) {
  console.error('使い方：node wbam.mjs <道具の名前|tools> [JSON の引数]')
  process.exit(2)
}

let seq = 0
async function rpc(method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'User-Agent': UA },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, ...(params ? { params } : {}) })
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const j = await res.json()
  if (j.error) throw new Error(`MCP エラー ${j.error.code}: ${j.error.message}`)
  return j.result
}

await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'wbam-agent-client', version: '1.0' } })

if (tool === 'tools') {
  const { tools } = await rpc('tools/list')
  for (const t of tools) console.log(`- ${t.name}: ${t.description}\n  引数: ${JSON.stringify(t.inputSchema.properties ?? {})}`)
  process.exit(0)
}

let args
try {
  // 「@ファイル名」なら、そのファイルの JSON を引数にする（Windows の PowerShell 5 は、コマンドの中の " を崩すことがあるため）
  args = JSON.parse(argText.startsWith('@') ? await readFile(argText.slice(1), 'utf-8') : argText)
} catch {
  console.error('引数は JSON で渡してください（例：\'{"show_groups":true}\'、または @args.json）')
  process.exit(2)
}
// 手元の画像ファイルは、ここで base64 にして送る（AI が長い文字を書き出さなくてよいように）
if (tool === 'load_image' && args.file) {
  const buf = await readFile(args.file)
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(args.file).toLowerCase()] ?? 'image/png'
  args = { ...args, data: `data:${mime};base64,${buf.toString('base64')}`, name: args.name ?? basename(args.file) }
  delete args.file
}

const result = await rpc('tools/call', { name: tool, arguments: args })
await mkdir(OUT, { recursive: true })
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
let n = 0
for (const c of result.content ?? []) {
  if (c.type === 'text') {
    console.log(c.text)
    const m = c.text.match(/ダウンロード URL[^:：]*[:：]\s*(\S+)/)
    if (m) {
      const res = await fetch(m[1], { headers: { 'User-Agent': UA } })
      if (res.ok) {
        const name = decodeURIComponent(m[1].split('/').pop() || `export-${stamp}`)
        const path = join(OUT, name)
        await writeFile(path, Buffer.from(await res.arrayBuffer()))
        console.log(`保存しました: ${path}`)
      } else console.log(`ダウンロードに失敗しました（${res.status}）`)
    }
  } else if (c.type === 'image') {
    const path = join(OUT, `${tool}-${stamp}-${++n}.png`)
    await writeFile(path, Buffer.from(c.data, 'base64'))
    console.log(`画像を保存しました: ${path}`)
  }
}
process.exit(result.isError ? 1 : 0)
