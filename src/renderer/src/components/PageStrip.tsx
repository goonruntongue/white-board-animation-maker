import { useRef, useState } from 'react'
import { importImageDialog, replaceImageDialog } from '../commands'
import { useLongPress } from '../lib/useLongPress'
import { useEditor } from '../store'
import { Icon } from './Icon'
import { ActionSheet, type SheetAction } from './phone/ActionSheet'

/**
 * ページ（スライド）の一覧。タップで切り替え、＋で画像を選んでページを追加、
 * 長押し（右クリック）で並べ替え・複製・削除。
 */
export function PageStrip(): React.JSX.Element {
  const project = useEditor((s) => s.project)
  const { gotoPage, deletePage, movePage, duplicatePage } = useEditor.getState()
  const [menuFor, setMenuFor] = useState<number | null>(null)
  const pressed = useRef<number | null>(null)
  const lp = useLongPress(() => {
    if (pressed.current !== null) setMenuFor(pressed.current)
  }, '.page-thumb')
  const indexOf = (e: React.SyntheticEvent): number | null => {
    const v = (e.target as HTMLElement).closest<HTMLElement>('[data-page]')?.dataset.page
    return v === undefined ? null : Number(v)
  }
  const count = project.pages.length

  const actions = (i: number): SheetAction[] => [
    { icon: 'up', label: '前へ移動', disabled: i === 0, onSelect: () => movePage(i, i - 1) },
    { icon: 'down', label: '後ろへ移動', disabled: i === count - 1, onSelect: () => movePage(i, i + 1) },
    { icon: 'layers', label: '複製', note: '描き順ごとコピーする', onSelect: () => duplicatePage(i) },
    {
      icon: 'image',
      label: '画像を差し替える',
      note: '描き順はそのまま残ります',
      onSelect: () => {
        gotoPage(i)
        void replaceImageDialog()
      }
    },
    {
      icon: 'trash',
      label: count > 1 ? 'このページを削除' : 'このページを空にする',
      note: '元に戻す（↶）で取り消せます',
      danger: true,
      onSelect: () => deletePage(i)
    }
  ]

  return (
    <div className="page-strip" aria-label="ページ">
      <span className="page-strip-label">
        ページ
        <b>
          {project.pageIndex + 1}/{count}
        </b>
      </span>
      <div
        className="page-list"
        {...lp.handlers}
        onPointerDown={(e) => {
          pressed.current = indexOf(e)
          if (pressed.current !== null) lp.handlers.onPointerDown(e)
        }}
        onContextMenu={(e) => {
          pressed.current = indexOf(e)
          if (pressed.current !== null) lp.handlers.onContextMenu(e)
        }}
      >
        {project.pages.map((pg, i) => {
          // 編集中のページは、作業中の最新の画像を見せる
          const image = i === project.pageIndex ? project.image : pg.image
          return (
            <button
              key={pg.id}
              data-page={i}
              className={`page-thumb ${i === project.pageIndex ? 'on' : ''}`}
              title={`ページ ${i + 1}（長押し・右クリックでメニュー）`}
              aria-current={i === project.pageIndex}
              onClick={() => {
                if (!lp.fired()) gotoPage(i)
              }}
            >
              {image ? <img src={image.dataUrl} alt="" draggable={false} /> : <span className="page-empty">空</span>}
              <i>{i + 1}</i>
            </button>
          )
        })}
        <button
          className="page-thumb add"
          title="画像を選んでページを追加"
          aria-label="ページを追加"
          onClick={() => {
            // いまのページが空なら、まずそこへ入る。画像があれば新しいページになる
            void importImageDialog()
          }}
        >
          <Icon name="image" size={15} />
          <i>＋</i>
        </button>
      </div>
      {menuFor !== null && <ActionSheet title={`ページ ${menuFor + 1}`} actions={actions(menuFor)} onClose={() => setMenuFor(null)} />}
    </div>
  )
}
