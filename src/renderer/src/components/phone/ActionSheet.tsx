import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from '../Icon'

export interface SheetAction {
  icon: IconName
  label: string
  note?: string
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  /** 選択中の項目（ランプが点く） */
  active?: boolean
}

/** 画面下から出る選択肢（iOS / Android のアクションシートと同じ使い勝手） */
export function ActionSheet({
  title,
  actions,
  onClose,
  footer
}: {
  title: string
  actions: SheetAction[]
  onClose: () => void
  footer?: ReactNode
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 呼び出し元（上部バー・ドックなど）の重なり順に閉じ込められないよう、ページの一番上（body 直下）に出す
  return createPortal(
    <div className="action-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="action-sheet" role="dialog" aria-label={title}>
        <span className="sheet-grip static" aria-hidden />
        <div className="action-title">{title}</div>
        <div className="action-list">
          {actions.map((a) => (
            <button
              key={a.label}
              className={`action-item ${a.danger ? 'danger' : ''} ${a.active ? 'on' : ''}`}
              disabled={a.disabled}
              onClick={() => {
                onClose()
                a.onSelect()
              }}
            >
              <span className="action-icon">
                <Icon name={a.icon} size={20} />
              </span>
              <span className="action-text">
                <span>{a.label}</span>
                {a.note && <small>{a.note}</small>}
              </span>
            </button>
          ))}
        </div>
        {footer}
        <button className="btn action-cancel" onClick={onClose}>
          キャンセル
        </button>
      </div>
    </div>,
    document.body
  )
}
