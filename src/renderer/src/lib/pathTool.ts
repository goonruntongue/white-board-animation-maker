// パス編集の道具（Illustrator / Photoshop と同じ3つ）。端末ごとに localStorage に覚えておく。
//  ・direct  … パス選択（ダイレクト選択）：アンカー・ハンドルを選んで動かす
//  ・convert … アンカーポイントの切り替え：押すと角に、ドラッグでなめらかに。ハンドルは片側だけ動く
//  ・addDel  … アンカーポイントの追加・削除：線の上で追加、アンカーの上で削除
import { useSyncExternalStore } from 'react'

export type PathTool = 'direct' | 'convert' | 'addDel'

const KEY = 'wbam.pathTool'
const listeners = new Set<() => void>()

function read(): PathTool {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'convert' || v === 'addDel' ? v : 'direct'
  } catch {
    return 'direct'
  }
}

let tool: PathTool = read()

export function getPathTool(): PathTool {
  return tool
}

export function setPathTool(v: PathTool): void {
  tool = v
  try {
    localStorage.setItem(KEY, v)
  } catch {
    // 保存できなくても、切り替え自体は行う
  }
  listeners.forEach((l) => l())
}

export function usePathTool(): PathTool {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => tool
  )
}
