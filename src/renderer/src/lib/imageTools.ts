import { loadImage } from '../engine/wb-engine'
import type { HandAsset, ImageAsset } from '../engine/types'

/** これより大きい画像は読み込み時に縮小する（PRD 推奨: 1920×1080 以下） */
export const MAX_IMPORT_EDGE = 2560

export async function importImage(
  name: string,
  dataUrl: string
): Promise<{ asset: ImageAsset; resized: boolean }> {
  const img = await loadImage(dataUrl)
  const w = img.naturalWidth
  const h = img.naturalHeight
  const scale = Math.min(1, MAX_IMPORT_EDGE / Math.max(w, h))
  if (scale >= 1) return { asset: { name, dataUrl, width: w, height: h }, resized: false }
  const nw = Math.round(w * scale)
  const nh = Math.round(h * scale)
  const out = reencode(img, nw, nh, 'image/png')
  return { asset: { name, dataUrl: out, width: nw, height: nh }, resized: true }
}

export async function importHand(name: string, dataUrl: string): Promise<HandAsset> {
  const img = await loadImage(dataUrl)
  // ペン先は左上付近にあると仮定して初期値を置き、インスペクタで調整してもらう
  return {
    name,
    dataUrl,
    width: img.naturalWidth,
    height: img.naturalHeight,
    tipX: Math.round(img.naturalWidth * 0.05),
    tipY: Math.round(img.naturalHeight * 0.05),
    builtin: false
  }
}

export function reencode(img: CanvasImageSource, w: number, h: number, mime: string, quality?: number): string {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  return c.toDataURL(mime, quality)
}

/** data URL のおおよそのバイト数 */
export function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(',')
  const body = dataUrl.slice(i + 1)
  if (dataUrl.slice(0, i).includes(';base64')) return Math.floor((body.length * 3) / 4)
  return decodeURIComponent(body).length
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
