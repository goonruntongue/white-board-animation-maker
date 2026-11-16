import { useEffect, useState } from 'react'
import { autoTrace, type AutoDetail, type AutoSpeed } from '../engine/autoTrace'
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

/** 画像を解析して、描き順（軌跡）の下書きを自動で作る */
export function AutoTraceDialog(): React.JSX.Element {
  const project = useEditor((s) => s.project)
  const { openDialog, notify } = useEditor.getState()
  const [detail, setDetail] = useState<AutoDetail>('normal')
  const [speed, setSpeed] = useState<AutoSpeed>('normal')
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
      const result = autoTrace(img, project.image, project.settings.boardColor, { detail, speed }, start)
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
