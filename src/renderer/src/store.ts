import { create } from 'zustand'
import { builtinHand } from './engine/handAsset'
import { mergeStrokes, removeStrokePart, splitStrokeAt, strokeParts } from './engine/strokeParts'
import { addPage, createProject, duplicatePage, movePage, newId, removePage, switchPage } from './engine/project'
import type { SelectionOp } from './engine/selection'
import type { PathNode } from './engine/pathEdit'
import type { ClipRegion, ImageAsset, Project, ProjectSettings, Stroke, StrokePoint } from './engine/types'

/** live：ライブ編集（絵の上の線をタップして選び、太さなどをその場で直す） */
export type Tool = 'draw' | 'erase' | 'select' | 'pan' | 'rect' | 'ellipse' | 'lasso' | 'live'
export const SELECTION_TOOLS: Tool[] = ['rect', 'ellipse', 'lasso']

/** 元に戻す単位。選択範囲も含める（Photoshop と同じく、選択の失敗も Ctrl+Z で戻せる） */
interface Snapshot {
  project: Project
  selection: ClipRegion | null
}

const HISTORY_LIMIT = 100
/** ページが変わったら、前のページ用の選択・再生位置などは持ち越さない */
const PAGE_RESET = { selectedId: null, livePart: null, livePath: null, selection: null, time: 0, playing: false, rerecordId: null, rerecordPart: null, insertBefore: null, viewMode: 'edit' as const }
let lastMerge: { key?: string; at: number } = { at: 0 }

interface EditorState {
  project: Project
  /** 保存先パス（デスクトップ版のみ） */
  filePath: string | null
  dirty: boolean
  past: Snapshot[]
  future: Snapshot[]
  /** 現在の選択範囲。この状態で描いた軌跡は範囲の外を見せない */
  selection: ClipRegion | null
  /** 選択ツールの合成モード（オプションバーで切り替え。Shift / Alt はこれより優先） */
  selectionMode: SelectionOp

  tool: Tool
  /** 最後に使った選択ツール（スマホのドックの「範囲」ボタン用） */
  lastSelTool: 'rect' | 'ellipse' | 'lasso'
  selectedId: string | null
  /** ライブ編集で選んでいる線（軌跡の中の、ペンを下ろしてから上げるまでの区間） */
  livePart: { strokeId: string; part: number } | null
  /**
   * ブラシで続けて書いている最中のグループ（手描きで何も選ばずに描いたとき）。
   * 少し間に（近くから）次の線を書き始めると、同じグループに入る。区切る・時間が空く・離れた所から書くと、新しいグループ
   */
  drawChain: { id: string; at: number; x: number; y: number } | null
  /** スマホ：ブラシ中に隠しているタイムラインを、一時的に出しているか */
  timelinePeek: boolean
  /**
   * ライブ編集の操作：move＝タップで選び、ドラッグで動かす / brush＝なぞった所を選んだ軌跡に足す / erase＝消しゴムで消す /
   * path＝線をアンカーとハンドルの曲線として編集する
   */
  liveMode: 'move' | 'brush' | 'erase' | 'path'
  /**
   * パス編集中の線の曲線。pointsRef は、この曲線から点を作り直したときの軌跡の点の配列（元に戻すなどで
   * 軌跡が変わったら、点の並びから曲線を作り直す目印）
   */
  livePath: { strokeId: string; part: number; nodes: PathNode[]; pointsRef: StrokePoint[]; selected: number | null } | null
  /** ライブ編集で選ぶ単位：stroke＝軌跡まるごと / part＝軌跡の中の1本の線 */
  liveUnit: 'stroke' | 'part'
  /** 再生ヘッド (ms) */
  time: number
  insertBefore: { id: string | null } | null
  setInsertBefore: (value: { id: string | null } | null) => void
  playing: boolean
  /** プレビュー表示（再生結果）か、編集表示（トレース用）か */
  viewMode: 'edit' | 'preview'
  toast: { id: number; text: string; kind: 'info' | 'error' } | null
  /** 次の録画で置き換える軌跡 */
  rerecordId: string | null
  rerecordPart: number | null
  dialog: 'html' | 'video' | 'recovery' | 'auto' | null
  /** スマホ表示で開いている下部シート */
  mobileSheet: 'strokes' | 'inspector' | null

  // --- 履歴付きの変更 ---
  /** mergeKey が直前と同じで短時間内なら、履歴を1つにまとめる（スライダー操作用） */
  commit: (fn: (p: Project) => Project, mergeKey?: string) => void
  updateSettings: (patch: Partial<ProjectSettings>) => void
  addStroke: (s: Stroke) => void
  updateStroke: (id: string, patch: Partial<Stroke>) => void
  removeStroke: (id: string) => void
  moveStroke: (id: string, toIndex: number) => void
  /** すぐ後ろに複製を作り、それを選ぶ */
  duplicateStroke: (id: string) => void
  /** となりの軌跡と1本にまとめる（dir：前と／次と）。まとめた軌跡を選ぶ */
  mergeStroke: (id: string, dir: 'prev' | 'next') => void
  /** グループから1本の線を消す（線が1本だけなら、グループごと消す） */
  removeLine: (id: string, part: number) => void
  /** グループを、part 番目の線の手前で2つに分ける */
  splitGroup: (id: string, part: number) => void
  mergeSelectedStrokes: (ids: string[]) => boolean
  setSelection: (sel: ClipRegion | null) => void
  // --- ページ（スライド） ---
  /** ページを切り替える（履歴には残さない・未保存扱いにもしない） */
  gotoPage: (index: number) => void
  addPage: (image: ImageAsset | null) => void
  deletePage: (index: number) => void
  movePage: (from: number, to: number) => void
  duplicatePage: (index: number) => void
  setSelectionMode: (m: SelectionOp) => void
  undo: () => void
  redo: () => void

  // --- 履歴なし ---
  loadProject: (p: Project, filePath: string | null) => void
  markSaved: (filePath: string) => void
  setTool: (t: Tool) => void
  select: (id: string | null) => void
  setLivePart: (part: { strokeId: string; part: number } | null) => void
  setLiveMode: (m: 'move' | 'brush' | 'erase' | 'path') => void
  setLivePath: (p: EditorState['livePath']) => void
  setDrawChain: (c: EditorState['drawChain']) => void
  setTimelinePeek: (v: boolean) => void
  setLiveUnit: (u: 'stroke' | 'part') => void
  setTime: (t: number) => void
  setPlaying: (v: boolean) => void
  setViewMode: (v: 'edit' | 'preview') => void
  notify: (text: string, kind?: 'info' | 'error') => void
  setRerecord: (id: string | null) => void
  setRerecordPart: (id: string, part: number) => void
  openDialog: (d: 'html' | 'video' | 'recovery' | 'auto' | null) => void
  setMobileSheet: (s: 'strokes' | 'inspector' | null) => void
}

export const useEditor = create<EditorState>((set, get) => ({
  project: createProject(),
  filePath: null,
  dirty: false,
  past: [],
  future: [],
  selection: null,
  selectionMode: 'new',
  tool: 'live',
  lastSelTool: 'rect',
  selectedId: null,
  livePart: null,
  liveMode: 'brush',
  livePath: null,
  drawChain: null,
  timelinePeek: false,
  liveUnit: 'part', // 直すは、いつも1本の線ごと（グループをまとめて扱うのは、タイムライン・描き順・設定）
  time: 0,
  insertBefore: null,
  setInsertBefore: (insertBefore) => set({ insertBefore }),
  playing: false,
  viewMode: 'edit',
  toast: null,
  rerecordId: null,
  rerecordPart: null,
  dialog: null,
  mobileSheet: null,

  commit: (fn, mergeKey) => {
    const prev = get().project
    const next = fn(prev)
    if (next === prev) return
    const snap: Snapshot = { project: prev, selection: get().selection }
    const now = Date.now()
    const merge = mergeKey !== undefined && mergeKey === lastMerge.key && now - lastMerge.at < 800
    lastMerge = { key: mergeKey, at: now }
    set((s) => ({
      project: next,
      past: merge ? s.past : [...s.past, snap].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true
    }))
  },

  updateSettings: (patch) =>
    get().commit((p) => {
      const settings = { ...p.settings, ...patch }
      // 内蔵の手素材はペン色に合わせて作り直す
      const hand = patch.penColor && p.hand.builtin ? builtinHand(patch.penColor) : p.hand
      return { ...p, settings, hand }
    }, 'settings:' + Object.keys(patch).join(',')),

  addStroke: (stroke) => {
    const target = get().insertBefore
    get().commit((p) => {
      const strokes = [...p.strokes]
      const index = target?.id ? strokes.findIndex((s) => s.id === target.id) : -1
      strokes.splice(index < 0 ? strokes.length : index, 0, stroke)
      return { ...p, strokes }
    })
    set({ selectedId: stroke.id, insertBefore: null })
  },

  updateStroke: (id, patch) =>
    get().commit(
      (p) => ({ ...p, strokes: p.strokes.map((s) => (s.id === id ? { ...s, ...patch } : s)) }),
      'stroke:' + id + ':' + Object.keys(patch).join(',')
    ),

  removeStroke: (id) => {
    const { project, selectedId } = get()
    const idx = project.strokes.findIndex((s) => s.id === id)
    if (idx < 0) return
    get().commit((p) => ({ ...p, strokes: p.strokes.filter((s) => s.id !== id) }))
    if (selectedId === id) {
      const rest = get().project.strokes
      set({ selectedId: rest[Math.min(idx, rest.length - 1)]?.id ?? null })
    }
  },

  moveStroke: (id, toIndex) =>
    get().commit((p) => {
      const from = p.strokes.findIndex((s) => s.id === id)
      if (from < 0) return p
      const to = Math.max(0, Math.min(p.strokes.length - 1, toIndex))
      if (from === to) return p
      const strokes = [...p.strokes]
      const [item] = strokes.splice(from, 1)
      strokes.splice(to, 0, item)
      return { ...p, strokes }
    }),

  setSelection: (selection) => {
    const { project, selection: prev } = get()
    if (selection === prev) return
    lastMerge = { at: 0 }
    set((s) => ({
      selection,
      past: [...s.past, { project, selection: prev }].slice(-HISTORY_LIMIT),
      future: []
    }))
  },

  setSelectionMode: (selectionMode) => set({ selectionMode }),

  duplicateStroke: (id) => {
    const { project } = get()
    const idx = project.strokes.findIndex((s) => s.id === id)
    if (idx < 0) return
    const src = project.strokes[idx]
    const copy = { ...src, id: newId(), name: `${src.name} のコピー`, points: src.points.map((p) => ({ ...p })) }
    get().commit((p) => {
      const strokes = [...p.strokes]
      strokes.splice(idx + 1, 0, copy)
      return { ...p, strokes }
    })
    set({ selectedId: copy.id })
  },

  removeLine: (id, part) => {
    const stroke = get().project.strokes.find((s) => s.id === id)
    if (!stroke) return
    const updated = removeStrokePart(stroke, part)
    if (!updated) {
      set({ livePart: null, livePath: null })
      get().removeStroke(id)
      return
    }
    get().commit((p) => ({ ...p, strokes: p.strokes.map((s) => (s.id === id ? updated : s)) }))
    const count = strokeParts(updated).length
    set({ selectedId: id, livePart: { strokeId: id, part: Math.min(part, count - 1) }, livePath: null })
  },

  splitGroup: (id, part) => {
    const stroke = get().project.strokes.find((s) => s.id === id)
    if (!stroke) return
    const pair = splitStrokeAt(stroke, part, newId())
    if (!pair) return
    get().commit((p) => {
      const strokes = [...p.strokes]
      const i = strokes.findIndex((s) => s.id === id)
      strokes.splice(i, 1, pair[0], pair[1])
      return { ...p, strokes }
    })
    set({ selectedId: pair[1].id, livePart: { strokeId: pair[1].id, part: 0 }, livePath: null })
  },

  mergeStroke: (id, dir) => {
    const { project } = get()
    const idx = project.strokes.findIndex((s) => s.id === id)
    const other = dir === 'prev' ? idx - 1 : idx + 1
    if (idx < 0 || other < 0 || other >= project.strokes.length) return
    const i0 = Math.min(idx, other)
    const merged = mergeStrokes(project.strokes[i0], project.strokes[i0 + 1])
    get().commit((p) => {
      const strokes = [...p.strokes]
      strokes.splice(i0, 2, merged)
      return { ...p, strokes }
    })
    set({ selectedId: merged.id, livePart: null })
  },

  mergeSelectedStrokes: (ids) => {
    const { project } = get()
    const chosen = new Set(ids)
    const indices = project.strokes.flatMap((s, i) => chosen.has(s.id) ? [i] : [])
    if (indices.length < 2 || indices.length !== chosen.size || indices[indices.length - 1] - indices[0] + 1 !== indices.length) return false
    const strokes = indices.map((i) => project.strokes[i])
    if (strokes.some((s) => !!s.hidden !== !!strokes[0].hidden || !s.points.length)) return false
    const merged = strokes.slice(1).reduce((first, second) => mergeStrokes(first, second), strokes[0])
    get().commit((p) => {
      const next = [...p.strokes]
      next.splice(indices[0], indices.length, merged)
      return { ...p, strokes: next }
    })
    set({ selectedId: merged.id, livePart: null, livePath: null })
    return true
  },

  gotoPage: (index) => {
    const p = get().project
    if (index === p.pageIndex || index < 0 || index >= p.pages.length) return
    set({ project: switchPage(p, index), ...PAGE_RESET })
  },
  addPage: (image) => {
    get().commit((p) => addPage(p, image))
    set(PAGE_RESET)
  },
  deletePage: (index) => {
    get().commit((p) => removePage(p, index))
    set(PAGE_RESET)
  },
  movePage: (from, to) => get().commit((p) => movePage(p, from, to)),
  duplicatePage: (index) => {
    get().commit((p) => duplicatePage(p, index))
    set(PAGE_RESET)
  },

  undo: () => {
    const { past, project, selection, future } = get()
    if (past.length === 0) return
    const snap = past[past.length - 1]
    set({
      project: snap.project,
      selection: snap.selection,
      past: past.slice(0, -1),
      future: [{ project, selection }, ...future],
      dirty: snap.project !== project || get().dirty,
      ...(snap.project.pageIndex !== project.pageIndex ? { selectedId: null, time: 0, playing: false } : {})
    })
  },

  redo: () => {
    const { past, project, selection, future } = get()
    if (future.length === 0) return
    const snap = future[0]
    set({
      project: snap.project,
      selection: snap.selection,
      past: [...past, { project, selection }],
      future: future.slice(1),
      dirty: snap.project !== project || get().dirty,
      ...(snap.project.pageIndex !== project.pageIndex ? { selectedId: null, time: 0, playing: false } : {})
    })
  },

  loadProject: (p, filePath) =>
    set({
      project: p,
      filePath,
      dirty: false,
      past: [],
      future: [],
      selection: null,
      selectedId: null,
      livePart: null,
      livePath: null,
      time: 0,
      insertBefore: null,
      playing: false,
      viewMode: 'edit',
      rerecordId: null
    }),
  markSaved: (filePath) => set({ filePath, dirty: false }),
  setTool: (tool) =>
    set(
      tool === 'rect' || tool === 'ellipse' || tool === 'lasso'
        ? { tool, lastSelTool: tool }
        : tool === 'live'
          ? { tool, playing: false, viewMode: 'edit' } // 手描きは、止めた状態の絵の上で行う
          : { tool }
    ),
  // グループを選ぶと、その最初の線も選ばれる（同じグループの線を選んでいれば、そのまま）
  select: (selectedId) =>
    set((s) => ({
      selectedId,
      livePart: !selectedId ? null : s.livePart?.strokeId === selectedId ? s.livePart : { strokeId: selectedId, part: 0 },
      livePath: s.livePart?.strokeId === selectedId ? s.livePath : null
    })),
  setLiveMode: (liveMode) => set({ liveMode, livePath: null }),
  setLivePath: (livePath) => set({ livePath }),
  setDrawChain: (drawChain) => set({ drawChain }),
  setTimelinePeek: (timelinePeek) => set({ timelinePeek }),
  setLiveUnit: (liveUnit) => set((s) => ({ liveUnit, livePart: s.livePart ? { ...s.livePart, part: liveUnit === 'stroke' ? 0 : s.livePart.part } : null })),
  setLivePart: (livePart) => set(livePart ? { livePart, selectedId: livePart.strokeId } : { livePart }),
  setTime: (time) => set({ time }),
  setPlaying: (playing) => set(playing ? { playing, viewMode: 'preview' } : { playing }),
  setViewMode: (viewMode) => set({ viewMode }),
  notify: (text, kind = 'info') => set({ toast: { id: Date.now(), text, kind } }),
  setRerecord: (rerecordId) => set(rerecordId ? { rerecordId, rerecordPart: null, tool: 'draw', viewMode: 'edit', playing: false } : { rerecordId, rerecordPart: null }),
  setRerecordPart: (rerecordId, rerecordPart) => set({ rerecordId, rerecordPart, tool: 'draw', viewMode: 'edit', playing: false }),
  openDialog: (dialog) => set({ dialog, playing: false }),
  setMobileSheet: (mobileSheet) => set({ mobileSheet })
}))
