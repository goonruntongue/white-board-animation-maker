import { applyPalette, GIFEncoder, quantize } from 'gifenc'
import { createSequence } from './sequence'
import type { Project } from '../engine/types'
import type { VideoExportHandle } from './exportVideo'

/** Encode the same sequence as video, frame by frame, without external services. */
export function exportGif(project: Project, options: { fps: number; maxWidth: number; repeat: boolean }, onProgress: (ratio: number) => void): VideoExportHandle {
  let cancelled = false
  const promise = (async () => {
    const seq = await createSequence(project, options.maxWidth)
    const { canvas } = seq
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('画像を描画できませんでした')
    const gif = GIFEncoder()
    const frameCount = Math.max(1, Math.ceil(seq.total / 1000 * options.fps))
    for (let i = 0; i <= frameCount; i++) {
      if (cancelled) throw new Error('cancelled')
      seq.render(Math.min(seq.total, i * 1000 / options.fps))
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      const palette = quantize(pixels, 256)
      const index = applyPalette(pixels, palette)
      gif.writeFrame(index, canvas.width, canvas.height, { palette, delay: 1000 / options.fps, repeat: options.repeat ? 0 : -1 })
      onProgress((i + 1) / (frameCount + 1))
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    if (cancelled) throw new Error('cancelled')
    gif.finish()
    return new Blob([gif.bytes()], { type: 'image/gif' })
  })()
  return { promise, cancel: () => { cancelled = true } }
}
