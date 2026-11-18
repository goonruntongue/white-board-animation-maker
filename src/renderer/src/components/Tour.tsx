// ツアーガイド：画面の各ボタンを順にスポットライトで照らし、そばに吹き出しで説明を出す。
// 対象は data-tour="…" を付けた要素。見つからない（隠れている）ステップは、画面中央に吹き出しを出す。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { importSampleImage } from '../commands'
import { getTourPrefs, setShowTourOnStartup } from '../lib/tour'

interface Step {
  /** data-tour の値。先に見つかったものを使う */
  anchors: string[]
  title: string
  text: string
  /** 吹き出しの中に「サンプル画像を読み込む」ボタンを出す */
  sample?: boolean
}

const DESKTOP_STEPS: Step[] = [
  {
    anchors: ['import', 'import-alt'],
    title: 'まずは画像を読み込みます',
    text: '清書した画像を選ぶか、ウィンドウにドラッグ＆ドロップします。練習するなら、サンプル画像も使えます。',
    sample: true
  },
  {
    anchors: ['auto'],
    title: '描き順を自動で作れます',
    text: '「自動」を押すと、画像の文字や図を見つけて、手が書いていく描き順の下書きを作ります。近いまとまりから自然な順に書く「自然に描く」のほか、範囲を塗るなどの描き方も選べます。'
  },
  {
    anchors: ['draw'],
    title: '自分でなぞることもできます',
    text: '「手描き」の「ブラシ」で画像の上をなぞると、その順番で描かれます。線を選んでからなぞると、そのグループに線を足せます。'
  },
  {
    anchors: ['strokes'],
    title: '描き順を整えます',
    text: '描き順とページの一覧です。並べ替え・録り直し・削除は、行を長押し（右クリック）して選びます。'
  },
  {
    anchors: ['play'],
    title: '再生して確かめます',
    text: '手が描いていく様子を確認できます。速さや待ち時間は、右側のパネルで調整できます。'
  },
  {
    anchors: ['export'],
    title: '完成したら書き出します',
    text: 'スライドに使える HTML、MP4 動画、GIF アニメーションとして書き出せます。続きを編集するなら、プロジェクトも保存しておきましょう。'
  },
  {
    anchors: ['help'],
    title: 'ガイドはここにあります',
    text: 'このボタンから、全機能を詳しく説明した「使い方ガイド」を開けます。ツアーをもう一度見たり、起動時にツアーを出すかどうかを切り替えたりもできます。'
  }
]

const PHONE_STEPS: Step[] = [
  {
    anchors: ['import', 'menu'],
    title: 'まずは画像を読み込みます',
    text: '画像を選ぶか、写真を撮って読み込みます。練習するなら、サンプル画像も使えます。',
    sample: true
  },
  {
    anchors: ['auto-phone', 'menu'],
    title: 'まずは描き順を自動で作ります',
    text: '「自動で作る」（下の「自動」からも）で、画像から描き順の下書きをすぐに作れます。範囲を選ぶと、その範囲だけを塗ることもできます。'
  },
  {
    anchors: ['draw'],
    title: '気になる線を手描きで直します',
    text: 'タイムラインで線を選んで「手描き」のブラシでなぞると、その線を描き直せます。何も選ばずになぞれば、最初から手で描くこともできます。2本指で拡大・移動できます。'
  },
  {
    anchors: ['strokes'],
    title: '描き順を整えます',
    text: '描き順とページの一覧が開きます。行を長押しすると、並べ替え・録り直し・削除ができます。'
  },
  {
    anchors: ['play'],
    title: '再生して確かめます',
    text: '画像を読み込むと、画面の下に再生ボタンが出ます。手が描いていく様子を確認できます。'
  },
  {
    anchors: ['export'],
    title: '完成したら書き出します',
    text: 'HTML スライド、MP4 動画、GIF アニメーションとして書き出せます。'
  },
  {
    anchors: ['help'],
    title: 'ガイドはここにあります',
    text: 'ここから、全機能を詳しく説明した「使い方ガイド」を開けます。ツアーをもう一度見ることもできます。'
  }
]

const PAD = 6 // スポットライトの余白
const GAP = 12 // 対象と吹き出しの間
const MARGIN = 10 // 画面の端との余白

type Rect = { x: number; y: number; w: number; h: number }

function findAnchor(anchors: string[]): HTMLElement | null {
  for (const a of anchors) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${a}"]`)) {
      const r = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      if (r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && r.bottom > 0 && r.top < innerHeight) return el
    }
  }
  return null
}

export function Tour({ isPhone, onClose }: { isPhone: boolean; onClose: () => void }): React.JSX.Element {
  const steps = isPhone ? PHONE_STEPS : DESKTOP_STEPS
  const [index, setIndex] = useState(0)
  const [hide, setHide] = useState(!getTourPrefs().showOnStartup)
  const [target, setTarget] = useState<Rect | null>(null)
  const [bubble, setBubble] = useState<{ x: number; y: number; side: 'top' | 'bottom' | 'center'; arrow: number } | null>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const step = steps[index]
  const last = index === steps.length - 1

  // 閉じるとき：「次回から表示しない」の選択を保存する
  const finish = useCallback(() => {
    setShowTourOnStartup(!hide)
    onClose()
  }, [hide, onClose])

  const go = (d: number): void => setIndex((i) => Math.max(0, Math.min(steps.length - 1, i + d)))

  // 対象の位置を追いかける（画面の大きさが変わる・パネルが動くなどに対応）
  const measure = useCallback(() => {
    const el = findAnchor(step.anchors)
    if (!el) {
      setTarget(null)
      return
    }
    const r = el.getBoundingClientRect()
    setTarget((prev) => {
      const next = { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 }
      return prev && Math.abs(prev.x - next.x) < 0.5 && Math.abs(prev.y - next.y) < 0.5 && Math.abs(prev.w - next.w) < 0.5 && Math.abs(prev.h - next.h) < 0.5 ? prev : next
    })
  }, [step])

  useEffect(() => {
    measure()
    const id = window.setInterval(measure, 250)
    window.addEventListener('resize', measure)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  // 吹き出しの置き場所：下に入れば下、だめなら上。左右は画面に収まるように寄せる
  useLayoutEffect(() => {
    const b = bubbleRef.current
    if (!b) return
    const bw = b.offsetWidth
    const bh = b.offsetHeight
    if (!target) {
      setBubble({ x: (innerWidth - bw) / 2, y: (innerHeight - bh) / 2, side: 'center', arrow: 0 })
      return
    }
    const cx = target.x + target.w / 2
    const below = target.y + target.h + GAP
    const above = target.y - GAP - bh
    let side: 'top' | 'bottom' = 'bottom'
    let y = below
    if (below + bh > innerHeight - MARGIN && above >= MARGIN) {
      side = 'top'
      y = above
    } else if (below + bh > innerHeight - MARGIN) {
      // 上下どちらにも入らない（大きな対象）：対象の内側の下寄りに重ねる
      y = Math.max(MARGIN, innerHeight - MARGIN - bh)
    }
    const x = Math.max(MARGIN, Math.min(innerWidth - MARGIN - bw, cx - bw / 2))
    setBubble({ x, y, side, arrow: Math.max(18, Math.min(bw - 18, cx - x)) })
  }, [target, index])

  // キー操作：ツアー中は後ろの画面にキーを渡さない
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      e.stopImmediatePropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        finish()
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        if (last) finish()
        else go(1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(-1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finish, last])

  useEffect(() => nextRef.current?.focus(), [index])

  return (
    <div className="tour-layer" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text">
      {/* 後ろの画面を触れないようにする（スポットライトの外は暗く） */}
      <div className="tour-shield" />
      {target ? (
        <div className="tour-spot" style={{ left: target.x, top: target.y, width: target.w, height: target.h }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div
        ref={bubbleRef}
        className={`tour-bubble ${bubble?.side ?? 'center'}`}
        style={{
          left: bubble?.x ?? -9999,
          top: bubble?.y ?? -9999,
          ['--arrow-x' as string]: `${bubble?.arrow ?? 0}px`
        }}
      >
        <div className="tour-head">
          <span className="tour-count">
            {index + 1} / {steps.length}
          </span>
          <button className="tour-skip" onClick={finish}>
            スキップ
          </button>
        </div>
        <h3 id="tour-title">{step.title}</h3>
        <p id="tour-text">{step.text}</p>
        {step.sample && (
          <button
            className="btn small"
            onClick={() => {
              void importSampleImage()
              go(1)
            }}
          >
            サンプル画像を読み込む
          </button>
        )}
        <div className="tour-dots" aria-hidden>
          {steps.map((_, i) => (
            <i key={i} className={i === index ? 'on' : i < index ? 'done' : ''} />
          ))}
        </div>
        <div className="tour-foot">
          <label className="tour-optout">
            <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} />
            次回から表示しない
          </label>
          <div className="tour-nav">
            {index > 0 && (
              <button className="btn small" onClick={() => go(-1)}>
                戻る
              </button>
            )}
            <button ref={nextRef} className="btn small primary" onClick={() => (last ? finish() : go(1))}>
              {last ? '完了' : '次へ'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
