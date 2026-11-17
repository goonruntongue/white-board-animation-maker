import { useEditor } from '../store'
import { Icon } from './Icon'

/** ペン先サイズのプリセット（新しく描く軌跡の「見せる幅」） */
export const PEN_PRESETS = [
  { label: '細', width: 12, key: '1' },
  { label: '中', width: 28, key: '2' },
  { label: '太', width: 48, key: '3' },
  { label: '極太', width: 80, key: '4' },
  { label: '特大', width: 200, key: '5' }
] as const

/** 消しゴムの大きさのプリセット */
export const ERASER_PRESETS = [
  { label: '小', width: 16, key: '1' },
  { label: '中', width: 40, key: '2' },
  { label: '大', width: 100, key: '3' },
  { label: '特大', width: 240, key: '4' }
] as const

export const PEN_MIN = 4
export const PEN_MAX = 600

/** プリセットの丸の大きさ（大きなサイズでもボタンに収まるよう平方根で縮める） */
export function penDotSize(width: number, max = 18): number {
  return Math.round(4 + Math.sqrt(Math.min(width, 200) / 200) * (max - 4))
}

/** ペン先（描く）／消しゴムの大きさを選ぶ。kind で対象を切り替える */
export function PenSizePicker({ disabled, kind = 'pen' }: { disabled: boolean; kind?: 'pen' | 'eraser' }): React.JSX.Element {
  const key = kind === 'eraser' ? 'eraserWidth' : 'defaultRevealWidth'
  const width = useEditor((s) => s.project.settings[key])
  const set = (w: number): void =>
    useEditor.getState().updateSettings({ [key]: Math.max(PEN_MIN, Math.min(PEN_MAX, Math.round(w))) })
  const presets = kind === 'eraser' ? ERASER_PRESETS : PEN_PRESETS

  return (
    <div
      className={`tb-group pen-size ${kind === 'eraser' ? 'eraser' : ''}`}
      title={kind === 'eraser' ? '消しゴムの大きさ' : 'ペン先のサイズ（これから描く線の幅）'}
    >
      <span className="tb-label">{kind === 'eraser' ? '消しゴム' : 'ペン先'}</span>
      {presets.map((p) => {
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
          aria-label={kind === 'eraser' ? '消しゴムの大きさ (px)' : 'ペン先のサイズ (px)'}
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
