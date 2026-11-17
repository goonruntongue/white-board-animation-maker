// 横に並べて、はみ出したら横スクロールする行。
// はみ出している側の端をぼかし、山形の矢印を出す（押すとその向きに送る）ので、続きがあることがわかる。
import { useCallback, useEffect, useRef, useState } from 'react'

type Props = React.HTMLAttributes<HTMLDivElement> & { className: string; label?: string }

export function ScrollRow({ className, label, children, ...rest }: Props): React.JSX.Element {
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
    const ro = new ResizeObserver(update)
    ro.observe(el)
    // 中身（ボタンの数や文字）が変わったときも測り直す
    const mo = new MutationObserver(update)
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
      mo.disconnect()
    }
  }, [update])

  const page = (dir: -1 | 1): void => {
    const el = ref.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: 'smooth' })
  }

  return (
    <div className={`hscroll ${more.left ? 'more-left' : ''} ${more.right ? 'more-right' : ''}`}>
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
