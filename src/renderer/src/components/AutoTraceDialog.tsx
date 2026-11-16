import { useEffect, useState } from 'react'
import { autoTrace, MOTION_PRESETS, type AutoDetail, type AutoSpeed } from '../engine/autoTrace'
import { SliderField } from './Field'
import { loadImage } from '../engine/wb-engine'
import { useEditor } from '../store'
import { Icon } from './Icon'

const DETAILS: { id: AutoDetail; label: string; note: string }[] = [
  { id: 'fine', label: '細かく', note: '単語・小さな図ごと' },
  { id: 'normal', label: 'ふつう', note: '行・図ごと' },
  { id: 'coarse', label: '大きく', note: '段落・まとまりごと' }
]
const SPEEDS: { id: AutoSpeed; label: string }[] = [
  { id: 'slow', label: 'ゆっくり' },
  { id: 'normal', label: 'ふつう' },
  { id: 'fast', label: '速い' }
]

// 前回選んだ設定を覚えておく（この端末の利用者ごとの好み）
const PREF_KEY = 'wbam.autoTrace'
interface AutoPrefs {
  detail: AutoDetail
  speed: AutoSpeed
  scrubV: number
  scrubH: number
}
function loadPrefs(): AutoPrefs {
  const base: AutoPrefs = { detail: 'normal', speed: 'normal', scrubV: 0, scrubH: 0 }
  try {
    return { ...base, ...(JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Partial<AutoPrefs>) }
  } catch {
    return base
  }
}
function savePrefs(p: AutoPrefs): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p))
  } catch {
    /* 保存できなくても続ける */
  }
}

/** 画像を解析して、描き順（軌跡）の下書きを自動で作る */
export function AutoTraceDialog(): React.JSX.Element {
  const project = useEditor((s) => s.project)
  const { openDialog, notify } = useEditor.getState()
  const [prefs] = useState(loadPrefs)
  const [detail, setDetail] = useState<AutoDetail>(prefs.detail)
  const [speed, setSpeed] = useState<AutoSpeed>(prefs.speed)
  // 手の動き：上下・左右のごしごしの強さ（0〜1）
  const [scrubV, setScrubV] = useState(prefs.scrubV)
  const [scrubH, setScrubH] = useState(prefs.scrubH)
  const preset = MOTION_PRESETS.find((m) => Math.abs(m.scrubV - scrubV) < 0.005 && Math.abs(m.scrubH - scrubH) < 0.005)
  const [mode, setMode] = useState<'replace' | 'append'>('replace')
  const [busy, setBusy] = useState(false)
  const existing = project.strokes.length
  const close = (): void => openDialog(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = async (): Promise<void> => {
    if (!project.image) return
    setBusy(true)
    try {
      const img = await loadImage(project.image.dataUrl)
      const start = mode === 'append' ? existing : 0
      savePrefs({ detail, speed, scrubV, scrubH })
      const result = autoTrace(img, project.image, project.settings.boardColor, { detail, speed, scrubV, scrubH }, start)
      const st = useEditor.getState()
      // まとめて1回の変更にする（「元に戻す」1回で取り消せる）
      st.commit((p) => ({ ...p, strokes: mode === 'append' ? [...p.strokes, ...result.strokes] : result.strokes }))
      st.select(null)
      st.setViewMode('edit')
      st.setTime(0)
      notify(
        result.fallback
          ? '文字や図をうまく分けられなかったため、画像全体を1本の軌跡にしました'
          : `${result.blocks} 本の軌跡を作りました。再生して確かめ、順番や速さは描き順リストで直せます`
      )
      close()
    } catch (e) {
      notify('自動生成に失敗しました: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal aria-label="描き順を自動で作る">
        <header>
          <h2>描き順を自動で作る</h2>
          <button className="icon-btn" onClick={close} title="閉じる (Esc)">
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body">
          <p className="lead">
            画像の文字や図をかたまりごとに見つけ、上から順に手が書いていく軌跡を作ります。できた軌跡は下書きです。順番の入れ替え・録り直し・描き足し・削除で、あとから自由に直せます。
          </p>
          <div className="form-grid">
            <label>かたまりの大きさ</label>
            <div className="choice-row" role="radiogroup" aria-label="かたまりの大きさ">
              {DETAILS.map((d) => (
                <button key={d.id} role="radio" aria-checked={detail === d.id} className={`choice ${detail === d.id ? 'on' : ''}`} onClick={() => setDetail(d.id)}>
                  <strong>{d.label}</strong>
                  <small>{d.note}</small>
                </button>
              ))}
            </div>
            <label>手の動き</label>
            <div className="motion-picker">
              <div className="choice-row wrap" role="radiogroup" aria-label="手の動き">
                {MOTION_PRESETS.map((m) => (
                  <button
                    key={m.id}
                    role="radio"
                    aria-checked={preset?.id === m.id}
                    className={`choice ${preset?.id === m.id ? 'on' : ''}`}
                    title={m.note}
                    onClick={() => {
                      setScrubV(m.scrubV)
                      setScrubH(m.scrubH)
                    }}
                  >
                    <MotionIcon v={m.scrubV} h={m.scrubH} />
                    <strong>{m.label}</strong>
                  </button>
                ))}
              </div>
              <SliderField
                label="上下のごしごし"
                hint="0% で上下に振らない（抑える）。大きいほど、行の高さいっぱいに上下させながら進みます"
                value={Math.round(scrubV * 100)}
                min={0}
                max={100}
                step={5}
                unit="%"
                onChange={(v) => setScrubV(v / 100)}
              />
              <SliderField
                label="左右のごしごし"
                hint="0% で行ったり戻ったりしない（抑える）。大きいほど、手が少し戻ってはまた進む動きになります"
                value={Math.round(scrubH * 100)}
                min={0}
                max={100}
                step={5}
                unit="%"
                onChange={(v) => setScrubH(v / 100)}
              />
              <MotionPreview v={scrubV} h={scrubH} />
            </div>
            <label>書く速さ</label>
            <div className="choice-row" role="radiogroup" aria-label="書く速さ">
              {SPEEDS.map((s) => (
                <button key={s.id} role="radio" aria-checked={speed === s.id} className={`choice ${speed === s.id ? 'on' : ''}`} onClick={() => setSpeed(s.id)}>
                  <strong>{s.label}</strong>
                </button>
              ))}
            </div>
            {existing > 0 && (
              <>
                <label>いまの軌跡（{existing} 本）</label>
                <div className="choice-row" role="radiogroup" aria-label="いまの軌跡の扱い">
                  <button role="radio" aria-checked={mode === 'replace'} className={`choice ${mode === 'replace' ? 'on' : ''}`} onClick={() => setMode('replace')}>
                    <strong>置き換える</strong>
                  </button>
                  <button role="radio" aria-checked={mode === 'append'} className={`choice ${mode === 'append' ? 'on' : ''}`} onClick={() => setMode('append')}>
                    <strong>後ろに追加</strong>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <footer className="modal-footer">
          <button className="btn" onClick={close}>
            キャンセル
          </button>
          <button className="btn primary" disabled={busy || !project.image} onClick={() => void run()}>
            <Icon name="sparkle" /> {busy ? '解析中…' : '自動で作る'}
          </button>
        </footer>
      </div>
    </div>
  )
}

/** 手の動きの小さな図（プリセットのボタン用） */
function MotionIcon({ v, h }: { v: number; h: number }): React.JSX.Element {
  return (
    <svg width="44" height="16" viewBox="0 0 44 16" aria-hidden>
      <path d={motionPath(v, h, 44, 16, 6)} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** いまの設定で、手がどう動くかの見本 */
function MotionPreview({ v, h }: { v: number; h: number }): React.JSX.Element {
  return (
    <div className="motion-preview" aria-label="手の動きの見本">
      <svg viewBox="0 0 240 44" preserveAspectRatio="none">
        <path d={motionPath(v, h, 240, 44, 14)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/** autoTrace と同じ考え方で、見本の折れ線を作る（なめらかのときは少し波打つ線） */
function motionPath(v: number, h: number, w: number, hgt: number, cycles: number): string {
  const pad = 3
  const cy = hgt / 2
  if (v <= 0.01 && h <= 0.01) {
    const pts = Array.from({ length: 13 }, (_, i) => {
      const x = pad + ((w - pad * 2) * i) / 12
      return `${x.toFixed(1)},${(cy + Math.sin(i * 0.9) * hgt * 0.08).toFixed(1)}`
    })
    return 'M' + pts.join(' L')
  }
  const count = cycles * 2
  const half = (w - pad * 2) / count
  const pts: string[] = []
  for (let i = 0; i <= count; i++) {
    const dir = i % 2 === 0 ? -1 : 1
    const edge = i === 0 || i === count
    const x = pad + half * i + (edge ? 0 : dir * h * half * 0.95)
    const y = cy + (edge ? 0 : dir * v * (hgt / 2 - pad))
    pts.push(`${Math.max(pad, Math.min(w - pad, x)).toFixed(1)},${y.toFixed(1)}`)
  }
  return 'M' + pts.join(' L')
}
