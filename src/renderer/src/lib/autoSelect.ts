// 「選ぶ・動かす」の自動選択（Photoshop の移動ツールの「自動選択」と同じ考え方）。
//  ・オン（既定）：押した所にある線に選び替え、そのままドラッグで動かす
//  ・オフ：いま選んでいる線（タイムラインで選んだ線）から選び替えず、どこをドラッグしてもその線を動かす
// 端末ごとの好みなので localStorage に覚えておく。
import { useSyncExternalStore } from 'react'

const KEY = 'wbam.autoSelect'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

let on = read()

export function getAutoSelect(): boolean {
  return on
}

export function setAutoSelect(v: boolean): void {
  on = v
  try {
    localStorage.setItem(KEY, v ? 'on' : 'off')
  } catch {
    // 保存できなくても、切り替え自体は行う
  }
  listeners.forEach((l) => l())
}

export function useAutoSelect(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => on
  )
}
