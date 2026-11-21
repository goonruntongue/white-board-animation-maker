import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteSelected,
  deselect,
  invertSelection,
  selectAll,
  importImageDialog,
  importImageFile,
  newProject,
  openAutoTrace,
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
import { HintLayer } from './components/HintLayer'
import { Toast } from './components/Toast'
import { OptionsBar, Toolbar } from './components/Toolbar'
import { UsageGuide } from './components/UsageGuide'
import { Tour } from './components/Tour'
import { getTourPrefs, GUIDE_EVENT, openGuide, TOUR_EVENT } from './lib/tour'
import { comboFromEvent, findShortcuts } from './lib/shortcuts'
import { brushWidthFor, selectedLine } from './lib/brushMode'
import { openPrefs, openShortcuts } from './lib/panels'
import { fitTimelineZoom, stepTimelineZoom } from './lib/timelineZoom'
import { buildTimeline } from './engine/wb-engine'
import { isDesktop, setWindowTitle } from './lib/platform'
import { runToolForAi } from './automation'
import { startWebMcp } from './lib/webMcp'
import { useIsPhone } from './lib/useMedia'
import { useBarLayout } from './lib/barLayout'
import { setPathTool } from './lib/pathTool'
import { finishRange, startRange } from './components/phone/RangeButton'
import { beginSession, listSnapshots, startAutosave } from './lib/recovery'
import { SELECTION_TOOLS, useEditor } from './store'

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return (tag === 'INPUT' && !['checkbox', 'range', 'color'].includes((el as HTMLInputElement).type)) || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/** 手描きの操作に切り替える（描き直しの途中ならやめてから） */
function liveMode(m: 'move' | 'brush' | 'erase' | 'path'): void {
  const st = useEditor.getState()
  if (!st.project.image) return
  if (st.rerecordId) st.setRerecord(null)
  if (st.tool !== 'live') st.setTool('live')
  st.setLiveMode(m)
}

/**
 * [ ] で大きさを変える。
 *  ・ブラシ：これから描くブラシの太さ（線を選んでいれば、その線を描き直す・足すときの太さ。すでにある線の太さは変えない）
 *  ・消しゴム：消しゴムの大きさ
 *  ・選ぶ・動かす／パス編集：選んでいる線の太さ
 */
function stepSize(dir: -1 | 1): void {
  const st = useEditor.getState()
  const scaled = (w: number): number => Math.max(PEN_MIN, Math.min(PEN_MAX, Math.round(w * (dir < 0 ? 0.85 : 1.18)) + (dir > 0 && w < 8 ? 1 : 0)))
  if (st.tool === 'live' && st.liveMode === 'brush') {
    const next = scaled(brushWidthFor(st))
    if (selectedLine(st)) st.setLineBrushWidth(next)
    else st.updateSettings({ defaultRevealWidth: next })
    return
  }
  if (st.tool === 'live' && st.liveMode === 'erase') return st.updateSettings({ eraserWidth: scaled(st.project.settings.eraserWidth) })
  if (st.tool === 'live') {
    const lp = st.livePart
    const stroke = lp ? st.project.strokes.find((s) => s.id === lp.strokeId) : undefined
    const part = stroke && lp ? strokeParts(stroke)[lp.part] : undefined
    if (part) return setLiveWidth(Math.max(1, Math.round(part.width * (dir < 0 ? 0.88 : 1.14))) + (dir > 0 && part.width < 8 ? 1 : 0))
  }
  const sizeKey = st.tool === 'erase' ? 'eraserWidth' : 'defaultRevealWidth'
  const w = st.project.settings[sizeKey]
  st.updateSettings({ [sizeKey]: Math.max(PEN_MIN, Math.min(PEN_MAX, Math.round(w * (dir < 0 ? 0.85 : 1.18)))) })
}

/** ショートカットの操作を実行する。その場面で効かないときは false（キーをほかに回す） */
function runShortcut(id: string): boolean | void {
  const st = useEditor.getState()
  const hasImage = !!st.project.image
  switch (id) {
    // ツール
    case 'tool.move':
      return liveMode('move')
    case 'tool.brush':
      return liveMode('brush')
    case 'tool.erase':
      return liveMode('erase')
    case 'tool.path':
      return liveMode('path')
    case 'tool.live':
      return void (hasImage && st.setTool('live'))
    case 'tool.groupSelect':
      return void (hasImage && st.setTool('select'))
    case 'tool.groupErase':
      return void (hasImage && st.setTool('erase'))
    case 'tool.hand':
      return void (hasImage && st.setTool('pan'))
    case 'tool.rect':
      return startRange('rect')
    case 'tool.ellipse':
      return startRange('ellipse')
    case 'tool.lasso':
      return startRange('lasso')
    // パス編集
    case 'path.direct':
      return setPathTool('direct')
    case 'path.convert':
      return setPathTool('convert')
    case 'path.addDel':
      return setPathTool('addDel')
    // 線・グループ
    case 'line.prevGroup':
      return selectRelative(-1)
    case 'line.nextGroup':
      return selectRelative(1)
    case 'line.prev':
    case 'line.next':
      if (st.tool !== 'live') return false
      return stepLivePart(id === 'line.prev' ? -1 : 1)
    case 'size.down':
      return stepSize(-1)
    case 'size.up':
      return stepSize(1)
    case 'edit.newGroup':
      if (!hasImage) return false
      if (st.rerecordId) st.setRerecord(null)
      st.startNewGroup()
      return st.notify('次になぞった線から、新しいグループになります')
    case 'edit.delete':
      return deleteSelected()
    // 再生・表示
    case 'play.toggle':
      return togglePlay()
    case 'play.rewind':
      return rewind()
    case 'view.toggle':
      return st.setViewMode(st.viewMode === 'edit' ? 'preview' : 'edit')
    case 'page.prev':
      return st.gotoPage(st.project.pageIndex - 1)
    case 'page.next':
      return st.gotoPage(st.project.pageIndex + 1)
    // タイムライン
    case 'timeline.zoomIn':
      return stepTimelineZoom(1.5)
    case 'timeline.zoomOut':
      return stepTimelineZoom(1 / 1.5)
    case 'timeline.fit':
      return fitTimelineZoom()
    // 選択範囲（Ctrl+A は範囲の道具のときだけ。ほかでは使わない）
    case 'sel.all':
      if (!SELECTION_TOOLS.includes(st.tool)) return false
      return selectAll()
    case 'sel.deselect':
      return deselect()
    case 'sel.invert':
      return invertSelection()
    // 編集
    case 'edit.undo':
      return st.undo()
    case 'edit.redo':
      return st.redo()
    case 'edit.autoTrace':
      return void (hasImage && openAutoTrace())
    case 'edit.prefs':
      return openPrefs()
    case 'edit.shortcuts':
      return openShortcuts()
    // ファイル
    case 'file.new':
      return newProject()
    case 'file.open':
      return void openProject()
    case 'file.save':
      return void saveProject(false)
    case 'file.saveAs':
      return void saveProject(true)
    case 'file.import':
      return void importImageDialog()
    case 'file.exportHtml':
      return openExport('html')
    case 'file.exportVideo':
      return openExport('video')
    // ヘルプ
    case 'help.guide':
      return openGuide()
  }
  return false
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
  // AI 連携（MCP）：Web 版は Cloudflare の中継につなぐ（オンにしてあるときだけ）
  useEffect(() => {
    if (!isDesktop) startWebMcp()
  }, [])
  // AI 連携（MCP）：デスクトップ版のエンドポイントに届いた道具の呼び出しを実行して返す
  useEffect(
    () =>
      window.desktop?.mcp.onCall(({ id, name, args }) => {
        void runToolForAi(name, args).then((outcome) => window.desktop?.mcp.reply(id, outcome))
      }),
    []
  )

  // ---- キーボードショートカット（割り当ては lib/shortcuts.ts。キーボードショートカットの画面で変えられる） ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e.target) || useEditor.getState().dialog || guideSection !== undefined) return
      const st = useEditor.getState()
      const inPath = st.tool === 'live' && st.liveMode === 'path'
      // パス編集の Alt：押しているあいだだけアンカーポイントの切り替え。Windows で Alt を離したときにメニューへ移らないようにする
      if (e.key === 'Alt' && inPath) return void e.preventDefault()

      // 変えられないキー
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.code === 'Enter' || e.code === 'NumpadEnter') {
          // 範囲の道具：囲み終えたら Enter で前の道具に戻る（多角形の投げ縄を打っている途中は、絵の側で確定する）
          if (SELECTION_TOOLS.includes(st.tool)) return void (e.preventDefault(), finishRange())
        } else if (e.code === 'Escape') {
          if (st.rerecordId) return st.setRerecord(null)
          if (st.livePart) return st.setLivePart(null)
          return st.select(null)
        }
        // 大きさのプリセット（1〜5）。消しゴムのときは消しゴムの大きさ
        const sizeKey = st.tool === 'erase' ? 'eraserWidth' : 'defaultRevealWidth'
        const preset = (st.tool === 'erase' ? ERASER_PRESETS : PEN_PRESETS).find((p) => p.key === e.key)
        if (preset) return void (e.preventDefault(), st.updateSettings({ [sizeKey]: preset.width }))
      }

      const combo = comboFromEvent(e)
      if (!combo) return
      for (const id of findShortcuts(combo, inPath)) {
        if (runShortcut(id) !== false) return void e.preventDefault()
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      const st = useEditor.getState()
      if (e.key === 'Alt' && st.tool === 'live' && st.liveMode === 'path') e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
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
      className={`app ${isPhone ? 'phone' : ''} ${hasImage ? 'has-image' : ''} ${rerecording ? 'rerecording' : ''} ${isPhone && timelineHidden ? 'tl-hidden' : ''} ${isPhone && barLayout === 'one' ? 'bar-one' : ''} ${!isPhone && barLayout === 'two' ? 'pc-two' : ''}`}
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
        <>
          <Toolbar />
          {barLayout === 'two' && <OptionsBar />}
        </>
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
      <HintLayer phone={isPhone} />
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
