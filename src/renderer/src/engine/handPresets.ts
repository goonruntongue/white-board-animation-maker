// 内蔵の手素材（assets/hand フォルダの画像）。
// フォルダ直下の PNG / WebP / SVG を自動で取り込む（サブフォルダ omit/ などは対象外）。
// 画像を追加・削除すれば、次のビルド（開発中は再読み込み）で選択肢に反映される。
import { builtinHand } from './handAsset'
import type { HandAsset } from './types'
import { loadImage } from './wb-engine'

const FILES = import.meta.glob('../../../../assets/hand/*.{png,webp,svg}', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

/** 既定の手素材（ファイル名から拡張子を除いたもの） */
export const DEFAULT_HAND_PRESET = 'hand-man-realistic'

export interface HandPreset {
  id: string
  label: string
  url: string
  hand: HandAsset
}

const GENDER: Record<string, string> = { man: '男性', woman: '女性' }
const STYLE: Record<string, string> = { realistic: 'リアル', manga: 'マンガ', '3d-model': '3D' }
const STYLE_ORDER = ['realistic', 'manga', '3d-model']

/** 「hand-man-realistic」→「男性・リアル」。規則に合わない名前はそのまま表示 */
export function presetLabel(id: string): string {
  const m = /^hand-(man|woman)-(.+)$/.exec(id)
  if (!m) return id.replace(/^hand-/, '')
  return `${GENDER[m[1]]}・${STYLE[m[2]] ?? m[2]}`
}

function sortKey(id: string): string {
  const m = /^hand-(man|woman)-(.+)$/.exec(id)
  if (!m) return `9-${id}`
  const style = STYLE_ORDER.indexOf(m[2])
  return `${m[1] === 'man' ? 0 : 1}-${style < 0 ? 9 : style}-${id}`
}

/**
 * 透過画像からペン先の位置を推定する。
 * 手素材はペン先が左上を向いている前提で、不透明な画素のうち「最も左上」に近い点を選ぶ。
 */
export function detectTip(img: CanvasImageSource, width: number, height: number): { x: number; y: number } {
  const k = Math.min(1, 640 / Math.max(width, height))
  const w = Math.max(1, Math.round(width * k))
  const h = Math.max(1, Math.round(height * k))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  let best = Infinity
  let bx = 0
  let by = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < 128) continue
      const score = x + y * 0.25
      if (score < best) {
        best = score
        bx = x
        by = y
      }
    }
  }
  if (best === Infinity) return { x: Math.round(width * 0.05), y: Math.round(height * 0.05) }
  return { x: Math.round((bx + 0.5) / k), y: Math.round((by + 0.5) / k) }
}

/** 画像の実寸（viewBox だけの SVG は naturalWidth が 0 になることがあるので補う） */
export function imageSize(img: HTMLImageElement): { width: number; height: number } {
  return { width: img.naturalWidth || 512, height: img.naturalHeight || 512 }
}

export async function makeHandAsset(name: string, src: string, presetId?: string): Promise<HandAsset> {
  const img = await loadImage(src)
  const { width, height } = imageSize(img)
  const tip = detectTip(img, width, height)
  return { name, dataUrl: src, width, height, tipX: tip.x, tipY: tip.y, builtin: false, ...(presetId ? { presetId } : {}) }
}

let presets: HandPreset[] = []

/** 起動時に一度だけ呼ぶ（画像サイズとペン先位置を調べる） */
export async function initHandPresets(onProgress?: (done: number, total: number) => void): Promise<void> {
  const entries = Object.entries(FILES).map(([path, url]) => {
    const id = path.split('/').pop()!.replace(/\.[^.]+$/, '')
    return { id, url }
  })
  let done = 0
  onProgress?.(0, entries.length)
  // 読み込みと展開（decode）は並行して、ブラウザの裏側で行う。
  // ペン先を調べる処理は1枚ずつ、間に画面の書き換えをはさむ（起動中の進捗表示が止まらないように）
  const images = entries.map(({ url }) =>
    loadImage(url).then(async (img) => {
      try {
        await img.decode()
      } catch {
        // decode できなくても、描くときに展開される
      }
      return img
    })
  )
  // 裏のタブでは画面の書き換えが止まるので、長くは待たない
  const nextFrame = (): Promise<void> =>
    new Promise((r) => {
      const t = setTimeout(r, 50)
      requestAnimationFrame(() => setTimeout(() => (clearTimeout(t), r()), 0))
    })
  const loaded: (HandPreset | null)[] = []
  for (let i = 0; i < entries.length; i++) {
    const { id, url } = entries[i]
    try {
      const img = await images[i]
      await nextFrame()
      const label = presetLabel(id)
      const { width, height } = imageSize(img)
      const tip = detectTip(img, width, height)
      loaded.push({ id, label, url, hand: { name: label, dataUrl: url, width, height, tipX: tip.x, tipY: tip.y, builtin: false, presetId: id } })
    } catch {
      loaded.push(null)
    }
    onProgress?.(++done, entries.length)
  }
  presets = loaded.filter((p): p is HandPreset => !!p).sort((a, b) => sortKey(a.id).localeCompare(sortKey(b.id)))
}

export function getHandPresets(): HandPreset[] {
  return presets
}

export function findPreset(id: string | undefined): HandPreset | undefined {
  return id ? presets.find((p) => p.id === id) : undefined
}

/** 新規プロジェクトの手素材。フォルダに素材がなければ内蔵のイラストを使う */
export function defaultHand(penColor: string): HandAsset {
  const p = findPreset(DEFAULT_HAND_PRESET) ?? presets[0]
  return p ? { ...p.hand } : builtinHand(penColor)
}
