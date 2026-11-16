import { create } from 'zustand'
import { builtinHand } from './engine/handAsset'
import { createProject } from './engine/project'
import type { SelectionOp } from './engine/selection'
import type { ClipRegion, Project, ProjectSettings, Stroke } from './engine/types'

export type Tool = 'draw' | 'select' | 'pan' | 'rect' | 'ellipse' | 'lasso'
export const SELECTION_TOOLS: Tool[] = ['rect', 'ellipse', 'lasso']

/** 元に戻す単位。選択範囲も含める（Photoshop と同じく、選択の失敗も Ctrl+Z で戻せる） */
interface Snapshot {
  project: Project
  selection: ClipRegion | null
}

const HISTORY_LIMIT = 100
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
  selectedId: string | null
  /** 再生ヘッド (ms) */
  time: number
  playing: boolean
  /** プレビュー表示（再生結果）か、編集表示（トレース用）か */
  viewMode: 'edit' | 'preview'
  toast: { id: number; text: string; kind: 'info' | 'error' } | null
  /** 次の録画で置き換える軌跡 */
  rerecordId: string | null
  dialog: 'html' | 'video' | null

  // --- 履歴付きの変更 ---
  /** mergeKey が直前と同じで短時間内なら、履歴を1つにまとめる（スライダー操作用） */
  commit: (fn: (p: Project) => Project, mergeKey?: string) => void
  updateSettings: (patch: Partial<ProjectSettings>) => void
  addStroke: (s: Stroke) => void
  updateStroke: (id: string, patch: Partial<Stroke>) => void
  removeStroke: (id: string) => void
  moveStroke: (id: string, toIndex: number) => void
  setSelection: (sel: ClipRegion | null) => void
  setSelectionMode: (m: SelectionOp) => void
  undo: () => void
  redo: () => void

  // --- 履歴なし ---
  loadProject: (p: Project, filePath: string | null) => void
  markSaved: (filePath: string) => void
  setTool: (t: Tool) => void
  select: (id: string | null) => void
  setTime: (t: number) => void
  setPlaying: (v: boolean) => void
  setViewMode: (v: 'edit' | 'preview') => void
  notify: (text: string, kind?: 'info' | 'error') => void
  setRerecord: (id: string | null) => void
  openDialog: (d: 'html' | 'video' | null) => void
}

export const useEditor = create<EditorState>((set, get) => ({
  project: createProject(),
  filePath: null,
  dirty: false,
  past: [],
  future: [],
  selection: null,
  selectionMode: 'new',
  tool: 'draw',
  selectedId: null,
  time: 0,
  playing: false,
  viewMode: 'edit',
  toast: null,
  rerecordId: null,
  dialog: null,

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
    get().commit((p) => ({ ...p, strokes: [...p.strokes, stroke] }))
    set({ selectedId: stroke.id })
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

  undo: () => {
    const { past, project, selection, future } = get()
    if (past.length === 0) return
    const snap = past[past.length - 1]
    set({
      project: snap.project,
      selection: snap.selection,
      past: past.slice(0, -1),
      future: [{ project, selection }, ...future],
      dirty: snap.project !== project || get().dirty
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
      dirty: snap.project !== project || get().dirty
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
      time: 0,
      playing: false,
      viewMode: 'edit',
      rerecordId: null
    }),
  markSaved: (filePath) => set({ filePath, dirty: false }),
  setTool: (tool) => set({ tool }),
  select: (selectedId) => set({ selectedId }),
  setTime: (time) => set({ time }),
  setPlaying: (playing) => set(playing ? { playing, viewMode: 'preview' } : { playing }),
  setViewMode: (viewMode) => set({ viewMode }),
  notify: (text, kind = 'info') => set({ toast: { id: Date.now(), text, kind } }),
  setRerecord: (rerecordId) => set(rerecordId ? { rerecordId, tool: 'draw', viewMode: 'edit', playing: false } : { rerecordId }),
  openDialog: (dialog) => set({ dialog, playing: false })
}))
