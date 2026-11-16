import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteSelected,
  importImageDialog,
  importImageFile,
  newProject,
  openExport,
  openProject,
  rewind,
  runMenuCommand,
  saveProject,
  selectRelative,
  togglePlay
} from './commands'
import { ExportDialogs } from './components/ExportDialogs'
import { Inspector } from './components/Inspector'
import { PEN_PRESETS } from './components/PenSizePicker'
import { Stage } from './components/Stage'
import { StatusBar } from './components/StatusBar'
import { StrokeList } from './components/StrokeList'
import { Timeline } from './components/Timeline'
import { Toast } from './components/Toast'
import { Toolbar } from './components/Toolbar'
import { buildTimeline } from './engine/wb-engine'
import { isDesktop, setWindowTitle } from './lib/platform'
import { useEditor } from './store'

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return (tag === 'INPUT' && !['checkbox', 'range', 'color'].includes((el as HTMLInputElement).type)) || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export default function App(): React.JSX.Element {
  const project = useEditor((s) => s.project)
  const playing = useEditor((s) => s.playing)
  const dirty = useEditor((s) => s.dirty)
  const filePath = useEditor((s) => s.filePath)
  const [zoom, setZoom] = useState(1)
  const [dragOver, setDragOver] = useState(false)
  const total = useMemo(() => buildTimeline(project).total, [project])
  const onZoomChange = useCallback((z: number) => setZoom(z), [])

  // ---- 再生ループ ----
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number): void => {
      const st = useEditor.getState()
      const t = st.time + (now - last)
      last = now
      if (t >= total) {
        st.setTime(total)
        st.setPlaying(false)
        return
      }
      st.setTime(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, total])

  // ---- ウィンドウタイトル ----
  useEffect(() => {
    const file = filePath ? filePath.split(/[\\/]/).pop() : project.name
    setWindowTitle(`${dirty ? '● ' : ''}${file} — Whiteboard Animation Maker`)
  }, [dirty, filePath, project.name])

  // ---- 閉じる前の確認（ブラウザ版） ----
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (useEditor.getState().dirty && !isDesktop) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // ---- Electron メニュー ----
  useEffect(() => window.desktop?.onMenu(runMenuCommand), [])

  // ---- キーボードショートカット ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e.target) || useEditor.getState().dialog) return
      const st = useEditor.getState()
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()

      if (mod) {
        if (k === 'z' && !e.shiftKey) return void (e.preventDefault(), st.undo())
        if ((k === 'z' && e.shiftKey) || k === 'y') return void (e.preventDefault(), st.redo())
        // デスクトップ版ではメニューのアクセラレータが処理する
        if (isDesktop) return
        if (k === 's') return void (e.preventDefault(), saveProject(e.shiftKey))
        if (k === 'o') return void (e.preventDefault(), openProject())
        if (k === 'n') return void (e.preventDefault(), newProject())
        if (k === 'i') return void (e.preventDefault(), importImageDialog())
        if (k === 'e') return void (e.preventDefault(), openExport(e.shiftKey ? 'video' : 'html'))
        return
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault()
          return togglePlay()
        case 'Home':
          e.preventDefault()
          return rewind()
        case 'Delete':
        case 'Backspace':
          e.preventDefault()
          return deleteSelected()
        case 'Tab':
          e.preventDefault()
          return st.setViewMode(st.viewMode === 'edit' ? 'preview' : 'edit')
        case 'ArrowUp':
          e.preventDefault()
          return selectRelative(-1)
        case 'ArrowDown':
          e.preventDefault()
          return selectRelative(1)
        case 'Escape':
          if (st.rerecordId) return st.setRerecord(null)
          return st.select(null)
        case 'BracketLeft':
        case 'BracketRight': {
          const w = st.project.settings.defaultRevealWidth
          const next = Math.max(4, Math.min(200, Math.round(w * (e.code === 'BracketLeft' ? 0.85 : 1.18))))
          return st.updateSettings({ defaultRevealWidth: next })
        }
      }
      const preset = PEN_PRESETS.find((p) => p.key === e.key)
      if (preset) return st.updateSettings({ defaultRevealWidth: preset.width })
      if (k === 'd') st.setTool('draw')
      else if (k === 'v') st.setTool('select')
      else if (k === 'h') st.setTool('pan')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---- ドラッグ＆ドロップ ----
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) void importImageFile(file)
  }

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      <Toolbar />
      <div className="workspace">
        <StrokeList />
        <main className="center">
          <Stage onZoomChange={onZoomChange} />
        </main>
        <Inspector />
      </div>
      <Timeline />
      <StatusBar zoom={zoom} />
      <ExportDialogs />
      <Toast />
      {dragOver && (
        <div className="drop-overlay" onDragLeave={() => setDragOver(false)}>
          <div>画像（PNG / JPEG / WebP）または .wbanim をドロップ</div>
        </div>
      )}
    </div>
  )
}
