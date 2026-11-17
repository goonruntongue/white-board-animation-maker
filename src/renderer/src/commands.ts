// メニュー・ツールバー・ショートカットから共通で呼ぶ操作。
import { builtinHand } from './engine/handAsset'
import { defaultHand, findPreset } from './engine/handPresets'
import { allPages, createProject, parseProject, PROJECT_EXT, serializeProject } from './engine/project'
import { addAreaErase, invert } from './engine/selection'
import { buildTimeline, rasterizeClip } from './engine/wb-engine'
import { setThemePref, type ThemePref } from './lib/theme'
import { openGuide, startTour } from './lib/tour'
import { importHand, importImage } from './lib/imageTools'
import { openImageFile, openProjectFile, readFileAsDataUrl, saveTextFile } from './lib/platform'
import { useEditor } from './store'
import sampleGuideUrl from './sample-guide.png'

const get = useEditor.getState

function confirmDiscard(): boolean {
  if (!get().dirty) return true
  return window.confirm('保存されていない変更があります。破棄してよろしいですか？')
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function newProject(): void {
  if (!confirmDiscard()) return
  get().loadProject(createProject(), null)
}

export async function openProject(): Promise<void> {
  if (!confirmDiscard()) return
  try {
    const res = await openProjectFile()
    if (!res) return
    loadProjectText(res.text, res.path)
  } catch (e) {
    get().notify('プロジェクトを開けませんでした: ' + errorText(e), 'error')
  }
}

export function loadProjectText(text: string, path: string | null): void {
  try {
    get().loadProject(parseProject(text), path)
    get().notify('プロジェクトを開きました')
  } catch (e) {
    get().notify('プロジェクトを開けませんでした: ' + errorText(e), 'error')
  }
}

export async function saveProject(saveAs = false): Promise<void> {
  const { project, filePath } = get()
  try {
    const saved = await saveTextFile(
      serializeProject(project),
      `${project.name}.${PROJECT_EXT}`,
      [{ name: 'Whiteboard Animation Project', extensions: [PROJECT_EXT] }],
      saveAs ? undefined : (filePath ?? undefined)
    )
    if (saved) {
      get().markSaved(saved)
      get().notify('保存しました')
    }
  } catch (e) {
    get().notify('保存に失敗しました: ' + errorText(e), 'error')
  }
}

/**
 * 画像を読み込む。
 * いまのページが空ならそこへ入れ、すでに画像があるなら新しいページとして後ろに足す。
 * replace = true のときは、いまのページの画像を差し替える（描き順は残す）。
 */
export async function setImageFromDataUrl(name: string, dataUrl: string, replace = false): Promise<void> {
  try {
    const { asset, resized } = await importImage(name, dataUrl)
    const st = get()
    const asNewPage = !replace && !!st.project.image
    if (asNewPage) {
      st.addPage(asset)
    } else {
      const firstImage = !st.project.image && st.project.pages.length === 1
      st.commit((p) => ({ ...p, image: asset, name: firstImage ? name.replace(/\.[^.]+$/, '') : p.name }))
      st.setViewMode('edit')
      st.setTime(0)
    }
    const page = get().project.pageIndex + 1
    get().notify(
      asNewPage
        ? `ページ ${page} として追加しました`
        : resized
          ? `画像を読み込みました（大きいため ${asset.width}×${asset.height} に縮小）`
          : replace
            ? '画像を差し替えました（軌跡はそのまま残っています）'
            : '画像を読み込みました。「自動」で描き順を作るか、「描く」ツールでなぞってください'
    )
  } catch (e) {
    get().notify('画像を読み込めませんでした: ' + errorText(e), 'error')
  }
}

export async function importImageDialog(): Promise<void> {
  const res = await openImageFile()
  if (res) await setImageFromDataUrl(res.name, res.dataUrl)
}

/** アプリに同梱された練習画像を通常の画像と同じように追加する。 */
export async function importSampleImage(): Promise<void> {
  try {
    // スタンドアロン版では画像が data URL として埋め込まれているので、そのまま使う。
    // それ以外はファイルをそのまま読み込む（キャンバスで描き直して PNG に再圧縮すると数秒かかるため）
    const dataUrl = sampleGuideUrl.startsWith('data:')
      ? sampleGuideUrl
      : await readFileAsDataUrl(new File([await (await fetch(sampleGuideUrl)).blob()], 'sample.png', { type: 'image/png' }))
    await setImageFromDataUrl('使い方サンプル.png', dataUrl)
  } catch (e) {
    get().notify('サンプル画像を読み込めませんでした: ' + errorText(e), 'error')
  }
}

/** いまのページの画像を差し替える（描き順はそのまま） */
export async function replaceImageDialog(): Promise<void> {
  const res = await openImageFile()
  if (res) await setImageFromDataUrl(res.name, res.dataUrl, true)
}

/** スマホのカメラで撮影して読み込む */
export async function captureImage(): Promise<void> {
  const res = await openImageFile({ camera: true })
  if (res) await setImageFromDataUrl(res.name, res.dataUrl)
}

export async function importImageFile(file: File): Promise<void> {
  if (file.name.toLowerCase().endsWith('.' + PROJECT_EXT)) {
    if (confirmDiscard()) loadProjectText(await file.text(), null)
    return
  }
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    get().notify('PNG / JPEG / WebP 画像を指定してください', 'error')
    return
  }
  await setImageFromDataUrl(file.name, await readFileAsDataUrl(file))
}

export async function importHandDialog(): Promise<void> {
  const res = await openImageFile({ allowSvg: true })
  if (!res) return
  try {
    const hand = await importHand(res.name, res.dataUrl)
    get().commit((p) => ({ ...p, hand }))
    get().notify('手素材を読み込みました。インスペクタでペン先の位置を合わせてください')
  } catch (e) {
    get().notify('手素材を読み込めませんでした: ' + errorText(e), 'error')
  }
}

/** 内蔵素材（assets/hand の画像）を選ぶ。presetId が 'builtin-svg' ならイラストの手 */
export function selectHandPreset(id: string): void {
  get().commit((p) => {
    if (id === 'builtin-svg') return { ...p, hand: builtinHand(p.settings.penColor) }
    const preset = findPreset(id)
    return preset ? { ...p, hand: { ...preset.hand } } : p
  })
}

export function resetHand(): void {
  get().commit((p) => ({ ...p, hand: defaultHand(p.settings.penColor) }))
}

export function totalDuration(): number {
  return buildTimeline(get().project).total
}

export function togglePlay(): void {
  const s = get()
  if (!s.project.image || s.project.strokes.length === 0) {
    s.notify('再生するには画像と軌跡が必要です', 'error')
    return
  }
  if (s.playing) {
    s.setPlaying(false)
    return
  }
  if (s.time >= totalDuration()) s.setTime(0)
  s.setPlaying(true)
}

export function rewind(): void {
  get().setTime(0)
}

/** Delete キー：選択範囲があれば、その範囲を消す。なければ選んでいる軌跡を削除する */
export function deleteSelected(): void {
  const { selectedId, removeStroke, selection } = get()
  if (selection) return eraseSelection()
  if (selectedId) removeStroke(selectedId)
}

/**
 * 選択範囲の中を消す（消しゴムと同じく、軌跡の表示範囲から除く）。
 * 軌跡を選んでいればその軌跡だけ。選んでいなければ、選択範囲の中を通るすべての軌跡から消す。
 */
export function eraseSelection(): void {
  const s = get()
  const sel = s.selection
  const img = s.project.image
  if (!sel || !img) return
  let targets = s.selectedId ? s.project.strokes.filter((x) => x.id === s.selectedId) : []
  if (targets.length === 0) {
    const mask = rasterizeClip(sel, img.width, img.height)
    const data = (mask.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, img.width, img.height).data
    const inside = (x: number, y: number): boolean => {
      const xi = Math.round(x)
      const yi = Math.round(y)
      return xi >= 0 && yi >= 0 && xi < img.width && yi < img.height && data[(yi * img.width + xi) * 4 + 3] > 0
    }
    targets = s.project.strokes.filter((st) => {
      if (st.hidden) return false
      const pts = st.points
      for (let i = 0; i < pts.length; i++) {
        if (inside(pts[i].x, pts[i].y)) return true
        // 点と点の間（ペンを上げた区間は除く）も見る
        if (i > 0 && !pts[i].b && inside((pts[i].x + pts[i - 1].x) / 2, (pts[i].y + pts[i - 1].y) / 2)) return true
      }
      return false
    })
  }
  if (targets.length === 0) {
    s.notify('選択範囲の中を通る軌跡がありません', 'error')
    return
  }
  const ids = new Set(targets.map((t) => t.id))
  s.commit((p) => ({ ...p, strokes: p.strokes.map((st) => (ids.has(st.id) ? { ...st, clip: addAreaErase(st.clip, sel) } : st)) }))
  s.notify(
    targets.length === 1
      ? `#${s.project.strokes.findIndex((x) => x.id === targets[0].id) + 1} の軌跡から、選択範囲の中を消しました（元に戻す（↶）で取り消せます）`
      : `${targets.length} 本の軌跡から、選択範囲の中を消しました（元に戻す（↶）で取り消せます）`
  )
}

export function openExport(kind: 'html' | 'video'): void {
  const s = get()
  const pages = allPages(s.project)
  if (!pages.some((pg) => pg.image)) {
    s.notify('先に画像を読み込んでください', 'error')
    return
  }
  if (!pages.some((pg) => pg.image && pg.strokes.length > 0)) {
    s.notify('軌跡がありません。「自動」で作るか、「描く」ツールで描き順をなぞってください', 'error')
    return
  }
  s.openDialog(kind)
}

/** 描き順の自動生成ダイアログを開く */
export function openAutoTrace(): void {
  const s = get()
  if (!s.project.image) {
    s.notify('先に画像を読み込んでください', 'error')
    return
  }
  s.openDialog('auto')
}

export function selectRelative(delta: number): void {
  const { project, selectedId, select } = get()
  if (project.strokes.length === 0) return
  const idx = project.strokes.findIndex((s) => s.id === selectedId)
  const next = idx < 0 ? 0 : Math.max(0, Math.min(project.strokes.length - 1, idx + delta))
  select(project.strokes[next].id)
}

export function deselect(): void {
  const st = get()
  if (!st.selection) return
  st.setSelection(null)
  st.notify('選択を解除しました')
}

/** キャンバス全体を選択する（Ctrl+A） */
export function selectAll(): void {
  const st = get()
  if (!st.project.image) return
  st.setSelection({ shapes: [{ kind: 'all', mode: 'add' }] })
  if (st.viewMode !== 'edit') st.setViewMode('edit')
}

export function invertSelection(): void {
  const st = get()
  if (!st.project.image) return
  st.setSelection(invert(st.selection))
  if (st.viewMode !== 'edit') st.setViewMode('edit')
}

/** Electron のメニューから届くコマンド */
export function runMenuCommand(cmd: string, payload?: unknown): void {
  switch (cmd) {
    case 'new':
      return newProject()
    case 'open':
      return void openProject()
    case 'open-project-data': {
      const p = payload as { path: string; text: string }
      if (confirmDiscard()) loadProjectText(p.text, p.path)
      return
    }
    case 'save':
      return void saveProject(false)
    case 'save-as':
      return void saveProject(true)
    case 'import-image':
      return void importImageDialog()
    case 'import-hand':
      return void importHandDialog()
    case 'export-html':
      return openExport('html')
    case 'export-video':
      return openExport('video')
    case 'undo':
      return get().undo()
    case 'redo':
      return get().redo()
    case 'delete-stroke':
      return deleteSelected()
    case 'toggle-play':
      return togglePlay()
    case 'rewind':
      return rewind()
    case 'theme':
      return setThemePref(payload as ThemePref, true)
    case 'deselect':
      return deselect()
    case 'tour':
      return startTour()
    case 'guide':
      return openGuide(typeof payload === 'string' ? payload : undefined)
    case 'sample':
      return void importSampleImage()
    case 'auto-trace':
      return openAutoTrace()
    case 'recovery':
      return get().openDialog('recovery')
    case 'select-all':
      return selectAll()
    case 'invert-selection':
      return invertSelection()
    case 'tool-rect':
      return get().setTool('rect')
    case 'tool-ellipse':
      return get().setTool('ellipse')
    case 'tool-lasso':
      return get().setTool('lasso')
  }
}
