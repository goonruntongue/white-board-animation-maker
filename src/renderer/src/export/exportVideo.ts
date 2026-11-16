// 動画書き出し（PRD 7.2）。Canvas の captureStream() + MediaRecorder で WebM（使えない端末では MP4）を作る。
// MediaRecorder は実時間で記録するため、書き出しには再生時間と同じだけかかる。
import { createSequence } from './sequence'
import type { Project } from '../engine/types'

export interface VideoExportOptions {
  fps: number
  /** 出力の最大幅 (px) */
  maxWidth: number
  bitrateMbps: number
}

export interface VideoExportHandle {
  promise: Promise<Blob>
  cancel: () => void
}

/** 録画できる形式を選ぶ。WebM が使えない端末（iPhone の Safari など）は MP4 */
export function pickVideoFormat(): { mime: string; ext: 'webm' | 'mp4' } {
  const candidates: { mime: string; ext: 'webm' | 'mp4' }[] = [
    { mime: 'video/webm;codecs=vp9', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
    { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' }
  ]
  if (typeof MediaRecorder === 'undefined') return candidates[2]
  return candidates.find((c) => MediaRecorder.isTypeSupported(c.mime)) ?? candidates[2]
}

export function exportWebm(
  project: Project,
  o: VideoExportOptions,
  onProgress: (ratio: number) => void
): VideoExportHandle {
  let cancelled = false
  let stopFn: (() => void) | null = null

  const promise = (async () => {
    // 全ページを順番につなげて描く
    const seq = await createSequence(project, o.maxWidth)
    const out = seq.canvas

    const stream = out.captureStream(o.fps)
    const format = pickVideoFormat()
    const recorder = new MediaRecorder(stream, {
      mimeType: format.mime,
      videoBitsPerSecond: o.bitrateMbps * 1_000_000
    })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)

    const done = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => (cancelled ? reject(new Error('cancelled')) : resolve(new Blob(chunks, { type: format.mime.split(';')[0] })))
      recorder.onerror = () => reject(new Error('録画に失敗しました'))
    })

    const total = seq.total
    const draw = seq.render
    draw(0)
    recorder.start(250)
    const t0 = performance.now()
    await new Promise<void>((resolve) => {
      stopFn = resolve
      const tick = (): void => {
        if (cancelled) return resolve()
        const t = Math.min(total, performance.now() - t0)
        draw(t)
        onProgress(t / total)
        if (t >= total) {
          // 最終フレームが確実に記録されるよう少し待つ
          setTimeout(resolve, 300)
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    recorder.stop()
    stream.getTracks().forEach((tr) => tr.stop())
    return done
  })()

  return {
    promise,
    cancel: () => {
      cancelled = true
      stopFn?.()
    }
  }
}
