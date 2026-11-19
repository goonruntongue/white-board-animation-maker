// オプションバーの並べ方（既定は2段）。端末ごとの好みなので localStorage に保存する（右上の ⚙ から切り替え）。
//  ・スマホ：2段（上に操作の切り替え、下に選んだ線の操作）／1段（すべて1列に並べて横にスクロール）
//  ・PC：2段（ツールバーの下の段に、いまの道具のオプションを並べる）／1段（ツールバーの中に並べる）
import { useSyncExternalStore } from 'react'

export type BarLayout = 'two' | 'one'

const KEY = 'wbam.barLayout'
const listeners = new Set<() => void>()

function read(): BarLayout {
  try {
    return localStorage.getItem(KEY) === 'one' ? 'one' : 'two'
  } catch {
    return 'two'
  }
}

let layout: BarLayout = read()

export function setBarLayout(v: BarLayout): void {
  layout = v
  try {
    localStorage.setItem(KEY, v)
  } catch {
    // 保存できなくても、切り替え自体は行う
  }
  listeners.forEach((l) => l())
}

export function useBarLayout(): BarLayout {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => layout
  )
}
