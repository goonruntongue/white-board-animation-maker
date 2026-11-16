import { useEffect, useRef, useState } from 'react'
import { importSampleImage } from '../commands'

const steps = [
  { title: 'まずは画像を読み込みます', text: '「画像を選ぶ」から画像を開きます。練習するときは、下のボタンから使い方のサンプル画像を読み込めます。' },
  { title: '描き順を作ります', text: '「描く」を選び、画像の線や文字を描きたい順になぞります。パソコンでは上部の「自動」、スマートフォンではメニューの「描き順を自動で作る」から下書きも作れます。' },
  { title: '動きを確認して調整します', text: '画面下の再生ボタンで、手が描いていく様子を確認します。描き順や設定を調整し、好みの動きに仕上げましょう。' },
  { title: '完成したら書き出します', text: '動画または HTML として書き出せます。後から編集を続けたい場合は、プロジェクトも保存しておきましょう。' }
]

export function TourGuide({ onClose, isPhone }: { onClose: () => void; isPhone: boolean }): React.JSX.Element {
  const [step, setStep] = useState(0)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { closeRef.current?.focus() }, [])
  const current = steps[step]
  return (
    <div className="tour-backdrop" onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') onClose() }}>
      <section className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-description">
        <div className="tour-top"><span>使い方ガイド　{step + 1} / {steps.length}</span><button ref={closeRef} className="btn small" onClick={onClose} aria-label="ガイドを閉じる">閉じる</button></div>
        <div className="tour-progress" aria-hidden="true">{steps.map((_, i) => <span key={i} className={i <= step ? 'on' : ''} />)}</div>
        <h2 id="tour-title">{current.title}</h2><p id="tour-description">{current.text}</p>
        {step === 0 && <button className="btn" onClick={() => { onClose(); void importSampleImage() }}>サンプル画像を読み込む</button>}
        <p className="tour-note">{isPhone ? 'ガイドとツアーは、上部の ⚙ からいつでも開けます。' : 'ガイドとツアーは、上部右の ⚙ からいつでも開けます。'}</p>
        <div className="tour-actions"><button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>戻る</button><button className="btn primary" onClick={() => step === steps.length - 1 ? onClose() : setStep(step + 1)}>{step === steps.length - 1 ? '完了' : '次へ'}</button></div>
      </section>
    </div>
  )
}
