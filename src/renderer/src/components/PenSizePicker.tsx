import { useEditor } from '../store'

/** ペン先サイズのプリセット（新しく描く軌跡の「見せる幅」） */
export const PEN_PRESETS = [
  { label: '細', width: 12, key: '1' },
  { label: '中', width: 28, key: '2' },
  { label: '太', width: 48, key: '3' },
  { label: '極太', width: 80, key: '4' },
  { label: '特大', width: 200, key: '5' }
] as const

export const PEN_MIN = 4
export const PEN_MAX = 600

/** プリセットの丸の大きさ（大きなサイズでもボタンに収まるよう平方根で縮める） */
export function penDotSize(width: number, max = 18): number {
  return Math.round(4 + Math.sqrt(Math.min(width, 200) / 200) * (max - 4))
}

export function PenSizePicker({ disabled }: { disabled: boolean }): React.JSX.Element {
  const width = useEditor((s) => s.project.settings.defaultRevealWidth)
  const set = (w: number): void =>
    useEditor.getState().updateSettings({ defaultRevealWidth: Math.max(PEN_MIN, Math.min(PEN_MAX, Math.round(w))) })

  return (
    <div className="tb-group pen-size" title="ペン先のサイズ（これから描く軌跡の幅）">
      <span className="tb-label">ペン先</span>
      {PEN_PRESETS.map((p) => {
        const dot = penDotSize(p.width)
        return (
          <button
            key={p.width}
            className={`pen-preset ${width === p.width ? 'on' : ''}`}
            title={`${p.label}（${p.width}px）  キー: ${p.key}`}
            disabled={disabled}
            onClick={() => set(p.width)}
          >
            <span className="pen-dot" style={{ width: dot, height: dot }} />
          </button>
        )
      })}
      <div className="num pen-num">
        <input
          type="number"
          min={PEN_MIN}
          max={PEN_MAX}
          value={width}
          disabled={disabled}
          aria-label="ペン先のサイズ (px)"
          onChange={(e) => {
            const v = Number(e.target.value)
            if (Number.isFinite(v) && v > 0) set(v)
          }}
        />
        <span className="unit">px</span>
      </div>
    </div>
  )
}
