// キーボードショートカットの一覧と、割り当ての変更（Ctrl+Alt+Shift+K、歯車のメニューから）。
// 操作ごとにキーをいくつでも持てる。「＋ キーを追加」を押してから、割り当てたいキーを押す。
// 同じ場面でほかの操作が使っているキーなら、そちらから外して付け替える（何から外したかを知らせる）。
import { useEffect, useMemo, useState } from 'react'
import {
  comboFromEvent,
  comboParts,
  conflictsOf,
  FIXED_SHORTCUTS,
  isCustomized,
  keysFor,
  resetKeys,
  setKeys,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  useShortcutsVersion
} from '../lib/shortcuts'
import { Icon } from './Icon'

function Combo({ combo }: { combo: string }): React.JSX.Element {
  return (
    <span className="sc-combo">
      {comboParts(combo).map((p, i) => (
        <kbd key={i}>{p}</kbd>
      ))}
    </span>
  )
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  useShortcutsVersion()
  const [query, setQuery] = useState('')
  /** キーを待っている操作 */
  const [recording, setRecording] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  // このパネルを開いているあいだは、アプリのショートカットを止める（検索欄への入力はそのまま）。
  // キーを待っているときは、押したキーをそのまま割り当てる
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (recording) {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (e.key === 'Escape') return setRecording(null)
        const combo = comboFromEvent(e)
        if (!combo) return
        const id = recording
        const taken = conflictsOf(combo, id)
        for (const d of taken) setKeys(d.id, keysFor(d.id).filter((k) => k !== combo))
        setKeys(id, [...keysFor(id).filter((k) => k !== combo), combo])
        setRecording(null)
        const label = SHORTCUTS.find((d) => d.id === id)?.label
        setMessage(
          taken.length
            ? `${comboParts(combo).join('+')} を「${label}」に割り当てました（「${taken.map((d) => d.label).join('」「')}」から外しました）`
            : `${comboParts(combo).join('+')} を「${label}」に割り当てました`
        )
        return
      }
      const typing = (e.target as HTMLElement | null)?.tagName === 'INPUT'
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
      // アプリのショートカットには渡さない（入力欄の文字入力・Tab での移動はそのまま）
      if (!typing || e.key === 'Escape') e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, onClose])

  const q = query.trim().toLowerCase()
  const groups = useMemo(
    () =>
      SHORTCUT_GROUPS.map((g) => ({
        name: g,
        items: SHORTCUTS.filter(
          (d) => d.group === g && (!q || d.label.toLowerCase().includes(q) || keysFor(d.id).some((k) => comboParts(k).join('+').toLowerCase().includes(q)))
        )
      })).filter((g) => g.items.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, message, recording]
  )
  const anyCustom = SHORTCUTS.some((d) => isCustomized(d.id))

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal shortcuts-modal" role="dialog" aria-modal aria-label="キーボードショートカット">
        <header>
          <h2>キーボードショートカット</h2>
          <span className="modal-head-actions">
            <button className="icon-btn" onClick={onClose} title="閉じる (Esc)" aria-label="閉じる">
              <Icon name="x" />
            </button>
          </span>
        </header>
        <div className="modal-body sc-body">
          <p className="sc-lead">
            操作の横の <b>＋ キーを追加</b> を押してから、割り当てたいキーを押します（<kbd>Esc</kbd> でやめる）。キーの × で外せます。変えた割り当てはこの端末に覚えます。
          </p>
          <div className="sc-tools">
            <input className="sc-search" type="search" placeholder="操作やキーで探す" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="ショートカットを探す" />
            <button
              className="btn small"
              disabled={!anyCustom}
              onClick={() => {
                resetKeys()
                setMessage('すべて最初の割り当てに戻しました')
              }}
            >
              すべて既定に戻す
            </button>
          </div>
          {message && (
            <p className="sc-message" role="status">
              {message}
            </p>
          )}
          {groups.map((g) => (
            <section key={g.name} className="sc-group">
              <h3>{g.name}</h3>
              {g.items.map((d) => {
                const keys = keysFor(d.id)
                const rec = recording === d.id
                return (
                  <div key={d.id} className={`sc-row ${rec ? 'recording' : ''}`}>
                    <div className="sc-label">
                      {d.label}
                      {d.note && <small>{d.note}</small>}
                    </div>
                    <div className="sc-keys">
                      {keys.length === 0 && !rec && <span className="sc-none">なし</span>}
                      {keys.map((k) => (
                        <span key={k} className="sc-chip">
                          <Combo combo={k} />
                          <button
                            className="sc-remove"
                            title="このキーを外す"
                            aria-label={`${comboParts(k).join('+')} を外す`}
                            onClick={() => {
                              setKeys(
                                d.id,
                                keys.filter((x) => x !== k)
                              )
                              setMessage(null)
                            }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {rec ? (
                        <span className="sc-wait">キーを押してください…</span>
                      ) : (
                        <button
                          className="sc-add"
                          onClick={() => {
                            setMessage(null)
                            setRecording(d.id)
                          }}
                        >
                          ＋ キーを追加
                        </button>
                      )}
                      {rec && (
                        <button className="sc-add" onClick={() => setRecording(null)}>
                          やめる
                        </button>
                      )}
                      {isCustomized(d.id) && !rec && (
                        <button
                          className="sc-reset"
                          title="最初の割り当てに戻す"
                          onClick={() => {
                            resetKeys(d.id)
                            setMessage(`「${d.label}」を最初の割り当てに戻しました`)
                          }}
                        >
                          既定
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </section>
          ))}
          {!q && (
            <section className="sc-group">
              <h3>変えられないキー</h3>
              {FIXED_SHORTCUTS.map((f) => (
                <div key={f.keys} className="sc-row fixed">
                  <div className="sc-label">{f.label}</div>
                  <div className="sc-keys">
                    <kbd>{f.keys}</kbd>
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
