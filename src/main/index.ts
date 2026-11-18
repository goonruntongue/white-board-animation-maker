import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, type MenuItemConstructorOptions } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { setupMcp, shutdownMcp } from './mcpServer'

const isDev = !app.isPackaged
const isMac = process.platform === 'darwin'
let mainWindow: BrowserWindow | null = null
let pendingOpenPath: string | null = process.argv.find((a) => a.endsWith('.wbanim')) ?? null

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
}

interface FileFilter {
  name: string
  extensions: string[]
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    icon: isDev ? join(app.getAppPath(), 'assets/icon/app-icon-hand.ico') : join(process.resourcesPath, 'app-icon.ico'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? WINDOW_BG.dark : WINDOW_BG.light,
    title: 'Whiteboard Animation Maker',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // 外部リンクは既定ブラウザで開き、アプリ内ナビゲーションは禁止する
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 画面の処理が落ちた・固まったときは、再読み込みして自動バックアップから復元できるようにする
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'error',
      title: '問題が発生しました',
      message: '画面の処理が停止しました。',
      detail: '再読み込みすると、自動バックアップから直前の状態に戻せます。',
      buttons: ['再読み込みして復元', '閉じる'],
      defaultId: 0
    })
    if (choice === 0) mainWindow?.webContents.reload()
    else mainWindow?.close()
  })
  mainWindow.webContents.on('unresponsive', () => {
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'warning',
      title: '応答していません',
      message: 'アプリが応答していません。',
      detail: 'しばらく待つか、再読み込みしてください。再読み込みすると、自動バックアップから直前の状態に戻せます。',
      buttons: ['待つ', '再読み込みして復元'],
      defaultId: 0,
      cancelId: 0
    })
    if (choice === 1) mainWindow?.webContents.forcefullyCrashRenderer()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingOpenPath) {
      void sendProjectToRenderer(pendingOpenPath)
      pendingOpenPath = null
    }
  })
}

async function sendProjectToRenderer(path: string): Promise<void> {
  try {
    const text = await readFile(path, 'utf-8')
    mainWindow?.webContents.send('menu', 'open-project-data', { path, text })
  } catch (err) {
    dialog.showErrorBox('プロジェクトを開けません', String(err))
  }
}

function send(cmd: string, payload?: unknown): void {
  mainWindow?.webContents.send('menu', cmd, payload)
}

type ThemePref = 'light' | 'dark' | 'system'
const WINDOW_BG = { light: '#c9cdd3', dark: '#16171a' }

/** ウィンドウ枠・メニュー・起動時の背景色をテーマに合わせる */
function applyTheme(pref: ThemePref): void {
  nativeTheme.themeSource = pref
  mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? WINDOW_BG.dark : WINDOW_BG.light)
  const item = Menu.getApplicationMenu()?.getMenuItemById(`theme-${pref}`)
  if (item) item.checked = true
}

function chooseTheme(pref: ThemePref): void {
  applyTheme(pref)
  send('theme', pref)
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'ファイル',
      submenu: [
        { label: '新規プロジェクト', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'プロジェクトを開く…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: '名前を付けて保存…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-as') },
        { label: '自動バックアップから復元…', click: () => send('recovery') },
        { type: 'separator' },
        { label: '画像を読み込む…', accelerator: 'CmdOrCtrl+I', click: () => send('import-image') },
        { label: '手・ペン素材を読み込む…', click: () => send('import-hand') },
        { type: 'separator' },
        { label: 'HTMLとして書き出す…', accelerator: 'CmdOrCtrl+E', click: () => send('export-html') },
        { label: '動画・GIF として書き出す…', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('export-video') },
        // Mac の終了はアプリ名のメニューにある
        ...(isMac ? [] : ([{ type: 'separator' }, { role: 'quit', label: '終了' }] as MenuItemConstructorOptions[]))
      ]
    },
    {
      label: '編集',
      submenu: [
        // Undo/Redo/Delete はレンダラー側のキーボード処理に任せる（入力欄での標準動作を壊さないため）
        { label: '元に戻す', accelerator: 'CmdOrCtrl+Z', click: () => send('undo'), registerAccelerator: false },
        { label: 'やり直す', accelerator: 'CmdOrCtrl+Y', click: () => send('redo'), registerAccelerator: false },
        { type: 'separator' },
        { label: '描き順を自動で作る…', click: () => send('auto-trace') },
        { type: 'separator' },
        { label: '選択中の軌跡を削除', accelerator: 'Delete', click: () => send('delete-stroke'), registerAccelerator: false },
        { type: 'separator' },
        { role: 'copy', label: 'コピー' },
        { role: 'paste', label: '貼り付け' }
      ]
    },
    {
      // キー操作はレンダラー側で処理する（registerAccelerator: false）
      label: '選択範囲',
      submenu: [
        { label: '長方形選択', accelerator: 'M', click: () => send('tool-rect'), registerAccelerator: false },
        { label: '楕円形選択', accelerator: 'Shift+M', click: () => send('tool-ellipse'), registerAccelerator: false },
        { label: '投げ縄', accelerator: 'L', click: () => send('tool-lasso'), registerAccelerator: false },
        { type: 'separator' },
        { label: 'すべてを選択', accelerator: 'CmdOrCtrl+A', click: () => send('select-all'), registerAccelerator: false },
        { label: '選択を解除', accelerator: 'CmdOrCtrl+D', click: () => send('deselect'), registerAccelerator: false },
        { label: '選択範囲を反転', accelerator: 'CmdOrCtrl+Shift+I', click: () => send('invert-selection'), registerAccelerator: false }
      ]
    },
    {
      label: '再生',
      submenu: [
        { label: '再生 / 一時停止', accelerator: 'Space', click: () => send('toggle-play'), registerAccelerator: false },
        { label: '先頭へ戻る', accelerator: 'Home', click: () => send('rewind'), registerAccelerator: false }
      ]
    },
    {
      label: 'ヘルプ',
      submenu: [
        { label: 'ツアーを始める', click: () => send('tour') },
        { label: '使い方ガイド', accelerator: 'F1', click: () => send('guide') },
        { label: 'サンプル画像を使う', click: () => send('sample') }
      ]
    },
    {
      label: '表示',
      submenu: [
        { role: 'resetZoom', label: 'UIの拡大率をリセット' },
        { role: 'zoomIn', label: 'UIを拡大' },
        { role: 'zoomOut', label: 'UIを縮小' },
        { type: 'separator' },
        {
          label: 'テーマ',
          submenu: [
            { id: 'theme-light', label: 'ライト', type: 'radio', click: () => chooseTheme('light') },
            { id: 'theme-dark', label: 'ダーク', type: 'radio', click: () => chooseTheme('dark') },
            { id: 'theme-system', label: 'システム設定に合わせる', type: 'radio', checked: true, click: () => chooseTheme('system') }
          ]
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全画面表示' },
        ...(isDev ? ([{ role: 'toggleDevTools', label: '開発者ツール' }] as MenuItemConstructorOptions[]) : [])
      ]
    }
  ]
  // Mac は先頭にアプリ名のメニュー（このアプリについて・隠す・終了など）が要る
  if (isMac) template.unshift({ role: 'appMenu' })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------- IPC ----------
ipcMain.handle('dialog:openImage', async (_e, opts?: { allowSvg?: boolean }) => {
  const res = await dialog.showOpenDialog(mainWindow!, {
    title: opts?.allowSvg ? '手・ペン素材を選択' : '画像を選択',
    properties: ['openFile'],
    filters: [
      opts?.allowSvg
        ? { name: '透過画像 (PNG / WebP / SVG)', extensions: ['png', 'webp', 'svg'] }
        : { name: '画像', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
    ]
  })
  if (res.canceled || !res.filePaths[0]) return null
  const p = res.filePaths[0]
  const buf = await readFile(p)
  const mime = MIME[extname(p).toLowerCase()] ?? 'image/png'
  return { name: basename(p), dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
})

ipcMain.handle('dialog:openProject', async () => {
  const res = await dialog.showOpenDialog(mainWindow!, {
    title: 'プロジェクトを開く',
    properties: ['openFile'],
    filters: [{ name: 'Whiteboard Animation Project', extensions: ['wbanim'] }]
  })
  if (res.canceled || !res.filePaths[0]) return null
  const p = res.filePaths[0]
  return { path: p, text: await readFile(p, 'utf-8') }
})

ipcMain.handle(
  'file:saveText',
  async (_e, args: { text: string; defaultName: string; path?: string; filters: FileFilter[] }) => {
    let target = args.path
    if (!target) {
      const res = await dialog.showSaveDialog(mainWindow!, { defaultPath: args.defaultName, filters: args.filters })
      if (res.canceled || !res.filePath) return null
      target = res.filePath
    }
    await writeFile(target, args.text, 'utf-8')
    return target
  }
)

ipcMain.handle(
  'file:saveBinary',
  async (_e, args: { data: ArrayBuffer; defaultName: string; filters: FileFilter[] }) => {
    const res = await dialog.showSaveDialog(mainWindow!, { defaultPath: args.defaultName, filters: args.filters })
    if (res.canceled || !res.filePath) return null
    await writeFile(res.filePath, Buffer.from(args.data))
    return res.filePath
  }
)

ipcMain.handle('shell:showItem', (_e, p: string) => shell.showItemInFolder(p))

ipcMain.on('window:setTitle', (_e, title: string) => mainWindow?.setTitle(title))
ipcMain.on('window:setTheme', (_e, pref: ThemePref) => {
  if (pref === 'light' || pref === 'dark' || pref === 'system') applyTheme(pref)
})

// ---------- ライフサイクル ----------
// Mac：Finder でプロジェクトファイルを開いたとき（起動前・起動後のどちらも）は open-file で届く
app.on('open-file', (e, path) => {
  e.preventDefault()
  if (!path.endsWith('.wbanim')) return
  if (mainWindow && !mainWindow.webContents.isLoading()) void sendProjectToRenderer(path)
  else pendingOpenPath = path
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const p = argv.find((a) => a.endsWith('.wbanim'))
    if (p) void sendProjectToRenderer(p)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    buildMenu()
    createWindow()
    // AI 連携（MCP）のエンドポイント。オンにしているときだけ待ち受ける
    void setupMcp(() => mainWindow)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => shutdownMcp())

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
