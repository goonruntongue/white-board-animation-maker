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

  // 結合：再生から外した軌跡と、再生する軌跡はまとめない（どちらの扱いにするか決められないため）
  const mergeNote = (other: number): string => {
    if (other < 0 || other >= count) return other < 0 ? 'これより前のグループがありません' : 'これより後のグループがありません'
    if (!!project.strokes[other].hidden !== !!stroke.hidden) return '再生から外したグループとは結合できません'
    return `#${other + 1} と1本にまとめる（描くタイミングはそのまま）`
  }
  const canMerge = (other: number): boolean => other >= 0 && other < count && !!project.strokes[other].hidden === !!stroke.hidden

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
    { icon: 'eraser', label: '全部消して線1から', note: '線を全部消して、手描きのブラシで線1から描き直す（名前・順番・待機はそのまま）', onSelect: () => (st.startEmptyGroup(stroke.id), st.setMobileSheet(null)) },
    { icon: 'up', label: '前へ移動', note: '描く順番を1つ早く', disabled: index === 0, onSelect: () => st.moveStroke(stroke.id, index - 1) },
    { icon: 'down', label: '後ろへ移動', note: '描く順番を1つ遅く', disabled: index === count - 1, onSelect: () => st.moveStroke(stroke.id, index + 1) },
    { icon: 'layers', label: '複製', note: 'すぐ後ろにコピーを作る', onSelect: () => st.duplicateStroke(stroke.id) },
    {
      icon: 'merge',
      label: '前のグループと結合',
      note: mergeNote(index - 1),
      disabled: !canMerge(index - 1),
      onSelect: () => st.mergeStroke(stroke.id, 'prev')
    },
    {
      icon: 'merge',
      label: '次のグループと結合',
      note: mergeNote(index + 1),
      disabled: !canMerge(index + 1),
      onSelect: () => st.mergeStroke(stroke.id, 'next')
    },
    {
      icon: stroke.hidden ? 'eye' : 'eyeOff',
      label: stroke.hidden ? '再生に含める' : '再生から外す',
      onSelect: () => st.updateStroke(stroke.id, { hidden: !stroke.hidden })
    },
    { icon: 'trash', label: '削除', note: '元に戻す（↶）で取り消せます', danger: true, onSelect: () => st.removeStroke(stroke.id) }
  ]

  return <ActionSheet title={`#${index + 1}  ${stroke.name}`} actions={actions} onClose={onClose} />
}
