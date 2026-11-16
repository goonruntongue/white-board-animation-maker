import { useSyncExternalStore } from 'react'

/**
 * スマホ用レイアウトを使う条件。
 *   縦向き・狭い画面（幅 820px 以下）、または横向きのスマホ（高さ 500px 以下のタッチ端末）。
 * タブレットや PC は従来のレイアウト（タッチ端末ではボタンが大きくなる）。
 */
export const PHONE_QUERY = '(max-width: 820px), (max-height: 500px) and (pointer: coarse)'
export const LANDSCAPE_QUERY = '(orientation: landscape)'

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches
  )
}

export function useIsPhone(): boolean {
  return useMedia(PHONE_QUERY)
}

export function useIsLandscape(): boolean {
  return useMedia(LANDSCAPE_QUERY)
}

/** 端末を軽く振動させる（対応端末のみ。iPhone は非対応なので何もしない） */
export function haptic(ms = 8): void {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* 非対応 */
  }
}
