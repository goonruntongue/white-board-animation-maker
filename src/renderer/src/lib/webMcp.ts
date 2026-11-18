// Web 版の AI 連携（MCP）：Cloudflare の中継（relay/）に WebSocket でつなぎ、AI からの道具の呼び出しをこのタブで実行する。
//  ・合言葉（トークン）はこの端末で作って覚えておく。AI に登録する URL は「中継/mcp/合言葉」
//  ・オン/オフも覚えておき、オンならアプリを開いたときに自動でつなぐ。切れたら少し待ってつなぎ直す
//  ・書き出したファイルは中継へ小分けに送り、AI にはダウンロード用の URL を返してもらう
import { useSyncExternalStore } from 'react'
import type { ToolOutcome } from '../../../shared/mcp'
import { runToolForAi } from '../automation'

export const RELAY_ORIGIN = 'https://whiteboard-mcp-relay.goonruntongue.workers.dev'
const KEY = 'wbam.mcp'
const CHUNK = 1024 * 1024

export type WebMcpStatus = 'off' | 'connecting' | 'connected' | 'error'

interface State {
  enabled: boolean
  token: string
  status: WebMcpStatus
  /** AI が道具を使った回数（このタブを開いてから） */
  calls: number
  error?: string
}

function newToken(): string {
  const b = new Uint8Array(24)
  crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function load(): Pick<State, 'enabled' | 'token'> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (typeof v.token === 'string' && /^[A-Za-z0-9_-]{24,64}$/.test(v.token)) return { enabled: !!v.enabled, token: v.token }
  } catch {
    // はじめて
  }
  return { enabled: false, token: newToken() }
}

let state: State = { ...load(), status: 'off', calls: 0 }
const listeners = new Set<() => void>()
function set(patch: Partial<State>): void {
  state = { ...state, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify({ enabled: state.enabled, token: state.token }))
  } catch {
    // 覚えられなくても、このタブのあいだは使える
  }
  listeners.forEach((l) => l())
}

export function useWebMcp(): State & { url: string } {
  const s = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state
  )
  return { ...s, url: `${RELAY_ORIGIN}/mcp/${s.token}` }
}

let ws: WebSocket | null = null
let retry = 0
let retryTimer = 0
let pingTimer = 0

function disconnect(): void {
  window.clearTimeout(retryTimer)
  window.clearInterval(pingTimer)
  const w = ws
  ws = null
  if (w) {
    w.onclose = null
    try {
      w.close()
    } catch {
      // すでに閉じている
    }
  }
}

/** 書き出したファイルを中継へ送り、AI に渡す目印に置き換える */
async function uploadFile(outcome: ToolOutcome): Promise<Omit<ToolOutcome, 'file'> & { fileRef?: unknown }> {
  const { file, ...rest } = outcome
  if (!file) return rest
  const id = 'f' + newToken().slice(0, 20)
  const base = `${RELAY_ORIGIN}/upload/${state.token}/${id}`
  let i = 0
  for (let o = 0; o < file.data.length; o += CHUNK, i++) {
    const res = await fetch(`${base}?i=${i}`, { method: 'POST', body: file.data.slice(o, o + CHUNK) })
    if (!res.ok) throw new Error(`ファイルを送れませんでした（${res.status}）`)
  }
  const done = await fetch(`${base}?i=${i}&done=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, mimeType: file.mimeType, size: file.data.length })
  })
  if (!done.ok) throw new Error(`ファイルを送れませんでした（${done.status}）`)
  return { ...rest, fileRef: { id, name: file.name, mimeType: file.mimeType, size: file.data.length, chunks: i } }
}

function connect(): void {
  disconnect()
  if (!state.enabled) return
  set({ status: 'connecting', error: undefined })
  const socket = new WebSocket(`${RELAY_ORIGIN.replace(/^http/, 'ws')}/tab/${state.token}`)
  ws = socket
  socket.onopen = () => {
    retry = 0
    set({ status: 'connected' })
    // つながりが途中の機器に切られないよう、ときどき合図を送る（中継は起きずに自動で返す）
    pingTimer = window.setInterval(() => socket.readyState === WebSocket.OPEN && socket.send('ping'), 30_000)
  }
  socket.onmessage = (ev) => {
    if (typeof ev.data !== 'string' || ev.data === 'pong') return
    let msg: { type?: string; id?: string; name?: string; args?: Record<string, unknown> }
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return
    }
    if (msg.type !== 'call' || !msg.id || !msg.name) return
    const id = msg.id
    set({ calls: state.calls + 1 })
    void runToolForAi(msg.name, msg.args ?? {})
      .then(uploadFile)
      .catch((e: unknown) => ({ content: [{ type: 'text' as const, text: 'エラー: ' + (e instanceof Error ? e.message : String(e)) }], isError: true }))
      .then((outcome) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'result', id, outcome }))
      })
  }
  socket.onclose = (ev) => {
    window.clearInterval(pingTimer)
    if (ws !== socket) return
    ws = null
    if (!state.enabled) return set({ status: 'off' })
    // ほかのタブが同じ合言葉でつないだ：このタブは引き下がる
    if (ev.code === 4000) return set({ status: 'error', error: 'ほかのタブ（またはほかの端末）が同じ URL でつなぎました。こちらは止めています' })
    set({ status: 'error', error: '中継とのつながりが切れました。つなぎ直しています…' })
    const wait = Math.min(30_000, 1000 * 2 ** retry++)
    retryTimer = window.setTimeout(connect, wait)
  }
}

/** アプリを開いたときに呼ぶ（オンにしてあれば、自動でつなぐ） */
export function startWebMcp(): void {
  if (state.enabled) connect()
  // 画面に戻ってきたとき、切れていればすぐにつなぎ直す（スマホは裏に回るとつながりが切れやすい）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.enabled && !ws) {
      retry = 0
      connect()
    }
  })
}

export function setWebMcpEnabled(on: boolean): void {
  set({ enabled: on })
  if (on) {
    retry = 0
    connect()
  } else {
    disconnect()
    set({ status: 'off', error: undefined })
  }
}

/** 合言葉を作り直す（前の URL は使えなくなる） */
export function regenerateWebMcpToken(): void {
  set({ token: newToken() })
  if (state.enabled) connect()
}

/** 「ほかのタブがつないだ」で止まっているとき、このタブでつなぎ直す */
export function reconnectWebMcp(): void {
  retry = 0
  connect()
}
