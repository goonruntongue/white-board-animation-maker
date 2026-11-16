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
}): React.JSX.Element {
  const { label, value, min, max, step = 1, unit, divisor = 1, onChange, hint } = props
  const shown = value / divisor
  const digits = step / divisor < 1 ? Math.min(2, Math.ceil(-Math.log10(step / divisor))) : 0
  return (
    <label className="field" title={hint}>
      <span className="field-label">{label}</span>
      <div className="field-control">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Math.min(max, Math.max(min, value))}
          onChange={(e) => onChange(Number(e.target.value))}
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
