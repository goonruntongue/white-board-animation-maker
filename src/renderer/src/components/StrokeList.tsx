import { useRef, useState } from 'react'
import { openAutoTrace } from '../commands'
import { useLongPress } from '../lib/useLongPress'
import { StrokeActions } from './phone/StrokeActions'
import { useEditor } from '../store'
import { Icon } from './Icon'
import { PageStrip } from './PageStrip'
import { SheetBar } from './SheetBar'

function rowId(e: React.SyntheticEvent): string | null {
  const t = e.target as HTMLElement
  // 行内のボタン・入力欄を押したときはメニューを出さない
  if (t.closest('button, input')) return null
  return t.closest<HTMLElement>('[data-stroke-id]')?.dataset.strokeId ?? null
}

export function StrokeList(): React.JSX.Element {
  const strokes = useEditor((s) => s.project.strokes)
  const selectedId = useEditor((s) => s.selectedId)
  const rerecordId = useEditor((s) => s.rerecordId)
  const hasImage = useEditor((s) => !!s.project.image)
  const { select, updateStroke, removeStroke, moveStroke, setRerecord } = useEditor.getState()
  const [dragId, setDragId] = useState<string | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  // 行を長押し（右クリック）でメニュー
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const pressed = useRef<string | null>(null)
  const lp = useLongPress(() => {
    if (!pressed.current) return
    select(pressed.current)
    setMenuFor(pressed.current)
  }, '.stroke-row')

  return (
    <aside className="panel left" data-tour="strokes">
      <SheetBar title="ページと描き順" />
      <PageStrip />
      <header className="panel-header">
        <span>描き順</span>
        <span className="header-actions">
          <button className="icon-btn tiny" title="描き順を自動で作る" disabled={!hasImage} onClick={openAutoTrace}>
            <Icon name="sparkle" size={14} />
          </button>
          <span className="badge">{strokes.length}</span>
        </span>
      </header>
      {strokes.length === 0 ? (
        <div className="panel-empty">
          <Icon name="pen" size={22} />
          <p>
            「描く」ツール（<kbd>D</kbd>）で
            <br />
            画像の上をなぞると、
            <br />
            描き順として追加されます。
          </p>
          <button className="btn primary" disabled={!hasImage} onClick={openAutoTrace}>
            <Icon name="sparkle" /> 自動で作る
          </button>
        </div>
      ) : (
        <ul
          className="stroke-list"
          {...lp.handlers}
          onPointerDown={(e) => {
            pressed.current = rowId(e)
            if (pressed.current) lp.handlers.onPointerDown(e)
          }}
          onContextMenu={(e) => {
            pressed.current = rowId(e)
            if (pressed.current) lp.handlers.onContextMenu(e)
          }}
        >
          {strokes.map((s, i) => (
            <li
              key={s.id}
              data-stroke-id={s.id}
              className={[
                'stroke-row',
                s.id === selectedId && 'selected',
                s.hidden && 'muted',
                s.id === rerecordId && 'rerecording',
                overIndex === i && dragId && dragId !== s.id && 'drop-target'
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => select(s.id)}
              draggable={editingId !== s.id}
              onDragStart={(e) => {
                setDragId(s.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                if (!dragId) return
                e.preventDefault()
                setOverIndex(i)
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (dragId) moveStroke(dragId, i)
                setDragId(null)
                setOverIndex(null)
              }}
              onDragEnd={() => {
                setDragId(null)
                setOverIndex(null)
              }}
            >
              <span className="grip">
                <Icon name="grip" size={14} />
              </span>
              <span className="stroke-num" style={{ background: s.hidden ? '#5c616b' : s.color }}>
                {i + 1}
              </span>
              <div className="stroke-main">
                {editingId === s.id ? (
                  <input
                    className="inline-input"
                    autoFocus
                    defaultValue={s.name}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      updateStroke(s.id, { name: e.target.value.trim() || s.name })
                      setEditingId(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  />
                ) : (
                  <span className="stroke-name" onDoubleClick={() => setEditingId(s.id)} title="ダブルクリックで名前を変更">
                    {s.name}
                  </span>
                )}
                <span className="stroke-meta">
                  {(s.duration / 1000).toFixed(1)}s · 幅 {Math.round(s.revealWidth)} · 待機 {(s.delayAfter / 1000).toFixed(1)}s
                  {s.clip && ' · 範囲'}
                </span>
              </div>
              <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                <button className="icon-btn tiny" title="上へ" disabled={i === 0} onClick={() => moveStroke(s.id, i - 1)}>
                  <Icon name="up" size={14} />
                </button>
                <button
                  className="icon-btn tiny"
                  title="下へ"
                  disabled={i === strokes.length - 1}
                  onClick={() => moveStroke(s.id, i + 1)}
                >
                  <Icon name="down" size={14} />
                </button>
                <button
                  className="icon-btn tiny"
                  title="録り直す"
                  onClick={() => {
                    select(s.id)
                    setRerecord(s.id)
                  }}
                >
                  <Icon name="record" size={14} />
                </button>
                <button
                  className="icon-btn tiny"
                  title={s.hidden ? '再生に含める' : '再生から外す'}
                  onClick={() => updateStroke(s.id, { hidden: !s.hidden })}
                >
                  <Icon name={s.hidden ? 'eyeOff' : 'eye'} size={14} />
                </button>
                <button className="icon-btn tiny danger" title="削除 (Delete)" onClick={() => removeStroke(s.id)}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {menuFor && <StrokeActions strokeId={menuFor} onClose={() => setMenuFor(null)} />}
    </aside>
  )
}
