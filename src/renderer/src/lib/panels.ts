// ショートカットから開くパネル（歯車のメニュー・キーボードショートカット）への合図。
// パネルは歯車のメニュー（HelpMenu）の中にあるので、イベントで知らせて開いてもらう
export const PREFS_EVENT = 'wbam:open-prefs'
export const SHORTCUTS_EVENT = 'wbam:open-shortcuts'

export function openPrefs(): void {
  window.dispatchEvent(new Event(PREFS_EVENT))
}

export function openShortcuts(): void {
  window.dispatchEvent(new Event(SHORTCUTS_EVENT))
}
