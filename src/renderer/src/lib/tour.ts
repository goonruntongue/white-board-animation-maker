// ツアーガイド（起動時に、ボタンのそばへ順番にヒントを出す）の設定と呼び出し。
// 「次回から表示しない」の設定は、この端末の利用者ごとの好みなので localStorage に保存する。
// Electron 版・Web（PWA）版・スタンドアロン版で同じ仕組みを使う。
import { useSyncExternalStore } from 'react'

const KEY = 'wbam.tour'

interface TourPrefs {
  /** 起動時にツアーを表示する */
  showOnStartup: boolean
}

function read(): TourPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<TourPrefs>
    return { showOnStartup: v.showOnStartup !== false }
  } catch {
    return { showOnStartup: true }
  }
}

let prefs = read()
const listeners = new Set<() => void>()

export function getTourPrefs(): TourPrefs {
  return prefs
}

export function setShowTourOnStartup(show: boolean): void {
  prefs = { ...prefs, showOnStartup: show }
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    /* 保存できなくても、今回の表示には影響しない */
  }
  listeners.forEach((l) => l())
}

export function useTourPrefs(): TourPrefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => prefs
  )
}

// ---- 開く・閉じる（どこからでも呼べるよう、イベントで App に伝える） ----
export const TOUR_EVENT = 'whiteboard:tour'
export const GUIDE_EVENT = 'whiteboard:guide'

/** ツアーを最初から始める */
export function startTour(): void {
  window.dispatchEvent(new Event(TOUR_EVENT))
}

/** 使い方ガイド（説明カード）を開く */
export function openGuide(): void {
  window.dispatchEvent(new Event(GUIDE_EVENT))
}
