// ボタンの説明（ポップヒント）を、アプリ全体でそろえて出す。
//  ・PC（マウス）：ボタンにしばらく乗せると、ボタンの下に小さな説明が出る（ブラウザ標準の title の代わり）
//  ・スマホ（指）：ボタンを長押しすると、画面下に説明が出る（指を離すと少しして消える）。そのときボタンは働かない
// 説明の文は data-tip ＞ title ＞ aria-label の順に使う。title はブラウザ標準の吹き出しが重ならないよう data-tip に移す。
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { lookupHint } from '../lib/hints'
import { haptic } from '../lib/useMedia'
import { useEditor } from '../store'

const SELECTOR =
  'button, [role="button"], [role="radio"], [role="menuitem"], [role="menuitemradio"], [role="tab"], select, a[href], label, [data-tip], [title], [aria-label]'
const HOVER_MS = 380
const INTRO_KEY = 'wbam.hintIntro'
const PRESS_MS = 480
const MOVE_TOLERANCE = 10

type Info = { text: string; name: string; key?: string }
type Tip = Info & { rect: DOMRect; mode: 'hover' | 'press' }

/** 説明の末尾の「(Ctrl+Z)」「（D）」のようなショートカット表記 */
const KEY_RE = /[（(]((?:Ctrl|Shift|Alt|Esc|Space|Delete|Enter|Tab|Home|End|PageUp|PageDown|[A-Za-z0-9]|[[\],./\\=+-]|[←→↑↓]|\s|＋|\+|／|\/)+)[)）]\s*$/

/** 要素の説明（なければ null）。title は data-tip に移す */
export function tipOf(el: Element): Info | null {
  const h = el as HTMLElement
  const title = h.getAttribute('title')
  if (title) {
    h.dataset.tip = title
    h.removeAttribute('title')
  }
  let text = (h.dataset.tip || h.getAttribute('aria-label') || '').trim()
  let key: string | undefined
  const m = text.match(KEY_RE)
  if (m && m.index && m.index > 0) {
    key = m[1].trim()
    text = text.slice(0, m.index).trim()
  }
  const visible = (h.innerText || '').replace(/\s+/g, ' ').trim()
  // 説明が無い・ボタンの名前と同じ・短すぎるときは、説明の一覧から引く
  if (!text || text === visible || text.length < 10) {
    const classes = [...h.classList, ...(h.parentElement?.classList ?? [])]
    // 設定の項目（label）は、項目名で引く
    const field = h.querySelector(':scope > .field-label, :scope > span:first-child')?.textContent?.trim() ?? ''
    const found = [text, field, visible, h.getAttribute('aria-label') ?? ''].map((n) => n && lookupHint(n, classes)).find(Boolean)
    if (found) {
      const name = field || (visible && visible.length <= 16 ? visible : text)
      return { text: found, name: name.replace(/^\d+\s+/, ''), key }
    }
  }
  if (!text) return null
  // 見出し：説明が「名前：説明」の形ならその名前、そうでなければボタンに見えている文字
  const colon = text.indexOf('：')
  let name = ''
  let body = text
  if (colon > 0 && colon <= 16) {
    name = text.slice(0, colon)
    body = text.slice(colon + 1).trim()
  } else if (visible && visible.length <= 16 && visible !== text) {
    name = visible
  }
  if (!body) return null
  return { text: body, name, key }
}

function findTarget(t: EventTarget | null): Element | null {
  let el = t instanceof Element ? t.closest(SELECTOR) : null
  // 説明のない label（チェックの入れ物など）なら、その外側の説明を探す
  while (el && el.tagName === 'LABEL' && !(el.getAttribute('title') || (el as HTMLElement).dataset.tip || el.getAttribute('aria-label'))) {
    el = el.parentElement?.closest(SELECTOR) ?? null
  }
  if (!el) return null
  // 絵の上（キャンバス）、文字を入力する所、説明を出さない印の付いた所では出さない
  if (el.closest('canvas, textarea, input[type="text"], input[type="number"], [data-no-tip], .hint-sheet, .hint-pop')) return null
  return el
}

export function HintLayer({ phone }: { phone: boolean }): React.JSX.Element | null {
  const [tip, setTip] = useState<Tip | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // スマホ：絵を読み込んで少ししたら、一度だけ「長押しで説明が出る」ことを知らせる
  const hasImage = useEditor((s) => !!s.project.image)
  useEffect(() => {
    if (!phone || !hasImage) return
    let seen = false
    try {
      seen = localStorage.getItem(INTRO_KEY) === '1'
    } catch {
      seen = true
    }
    if (seen) return
    const t = window.setTimeout(() => {
      useEditor.getState().notify('ボタンを長押しすると、その説明が出ます')
      try {
        localStorage.setItem(INTRO_KEY, '1')
      } catch {
        // 保存できなくても、案内は出す
      }
    }, 2500)
    return () => window.clearTimeout(t)
  }, [phone, hasImage])

  // PC：マウスを乗せて少し待つと出す
  useEffect(() => {
    let timer = 0
    let current: Element | null = null
    const hide = (): void => {
      window.clearTimeout(timer)
      current = null
      setTip((t) => (t?.mode === 'hover' ? null : t))
    }
    const onOver = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse') return
      const el = findTarget(e.target)
      if (el === current) return
      hide()
      if (!el) return
      const info = tipOf(el)
      if (!info) return
      current = el
      timer = window.setTimeout(() => {
        if (current !== el || !el.isConnected) return
        setTip({ ...info, rect: el.getBoundingClientRect(), mode: 'hover' })
      }, HOVER_MS)
    }
    const onOut = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse' || !current) return
      const to = findTarget(e.relatedTarget)
      if (to !== current) hide()
    }
    window.addEventListener('pointerover', onOver, true)
    window.addEventListener('pointerout', onOut, true)
    window.addEventListener('pointerdown', hide, true)
    window.addEventListener('wheel', hide, { capture: true, passive: true })
    window.addEventListener('keydown', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerover', onOver, true)
      window.removeEventListener('pointerout', onOut, true)
      window.removeEventListener('pointerdown', hide, true)
      window.removeEventListener('wheel', hide, true)
      window.removeEventListener('keydown', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // 指：長押しで出し、指を離すと少しして消す。出したときは、そのあとの click を止める（ボタンは働かない）
  useEffect(() => {
    let timer = 0
    let hideTimer = 0
    let start: { x: number; y: number; id: number } | null = null
    let shown = false
    let shownAt = 0
    let swallow = false
    const cancel = (): void => {
      window.clearTimeout(timer)
      start = null
    }
    const onDown = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse') return
      // 前の説明が出ていれば、どこかを押した時点で消す
      window.clearTimeout(hideTimer)
      setTip((t) => (t?.mode === 'press' ? null : t))
      swallow = false
      if ((e as PointerEvent & { ownLongPress?: boolean }).ownLongPress) return // 自前の長押し（メニューを出すもの）がある
      const el = findTarget(e.target)
      if (!el || (el instanceof HTMLInputElement && el.type === 'range')) return
      const info = tipOf(el)
      if (!info) return
      cancel()
      start = { x: e.clientX, y: e.clientY, id: e.pointerId }
      timer = window.setTimeout(() => {
        if (!start || !el.isConnected) return
        shown = true
        shownAt = performance.now()
        swallow = true
        haptic(12)
        setTip({ ...info, rect: el.getBoundingClientRect(), mode: 'press' })
      }, PRESS_MS)
    }
    const onMove = (e: PointerEvent): void => {
      if (start && e.pointerId === start.id && Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE) cancel()
    }
    const onUp = (e: PointerEvent): void => {
      if (start && e.pointerId !== start.id) return
      cancel()
      if (!shown) return
      shown = false
      // すぐ離しても読めるよう、少しのあいだ残す
      const wait = Math.max(1800, 3200 - (performance.now() - shownAt))
      hideTimer = window.setTimeout(() => setTip((t) => (t?.mode === 'press' ? null : t)), wait)
    }
    const onClick = (e: MouseEvent): void => {
      if (!swallow) return
      swallow = false
      e.preventDefault()
      e.stopPropagation()
    }
    const onContext = (e: Event): void => {
      if (shown || start) e.preventDefault()
    }
    // 先に（キャプチャで）前の印を消し、あとで（バブルで）新しい長押しを始める。
    // バブルで聞くのは、自前の長押しが ownLongPress の印を付けた後に見るため
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    window.addEventListener('click', onClick, true)
    window.addEventListener('contextmenu', onContext, true)
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(hideTimer)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('contextmenu', onContext, true)
    }
  }, [])

  // PC の吹き出しの位置：ボタンの下（入らなければ上）。画面からはみ出さないようにする
  useLayoutEffect(() => {
    if (!tip || tip.mode !== 'hover' || !boxRef.current) return setPos(null)
    const b = boxRef.current.getBoundingClientRect()
    const r = tip.rect
    let left = r.left + r.width / 2 - b.width / 2
    left = Math.max(8, Math.min(left, window.innerWidth - b.width - 8))
    let top = r.bottom + 8
    if (top + b.height > window.innerHeight - 8) top = r.top - b.height - 8
    setPos({ left, top })
  }, [tip])

  if (!tip) return null
  if (tip.mode === 'press') {
    return (
      <div className={`hint-sheet ${phone ? 'phone' : ''}`} role="status" aria-live="polite">
        {tip.name && <div className="hint-name">{tip.name}</div>}
        <div className="hint-text">{tip.text}</div>
      </div>
    )
  }
  return (
    <div ref={boxRef} className="hint-pop" role="tooltip" style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}>
      {(tip.name || tip.key) && (
        <div className="hint-head">
          {tip.name && <span className="hint-name">{tip.name}</span>}
          {tip.key && <kbd className="hint-key">{tip.key}</kbd>}
        </div>
      )}
      <div className="hint-text">{tip.text}</div>
    </div>
  )
}
