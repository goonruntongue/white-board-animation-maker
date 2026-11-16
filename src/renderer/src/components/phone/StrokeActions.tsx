import { buildTimeline } from '../../engine/wb-engine'
import { useEditor } from '../../store'
import { ActionSheet, type SheetAction } from './ActionSheet'

/**
 * 軌跡を長押し（マウスは右クリック）したときのメニュー。
 * タイムラインのアイテムと描き順リストの行で共通に使う。
 */
export function StrokeActions({ strokeId, onClose }: { strokeId: string; onClose: () => void }): React.JSX.Element | null {
  const project = useEditor((s) => s.project)
  const index = project.strokes.findIndex((s) => s.id === strokeId)
  const stroke = project.strokes[index]
  if (!stroke) return null
  const st = useEditor.getState()
  const count = project.strokes.length

  const playFromHere = (): void => {
    const seg = buildTimeline(st.project).segments.find((g) => g.index === index)
    st.select(stroke.id)
    st.setTime(seg ? seg.start : 0)
    st.setPlaying(true)
  }

  const actions: SheetAction[] = [
    { icon: 'play', label: 'ここから再生', onSelect: playFromHere, disabled: !!stroke.hidden },
    {
      icon: 'sliders',
      label: '詳しく編集',
      note: '名前・見せる幅・再生時間・待機・表示範囲',
      onSelect: () => {
        st.select(stroke.id)
        st.setMobileSheet('inspector')
      }
    },
    { icon: 'record', label: '録り直す', note: 'もう一度なぞって置き換える', onSelect: () => (st.select(stroke.id), st.setRerecord(stroke.id)) },
    { icon: 'up', label: '前へ移動', note: '描く順番を1つ早く', disabled: index === 0, onSelect: () => st.moveStroke(stroke.id, index - 1) },
    { icon: 'down', label: '後ろへ移動', note: '描く順番を1つ遅く', disabled: index === count - 1, onSelect: () => st.moveStroke(stroke.id, index + 1) },
    { icon: 'layers', label: '複製', note: 'すぐ後ろにコピーを作る', onSelect: () => st.duplicateStroke(stroke.id) },
    {
      icon: stroke.hidden ? 'eye' : 'eyeOff',
      label: stroke.hidden ? '再生に含める' : '再生から外す',
      onSelect: () => st.updateStroke(stroke.id, { hidden: !stroke.hidden })
    },
    { icon: 'trash', label: '削除', note: '元に戻す（↶）で取り消せます', danger: true, onSelect: () => st.removeStroke(stroke.id) }
  ]

  return <ActionSheet title={`#${index + 1}  ${stroke.name}`} actions={actions} onClose={onClose} />
}
