// デスクトップ版の MCP エンドポイント（AI からこのアプリを操作する入口）。
//  ・このパソコンの中だけ（127.0.0.1）で待ち受ける。URL に合言葉（トークン）を入れ、知らない相手は断る
//  ・初めはオフ。アプリの「AI 連携（MCP）」でオンにする。オン/オフとトークンは端末に覚えておく
//  ・道具の実行は画面側（renderer）に頼み、結果を AI に返す。書き出したファイルは「書類」フォルダに保存して場所を返す
import { app, ipcMain, type BrowserWindow } from 'electron'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { handleMcpMessage, type ToolOutcome } from '../shared/mcp'

export const MCP_PORT = 39271
const CALL_TIMEOUT_MS = 15 * 60 * 1000 // 動画の書き出しは時間がかかる
const MAX_BODY = 60 * 1024 * 1024 // 画像を base64 で受け取るので大きめ

interface McpConfig {
  enabled: boolean
  token: string
}

export interface McpInfo {
  enabled: boolean
  running: boolean
  url: string
  error?: string
  exportDir: string
}

let config: McpConfig = { enabled: false, token: '' }
let server: Server | null = null
let lastError: string | undefined
let getWindow: () => BrowserWindow | null = () => null
const pending = new Map<string, { resolve: (o: ToolOutcome) => void; timer: NodeJS.Timeout }>()

const configPath = (): string => join(app.getPath('userData'), 'mcp.json')
const exportDir = (): string => join(app.getPath('documents'), 'Whiteboard Animation Maker', 'AI exports')
const newToken = (): string => randomBytes(18).toString('base64url')

function info(): McpInfo {
  return {
    enabled: config.enabled,
    running: !!server?.listening,
    url: `http://127.0.0.1:${MCP_PORT}/mcp/${config.token}`,
    error: lastError,
    exportDir: exportDir()
  }
}

async function saveConfig(): Promise<void> {
  await writeFile(configPath(), JSON.stringify(config), 'utf-8')
}

/** 画面側に道具の実行を頼み、結果を待つ */
function callTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const win = getWindow()
  if (!win || win.isDestroyed()) return Promise.resolve({ content: [{ type: 'text', text: 'アプリの画面が開いていません' }], isError: true })
  const id = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({ content: [{ type: 'text', text: '時間内に終わりませんでした' }], isError: true })
    }, CALL_TIMEOUT_MS)
    pending.set(id, { resolve, timer })
    win.webContents.send('mcp:call', { id, name, args })
  })
}

/** 書き出したファイルを保存して、AI に場所を伝える */
async function withSavedFile(outcome: ToolOutcome): Promise<ToolOutcome> {
  if (!outcome.file) return outcome
  const dir = exportDir()
  await mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
  const safe = outcome.file.name.replace(/[\\/:*?"<>|]/g, '_')
  const dot = safe.lastIndexOf('.')
  const path = join(dir, dot > 0 ? `${safe.slice(0, dot)}-${stamp}${safe.slice(dot)}` : `${safe}-${stamp}`)
  await writeFile(path, Buffer.from(outcome.file.data))
  return { content: [...outcome.content, { type: 'text', text: `保存先: ${path}` }], isError: outcome.isError }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, body === undefined ? {} : { 'Content-Type': 'application/json' })
  res.end(body === undefined ? undefined : JSON.stringify(body))
}

async function onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // ほかのサイトのページから勝手に呼ばれないよう、ブラウザからの呼び出し（Origin 付き）は手元のものだけ受ける
  const origin = req.headers.origin
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'forbidden origin' })
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (url.pathname !== `/mcp/${config.token}`) return send(res, 404, { error: 'not found' })
  if (req.method === 'GET') return send(res, 405) // サーバーからの通知（SSE）は使わない
  if (req.method === 'DELETE') return send(res, 200)
  if (req.method !== 'POST') return send(res, 405)
  let body: unknown
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
  }
  const reply = await handleMcpMessage(body, async (name, args) => withSavedFile(await callTool(name, args)))
  if (reply === null) return send(res, 202)
  send(res, 200, reply)
}

async function start(): Promise<void> {
  if (server) return
  lastError = undefined
  await new Promise<void>((resolve) => {
    const s = createServer((req, res) => {
      onRequest(req, res).catch((e) => send(res, 500, { error: String(e) }))
    })
    s.on('error', (e: NodeJS.ErrnoException) => {
      lastError = e.code === 'EADDRINUSE' ? `ポート ${MCP_PORT} がほかのアプリで使われています` : String(e)
      server = null
      resolve()
    })
    s.listen(MCP_PORT, '127.0.0.1', () => {
      server = s
      resolve()
    })
  })
}

async function stop(): Promise<void> {
  const s = server
  server = null
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()))
}

/** アプリの起動時に呼ぶ */
export async function setupMcp(win: () => BrowserWindow | null): Promise<void> {
  getWindow = win
  try {
    config = { enabled: false, token: '', ...JSON.parse(await readFile(configPath(), 'utf-8')) }
  } catch {
    // はじめて
  }
  if (!config.token) {
    config.token = newToken()
    await saveConfig()
  }
  if (config.enabled) await start()

  ipcMain.on('mcp:result', (_e, msg: { id: string; outcome: ToolOutcome }) => {
    const p = pending.get(msg.id)
    if (!p) return
    clearTimeout(p.timer)
    pending.delete(msg.id)
    p.resolve(msg.outcome)
  })
  ipcMain.handle('mcp:info', () => info())
  ipcMain.handle('mcp:setEnabled', async (_e, on: boolean) => {
    config.enabled = !!on
    await saveConfig()
    if (config.enabled) await start()
    else await stop()
    return info()
  })
  ipcMain.handle('mcp:regenerate', async () => {
    config.token = newToken()
    await saveConfig()
    return info()
  })
}

export function shutdownMcp(): void {
  void stop()
}
