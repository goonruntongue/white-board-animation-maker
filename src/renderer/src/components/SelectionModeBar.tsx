import { deselect, invertSelection } from '../commands'
import type { SelectionOp } from '../engine/selection'
import { useEditor } from '../store'
import { Icon } from './Icon'

/**
 * 選択ツール用のオプションバー（Photoshop と同じ「新規／追加／除外／交差」）。
 * ドラッグ中の修飾キー（Shift=追加、Alt=除外、Shift+Alt=交差）はこの設定より優先される。
 */
const MODES: { id: SelectionOp; label: string; hint: string }[] = [
  { id: 'new', label: '新規', hint: '新しい選択範囲を作る' },
  { id: 'add', label: '追加', hint: '選択範囲に追加（Shift+ドラッグでも可）' },
  { id: 'subtract', label: '除外', hint: '選択範囲から除外（Alt+ドラッグでも可）' },
  { id: 'intersect', label: '交差', hint: '重なった部分だけを残す（Shift+Alt+ドラッグでも可）' }
]

function ModeIcon({ mode }: { mode: SelectionOp }): React.JSX.Element {
  // 2つの四角形の重なりで、合成の結果を表す
  const a = { x: 2.5, y: 2.5, width: 10, height: 10, rx: 1.5 }
  const b = { x: 7.5, y: 7.5, width: 10, height: 10, rx: 1.5 }
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
      <defs>
        <mask id="sel-sub">
          <rect x="0" y="0" width="20" height="20" fill="#fff" />
          <rect {...b} fill="#000" />
        </mask>
        <clipPath id="sel-int">
          <rect {...b} />
        </clipPath>
      </defs>
      {mode === 'new' && <rect x="4" y="4" width="12" height="12" rx="1.5" fill="currentColor" />}
      {mode === 'add' && (
        <>
          <rect {...a} fill="currentColor" />
          <rect {...b} fill="currentColor" />
        </>
      )}
      {mode === 'subtract' && (
        <>
          <rect {...a} fill="currentColor" mask="url(#sel-sub)" />
          <rect {...b} fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.6" opacity="0.7" />
        </>
      )}
      {mode === 'intersect' && (
        <>
          <rect {...a} fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.6" opacity="0.7" />
          <rect {...b} fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.6" opacity="0.7" />
          <rect {...a} fill="currentColor" clipPath="url(#sel-int)" />
        </>
      )}
    </svg>
  )
}

export function SelectionModeBar(): React.JSX.Element {
  const mode = useEditor((s) => s.selectionMode)
  const hasSelection = useEditor((s) => !!s.selection)
  const setMode = useEditor.getState().setSelectionMode

  return (
    <>
      <div className="tb-group sel-modes" role="radiogroup" aria-label="選択範囲の合成モード">
        <span className="tb-label">範囲</span>
        {MODES.map((m) => (
          <button
            key={m.id}
            role="radio"
            aria-checked={mode === m.id}
            className={`tool-btn mode-btn ${mode === m.id ? 'on' : ''}`}
            title={`${m.label}：${m.hint}`}
            onClick={() => setMode(m.id)}
          >
            <ModeIcon mode={m.id} />
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      <div className="tb-group">
        <button className="tool-btn icon-only" title="選択範囲を反転 (Ctrl+Shift+I)" onClick={invertSelection}>
          <Icon name="layers" />
        </button>
        <button className="tool-btn icon-only" title="選択を解除 (Ctrl+D)" disabled={!hasSelection} onClick={deselect}>
          <Icon name="deselect" />
        </button>
      </div>
    </>
  )
}
