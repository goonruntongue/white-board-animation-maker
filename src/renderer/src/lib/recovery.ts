// 自動バックアップと復元。
//   ・未保存の変更があるあいだ、数十秒おきにプロジェクトを端末内（IndexedDB）へ保存する
//   ・履歴は「最新」＋「2分以上間隔をあけた過去の版」を最大 20 件（＝およそ 40 分ぶん）
//   ・画像（数MB）は中身のハッシュで1回だけ保存し、各版はプロジェクトの JSON だけを持つ
//   ・起動時に「前回きちんと終了したか」を記録し、異常終了（フリーズ・強制終了・クラッシュ）なら復元を案内する
// Electron 版・PWA 版の両方で同じ仕組みが動く（データは各アプリの保存領域に入る）。
import { parseProject, serializeProject, syncPages } from '../engine/project'
import type { Project } from '../engine/types'
import { useEditor } from '../store'

const DB_NAME = 'wbam-recovery'
const DB_VERSION = 1
const MAX_SNAPSHOTS = 20
const SPACING_MS = 2 * 60 * 1000 // 過去の版どうしの間隔
const CHECK_MS = 20 * 1000 // 変更を確認する間隔
const SESSION_KEY = 'wbam.session'

export interface SnapshotMeta {
  id: number
  at: number
  name: string
  strokes: number
  filePath: string | null
}

interface SnapshotRecord extends SnapshotMeta {
  /** この版（枠）を作った時刻。枠ができてから2分間は同じ枠を上書きする */
  createdAt: number
  json: string
  /** ページごとの画像の保存キー（画像のないページは null） */
  imageKeys: (string | null)[]
  handKey: string | null
}

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------
let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true })
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

function reqP<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

// ---------------------------------------------------------------------------
// 画像の重複を避けるためのハッシュ
// ---------------------------------------------------------------------------
let lastHashed: { text: string; key: string } | null = null

async function contentKey(text: string): Promise<string> {
  if (lastHashed && lastHashed.text === text) return lastHashed.key
  let key: string
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    key = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
  } else {
    // 予備：FNV-1a（暗号用途ではなく、同じ画像かどうかの判定だけ）
    let h = 0x811c9dc5
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
    key = `fnv-${(h >>> 0).toString(16)}-${text.length}`
  }
  lastHashed = { text, key }
  return key
}

// ---------------------------------------------------------------------------
// 保存・一覧・読み込み
// ---------------------------------------------------------------------------
async function saveSnapshot(project: Project, filePath: string | null): Promise<void> {
  const db = await openDb()
  project = syncPages(project)
  const handData = !project.hand.presetId && !project.hand.builtin ? project.hand.dataUrl : null
  const handKey = handData ? await contentKey(handData) : null
  // 画像本体は別に持つので、JSON からは外す（同じ画像は1回だけ保存される）
  const images = new Map<string, string>()
  const imageKeys: (string | null)[] = []
  for (const pg of project.pages) {
    const key = pg.image ? await contentKey(pg.image.dataUrl) : null
    if (key && pg.image) images.set(key, pg.image.dataUrl)
    imageKeys.push(key)
  }
  const slim: Project = {
    ...project,
    pages: project.pages.map((pg) => ({ ...pg, image: pg.image ? { ...pg.image, dataUrl: '' } : null })),
    hand: handData ? { ...project.hand, dataUrl: '' } : project.hand
  }
  const now = Date.now()
  const record: Omit<SnapshotRecord, 'id'> & { id?: number } = {
    at: now,
    createdAt: now,
    name: project.name,
    strokes: project.pages.reduce((sum, pg) => sum + pg.strokes.length, 0),
    filePath,
    json: serializeProject(slim),
    imageKeys,
    handKey
  }

  const tx = db.transaction(['snapshots', 'blobs'], 'readwrite')
  const snaps = tx.objectStore('snapshots')
  const blobs = tx.objectStore('blobs')
  for (const [key, data] of images) blobs.put(data, key)
  if (handKey && handData) blobs.put(handData, handKey)

  const all = (await reqP(snaps.getAll())) as SnapshotRecord[]
  all.sort((a, b) => b.at - a.at)
  const latest = all[0]
  // 最新の枠ができてから2分未満なら、その枠を最新の内容で上書きする。
  // 2分たったら新しい枠を作る → 「最新」と「約2分おきの過去の版」が残る
  const overwrite = !!latest && now - (latest.createdAt ?? latest.at) < SPACING_MS
  if (overwrite) {
    record.id = latest.id
    record.createdAt = latest.createdAt ?? latest.at
  }
  snaps.put(record)
  // 件数の上限を超えた古い版を消す（上書きなら既存件数のまま、新規なら1件増える）
  const older = overwrite ? all.slice(1) : all
  for (const old of older.slice(MAX_SNAPSHOTS - 1)) snaps.delete(old.id)
  await txDone(tx)
  await collectGarbage()
}

/** どの版からも使われなくなった画像を消す */
async function collectGarbage(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(['snapshots', 'blobs'], 'readwrite')
  const all = (await reqP(tx.objectStore('snapshots').getAll())) as SnapshotRecord[]
  const used = new Set(all.flatMap((s) => [...(s.imageKeys ?? []), s.handKey]).filter(Boolean) as string[])
  const keys = (await reqP(tx.objectStore('blobs').getAllKeys())) as string[]
  for (const k of keys) if (!used.has(k)) tx.objectStore('blobs').delete(k)
  await txDone(tx)
}

export async function listSnapshots(): Promise<SnapshotMeta[]> {
  try {
    const db = await openDb()
    const all = (await reqP(db.transaction('snapshots').objectStore('snapshots').getAll())) as SnapshotRecord[]
    return all
      .map(({ id, at, name, strokes, filePath }) => ({ id, at, name, strokes, filePath }))
      .sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}

export async function loadSnapshot(id: number): Promise<{ project: Project; filePath: string | null }> {
  const db = await openDb()
  const tx = db.transaction(['snapshots', 'blobs'])
  const rec = (await reqP(tx.objectStore('snapshots').get(id))) as SnapshotRecord | undefined
  if (!rec) throw new Error('バックアップが見つかりません')
  const project = parseProject(rec.json)
  const blobs = tx.objectStore('blobs')
  for (let i = 0; i < project.pages.length; i++) {
    const key = rec.imageKeys?.[i]
    const pg = project.pages[i]
    if (key && pg.image) project.pages[i] = { ...pg, image: { ...pg.image, dataUrl: (await reqP(blobs.get(key))) as string } }
  }
  project.image = project.pages[project.pageIndex].image
  project.strokes = project.pages[project.pageIndex].strokes
  if (rec.handKey) {
    project.hand = { ...project.hand, dataUrl: (await reqP(tx.objectStore('blobs').get(rec.handKey))) as string }
  }
  return { project, filePath: rec.filePath }
}

export async function clearSnapshots(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(['snapshots', 'blobs'], 'readwrite')
  tx.objectStore('snapshots').clear()
  tx.objectStore('blobs').clear()
  await txDone(tx)
}

// ---------------------------------------------------------------------------
// 自動保存と、異常終了の検出
// ---------------------------------------------------------------------------
let sessionInfo: { crashed: boolean } | null = null

/** 起動時に一度だけ呼ぶ。前回が正常終了でなければ crashed = true */
export function beginSession(): { crashed: boolean } {
  if (sessionInfo) return sessionInfo
  let crashed = false
  try {
    const prev = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as { open?: boolean } | null
    crashed = !!prev?.open
    localStorage.setItem(SESSION_KEY, JSON.stringify({ open: true, at: Date.now() }))
  } catch {
    /* 保存領域が使えない環境では判定しない */
  }
  sessionInfo = { crashed }
  return sessionInfo
}

function markCleanExit(): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ open: false, at: Date.now() }))
  } catch {
    /* 何もしない */
  }
}

let lastSaved: Project | null = null
let saving = false

/** 未保存の変更があれば、すぐにバックアップする */
export async function backupNow(): Promise<boolean> {
  const { project, dirty, filePath } = useEditor.getState()
  const hasContent = !!project.image || project.pages.some((pg) => pg.image)
  if (saving || !dirty || !hasContent || project === lastSaved) return false
  saving = true
  try {
    await saveSnapshot(project, filePath)
    lastSaved = project
    return true
  } catch {
    return false
  } finally {
    saving = false
  }
}

/** 自動保存を始める（戻り値で停止） */
export function startAutosave(): () => void {
  const timer = window.setInterval(() => void backupNow(), CHECK_MS)
  // スマホはアプリが裏に回ると終了させられることがあるので、そのときにも保存する
  const onHide = (): void => {
    if (document.visibilityState === 'hidden') void backupNow()
  }
  const onPageHide = (): void => {
    void backupNow()
    markCleanExit()
  }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', onPageHide)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('pagehide', onPageHide)
  }
}

/** 「3分前」のような表示 */
export function relativeTime(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 45) return 'たった今'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}分前`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}時間前`
  return `${Math.round(h / 24)}日前`
}
