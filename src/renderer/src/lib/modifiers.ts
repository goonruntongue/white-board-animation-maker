// Shift・Alt を押しているか（画面の表示を、押しているあいだだけ切り替えるのに使う）
//  ・Shift：ブラシで線を選んでいるとき、その1回だけ「追加」
//  ・Alt：パス編集の「パス選択」のとき、押しているあいだだけ「アンカーポイントの切り替え」
import { useSyncExternalStore } from 'react'

let shift = false
let alt = false
const listeners = new Set<() => void>()

function set(s: boolean, a: boolean): void {
  if (s === shift && a === alt) return
  shift = s
  alt = a
  listeners.forEach((f) => f())
}

if (typeof window !== 'undefined') {
  const fromEvent = (e: KeyboardEvent | PointerEvent): void => set(e.shiftKey, e.altKey)
  window.addEventListener('keydown', fromEvent, true)
  window.addEventListener('keyup', fromEvent, true)
  window.addEventListener('pointermove', fromEvent, true)
  window.addEventListener('pointerdown', fromEvent, true)
  // 別のウィンドウへ移ったら、離したものとみなす（離したことが届かないため）
  window.addEventListener('blur', () => set(false, false))
}

const subscribe = (f: () => void): (() => void) => {
  listeners.add(f)
  return () => void listeners.delete(f)
}

export function getAltHeld(): boolean {
  return alt
}

export function useShiftHeld(): boolean {
  return useSyncExternalStore(subscribe, () => shift)
}

export function useAltHeld(): boolean {
  return useSyncExternalStore(subscribe, () => alt)
}
