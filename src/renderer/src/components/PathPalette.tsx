// パス編集中に絵の上に浮かぶ道具パネル（Illustrator / Photoshop の道具と同じ3つ）。
// 上の取っ手をドラッグして好きな所へ動かせる（位置は端末ごとに覚える）。
import { useEffect, useRef, useState } from 'react'
import { setPathTool, usePathTool, type PathTool } from '../lib/pathTool'
import { Icon, type IconName } from './Icon'

const POS_KEY = 'wbam.pathPalettePos'

const TOOLS: { id: PathTool; icon: IconName; label: string; tip: string }[] = [
  {
    id: 'direct',
    icon: 'directSelect',
    label: 'パス選択',
    tip: 'パス選択：アンカー（四角）を押して選び、ドラッグで動かします。選んだアンカーのハンドルをドラッグすると曲がり具合が変わります（A）'
  },
  {
    id: 'convert',
    icon: 'convertAnchor',
    label: 'アンカーポイントの切り替え',
    tip: 'アンカーポイントの切り替え：アンカーを押すと角に、アンカーからドラッグするとなめらかな曲線になります。ハンドルのドラッグは片側だけ動きます（Shift+C）'
  },
  {
    id: 'addDel',
    icon: 'penAddDel',
    label: 'アンカーポイントの追加・削除',
    tip: 'アンカーポイントの追加・削除：線の上を押すとアンカーを足し、アンカーの上を押すと消します（+ / -）'
  }
]

function readPos(): { x: number; y: number } {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) ?? '')
    if (typeof v?.x === 'number' && typeof v?.y === 'number') return v
  } catch {
    // 既定の位置を使う
  }
  return { x: 14, y: 14 }
}

export function PathPalette(): React.JSX.Element {
  const tool = usePathTool()
  const [pos, setPos] = useState(readPos)
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null)
  const latest = useRef(pos)

  // 絵の枠が小さくなっても、パネルが外へ出ないようにする
  const clamp = (x: number, y: number): { x: number; y: number } => {
    const el = ref.current
    const parent = el?.offsetParent as HTMLElement | null
    if (!el || !parent) return { x, y }
    return {
      x: Math.max(4, Math.min(x, parent.clientWidth - el.offsetWidth - 4)),
      y: Math.max(4, Math.min(y, parent.clientHeight - el.offsetHeight - 4))
    }
  }
  useEffect(() => {
    const fit = (): void =>
      setPos((p) => {
        const c = clamp(p.x, p.y)
        latest.current = c
        return c
      })
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  return (
    <div
      ref={ref}
      className="path-palette"
      role="toolbar"
      aria-label="パス編集の道具"
      aria-orientation="vertical"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        className="path-palette-grip"
        data-tip="パネルの取っ手：ドラッグして、パネルを動かします"
        onPointerDown={(e) => {
          drag.current = { id: e.pointerId, dx: e.clientX - pos.x, dy: e.clientY - pos.y }
          try {
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          } catch {
            // つかめなくても、取っ手の上で動かしている間は動く
          }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d || d.id !== e.pointerId) return
          const next = clamp(e.clientX - d.dx, e.clientY - d.dy)
          latest.current = next
          setPos(next)
        }}
        onPointerUp={() => {
          if (!drag.current) return
          drag.current = null
          try {
            localStorage.setItem(POS_KEY, JSON.stringify(latest.current))
          } catch {
            // 覚えられなくても動かせる
          }
        }}
      />
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`path-palette-btn ${tool === t.id ? 'on' : ''}`}
          aria-label={t.label}
          aria-pressed={tool === t.id}
          data-tip={t.tip}
          onClick={() => setPathTool(t.id)}
        >
          <Icon name={t.icon} size={20} />
        </button>
      ))}
    </div>
  )
}
