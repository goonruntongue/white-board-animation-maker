import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteSelected,
  deselect,
  invertSelection,
  selectAll,
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
import { RecoveryDialog } from './components/RecoveryDialog'
import { AutoTraceDialog } from './components/AutoTraceDialog'
import { Inspector } from './components/Inspector'
import { PhoneAppBar, PhoneContextBar, PhoneDock } from './components/phone/PhoneChrome'
import { setLiveWidth, stepLivePart } from './components/LiveEditBar'
import { strokeParts } from './engine/strokeParts'
import { ERASER_PRESETS, PEN_MAX, PEN_MIN, PEN_PRESETS } from './components/PenSizePicker'
import { Stage } from './components/Stage'
import { StatusBar } from './components/StatusBar'
import { StrokeList } from './components/StrokeList'
import { Timeline } from './components/Timeline'
import { Toast } from './components/Toast'
import { Toolbar } from './components/Toolbar'
import { UsageGuide } from './components/UsageGuide'
import { Tour } from './components/Tour'
import { getTourPrefs, GUIDE_EVENT, TOUR_EVENT } from './lib/tour'
import { buildTimeline } from './engine/wb-engine'
import { isDesktop, setWindowTitle } from './lib/platform'
import { useIsPhone } from './lib/useMedia'
import { useBarLayout } from './lib/barLayout'
import { beginSession, listSnapshots, startAutosave } from './lib/recovery'
import { SELECTION_TOOLS, useEditor } from './store'

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
  const mobileSheet = useEditor((s) => s.mobileSheet)
  const isPhone = useIsPhone()
  // 描き直し中は、スマホでは下のパネル（タイムライン・ドック）を隠して絵を広く使う
  const rerecording = useEditor((s) => !!s.rerecordId)
  // 手描きのブラシに入ったら（スマホ）、下のタイムラインを隠して絵を広く使う。ほかの操作に移ったら出す。
  // 絵と下のパネルの境目の取っ手（山形の矢印）で、どの操作中でもいつでも出し入れできる。ドックは残す
  const brushMode = useEditor((s) => s.tool === 'live' && s.liveMode === 'brush')
  useEffect(() => {
    useEditor.getState().setTimelineHidden(brushMode)
  }, [brushMode])
  const timelineHidden = useEditor((s) => s.timelineHidden)
  const barLayout = useBarLayout()
  const hasImage = !!project.image
  const [zoom, setZoom] = useState(1)
  const [dragOver, setDragOver] = useState(false)
  // tour = ボタンのそばに出すツアー / guide = 説明カードの「使い方ガイド」
  const [tourOpen, setTourOpen] = useState(false)
  // 使い方ガイド：開いているときは表示する項目（null は先頭）。undefined は閉じている
  const [guideSection, setGuideSection] = useState<string | null | undefined>(undefined)
  const total = useMemo(() => buildTimeline(project).total, [project])
  const onZoomChange = useCallback((z: number) => setZoom(z), [])

  useEffect(() => {
    const openTour = (): void => {
      setGuideSection(undefined)
      useEditor.getState().setMobileSheet(null)
      setTourOpen(true)
    }
    const openGuideCard = (e: Event): void => {
      setTourOpen(false)
      setGuideSection((e as CustomEvent<string | null>).detail ?? null)
    }
    window.addEventListener(TOUR_EVENT, openTour)
    window.addEventListener(GUIDE_EVENT, openGuideCard)
    return () => {
      window.removeEventListener(TOUR_EVENT, openTour)
      window.removeEventListener(GUIDE_EVENT, openGuideCard)
    }
  }, [])

  // 起動時のツアー：「次回から表示しない」にしていなければ出す。
  // 復元ダイアログなどが開いていたら、閉じてから出す
  useEffect(() => {
    if (!getTourPrefs().showOnStartup) return
    let shown = false
    const tryOpen = (): void => {
      if (shown || useEditor.getState().dialog) return
      shown = true
      setTourOpen(true)
    }
    const timer = window.setTimeout(tryOpen, 700)
    const unsub = useEditor.subscribe((s, prev) => {
      if (prev.dialog && !s.dialog) window.setTimeout(tryOpen, 300)
    })
    return () => {
      window.clearTimeout(timer)
      unsub()
    }
  }, [])

  // ---- 自動バックアップ（異常終了していたら、起動時に復元を案内） ----
  useEffect(() => {
    const { crashed } = beginSession()
    const stop = startAutosave()
    if (crashed) {
      void listSnapshots().then((list) => {
        if (list.length > 0) useEditor.getState().openDialog('recovery')
      })
    }
    return stop
  }, [])
  const dialog = useEditor((s) => s.dialog)

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
      if (isTyping(e.target) || useEditor.getState().dialog || guideSection !== undefined) return
      const st = useEditor.getState()
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()

      if (mod) {
        if (k === 'z' && !e.shiftKey) return void (e.preventDefault(), st.undo())
        if ((k === 'z' && e.shiftKey) || k === 'y') return void (e.preventDefault(), st.redo())
        // 選択範囲（Photoshop と同じキー）
        if (k === 'd' && !e.shiftKey) return void (e.preventDefault(), deselect())
        // 選択ツールのときだけ Ctrl+A でキャンバス全体を選択（入力欄では通常の全選択のまま）
        if (k === 'a' && SELECTION_TOOLS.includes(st.tool)) return void (e.preventDefault(), selectAll())
        if (k === 'i' && e.shiftKey) return void (e.preventDefault(), invertSelection())
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
        case 'PageUp':
          e.preventDefault()
          return st.gotoPage(st.project.pageIndex - 1)
        case 'PageDown':
          e.preventDefault()
          return st.gotoPage(st.project.pageIndex + 1)
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
          if (st.livePart) return st.setLivePart(null)
          return st.select(null)
      }
      // ペン先サイズ: [ で小さく / ] で大きく。
      // e.code は物理キー位置（US配列基準）なので、JIS配列では [ が「@」キーになってしまう。
      // 入力される文字（e.key）で判定し、念のため keyCode（[ = 219, ] = 221）も見る。
      // 消しゴムツールのときは消しゴムの大きさ、それ以外はペン先
      const sizeKey = st.tool === 'erase' ? 'eraserWidth' : 'defaultRevealWidth'
      const bracket = e.key === '[' || e.keyCode === 219 ? -1 : e.key === ']' || e.keyCode === 221 ? 1 : 0
      // ライブ編集で線を選んでいるときは、[ ] でその線の太さ、 , . で前後の線へ
      if (st.tool === 'live') {
        const lp = st.livePart
        const stroke = lp ? st.project.strokes.find((s) => s.id === lp.strokeId) : undefined
        const part = stroke && lp ? strokeParts(stroke)[lp.part] : undefined
        if (bracket !== 0 && part) {
          e.preventDefault()
          return setLiveWidth(Math.max(1, Math.round(part.width * (bracket < 0 ? 0.88 : 1.14))) + (bracket > 0 && part.width < 8 ? 1 : 0))
        }
        if (e.key === ',' || e.key === '.') {
          e.preventDefault()
          return stepLivePart(e.key === ',' ? -1 : 1)
        }
      }
      if (bracket !== 0) {
        e.preventDefault()
        const w = st.project.settings[sizeKey]
        const next = Math.max(PEN_MIN, Math.min(PEN_MAX, Math.round(w * (bracket < 0 ? 0.85 : 1.18))))
        return st.updateSettings({ [sizeKey]: next })
      }
      const preset = (st.tool === 'erase' ? ERASER_PRESETS : PEN_PRESETS).find((p) => p.key === e.key)
      if (preset) return st.updateSettings({ [sizeKey]: preset.width })
      if (k === 'd') {
        // 描く＝直すのブラシ（何も選んでいなければ、新しいグループを描く）
        st.setTool('live')
        st.setLiveMode('brush')
      }
      else if (k === 'e') st.setTool('erase')
      else if (k === 'm') st.setTool(e.shiftKey ? 'ellipse' : 'rect')
      else if (k === 'l') st.setTool('lasso')
      else if (k === 'v') st.setTool('select')
      else if (k === 'h') st.setTool('pan')
      else if (k === 'w') st.setTool('live')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [guideSection])

  // ---- ドラッグ＆ドロップ ----
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    // 複数の画像を落としたら、順番にページとして追加する
    const files = Array.from(e.dataTransfer.files)
    void (async () => {
      for (const file of files) await importImageFile(file)
    })()
  }

  return (
    <div
      className={`app ${isPhone ? 'phone' : ''} ${hasImage ? 'has-image' : ''} ${rerecording ? 'rerecording' : ''} ${isPhone && timelineHidden ? 'tl-hidden' : ''} ${isPhone && barLayout === 'one' ? 'bar-one' : ''}`}
      data-sheet={mobileSheet ?? undefined}
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
      {isPhone ? (
        <>
          <PhoneAppBar />
          <PhoneContextBar />
        </>
      ) : (
        <Toolbar />
      )}
      <div className="workspace">
        <StrokeList />
        <main className="center">
          <Stage onZoomChange={onZoomChange} />
        </main>
        <Inspector />
        {isPhone && hasImage && !rerecording && (
          // 絵と下のパネルの境目に常にある取っ手：押すとタイムラインを出し入れする
          <button
            className={`tl-handle ${timelineHidden ? 'closed' : ''}`}
            aria-label={timelineHidden ? 'タイムラインを出す' : 'タイムラインを隠す'}
            aria-expanded={!timelineHidden}
            onClick={() => useEditor.getState().setTimelineHidden(!timelineHidden)}
          >
            <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true">
              <path d="M3 3 L11 9 L19 3" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
      <Timeline />
      {isPhone ? <PhoneDock /> : <StatusBar zoom={zoom} />}
      <ExportDialogs />
      {dialog === 'recovery' && <RecoveryDialog />}
      {dialog === 'auto' && <AutoTraceDialog />}
      <Toast />
      {tourOpen && <Tour isPhone={isPhone} onClose={() => setTourOpen(false)} />}
      {guideSection !== undefined && <UsageGuide section={guideSection} onClose={() => setGuideSection(undefined)} />}
      {dragOver && (
        <div className="drop-overlay" onDragLeave={() => setDragOver(false)}>
          <div>画像（PNG / JPEG / WebP）または .wbanim をドロップ</div>
        </div>
      )}
    </div>
  )
}
