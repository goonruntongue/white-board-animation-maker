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

// ---------------------------------------------------------------------------
// 「描き直したら次の線へ進む」（▼ のメニューで切り替え。既定はオン）
// ---------------------------------------------------------------------------
const ADVANCE_KEY = 'wbam.redoAdvance'
const advanceListeners = new Set<() => void>()
let advance = ((): boolean => {
  try {
    return localStorage.getItem(ADVANCE_KEY) !== 'off'
  } catch {
    return true
  }
})()

export function getRedoAdvance(): boolean {
  return advance
}

export function setRedoAdvance(v: boolean): void {
  advance = v
  try {
    localStorage.setItem(ADVANCE_KEY, v ? 'on' : 'off')
  } catch {
    // 保存できなくても、切り替え自体は行う
  }
  advanceListeners.forEach((l) => l())
}

export function useRedoAdvance(): boolean {
  return useSyncExternalStore(
    (cb) => {
      advanceListeners.add(cb)
      return () => advanceListeners.delete(cb)
    },
    () => advance
  )
}
