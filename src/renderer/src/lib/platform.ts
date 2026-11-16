// ファイル入出力の抽象化。
// Electron 上では preload の window.desktop（OSダイアログ）を使い、
// ブラウザ版ではファイル選択ダイアログとダウンロードで代替する。

export interface FileFilter {
  name: string
  extensions: string[]
}

export const isDesktop = typeof window !== 'undefined' && !!window.desktop

/** 指で操作する端末（スマホ・タブレット） */
export const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

/**
 * スマホでは「共有」シートで保存先（ファイル・ドライブ・AirDrop など）を選べるようにする。
 * 共有できない形式・端末ではダウンロードにする。キャンセル時は 'cancel'。
 */
async function shareFile(blob: Blob, name: string): Promise<'shared' | 'cancel' | 'unsupported'> {
  if (!isTouchDevice || typeof navigator.canShare !== 'function') return 'unsupported'
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' })
  if (!navigator.canShare({ files: [file] })) return 'unsupported'
  try {
    await navigator.share({ files: [file], title: name })
    return 'shared'
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'cancel' : 'unsupported'
  }
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export async function openImageFile(opts?: { allowSvg?: boolean }): Promise<{ name: string; dataUrl: string } | null> {
  if (window.desktop) return window.desktop.openImage(opts)
  const f = await pickFile(opts?.allowSvg ? 'image/png,image/webp,image/svg+xml,.svg' : 'image/png,image/jpeg,image/webp')
  return f ? { name: f.name, dataUrl: await readFileAsDataUrl(f) } : null
}

export async function openProjectFile(): Promise<{ path: string | null; text: string } | null> {
  if (window.desktop) return window.desktop.openProject()
  // iOS は独自拡張子を選べないことがあるので、JSON / テキストも受け付ける
  const f = await pickFile('.wbanim,application/json,text/plain,application/octet-stream')
  return f ? { path: null, text: await f.text() } : null
}

/** 保存したパス（ブラウザ版はファイル名）を返す。キャンセル時は null */
export async function saveTextFile(
  text: string,
  defaultName: string,
  filters: FileFilter[],
  path?: string
): Promise<string | null> {
  if (window.desktop) return window.desktop.saveText({ text, defaultName, filters, path })
  const type = defaultName.endsWith('.html') ? 'text/html' : defaultName.endsWith('.wbanim') ? 'application/json' : 'text/plain'
  const blob = new Blob([text], { type: `${type};charset=utf-8` })
  const shared = await shareFile(blob, defaultName)
  if (shared === 'cancel') return null
  if (shared === 'unsupported') download(blob, defaultName)
  return defaultName
}

export async function saveBlobFile(blob: Blob, defaultName: string, filters: FileFilter[]): Promise<string | null> {
  if (window.desktop) {
    return window.desktop.saveBinary({ data: await blob.arrayBuffer(), defaultName, filters })
  }
  const shared = await shareFile(blob, defaultName)
  if (shared === 'cancel') return null
  if (shared === 'unsupported') download(blob, defaultName)
  return defaultName
}

export function revealInFolder(path: string): void {
  if (window.desktop && /[\\/]/.test(path)) void window.desktop.showItemInFolder(path)
}

export function setWindowTitle(title: string): void {
  if (window.desktop) window.desktop.setTitle(title)
  else document.title = title
}
