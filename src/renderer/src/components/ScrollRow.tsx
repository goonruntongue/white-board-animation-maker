// 横に並べて、はみ出したら横スクロールする行。
// はみ出している側の端をぼかし、山形の矢印を出す（押すとその向きに送る）ので、続きがあることがわかる。
import { useCallback, useEffect, useRef, useState } from 'react'

type Props = React.HTMLAttributes<HTMLDivElement> & {
  className: string
  label?: string
  /** マウスのホイール（縦）でも横にスクロールする（PC のバー用） */
  wheel?: boolean
}

export function ScrollRow({ className, label, wheel = false, children, ...rest }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ left: false, right: false })

  const update = useCallback((): void => {
    const el = ref.current
    if (!el) return
    const left = el.scrollLeft > 2
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }))
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    el.addEventListener('scroll', update, { passive: true })
    // ホイールの縦の動きを横のスクロールにする（はみ出しているときだけ）
    const onWheel = (e: WheelEvent): void => {
      if (!wheel || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      if (el.scrollWidth <= el.clientWidth + 2) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    // 中身（ボタンの数や文字）が変わったときも測り直す
    const mo = new MutationObserver(update)
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    return () => {
      el.removeEventListener('scroll', update)
      el.removeEventListener('wheel', onWheel)
      ro.disconnect()
      mo.disconnect()
    }
  }, [update, wheel])

  const page = (dir: -1 | 1): void => {
    const el = ref.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: 'smooth' })
  }

  return (
    <div className={`hscroll hscroll-${className.split(' ')[0]} ${more.left ? 'more-left' : ''} ${more.right ? 'more-right' : ''}`}>
      <div ref={ref} className={`hscroll-track ${className}`} aria-label={label} {...rest}>
        {children}
      </div>
      {more.left && (
        <button className="hscroll-more left" aria-label="左へ送る" tabIndex={-1} onPointerDown={(e) => e.stopPropagation()} onClick={() => page(-1)}>
          <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
            <path d="M7.5 2.5 L2.5 8 L7.5 13.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {more.right && (
        <button className="hscroll-more right" aria-label="右へ送る" tabIndex={-1} onPointerDown={(e) => e.stopPropagation()} onClick={() => page(1)}>
          <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
            <path d="M2.5 2.5 L7.5 8 L2.5 13.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  )
}
