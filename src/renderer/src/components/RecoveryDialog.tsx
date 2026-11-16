import { useEffect, useState } from 'react'
import { beginSession, clearSnapshots, listSnapshots, loadSnapshot, relativeTime, type SnapshotMeta } from '../lib/recovery'
import { useEditor } from '../store'
import { Icon } from './Icon'
import { GuideLink } from './UsageGuide'

/** 自動バックアップの一覧から、選んだ時点のプロジェクトに戻す */
export function RecoveryDialog(): React.JSX.Element {
  const { openDialog, notify } = useEditor.getState()
  const [items, setItems] = useState<SnapshotMeta[] | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const crashed = beginSession().crashed
  const close = (): void => openDialog(null)

  useEffect(() => {
    void listSnapshots().then(setItems)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const restore = async (s: SnapshotMeta): Promise<void> => {
    const st = useEditor.getState()
    if (st.dirty && !window.confirm('いまの未保存の変更は失われます。この時点に戻しますか？')) return
    setBusy(s.id)
    try {
      const { project, filePath } = await loadSnapshot(s.id)
      st.loadProject(project, filePath)
      // 復元した内容はまだファイルに保存されていないので「未保存」にしておく
      useEditor.setState({ dirty: true })
      notify(`${relativeTime(s.at)}（${clock(s.at)}）の状態に戻しました。保存しておくと安心です`)
      close()
    } catch (e) {
      notify('復元できませんでした: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal aria-label="自動バックアップから復元">
        <header>
          <h2>自動バックアップから復元</h2>
          <span className="modal-head-actions">
            <GuideLink section="save" label="保存と自動バックアップ" />
            <button className="icon-btn" onClick={close} title="閉じる (Esc)">
              <Icon name="x" />
            </button>
          </span>
        </header>
        <div className="modal-body">
          {crashed && (
            <div className="recovery-alert">
              <i className="led warn" /> 前回、アプリが正しく終了しませんでした。下の一覧から、戻したい時点を選んでください。
            </div>
          )}
          <p className="lead">
            未保存の変更があるあいだ、自動でこの端末に保存しています（約2分おき・最大20件）。保存したファイルは変更しません。
          </p>
          {items === null ? (
            <p className="muted-text">読み込み中…</p>
          ) : items.length === 0 ? (
            <p className="muted-text">まだバックアップはありません。</p>
          ) : (
            <ul className="recovery-list">
              {items.map((s, i) => (
                <li key={s.id}>
                  <div className="rec-when">
                    <strong>{relativeTime(s.at)}</strong>
                    <span>{clock(s.at)}</span>
                  </div>
                  <div className="rec-what">
                    <span className="rec-name">{s.name}</span>
                    <span className="muted-text small">
                      軌跡 {s.strokes} 本{i === 0 ? ' ・ いちばん新しい' : ''}
                    </span>
                  </div>
                  <button className={`btn ${i === 0 ? 'primary' : ''}`} disabled={busy !== null} onClick={() => void restore(s)}>
                    {busy === s.id ? '復元中…' : '復元'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className="modal-footer">
          {items && items.length > 0 && (
            <button
              className="btn danger"
              onClick={() => {
                if (!window.confirm('自動バックアップをすべて削除します。元に戻せません。よろしいですか？')) return
                void clearSnapshots().then(() => setItems([]))
              }}
            >
              すべて削除
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={close}>
            {crashed ? '復元しないで続ける' : '閉じる'}
          </button>
        </footer>
      </div>
    </div>
  )
}

function clock(at: number): string {
  const d = new Date(at)
  const today = new Date()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return d.toDateString() === today.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}
