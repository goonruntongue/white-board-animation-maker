// スマホ：絵の右下の「範囲」ボタン。
// 範囲は自動（範囲を塗る）にも手描き（ブラシ・消しゴム）にも効く共通の指定なので、ドックの道具とは分けて絵の上に置く。
//  ・押すと範囲の道具になる（前に使った形）。範囲の道具のときに押すと、形（長方形・楕円・投げ縄）を選べる
//  ・オプションバーの「完了」で、範囲を作る前の道具に戻る
import { useState } from 'react'
import { haptic } from '../../lib/useMedia'
import { useEditor, type Tool } from '../../store'
import { Icon, type IconName } from '../Icon'
import { ActionSheet } from './ActionSheet'

export const RANGE_SHAPES: { id: 'rect' | 'ellipse' | 'lasso'; icon: IconName; label: string; note: string }[] = [
  { id: 'rect', icon: 'selRect', label: '長方形', note: 'ドラッグで四角く囲む' },
  { id: 'ellipse', icon: 'selEllipse', label: '楕円', note: 'ドラッグで丸く囲む' },
  { id: 'lasso', icon: 'lasso', label: '投げ縄', note: 'なぞって囲む／タップで頂点を打つ' }
]

const isRangeTool = (t: Tool): boolean => t === 'rect' || t === 'ellipse' || t === 'lasso'

/** 範囲を作る前の道具（「完了」で戻る先） */
let before: Tool = 'live'

/** 範囲の道具を始める（いまの道具を覚えておく） */
export function startRange(shape?: 'rect' | 'ellipse' | 'lasso'): void {
  const st = useEditor.getState()
  if (!isRangeTool(st.tool)) before = st.tool
  st.setTool(shape ?? st.lastSelTool)
  if (st.mobileSheet) st.setMobileSheet(null)
}

/** 範囲を作り終えて、前の道具に戻る（範囲はそのまま効く） */
export function finishRange(): void {
  const st = useEditor.getState()
  st.setTool(isRangeTool(before) ? 'live' : before)
}

/** PC で形ごとに出すボタンの説明（キーと修飾キー） */
const PC_TIPS: Record<'rect' | 'ellipse' | 'lasso', string> = {
  rect: '長方形で囲む：ドラッグで四角く囲みます（Shift で追加・Alt で除外）（M）',
  ellipse: '楕円で囲む：ドラッグで丸く囲みます（Shift で追加・Alt で除外）（Shift+M）',
  lasso: '投げ縄で囲む：ドラッグで自由な形、クリックで多角形に囲みます（L）'
}

export function RangeButton({ phone = true }: { phone?: boolean }): React.JSX.Element {
  const tool = useEditor((s) => s.tool)
  const lastSel = useEditor((s) => s.lastSelTool)
  const [menu, setMenu] = useState(false)
  const on = isRangeTool(tool)
  // PC：「範囲」の見出しと3つの形を並べ、押した形で範囲の道具になる
  if (!phone) {
    return (
      <div
        className={`range-group ${on ? 'on' : ''}`}
        role="group"
        aria-label="範囲"
        data-tip="範囲：描く範囲・消す範囲・自動で塗る範囲を、形で囲んで決めます。自動にも手描きにも効きます"
      >
        <span className="range-label">範囲</span>
        {RANGE_SHAPES.map((s) => (
          <button
            key={s.id}
            className={`icon-btn ${tool === s.id ? 'on' : ''}`}
            aria-pressed={tool === s.id}
            aria-label={`${s.label}で囲む`}
            data-tip={PC_TIPS[s.id]}
            onClick={() => startRange(s.id)}
          >
            <Icon name={s.icon} />
          </button>
        ))}
      </div>
    )
  }
  const shape = RANGE_SHAPES.find((s) => s.id === (on ? tool : lastSel))!
  return (
    <>
      <button
        className={`range-btn ${on ? 'on' : ''}`}
        aria-pressed={on}
        aria-label="範囲"
        data-tip="範囲：描く範囲・消す範囲・自動で塗る範囲を、形で囲んで決めます（範囲の道具のときに押すと、形を選べます）"
        onClick={() => {
          haptic()
          if (on) setMenu(true)
          else startRange()
        }}
      >
        <Icon name={shape.icon} size={18} />
        <span>範囲</span>
        <span className="range-more" aria-hidden />
      </button>
      {menu && (
        <ActionSheet
          title="範囲の形"
          actions={RANGE_SHAPES.map((s) => ({ icon: s.icon, label: s.label, note: s.note, active: tool === s.id, onSelect: () => startRange(s.id) }))}
          onClose={() => setMenu(false)}
        />
      )}
    </>
  )
}
