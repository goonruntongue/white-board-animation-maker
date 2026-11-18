// 「AI 連携（MCP）」：AI からこのアプリを操作するエンドポイントの URL を表示・コピーし、オン/オフを切り替える。
//  ・デスクトップ版：このパソコンの中だけで待ち受ける（src/main/mcpServer.ts）
//  ・Web 版：Cloudflare の中継（relay/）経由。このタブを開いているあいだ、AI から操作できる（lib/webMcp.ts）
import { useEffect, useState } from 'react'
import type { McpInfo } from '../../../preload/index'
import { isDesktop } from '../lib/platform'
import { reconnectWebMcp, regenerateWebMcpToken, setWebMcpEnabled, useWebMcp } from '../lib/webMcp'
import { Icon } from './Icon'

function CopyRow({ value, label }: { value: string; label: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mcp-copy">
      <code>{value}</code>
      <button
        className="btn small"
        aria-label={`${label}をコピー`}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1600)
          })
        }}
      >
        <Icon name={copied ? 'check' : 'share'} size={13} /> {copied ? 'コピーしました' : 'コピー'}
      </button>
    </div>
  )
}

/** どの AI でも共通のつなぎ方の説明 */
function HowTo({ url, web }: { url: string; web: boolean }): React.JSX.Element {
  return (
    <>
      <h3>つなぎ方</h3>
      {web && (
        <p className="mcp-note">
          claude.ai・Claude のアプリ：設定 →「コネクタ」→「カスタムコネクタを追加」で、上の URL を登録します（認証は「なし」）。
        </p>
      )}
      <p className="mcp-note">Claude Code（ターミナル）：</p>
      <CopyRow value={`claude mcp add --transport http whiteboard ${url}`} label="Claude Code のコマンド" />
      <p className="mcp-note">Codex（~/.codex/config.toml に追加）：</p>
      <CopyRow value={`[mcp_servers.whiteboard]\nurl = "${url}"`} label="Codex の設定" />
      <p className="mcp-note">そのほかの AI は、「HTTP（Streamable HTTP）」の MCP サーバーとして上の URL を登録します。</p>
    </>
  )
}

function Frame({ onClose, children }: { onClose: () => void; children: React.ReactNode }): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal mcp-modal" role="dialog" aria-modal aria-label="AI 連携（MCP）">
        <header>
          <h2>AI 連携（MCP）</h2>
          <span className="modal-head-actions">
            <button className="icon-btn" onClick={onClose} title="閉じる (Esc)" aria-label="閉じる">
              <Icon name="x" />
            </button>
          </span>
        </header>
        <div className="modal-body mcp-body">
          <p className="mcp-lead">
            Claude・Codex などの MCP に対応した AI をこのアプリにつなぐと、画像の読み込み・描き順づくり・並べ替え・書き出しまでを AI に任せられます。
            AI の操作はこの画面にそのまま表示され、途中で手で直すこともできます。
          </p>
          {children}
        </div>
      </div>
    </div>
  )
}

function DesktopMcp({ onClose }: { onClose: () => void }): React.JSX.Element | null {
  const [info, setInfo] = useState<McpInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const api = window.desktop?.mcp
  useEffect(() => {
    void api?.info().then(setInfo)
  }, [api])
  if (!api) return null
  const act = async (fn: () => Promise<McpInfo>): Promise<void> => {
    setBusy(true)
    try {
      setInfo(await fn())
    } finally {
      setBusy(false)
    }
  }
  return (
    <Frame onClose={onClose}>
      <label className="toggle mcp-toggle">
        <span>AI からの接続を受け付ける</span>
        <input type="checkbox" checked={!!info?.enabled} disabled={busy || !info} onChange={(e) => void act(() => api.setEnabled(e.target.checked))} />
        <span className="switch" />
      </label>
      {info && (
        <>
          <p className={`mcp-state ${info.running ? 'on' : ''}`}>
            {info.error ? `接続できません：${info.error}` : info.running ? '受け付け中（このパソコンの中からだけつなげます）' : '止めています'}
          </p>
          <h3>エンドポイントの URL</h3>
          <CopyRow value={info.url} label="URL" />
          <p className="mcp-note">URL には合言葉が入っています。人に教えないでください。漏れたときは作り直せます（前の URL は使えなくなります）。</p>
          <button className="btn small" disabled={busy} onClick={() => void act(() => api.regenerate())}>
            <Icon name="redo" size={13} /> 合言葉を作り直す
          </button>
          <HowTo url={info.url} web={false} />
          <h3>書き出したファイルの保存先</h3>
          <CopyRow value={info.exportDir} label="保存先" />
        </>
      )}
    </Frame>
  )
}

function WebMcp({ onClose }: { onClose: () => void }): React.JSX.Element {
  const m = useWebMcp()
  const stateText =
    m.status === 'connected'
      ? `受け付け中（このタブを開いているあいだ、AI から操作できます${m.calls ? `。AI の操作 ${m.calls} 回` : ''}）`
      : m.status === 'connecting'
        ? 'つないでいます…'
        : m.status === 'error'
          ? m.error ?? 'つながっていません'
          : '止めています'
  return (
    <Frame onClose={onClose}>
      <label className="toggle mcp-toggle">
        <span>AI からの接続を受け付ける</span>
        <input type="checkbox" checked={m.enabled} onChange={(e) => setWebMcpEnabled(e.target.checked)} />
        <span className="switch" />
      </label>
      <p className={`mcp-state ${m.status === 'connected' ? 'on' : ''}`}>{stateText}</p>
      {m.enabled && m.status === 'error' && (
        <button className="btn small" onClick={reconnectWebMcp}>
          <Icon name="redo" size={13} /> このタブでつなぎ直す
        </button>
      )}
      <h3>エンドポイントの URL</h3>
      <CopyRow value={m.url} label="URL" />
      <p className="mcp-note">
        URL には合言葉が入っています。人に教えないでください。漏れたときは作り直せます（前の URL は使えなくなり、AI への登録もし直しが必要です）。
      </p>
      <button className="btn small" onClick={regenerateWebMcpToken}>
        <Icon name="redo" size={13} /> 合言葉を作り直す
      </button>
      <HowTo url={m.url} web />
      <h3>使うときの注意</h3>
      <p className="mcp-note">
        AI の操作は、このタブで行います。AI に頼んでいるあいだは、このタブを開いたままにしてください（スマホでは、画面を消したりほかのアプリに切り替えたりすると止まることがあります）。
        書き出したファイルは、AI が返すダウンロード用の URL から2時間だけ受け取れます。作品はサーバーに保管しません。
      </p>
    </Frame>
  )
}

export function McpDialog({ onClose }: { onClose: () => void }): React.JSX.Element | null {
  return isDesktop ? <DesktopMcp onClose={onClose} /> : <WebMcp onClose={onClose} />
}
