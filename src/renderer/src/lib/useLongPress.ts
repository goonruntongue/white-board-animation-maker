import { useRef } from 'react'
import { haptic } from './useMedia'

const PRESS_MS = 450
const MOVE_TOLERANCE = 10 // これ以上指が動いたら長押しではない（スクロールやドラッグ）

/**
 * 長押し（タッチ）と右クリック（マウス）で同じ操作を呼び出す。
 *   const lp = useLongPress(() => openMenu())
 *   <div {...lp.handlers} />
 * pressTarget：押している手ごたえ（data-pressing）を付ける要素の CSS セレクタ。省略時はハンドラを付けた要素。
 * fired()：直前の操作が長押しだったか（その後の click を無視したいとき用）。
 */
export function useLongPress(onLongPress: () => void, pressTarget?: string): {
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: () => void
    onPointerCancel: () => void
    onPointerLeave: () => void
    onContextMenu: (e: React.MouseEvent) => void
  }
  /** 長押しの直後に発生する click を無視する */
  fired: () => boolean
} {
  const timer = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number; el: HTMLElement } | null>(null)
  const didFire = useRef(false)

  const clear = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    if (start.current) delete start.current.el.dataset.pressing
    start.current = null
  }

  return {
    handlers: {
      onPointerDown: (e) => {
        didFire.current = false
        if (e.pointerType === 'mouse') return // マウスは右クリックで開く
        const el =
          ((pressTarget && (e.target as HTMLElement).closest(pressTarget)) as HTMLElement | null) ??
          (e.currentTarget as HTMLElement)
        start.current = { x: e.clientX, y: e.clientY, el }
        // 押している間の手ごたえ（CSS の [data-pressing]）。class は React の再描画で消えるので data 属性を使う
        el.dataset.pressing = '1'
        timer.current = window.setTimeout(() => {
          didFire.current = true
          clear()
          haptic(12)
          onLongPress()
        }, PRESS_MS)
      },
      onPointerMove: (e) => {
        const s = start.current
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE) clear()
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
      onContextMenu: (e) => {
        // Android の長押しでも contextmenu が来るので、二重に開かないようにする
        e.preventDefault()
        if (didFire.current) return
        didFire.current = true
        clear()
        onLongPress()
      }
    },
    fired: () => {
      const f = didFire.current
      didFire.current = false
      return f
    }
  }
}
