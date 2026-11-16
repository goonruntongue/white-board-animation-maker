// ライト / ダーク / システム設定に合わせる、のテーマ切り替え。
// 選んだ設定は（この PC の利用者ごとの好みなので）localStorage に保存する。
import { useSyncExternalStore } from 'react'

export type ThemePref = 'light' | 'dark' | 'system'
export type Theme = 'light' | 'dark'

const KEY = 'wbam.theme'
const listeners = new Set<() => void>()
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* 保存領域が使えない環境では既定値 */
  }
  return 'system'
}

let pref: ThemePref = readPref()

export function resolveTheme(p: ThemePref = pref): Theme {
  if (p === 'system') return media?.matches ? 'dark' : 'light'
  return p
}

function apply(): void {
  const t = resolveTheme()
  document.documentElement.dataset.theme = t
  document.documentElement.style.colorScheme = t
  listeners.forEach((l) => l())
}

export function getThemePref(): ThemePref {
  return pref
}

export function setThemePref(p: ThemePref, fromMenu = false): void {
  pref = p
  try {
    localStorage.setItem(KEY, p)
  } catch {
    /* 保存できなくても切り替え自体は行う */
  }
  apply()
  // デスクトップ版はウィンドウ枠・メニューの色も合わせる
  if (!fromMenu) window.desktop?.setTheme(p)
}

/** 起動時に一度呼ぶ（描画前に適用して、ちらつきを防ぐ） */
export function initTheme(): void {
  apply()
  window.desktop?.setTheme(pref)
  media?.addEventListener('change', () => {
    if (pref === 'system') apply()
  })
}

export function useTheme(): { pref: ThemePref; theme: Theme } {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => `${pref}|${resolveTheme()}`
  )
  const [p, t] = theme.split('|') as [ThemePref, Theme]
  return { pref: p, theme: t }
}
