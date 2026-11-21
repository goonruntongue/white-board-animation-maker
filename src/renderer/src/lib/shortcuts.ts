// キーボードショートカットの一覧と、その割り当て（端末ごとに localStorage に覚える）。
// 既定の割り当ては、なるべく Adobe（Photoshop / Illustrator / Premiere）と同じにしている。
// 「キーボードショートカット」の画面（Ctrl+Alt+Shift+K）で、操作ごとに変えられる。
//
// キーの書き方（combo）："Ctrl+Shift+S" のように、Ctrl → Alt → Shift → キーの順に + でつなぐ。
//  ・Ctrl は Mac では ⌘ も含む
//  ・英字は大文字、数字はそのまま、記号はその文字（記号は Shift を書かない。JIS 配列の = などは Shift で入力するため）
//  ・ほかのキーは KeyboardEvent.key の名前（Space / ArrowUp / Home / PageUp / Delete / Tab / F1 など）
import { useSyncExternalStore } from 'react'

/** 効く場面。path は「パス編集のあいだ」だけ効き、そのあいだは global より先に調べる */
export type ShortcutScope = 'global' | 'path'

export interface ShortcutDef {
  id: string
  label: string
  group: string
  keys: string[]
  scope?: ShortcutScope
  note?: string
}

export const SHORTCUT_GROUPS = ['ツール', 'パス編集（パス編集中だけ）', '線・グループ', '再生・表示', 'タイムライン', '選択範囲', '編集', 'ファイル', 'ヘルプ'] as const

export const SHORTCUTS: ShortcutDef[] = [
  // ---- ツール ----
  { id: 'tool.move', group: 'ツール', label: '選ぶ・動かす', keys: ['V'] },
  { id: 'tool.brush', group: 'ツール', label: 'ブラシ', keys: ['B', 'D'] },
  { id: 'tool.erase', group: 'ツール', label: '消しゴム（選んだ線だけ）', keys: ['E'] },
  { id: 'tool.path', group: 'ツール', label: 'パス編集', keys: ['P'] },
  { id: 'tool.live', group: 'ツール', label: '手描き（いまの操作のまま）', keys: ['W'] },
  { id: 'tool.groupSelect', group: 'ツール', label: 'グループを選ぶ', keys: ['Shift+V'] },
  { id: 'tool.groupErase', group: 'ツール', label: 'グループから消す', keys: ['Shift+E'] },
  { id: 'tool.hand', group: 'ツール', label: '移動（表示位置）', keys: ['H'] },
  { id: 'tool.rect', group: 'ツール', label: '長方形選択', keys: ['M'] },
  { id: 'tool.ellipse', group: 'ツール', label: '楕円形選択', keys: ['Shift+M'] },
  { id: 'tool.lasso', group: 'ツール', label: '投げ縄', keys: ['L'] },
  // ---- パス編集 ----
  { id: 'path.direct', group: 'パス編集（パス編集中だけ）', label: 'パス選択', keys: ['A'], scope: 'path' },
  { id: 'path.convert', group: 'パス編集（パス編集中だけ）', label: 'アンカーポイントの切り替え', keys: ['Shift+C'], scope: 'path', note: 'パス選択のときに Alt を押しているあいだも、一時的にこの道具になります' },
  { id: 'path.addDel', group: 'パス編集（パス編集中だけ）', label: 'アンカーポイントの追加・削除', keys: ['+', '=', '-', ';'], scope: 'path' },
  // ---- 線・グループ ----
  { id: 'line.prevGroup', group: '線・グループ', label: '前のグループを選ぶ', keys: ['ArrowUp'] },
  { id: 'line.nextGroup', group: '線・グループ', label: '次のグループを選ぶ', keys: ['ArrowDown'] },
  { id: 'line.prev', group: '線・グループ', label: '前の線（手描き）', keys: [','] },
  { id: 'line.next', group: '線・グループ', label: '次の線（手描き）', keys: ['.'] },
  { id: 'size.down', group: '線・グループ', label: 'ブラシ・消しゴムを小さく', keys: ['['], note: 'ブラシはこれから描く太さ（すでにある線は変わりません）。選ぶ・動かす・パス編集では、選んでいる線の太さ' },
  { id: 'size.up', group: '線・グループ', label: 'ブラシ・消しゴムを大きく', keys: [']'] },
  { id: 'edit.newGroup', group: '線・グループ', label: '新しいグループ（次になぞった線から）', keys: ['Ctrl+Shift+N'], note: 'Photoshop の「新規レイヤー」と同じキー' },
  { id: 'edit.delete', group: '線・グループ', label: '削除（範囲の中・選んだグループ・アンカー）', keys: ['Delete', 'Backspace'] },
  // ---- 再生・表示 ----
  { id: 'play.toggle', group: '再生・表示', label: '再生 / 一時停止', keys: ['Space'] },
  { id: 'play.rewind', group: '再生・表示', label: '先頭へ戻る', keys: ['Home'] },
  { id: 'view.toggle', group: '再生・表示', label: '編集表示 ⇔ プレビュー表示', keys: ['Tab'] },
  { id: 'page.prev', group: '再生・表示', label: '前のページ', keys: ['PageUp'] },
  { id: 'page.next', group: '再生・表示', label: '次のページ', keys: ['PageDown'] },
  // ---- タイムライン ----
  { id: 'timeline.zoomIn', group: 'タイムライン', label: 'タイムラインを拡大', keys: ['Alt+='], note: 'タイムラインの上で Ctrl＋ホイールでも' },
  { id: 'timeline.zoomOut', group: 'タイムライン', label: 'タイムラインを縮小', keys: ['Alt+-'] },
  { id: 'timeline.fit', group: 'タイムライン', label: 'タイムラインを全体表示', keys: ['\\'], note: 'Premiere と同じキー' },
  // ---- 選択範囲 ----
  { id: 'sel.all', group: '選択範囲', label: 'すべてを選択（範囲の道具のとき）', keys: ['Ctrl+A'] },
  { id: 'sel.deselect', group: '選択範囲', label: '選択を解除', keys: ['Ctrl+D'] },
  { id: 'sel.invert', group: '選択範囲', label: '選択範囲を反転', keys: ['Ctrl+Shift+I'] },
  // ---- 編集 ----
  { id: 'edit.undo', group: '編集', label: '元に戻す', keys: ['Ctrl+Z'] },
  { id: 'edit.redo', group: '編集', label: 'やり直す', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
  { id: 'edit.autoTrace', group: '編集', label: '描き順を自動で作る', keys: ['Ctrl+Shift+A'] },
  { id: 'edit.prefs', group: '編集', label: '環境設定（歯車のメニュー）', keys: ['Ctrl+K'] },
  { id: 'edit.shortcuts', group: '編集', label: 'キーボードショートカット', keys: ['Ctrl+Alt+Shift+K'] },
  // ---- ファイル ----
  { id: 'file.new', group: 'ファイル', label: '新規', keys: ['Ctrl+N'] },
  { id: 'file.open', group: 'ファイル', label: '開く', keys: ['Ctrl+O'] },
  { id: 'file.save', group: 'ファイル', label: '保存', keys: ['Ctrl+S'] },
  { id: 'file.saveAs', group: 'ファイル', label: '名前を付けて保存', keys: ['Ctrl+Shift+S'] },
  { id: 'file.import', group: 'ファイル', label: '画像を読み込む', keys: ['Ctrl+I'] },
  { id: 'file.exportHtml', group: 'ファイル', label: 'HTMLを書き出す', keys: ['Ctrl+E'] },
  { id: 'file.exportVideo', group: 'ファイル', label: '動画・GIF を書き出す', keys: ['Ctrl+Shift+E'] },
  // ---- ヘルプ ----
  { id: 'help.guide', group: 'ヘルプ', label: '使い方ガイド', keys: ['F1'] }
]

/** 変えられないキー（説明のために一覧に出すだけ） */
export const FIXED_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: '1〜5', label: 'ブラシ・消しゴムの大きさ（細・中・太・極太・特大）' },
  { keys: 'Shift＋なぞる', label: 'ブラシで線を選んでいるとき、その1回だけ「追加」' },
  { keys: 'Alt（押しているあいだ）', label: 'パス選択 → 一時的にアンカーポイントの切り替え' },
  { keys: 'Alt＋ドラッグ', label: '表示位置を動かす（範囲の道具とパス編集のときを除く）' },
  { keys: 'ホイール', label: '絵の上：拡大・縮小' },
  { keys: 'Ctrl＋ホイール', label: 'タイムラインの上：拡大・縮小' },
  { keys: 'Enter', label: '範囲を囲み終える' },
  { keys: 'Esc', label: '選択を外す・録り直しや多角形の取り消し' }
]

const BY_ID = new Map(SHORTCUTS.map((d) => [d.id, d]))

// ---------------------------------------------------------------------------
// 割り当ての保存（既定と違うものだけを覚える）
// ---------------------------------------------------------------------------
const STORE_KEY = 'wbam.shortcuts'
const listeners = new Set<() => void>()
let version = 0

function read(): Record<string, string[]> {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')
    if (v && typeof v === 'object') {
      const out: Record<string, string[]> = {}
      for (const [id, keys] of Object.entries(v)) if (BY_ID.has(id) && Array.isArray(keys)) out[id] = keys.filter((k) => typeof k === 'string')
      return out
    }
  } catch {
    // 読めなければ既定のまま
  }
  return {}
}

let overrides = read()

function save(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(overrides))
  } catch {
    // 保存できなくても、この起動のあいだは効く
  }
  version++
  listeners.forEach((f) => f())
}

export function keysFor(id: string): string[] {
  return overrides[id] ?? BY_ID.get(id)?.keys ?? []
}

export function isCustomized(id: string): boolean {
  return id in overrides
}

export function setKeys(id: string, keys: string[]): void {
  const def = BY_ID.get(id)
  if (!def) return
  const uniq = [...new Set(keys)]
  if (uniq.length === def.keys.length && uniq.every((k, i) => k === def.keys[i])) delete overrides[id]
  else overrides = { ...overrides, [id]: uniq }
  save()
}

export function resetKeys(id?: string): void {
  if (id) {
    const { [id]: _, ...rest } = overrides
    overrides = rest
  } else overrides = {}
  save()
}

/** 割り当てが変わったら描き直す（戻り値は使わなくてよい） */
export function useShortcutsVersion(): number {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => void listeners.delete(f)
    },
    () => version
  )
}

/** 同じ場面で同じキーを使っている、ほかの操作 */
export function conflictsOf(combo: string, exceptId: string): ShortcutDef[] {
  const scope = BY_ID.get(exceptId)?.scope ?? 'global'
  return SHORTCUTS.filter((d) => d.id !== exceptId && (d.scope ?? 'global') === scope && keysFor(d.id).includes(combo))
}

// ---------------------------------------------------------------------------
// キーの読み取りと表示
// ---------------------------------------------------------------------------
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS', 'Process', 'Dead', 'Unidentified'])

/** キーを押したときの combo（修飾キーだけのとき・変換中は null） */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (e.isComposing || MODIFIER_KEYS.has(e.key)) return null
  let key = e.key
  // 数字・英字は物理キーで読む（Shift+1 が ! になる、Mac の Option で別の文字になる、などを避ける）
  if (/^Digit\d$/.test(e.code)) key = e.code.slice(5)
  else if (/^Key[A-Z]$/.test(e.code) && !(key.length === 1 && /[a-z]/i.test(key))) key = e.code.slice(3)
  if (key === ' ' || key === 'Spacebar') key = 'Space'
  if (key === 'Esc') key = 'Escape'
  if (key.length === 1) key = key.toUpperCase()
  const symbol = key.length === 1 && !/[A-Z0-9]/.test(key)
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey && !symbol) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

/** combo に当たる操作（場面に合うものだけ。パス編集中はパス編集の操作を先に） */
export function findShortcuts(combo: string, inPath: boolean): string[] {
  const hits = SHORTCUTS.filter((d) => keysFor(d.id).includes(combo) && (d.scope !== 'path' || inPath))
  return hits.sort((a, b) => (a.scope === 'path' ? 0 : 1) - (b.scope === 'path' ? 0 : 1)).map((d) => d.id)
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

const KEY_NAMES: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Delete: 'Delete',
  Backspace: 'Backspace',
  PageUp: 'PageUp',
  PageDown: 'PageDown'
}

/** 表示用に combo を分けたもの（["Ctrl", "Shift", "S"] など） */
export function comboParts(combo: string): string[] {
  // 最後の + はキーそのもの（"Alt++" の +）
  const m = combo.match(/^((?:(?:Ctrl|Alt|Shift)\+)*)(.+)$/)
  const mods = m ? m[1].split('+').filter(Boolean) : []
  const key = m ? m[2] : combo
  return [...mods.map((p) => (isMac ? ({ Ctrl: '⌘', Alt: '⌥', Shift: '⇧' } as Record<string, string>)[p] ?? p : p)), KEY_NAMES[key] ?? key]
}

export function formatCombo(combo: string): string {
  return comboParts(combo).join(isMac ? '' : '+')
}

/** ツールチップ用：「（V）」のような、いまの最初のキー。割り当てがなければ空 */
export function keyHint(id: string): string {
  const k = keysFor(id)[0]
  return k ? `（${formatCombo(k)}）` : ''
}
