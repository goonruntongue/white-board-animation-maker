import { useEffect, useRef, useState } from 'react'
import { autoTrace, MOTION_PRESETS, type AutoDetail, type AutoSpeed } from '../engine/autoTrace'
import { SliderField } from './Field'
import { clipBounds, loadImage, rasterizeClip } from '../engine/wb-engine'
import type { ClipRegion, ImageAsset } from '../engine/types'
import { useEditor } from '../store'
import { Icon } from './Icon'
import { GuideLink } from './UsageGuide'
import { fillSelection, type FillDirection, type FillMotion } from '../engine/fillSelection'

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
  revealWidth: number
  detail: AutoDetail
  pathMode: 'natural' | 'group' | 'ink'
  speed: AutoSpeed
  scrubV: number
  scrubH: number
  scrubCycles: number
  scrubTilt: number
  motionVersion: number
}
function loadPrefs(): AutoPrefs {
  const base: AutoPrefs = { revealWidth: 0, detail: 'normal', pathMode: 'natural', speed: 'normal', scrubV: 0, scrubH: 0, scrubCycles: 8, scrubTilt: 0, motionVersion: 2 }
  try {
    const stored = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Partial<AutoPrefs>
    return { ...base, ...stored, ...(stored.motionVersion === 2 ? {} : { scrubV: 0, scrubH: 0, scrubCycles: 8, scrubTilt: 0, motionVersion: 2 }) }
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
  const selection = useEditor((s) => s.selection)
  const selectedId = useEditor((s) => s.selectedId)
  const selectedStroke = project.strokes.find((s) => s.id === selectedId)
  const editingStroke = useEditor((s) => s.tool === 'live' && !!s.livePart)
  const { openDialog, notify } = useEditor.getState()
  const [prefs] = useState(loadPrefs)
  const [revealWidth, setRevealWidth] = useState(prefs.revealWidth)
  const [detail, setDetail] = useState<AutoDetail>(prefs.detail)
  const [pathMode, setPathMode] = useState<'natural' | 'group' | 'ink'>(prefs.pathMode === 'ink' || prefs.pathMode === 'group' ? prefs.pathMode : 'natural')
  const [fill, setFill] = useState(!!selection && !editingStroke)
  // 選択範囲：範囲全体を均一に塗る（area）か、範囲の中の文字・図を見分けて自然な順に描く（detect）
  const [fillKind, setFillKind] = useState<'area' | 'detect'>('area')
  const [fillDirection, setFillDirection] = useState<FillDirection>('horizontal')
  const [fillMotion, setFillMotion] = useState<FillMotion>('smooth')
  const [fillWidth, setFillWidth] = useState(Math.max(1, project.settings.defaultRevealWidth))
  const [speed, setSpeed] = useState<AutoSpeed>(prefs.speed)
  // 手の動き：上下・左右のごしごしの強さ（0〜1）
  const [scrubV, setScrubV] = useState(prefs.scrubV)
  const [scrubH, setScrubH] = useState(prefs.scrubH)
  const [scrubCycles, setScrubCycles] = useState(prefs.scrubCycles)
  const [scrubTilt, setScrubTilt] = useState(prefs.scrubTilt)
  const preset = MOTION_PRESETS.find((m) => Math.abs(m.scrubV - scrubV) < 0.005 && Math.abs(m.scrubH - scrubH) < 0.005)
  const [mode, setMode] = useState<'replace' | 'append' | 'stroke'>(selectedStroke?.clip && (editingStroke || !selection) ? 'stroke' : 'replace')
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
      const start = mode === 'append' ? existing : 0
      savePrefs({ detail, pathMode, speed, scrubV, scrubH, revealWidth, scrubCycles, scrubTilt, motionVersion: 2 })
      const result = mode === 'stroke' && selectedStroke?.clip
        ? autoTrace(await loadImage(project.image.dataUrl), project.image, project.settings.boardColor, { detail, pathMode, speed, scrubV, scrubH, scrubCycles, scrubTilt, revealWidth, within: selectedStroke.clip }, 0)
        : fill && fillKind === 'detect'
        ? autoTrace(await loadImage(project.image.dataUrl), project.image, project.settings.boardColor, { detail, pathMode: 'natural', speed, revealWidth, within: selection! }, start)
        : fill
        ? { strokes: [fillSelection(selection!, project.image, fillWidth, fillDirection, fillMotion, project.image.width * ({ slow: 0.38, normal: 0.65, fast: 1.1 }[speed]), start, scrubV, scrubH, scrubCycles, scrubTilt)], blocks: 1, fallback: false }
        : autoTrace(await loadImage(project.image.dataUrl), project.image, project.settings.boardColor, { detail, pathMode, speed, scrubV, scrubH, scrubCycles, scrubTilt, revealWidth }, start)
      const st = useEditor.getState()
      if (st.project !== project || (mode === 'stroke' && !selectedStroke?.clip)) throw new Error('編集中の内容が変わりました。もう一度お試しください')
      if (result.strokes.length === 0) throw new Error('新しいグループを作れませんでした。元のグループはそのままです')
      // まとめて1回の変更にする（「元に戻す」1回で取り消せる）
      st.commit((p) => ({ ...p, strokes: mode === 'stroke' ? p.strokes.flatMap((s) => s.id === selectedStroke!.id ? result.strokes : [s]) : mode === 'append' ? [...p.strokes, ...result.strokes] : result.strokes }))
      st.select(null)
      st.setLivePart(null)
      st.setViewMode('edit')
      st.setTime(0)
      notify(
        result.fallback
          ? '文字や図をうまく分けられなかったため、画像全体を1つのグループにしました'
          : `${result.blocks} 個のグループを作りました。再生して確かめ、順番や速さは描き順リストで直せます`
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
          <span className="modal-head-actions">
            <GuideLink section="auto" label="描き順を自動で作る" />
            <button className="icon-btn" onClick={close} title="閉じる (Esc)">
              <Icon name="x" />
            </button>
          </span>
        </header>
        <div className="modal-body">
          <p className="lead">
            画像の文字や図をかたまりごとに見つけ、上から順に手が書いていくグループを作ります。できたグループは下書きです。順番の入れ替え・録り直し・描き足し・削除で、あとから自由に直せます。
          </p>
          <div className="form-grid">
            <label>描き方</label>
            <div className="choice-row" role="radiogroup" aria-label="描き方">
              <button role="radio" aria-checked={!fill && pathMode === 'natural'} className={`choice ${!fill && pathMode === 'natural' ? 'on' : ''}`} onClick={() => { setFill(false); setPathMode('natural') }}><strong>自然に書く</strong><small>近い所から・行は左→右</small></button>
              <button role="radio" aria-checked={!fill && pathMode === 'group'} className={`choice ${!fill && pathMode === 'group' ? 'on' : ''}`} onClick={() => { setFill(false); setPathMode('group') }}><strong>かたまりを描く</strong><small>まとまりごとに描く</small></button>
              <button role="radio" aria-checked={!fill && pathMode === 'ink'} className={`choice ${!fill && pathMode === 'ink' ? 'on' : ''}`} onClick={() => { setFill(false); setPathMode('ink') }}><strong>インクの線をたどる</strong><small>試験版・書き順は推定</small></button>
              <button role="radio" aria-checked={fill} className={`choice ${fill ? 'on' : ''}`} onClick={() => { setFill(true); if (mode === 'stroke') setMode('append') }}><strong>選択範囲を塗る</strong><small>選んだ範囲だけ</small></button>
            </div>
            {fill && <>
              <p>先に画像上で範囲を選択してください。選択範囲の中を順に表示します。</p>
              {!selection && <p>選択範囲がありません。ダイアログを閉じて範囲を選んでください。</p>}
              <label>塗り方</label>
              <div className="choice-row" role="radiogroup" aria-label="塗り方">
                <button role="radio" aria-checked={fillKind === 'area'} className={`choice ${fillKind === 'area' ? 'on' : ''}`} onClick={() => setFillKind('area')}><strong>範囲全体を塗る</strong><small>端から端まで均一に</small></button>
                <button role="radio" aria-checked={fillKind === 'detect'} className={`choice ${fillKind === 'detect' ? 'on' : ''}`} onClick={() => setFillKind('detect')}><strong>中の文字・図を見分けて描く</strong><small>自然に書くと同じ順番</small></button>
              </div>
              {fillKind === 'detect' && <p>範囲の中の文字や図だけを見分け、「自然に書く」と同じ順番と動きで描きます。範囲の外は表示しません。</p>}
              {fillKind === 'area' && <>
              <label>進む方向</label>
              <div className="choice-row" role="radiogroup" aria-label="進む方向">
                <button role="radio" aria-checked={fillDirection === 'horizontal'} className={`choice ${fillDirection === 'horizontal' ? 'on' : ''}`} onClick={() => setFillDirection('horizontal')}>左から右へ</button>
                <button role="radio" aria-checked={fillDirection === 'vertical'} className={`choice ${fillDirection === 'vertical' ? 'on' : ''}`} onClick={() => setFillDirection('vertical')}>上から下へ</button>
              </div>
              <label>手の動き</label>
              <div className="choice-row" role="radiogroup" aria-label="塗るときの手の動き">
                {([['smooth', 'なめらか'], ['vertical', '上下にごしごし'], ['horizontal', '左右にごしごし']] as const).map(([id, label]) => <button key={id} role="radio" aria-checked={fillMotion === id} className={`choice ${fillMotion === id ? 'on' : ''}`} onClick={() => { setFillMotion(id); if (id === 'vertical' && scrubV === 0) setScrubV(0.12); if (id === 'horizontal' && scrubH === 0) setScrubH(0.12) }}>{label}</button>)}
              </div>
              {selection && project.image && <FillPreview image={project.image} selection={selection} width={fillWidth} direction={fillDirection} motion={fillMotion} v={scrubV} h={scrubH} cycles={scrubCycles} tilt={scrubTilt} />}
              {fillMotion !== 'smooth' && <>
                <SliderField label={fillMotion === 'vertical' ? '上下の振幅' : '左右の振幅'} hint={fillMotion === 'vertical' ? '100%は画像の高さです。' : '100%は画像の幅です。'} value={Math.round((fillMotion === 'vertical' ? scrubV : scrubH) * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => fillMotion === 'vertical' ? setScrubV(Math.max(0, Math.min(100, v)) / 100) : setScrubH(Math.max(0, Math.min(100, v)) / 100)} />
                {fillMotion === 'vertical' && <SliderField label="振りの傾き" hint="50%が垂直。左側・右側に傾けられます。" value={Math.round(50 + scrubTilt * 50)} min={0} max={100} step={1} unit="%" onChange={(v) => setScrubTilt((Math.max(0, Math.min(100, v)) - 50) / 50)} />}
                <SliderField label="振動数（1区間の往復回数）" value={scrubCycles} min={1} max={100} step={1} unit="回" onChange={(v) => setScrubCycles(Math.max(1, Math.min(100, v)))} />
                <MotionPreview v={fillMotion === 'vertical' ? scrubV : 0} h={fillMotion === 'horizontal' ? scrubH : 0} cycles={scrubCycles} />
              </>}
              <SliderField label="ペンの太さ" value={fillWidth} min={1} max={300} step={1} unit="px" onChange={setFillWidth} />
              </>}
            </>}
            {!fill && pathMode === 'natural' && <p>文字の大きさから行・まとまりを見分けます。近いまとまりを書き切ってから次へ進み、行は1回で左から右へ、背の高い図は左の列から上→下へ書きます。</p>}
            {!fill && pathMode === 'ink' && <p>「自然に書く」と同じ順番でまとまりを選び、その中で線の中心をたどります。線の太さを場所ごとに測ってペンの太さを自動で切り替え、1回なぞれば線の幅全体が見えるようにします。もう見えている線は飛ばすので、細かい線が多い画像でも短い時間で描けます。元の書き順は分からないため推定です。</p>}
            {!fill && <>
            <label>ペンの太さ</label>
            <div className="choice-row">
              <button className={`choice ${revealWidth === 0 ? 'on' : ''}`} onClick={() => setRevealWidth(0)}>自動</button>
              <button className={`choice ${revealWidth > 0 ? 'on' : ''}`} onClick={() => setRevealWidth(revealWidth || 20)}>指定する</button>
            </div>
            {revealWidth === 0 && pathMode === 'ink' && <p>自動：線の太さを測り、にじみの分も含めて覆える太さを、場所ごとに選びます。</p>}
            {revealWidth > 0 && <SliderField label="表示する線の幅" hint="元画像上の幅です。細くするとインクが一部残る場合があります。" value={revealWidth} min={1} max={300} step={1} unit="px" onChange={setRevealWidth} />}
            <label>かたまりの大きさ</label>
            <div className="choice-row" role="radiogroup" aria-label="かたまりの大きさ">
              {DETAILS.map((d) => (
                <button key={d.id} role="radio" aria-checked={detail === d.id} className={`choice ${detail === d.id ? 'on' : ''}`} onClick={() => setDetail(d.id)}>
                  <strong>{d.label}</strong>
                  <small>{d.note}</small>
                </button>
              ))}
            </div>
            {pathMode === 'group' && <>
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
              <SliderField label="上下の振幅" hint="100%は画像の高さです。" value={Math.round(scrubV * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => setScrubV(Math.max(0, Math.min(100, v)) / 100)} />
              <SliderField label="左右の振幅" hint="100%は画像の幅です。" value={Math.round(Math.abs(scrubH) * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => setScrubH(Math.max(0, Math.min(100, v)) / 100)} />
              <SliderField label="振りの傾き" hint="50%が垂直。上下に振る動きを左右へ傾けます。" value={Math.round(50 + scrubTilt * 50)} min={0} max={100} step={1} unit="%" onChange={(v) => setScrubTilt((Math.max(0, Math.min(100, v)) - 50) / 50)} />
              <SliderField label="振動数（1区間の往復回数）" value={scrubCycles} min={1} max={100} step={1} unit="回" onChange={(v) => setScrubCycles(Math.max(1, Math.min(100, v)))} />
              <p>振幅100%は画像全体の高さ・幅です。画像の端では動きが制限されます。</p>
              <MotionPreview v={scrubV} h={scrubH} cycles={scrubCycles} />
            </div>
            </>}
            </>}
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
                <label>いまのグループ（{existing} 個）</label>
                <div className="choice-row" role="radiogroup" aria-label="いまのグループの扱い">
                  {selectedStroke?.clip && !fill && <button role="radio" aria-checked={mode === 'stroke'} className={`choice ${mode === 'stroke' ? 'on' : ''}`} onClick={() => setMode('stroke')}><strong>選択中のグループだけ</strong><small>元の位置で作り直す</small></button>}
                  <button role="radio" aria-checked={mode === 'replace'} className={`choice ${mode === 'replace' ? 'on' : ''}`} onClick={() => setMode('replace')}>
                    <strong>置き換える</strong>
                  </button>
                  <button role="radio" aria-checked={mode === 'append'} className={`choice ${mode === 'append' ? 'on' : ''}`} onClick={() => setMode('append')}>
                    <strong>後ろに追加</strong>
                  </button>
                </div>
                {mode === 'stroke' && <p>選択中のグループの表示範囲だけを解析し、同じ順番の位置に置き換えます。ほかのグループはそのままです。元の時間は引き継がれません。消した部分は解析範囲から除かれます。</p>}
              </>
            )}
          </div>
        </div>
        <footer className="modal-footer">
          <button className="btn" onClick={close}>
            キャンセル
          </button>
          <button className="btn primary" disabled={busy || !project.image || (fill && !selection)} onClick={() => void run()}>
            <Icon name="sparkle" /> {busy ? '解析中…' : '自動で作る'}
          </button>
        </footer>
      </div>
    </div>
  )
}

/** Use the same generator as the final operation, without changing the project. */
function FillPreview({ image, selection, width, direction, motion, v, h, cycles, tilt }: { image: ImageAsset; selection: ClipRegion; width: number; direction: FillDirection; motion: FillMotion; v: number; h: number; cycles: number; tilt: number }): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [message, setMessage] = useState('プレビューを作成中…')
  const [zoomSelection, setZoomSelection] = useState(true)
  useEffect(() => {
    let cancelled = false
    setMessage('プレビューを作成中…')
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const stroke = fillSelection(selection, image, width, direction, motion, image.width * 0.65, 0, v, h, cycles, tilt)
          const source = await loadImage(image.dataUrl)
          const target = canvas.current
          if (cancelled || !target) return
          const bounds = clipBounds(selection, image.width, image.height)
          const margin = Math.max(10, Math.max(bounds.w, bounds.h) * 0.12)
          const x = zoomSelection ? Math.max(0, Math.floor(bounds.x - margin)) : 0
          const y = zoomSelection ? Math.max(0, Math.floor(bounds.y - margin)) : 0
          const right = zoomSelection ? Math.min(image.width, Math.ceil(bounds.x + bounds.w + margin)) : image.width
          const bottom = zoomSelection ? Math.min(image.height, Math.ceil(bounds.y + bounds.h + margin)) : image.height
          const viewWidth = Math.max(1, right - x), viewHeight = Math.max(1, bottom - y)
          const scale = Math.min(1, 640 / viewWidth, 360 / viewHeight)
          target.width = Math.max(1, Math.round(viewWidth * scale))
          target.height = Math.max(1, Math.round(viewHeight * scale))
          const ctx = target.getContext('2d')!
          ctx.drawImage(source, x, y, viewWidth, viewHeight, 0, 0, target.width, target.height)
          ctx.fillStyle = 'rgba(0,0,0,.35)'
          ctx.fillRect(0, 0, target.width, target.height)
          const mask = document.createElement('canvas')
          mask.width = target.width; mask.height = target.height
          const mc = mask.getContext('2d')!
          mc.drawImage(rasterizeClip(selection, image.width, image.height), x, y, viewWidth, viewHeight, 0, 0, target.width, target.height)
          mc.globalCompositeOperation = 'source-in'
          mc.fillStyle = 'rgba(70,180,255,.3)'
          mc.fillRect(0, 0, target.width, target.height)
          ctx.drawImage(mask, 0, 0)
          ctx.beginPath()
          for (const [i, p] of stroke.points.entries()) {
            if (i === 0 || p.b) ctx.moveTo((p.x - x) * scale, (p.y - y) * scale)
            else ctx.lineTo((p.x - x) * scale, (p.y - y) * scale)
          }
          ctx.strokeStyle = '#ff8a32'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke()
          setMessage('青：選択範囲　オレンジ：線（線の間はペンを上げます）')
        } catch (error) {
          if (!cancelled) setMessage('プレビューできません: ' + (error instanceof Error ? error.message : String(error)))
        }
      })()
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [image, selection, width, direction, motion, v, h, cycles, tilt, zoomSelection])
  return <div className="fill-preview"><div className="fill-preview-heading"><strong>作成前のプレビュー</strong><button type="button" className="btn" onClick={() => setZoomSelection(!zoomSelection)}>{zoomSelection ? '画像全体' : '範囲を拡大'}</button></div><canvas ref={canvas} aria-label="選択範囲と生成されるグループのプレビュー" /><p aria-live="polite">{message}{zoomSelection ? '（範囲周辺を拡大中）' : ''}</p></div>
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
function MotionPreview({ v, h, cycles }: { v: number; h: number; cycles: number }): React.JSX.Element {
  return (
    <div className="motion-preview" aria-label="手の動きの見本">
      <svg viewBox="0 0 240 44" preserveAspectRatio="none">
        <path d={motionPath(v, h, 240, 44, cycles)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/** autoTrace と同じ考え方で、見本の折れ線を作る（なめらかのときは少し波打つ線） */
function motionPath(v: number, h: number, w: number, hgt: number, cycles: number): string {
  const pad = 3
  const cy = hgt / 2
  if (v <= 0.01 && Math.abs(h) <= 0.01) {
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
    const x = Math.max(1, Math.min(w - 1, pad + half * i + (edge ? 0 : -dir * h * (w - pad * 2) / 2)))
    const y = cy + (edge ? 0 : dir * v * (hgt / 2 - pad))
    pts.push(`${Math.max(pad, Math.min(w - pad, x)).toFixed(1)},${y.toFixed(1)}`)
  }
  return 'M' + pts.join(' L')
}
