import type { ReactNode } from 'react'

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }): React.JSX.Element {
  return (
    <section className="section">
      <h3>
        <span>{title}</span>
        {aside}
      </h3>
      <div className="section-body">{children}</div>
    </section>
  )
}

/** スライダー＋数値入力 */
export function SliderField(props: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  /** 表示値 = 内部値 / divisor（ms→秒など） */
  divisor?: number
  onChange: (v: number) => void
  hint?: string
  /** 'log'：対数目盛り（小さい値を細かく、大きい値まで素早く。ブラシ幅など） */
  scale?: 'linear' | 'log'
}): React.JSX.Element {
  const { label, value, min, max, step = 1, unit, divisor = 1, onChange, hint, scale = 'linear' } = props
  const log = scale === 'log' && min > 0
  // 対数目盛りのときは、スライダー内部を 0〜1000 で扱って値に変換する
  const toSlider = (v: number): number => (log ? (Math.log(v / min) / Math.log(max / min)) * 1000 : v)
  const fromSlider = (t: number): number => (log ? Math.round((min * Math.pow(max / min, t / 1000)) / step) * step : t)
  const clamped = Math.min(max, Math.max(min, value))
  const shown = value / divisor
  const digits = step / divisor < 1 ? Math.min(2, Math.ceil(-Math.log10(step / divisor))) : 0
  return (
    <label className="field" title={hint}>
      <span className="field-label">{label}</span>
      <div className="field-control">
        <input
          type="range"
          min={log ? 0 : min}
          max={log ? 1000 : max}
          step={log ? 1 : step}
          style={{ '--fill': `${((toSlider(clamped) - toSlider(min)) / (toSlider(max) - toSlider(min))) * 100}%` } as React.CSSProperties}
          value={toSlider(clamped)}
          onChange={(e) => onChange(fromSlider(Number(e.target.value)))}
        />
        <div className="num">
          <input
            type="number"
            value={Number(shown.toFixed(digits))}
            step={step / divisor}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (Number.isFinite(v)) onChange(v * divisor)
            }}
          />
          {unit && <span className="unit">{unit}</span>}
        </div>
      </div>
    </label>
  )
}

export function ToggleField({
  label,
  checked,
  onChange,
  hint
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}): React.JSX.Element {
  return (
    <label className="toggle" title={hint}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" />
    </label>
  )
}

export function ColorField({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  return (
    <label className="field inline">
      <span className="field-label">{label}</span>
      <div className="color-control">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        <code>{value.toUpperCase()}</code>
      </div>
    </label>
  )
}
