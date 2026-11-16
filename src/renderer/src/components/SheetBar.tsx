import { useRef } from 'react'
import { useEditor } from '../store'
import { Icon } from './Icon'

/**
 * スマホのシート上部（つまみ・タイトル・閉じる）。
 * つまみ部分を下へスワイプしても閉じられる（縦向きのとき）。PC 表示では非表示。
 */
export function SheetBar({ title }: { title: string }): React.JSX.Element {
  const drag = useRef<{ y: number; el: HTMLElement; id: number } | null>(null)
  const close = (): void => useEditor.getState().setMobileSheet(null)

  const onDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('button')) return
    const el = e.currentTarget.closest('.panel') as HTMLElement | null
    if (!el || window.matchMedia('(orientation: landscape)').matches) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 失敗しても続ける */
    }
    el.style.transition = 'none'
    drag.current = { y: e.clientY, el, id: e.pointerId }
  }
  const onMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    d.el.style.transform = `translateY(${Math.max(0, e.clientY - d.y)}px)`
  }
  const onUp = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    const dy = e.clientY - d.y
    d.el.style.transition = ''
    d.el.style.transform = ''
    if (dy > 90) close()
  }

  return (
    <div className="sheet-bar" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <span className="sheet-grip" aria-hidden />
      <span className="sheet-title">{title}</span>
      <button className="icon-btn" title="閉じる" aria-label="閉じる" onClick={close}>
        <Icon name="x" />
      </button>
    </div>
  )
}
