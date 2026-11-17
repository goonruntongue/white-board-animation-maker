// 線を選んでいるときのブラシの動き：描き直す（選んだ線を置き換える。既定）／追加（グループの最後に線を足す）。
// ブラシボタンの ▼ で切り替え、端末ごとに localStorage に覚えておく。
import { useSyncExternalStore } from 'react'

export type BrushTarget = 'redo' | 'add'

const KEY = 'wbam.brushTarget'
const listeners = new Set<() => void>()

function read(): BrushTarget {
  try {
    return localStorage.getItem(KEY) === 'add' ? 'add' : 'redo'
  } catch {
    return 'redo'
  }
}

let target: BrushTarget = read()

export function getBrushTarget(): BrushTarget {
  return target
}

export function setBrushTarget(v: BrushTarget): void {
  target = v
  try {
    localStorage.setItem(KEY, v)
  } catch {
    // 保存できなくても、切り替え自体は行う
  }
  listeners.forEach((l) => l())
}

export function useBrushTarget(): BrushTarget {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => target
  )
}
