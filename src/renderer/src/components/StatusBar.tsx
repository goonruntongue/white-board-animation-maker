import { useMemo } from 'react'
import { formatTime } from '../engine/project'
import { buildTimeline } from '../engine/wb-engine'
import { useEditor } from '../store'

const HINTS: Record<string, string> = {
  draw: 'ドラッグで描き順をなぞる ・ 1〜4 / [ ] でペン先サイズ ・ ホイールでズーム ・ Alt+ドラッグで移動',
  select: 'クリックで軌跡を選択 ・ ↑↓ で前後の軌跡 ・ Delete で削除',
  pan: 'ドラッグで表示位置を移動 ・ ホイールでズーム',
  rect: 'ドラッグで長方形の範囲 ・ Shift で追加 / Alt で除外 ・ クリックで選択解除 ・ Ctrl+D 解除 / Ctrl+Shift+I 反転',
  ellipse: 'ドラッグで楕円の範囲 ・ Shift で追加 / Alt で除外 ・ クリックで選択解除 ・ Ctrl+D 解除 / Ctrl+Shift+I 反転',
  lasso: 'ドラッグで自由に囲む / クリックで頂点を打つ多角形 ・ Shift で追加 / Alt で除外 ・ Ctrl+D 解除'
}

export function StatusBar({ zoom }: { zoom: number }): React.JSX.Element {
  const project = useEditor((s) => s.project)
  const tool = useEditor((s) => s.tool)
  const selection = useEditor((s) => s.selection)
  const total = useMemo(() => buildTimeline(project).total, [project])
  const img = project.image

  return (
    <div className="statusbar">
      <span>{img ? `${img.width} × ${img.height}px` : '画像なし'}</span>
      <span>軌跡 {project.strokes.length}</span>
      <span>全長 {formatTime(total)}</span>
      <span>ペン先 {project.settings.defaultRevealWidth}px</span>
      {selection && <span className="sel-badge">選択範囲あり</span>}
      <span className="hint">{img ? HINTS[tool] : '画像をドラッグ＆ドロップして始めましょう'}</span>
      <span className="right">{Math.round(zoom * 100)}%</span>
    </div>
  )
}
