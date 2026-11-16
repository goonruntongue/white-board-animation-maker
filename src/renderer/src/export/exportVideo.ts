// 動画書き出し（PRD 7.2）。Canvas の captureStream() + MediaRecorder で WebM（使えない端末では MP4）を作る。
// MediaRecorder は実時間で記録するため、書き出しには再生時間と同じだけかかる。
import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
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

// ---------------------------------------------------------------------------
// MP4 の高速書き出し
// ブラウザの動画エンコーダー（WebCodecs）で1コマずつ H.264 に圧縮し、MP4 にまとめる。
// 画面の再生を録画するのではないので、再生時間を待たずに書き出せて、コマ落ちもしない。
// ---------------------------------------------------------------------------

/** 高いプロファイル・レベルから順に試す（大きな解像度ほど高いレベルが必要） */
const H264_CODECS = ['avc1.640034', 'avc1.640033', 'avc1.64002a', 'avc1.4d0034', 'avc1.4d002a', 'avc1.42003e', 'avc1.42002a', 'avc1.42001f']

async function pickH264Config(width: number, height: number, fps: number, bitrate: number): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null
  for (const codec of H264_CODECS) {
    const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: fps, avc: { format: 'avc' } }
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return config
    } catch {
      /* 次の候補へ */
    }
  }
  return null
}

/** この端末で MP4 の高速書き出しができるか（設定画面の表示用） */
export async function canExportMp4(): Promise<boolean> {
  return (await pickH264Config(1280, 720, 30, 4_000_000)) !== null
}

export function exportMp4(project: Project, o: VideoExportOptions, onProgress: (ratio: number) => void): VideoExportHandle {
  let cancelled = false

  const promise = (async () => {
    const seq = await createSequence(project, o.maxWidth)
    const { width, height } = seq.canvas
    const config = await pickH264Config(width, height, o.fps, o.bitrateMbps * 1_000_000)
    if (!config) throw new Error('この端末では MP4 の書き出しに対応していません')

    const target = new ArrayBufferTarget()
    const muxer = new Muxer({ target, video: { codec: 'avc', width, height, frameRate: o.fps }, fastStart: 'in-memory' })
    let failure: Error | null = null
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        failure = e
      }
    })
    encoder.configure(config)

    const frameUs = 1_000_000 / o.fps
    const frames = Math.ceil((seq.total / 1000) * o.fps) + 1
    for (let i = 0; i < frames; i++) {
      if (cancelled) break
      if (failure) throw failure
      seq.render(Math.min(seq.total, (i * 1000) / o.fps))
      const frame = new VideoFrame(seq.canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) })
      // 2秒ごとにキーフレーム（途中からの再生・シークができるように）
      encoder.encode(frame, { keyFrame: i % (o.fps * 2) === 0 })
      frame.close()
      // エンコーダーが詰まってきたら待つ。ときどき画面にも処理を返す（進み具合の表示・中止ボタン）
      if (encoder.encodeQueueSize > 6) {
        await new Promise<void>((resolve) => encoder.addEventListener('dequeue', () => resolve(), { once: true }))
      }
      if (i % 4 === 0) {
        onProgress(i / frames)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    }
    if (cancelled) {
      encoder.close()
      throw new Error('cancelled')
    }
    await encoder.flush()
    if (failure) throw failure
    encoder.close()
    muxer.finalize()
    onProgress(1)
    return new Blob([target.buffer], { type: 'video/mp4' })
  })()

  return {
    promise,
    cancel: () => {
      cancelled = true
    }
  }
}
