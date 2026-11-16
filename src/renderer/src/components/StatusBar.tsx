import { useMemo } from 'react'
import { formatTime } from '../engine/project'
import { buildTimeline } from '../engine/wb-engine'
import { useEditor } from '../store'

const HINTS: Record<string, string> = {
  draw: 'ドラッグで描き順をなぞる ・ [ ] で幅を調整 ・ ホイールでズーム ・ Alt+ドラッグで移動',
  select: 'クリックで軌跡を選択 ・ ↑↓ で前後の軌跡 ・ Delete で削除',
  pan: 'ドラッグで表示位置を移動 ・ ホイールでズーム'
}

export function StatusBar({ zoom }: { zoom: number }): React.JSX.Element {
  const project = useEditor((s) => s.project)
  const tool = useEditor((s) => s.tool)
  const total = useMemo(() => buildTimeline(project).total, [project])
  const img = project.image

  return (
    <div className="statusbar">
      <span>{img ? `${img.width} × ${img.height}px` : '画像なし'}</span>
      <span>軌跡 {project.strokes.length}</span>
      <span>全長 {formatTime(total)}</span>
      <span>ブラシ幅 {project.settings.defaultRevealWidth}px</span>
      <span className="hint">{img ? HINTS[tool] : '画像をドラッグ＆ドロップして始めましょう'}</span>
      <span className="right">{Math.round(zoom * 100)}%</span>
    </div>
  )
}
