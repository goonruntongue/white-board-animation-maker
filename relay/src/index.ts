// Web 版の AI 連携（MCP）の中継（Cloudflare Workers ＋ Durable Objects）。
//
//   AI（MCP クライアント） ──POST /mcp/<合言葉>──▶ 中継 ──WebSocket──▶ 開いているブラウザのタブ（アプリが道具を実行）
//
// ・合言葉（トークン）はブラウザのタブが作る。合言葉ごとに Durable Object を1つ使い、そこでタブとのつながりを持つ
// ・道具の一覧と JSON-RPC の受け答えは、デスクトップ版と同じ src/shared/mcp.ts
// ・書き出したファイルは、タブから小分けに送ってもらい、この Durable Object の保存場所（SQLite）に2時間だけ置く。
//   AI にはダウンロード用の URL を返す（タブを閉じても、2時間はダウンロードできる）
// ・ログインはない。合言葉を知っている人だけがつなげる。作品そのものはサーバーに保管しない
import { DurableObject } from 'cloudflare:workers'
import { handleMcpMessage, type ToolContent, type ToolOutcome } from '../../src/shared/mcp'

interface Env {
  SESSIONS: DurableObjectNamespace<RelaySession>
}

const TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/
const FILE_ID_RE = /^[A-Za-z0-9_-]{8,40}$/
/** つないでよいブラウザのページ（本番・Cloudflare のプレビュー・手元の開発用） */
const ALLOWED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)?whiteboard-animation-maker\.pages\.dev$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
const CALL_TIMEOUT_MS = 15 * 60 * 1000
const FILE_TTL_MS = 2 * 60 * 60 * 1000
const MAX_CHUNK = 1024 * 1024 // タブから送るファイルの1かけらの上限（SQLite の1行に収まる大きさ）
const MAX_FILE = 300 * 1024 * 1024

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  if (!ALLOWED_ORIGIN.test(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin'
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const [, kind, token] = url.pathname.split('/')
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) })
    if (url.pathname === '/' || url.pathname === '') {
      return new Response('Whiteboard Animation Maker MCP relay', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }
    if (!['mcp', 'tab', 'upload', 'dl', 'status'].includes(kind) || !TOKEN_RE.test(token ?? '')) {
      return json({ error: 'not found' }, 404, cors(req))
    }
    // 合言葉ごとの Durable Object にそのまま渡す（ここでは本文を読まないので、Worker の CPU をほとんど使わない）
    const stub = env.SESSIONS.get(env.SESSIONS.idFromName(token))
    return stub.fetch(req)
  }
} satisfies ExportedHandler<Env>

interface Pending {
  resolve: (o: ToolOutcome) => void
  timer: ReturnType<typeof setTimeout>
}

/** タブから届く、書き出したファイルの目印（中身は /upload で先に送ってある） */
interface FileRef {
  id: string
  name: string
  mimeType: string
  size: number
  chunks: number
}

export class RelaySession extends DurableObject<Env> {
  private pending = new Map<string, Pending>()
  private sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.sql.exec(`CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, name TEXT, mime TEXT, size INTEGER, chunks INTEGER, created INTEGER)`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS chunks (id TEXT, idx INTEGER, data BLOB, PRIMARY KEY (id, idx))`)
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const [, kind, token, fileId, fileName] = url.pathname.split('/')
    switch (kind) {
      case 'tab':
        return this.connectTab(req)
      case 'status':
        return json({ tab: this.tab() !== null }, 200, cors(req))
      case 'mcp':
        return this.mcp(req, url.origin, token)
      case 'upload':
        return this.upload(req, fileId, Number(url.searchParams.get('i')))
      case 'dl':
        return this.download(fileId, fileName)
    }
    return json({ error: 'not found' }, 404)
  }

  /** いまつながっているタブ（なければ null） */
  private tab(): WebSocket | null {
    const list = this.ctx.getWebSockets('tab')
    return list.length ? list[list.length - 1] : null
  }

  private connectTab(req: Request): Response {
    if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426)
    if (!ALLOWED_ORIGIN.test(req.headers.get('Origin') ?? '')) return json({ error: 'forbidden origin' }, 403)
    // 同じ合言葉で新しいタブがつながったら、前のタブとのつながりは閉じる（最後に開いたタブが使われる）
    for (const old of this.ctx.getWebSockets('tab')) {
      try {
        old.close(4000, 'replaced by another tab')
      } catch {
        // すでに閉じている
      }
    }
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1], ['tab'])
    // タブからの「ping」には、Durable Object を起こさずに自動で返す
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return
    let msg: { type?: string; id?: string; outcome?: ToolOutcome & { fileRef?: FileRef } }
    try {
      msg = JSON.parse(message)
    } catch {
      return
    }
    if (msg.type !== 'result' || !msg.id) return
    const p = this.pending.get(msg.id)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(msg.id)
    p.resolve(msg.outcome ?? { content: [{ type: 'text', text: '結果が空でした' }], isError: true })
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason)
    } catch {
      // すでに閉じている
    }
  }

  /** タブに道具の実行を頼み、結果を待つ */
  private callTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome & { fileRef?: FileRef }> {
    const ws = this.tab()
    if (!ws) {
      return Promise.resolve({
        content: [{ type: 'text', text: 'アプリが開いていません。ブラウザで Whiteboard Animation Maker を開き、歯車のメニューの「AI 連携（MCP）」で受け付けをオンにしてください' }],
        isError: true
      })
    }
    const id = crypto.randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ content: [{ type: 'text', text: '時間内に終わりませんでした（アプリのタブが閉じられたか、止まっている可能性があります）' }], isError: true })
      }, CALL_TIMEOUT_MS)
      this.pending.set(id, { resolve, timer })
      try {
        ws.send(JSON.stringify({ type: 'call', id, name, args }))
      } catch {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve({ content: [{ type: 'text', text: 'アプリのタブに届けられませんでした' }], isError: true })
      }
    })
  }

  private async mcp(req: Request, origin: string, token: string): Promise<Response> {
    if (req.method === 'GET') return new Response(null, { status: 405, headers: { Allow: 'POST' } }) // サーバーからの通知（SSE）は使わない
    if (req.method === 'DELETE') return new Response(null, { status: 200 })
    if (req.method !== 'POST') return new Response(null, { status: 405 })
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400)
    }
    const reply = await handleMcpMessage(body, async (name, args) => {
      const r = await this.callTool(name, args)
      if (!r.fileRef) return { content: r.content, isError: r.isError }
      // 書き出したファイル：ダウンロード用の URL を AI に伝える
      const f = r.fileRef
      const dl = `${origin}/dl/${token}/${f.id}/${encodeURIComponent(f.name)}`
      const extra: ToolContent = {
        type: 'text',
        text: `ダウンロード URL（2時間有効）: ${dl}\nファイル名: ${f.name}（${Math.round(f.size / 1024)}KB）`
      }
      return { content: [...r.content, extra], isError: r.isError }
    })
    if (reply === null) return new Response(null, { status: 202 })
    return json(reply)
  }

  /** タブから、書き出したファイルを小分けに受け取る（i 番目のかけら。最後に meta を付けて送ってもらう） */
  private async upload(req: Request, fileId: string, i: number): Promise<Response> {
    const h = cors(req)
    if (req.method !== 'POST') return json({ error: 'method' }, 405, h)
    if (!FILE_ID_RE.test(fileId ?? '') || !Number.isInteger(i) || i < 0 || i > MAX_FILE / MAX_CHUNK) return json({ error: 'bad request' }, 400, h)
    const url = new URL(req.url)
    if (url.searchParams.get('done') === '1') {
      // 最後：ファイルの名前と大きさを登録する
      const meta = (await req.json()) as { name?: string; mimeType?: string; size?: number }
      const name = String(meta.name ?? 'file').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 120)
      this.sql.exec(
        `INSERT OR REPLACE INTO files (id, name, mime, size, chunks, created) VALUES (?, ?, ?, ?, ?, ?)`,
        fileId,
        name,
        String(meta.mimeType ?? 'application/octet-stream'),
        Number(meta.size ?? 0),
        i,
        Date.now()
      )
      await this.scheduleCleanup()
      return json({ ok: true }, 200, h)
    }
    const data = await req.arrayBuffer()
    if (data.byteLength > MAX_CHUNK) return json({ error: 'chunk too large' }, 413, h)
    this.sql.exec(`INSERT OR REPLACE INTO chunks (id, idx, data) VALUES (?, ?, ?)`, fileId, i, data)
    return json({ ok: true }, 200, h)
  }

  private download(fileId: string, fileName: string): Response {
    if (!FILE_ID_RE.test(fileId ?? '')) return json({ error: 'not found' }, 404)
    const meta = this.sql.exec(`SELECT name, mime, size, chunks FROM files WHERE id = ?`, fileId).toArray()[0] as
      | { name: string; mime: string; size: number; chunks: number }
      | undefined
    if (!meta) return json({ error: 'ファイルが見つかりません（2時間を過ぎて消えたか、URL が違います）' }, 404)
    const sql = this.sql
    let idx = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (idx >= meta.chunks) {
          controller.close()
          return
        }
        const row = sql.exec(`SELECT data FROM chunks WHERE id = ? AND idx = ?`, fileId, idx).toArray()[0] as { data: ArrayBuffer } | undefined
        idx++
        if (!row) {
          controller.error(new Error('missing chunk'))
          return
        }
        controller.enqueue(new Uint8Array(row.data))
      }
    })
    const name = decodeURIComponent(fileName || meta.name)
    return new Response(stream, {
      headers: {
        'Content-Type': meta.mime,
        'Content-Length': String(meta.size),
        'Content-Disposition': `attachment; filename="download${name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'private, no-store'
      }
    })
  }

  private async scheduleCleanup(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + FILE_TTL_MS + 60_000)
  }

  /** 2時間を過ぎたファイルを消す。まだ残っていれば、次の見回りを予約する */
  async alarm(): Promise<void> {
    const limit = Date.now() - FILE_TTL_MS
    const old = this.sql.exec(`SELECT id FROM files WHERE created < ?`, limit).toArray() as { id: string }[]
    for (const { id } of old) {
      this.sql.exec(`DELETE FROM chunks WHERE id = ?`, id)
      this.sql.exec(`DELETE FROM files WHERE id = ?`, id)
    }
    // 送りかけで終わったかけら（files に登録されなかったもの）も消す
    this.sql.exec(`DELETE FROM chunks WHERE id NOT IN (SELECT id FROM files)`)
    const left = this.sql.exec(`SELECT MIN(created) AS m FROM files`).toArray()[0] as { m: number | null }
    if (left?.m) await this.ctx.storage.setAlarm(left.m + FILE_TTL_MS + 60_000)
  }
}
