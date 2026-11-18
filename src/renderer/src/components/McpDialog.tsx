// 「AI 連携（MCP）」：AI からこのアプリを操作するエンドポイントの URL を表示・コピーし、オン/オフを切り替える。
// いまはデスクトップ版だけ（Web 版は中継を用意してから）。
import { useEffect, useState } from 'react'
import type { McpInfo } from '../../../preload/index'
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

export function McpDialog({ onClose }: { onClose: () => void }): React.JSX.Element | null {
  const [info, setInfo] = useState<McpInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const api = window.desktop?.mcp

  useEffect(() => {
    void api?.info().then(setInfo)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api, onClose])

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
              <h3>つなぎ方</h3>
              <p className="mcp-note">Claude Code（ターミナル）：</p>
              <CopyRow value={`claude mcp add --transport http whiteboard ${info.url}`} label="Claude Code のコマンド" />
              <p className="mcp-note">Codex（~/.codex/config.toml に追加）：</p>
              <CopyRow value={`[mcp_servers.whiteboard]\nurl = "${info.url}"`} label="Codex の設定" />
              <p className="mcp-note">そのほかの AI は、「HTTP（Streamable HTTP）」の MCP サーバーとして上の URL を登録します。</p>
              <h3>書き出したファイルの保存先</h3>
              <CopyRow value={info.exportDir} label="保存先" />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
