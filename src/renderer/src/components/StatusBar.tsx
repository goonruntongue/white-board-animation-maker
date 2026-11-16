import { useMemo } from 'react'
import { formatTime } from '../engine/project'
import { buildTimeline } from '../engine/wb-engine'
import { useEditor } from '../store'

const HINTS: Record<string, string> = {
  draw: 'ドラッグで描き順をなぞる ・ 1〜5 / [ ] でペン先サイズ（最大 600px） ・ ホイールでズーム ・ Alt+ドラッグで移動',
  erase: 'ドラッグで、選んでいる軌跡の表示を消す（道筋と時間はそのまま） ・ 1〜4 / [ ] で大きさ ・ 元に戻すで取り消し',
  select: 'クリックで軌跡を選択 ・ ↑↓ で前後の軌跡 ・ Delete で削除',
  pan: 'ドラッグで表示位置を移動 ・ ホイールでズーム',
  rect: 'ドラッグで長方形の範囲 ・ 合成モードはツールバーで切替（Shift 追加 / Alt 除外 / Shift+Alt 交差） ・ Ctrl+A 全体 / Ctrl+D 解除',
  ellipse: 'ドラッグで楕円の範囲 ・ 合成モードはツールバーで切替（Shift 追加 / Alt 除外 / Shift+Alt 交差） ・ Ctrl+A 全体 / Ctrl+D 解除',
  lasso: 'ドラッグで自由に囲む / クリックで多角形 ・ Shift 追加 / Alt 除外 / Shift+Alt 交差 ・ Ctrl+A 全体 / Ctrl+D 解除'
}

export function StatusBar({ zoom }: { zoom: number }): React.JSX.Element {
  const project = useEditor((s) => s.project)
  const tool = useEditor((s) => s.tool)
  const selection = useEditor((s) => s.selection)
  const dirty = useEditor((s) => s.dirty)
  const total = useMemo(() => buildTimeline(project).total, [project])
  const img = project.image

  return (
    <div className="statusbar">
      <span>{img ? `${img.width} × ${img.height}px` : '画像なし'}</span>
      <span>軌跡 {project.strokes.length}</span>
      <span>全長 {formatTime(total)}</span>
      <span>ペン先 {project.settings.defaultRevealWidth}px</span>
      <span className="led-item" title="選択範囲">
        <i className={`led ${selection ? 'on' : ''}`} />
        選択範囲
      </span>
      <span className="led-item" title="保存状態">
        <i className={`led ${dirty ? 'warn' : 'ok'}`} />
        {dirty ? '未保存' : '保存済み'}
      </span>
      <span className="hint">{img ? HINTS[tool] : '画像をドラッグ＆ドロップして始めましょう'}</span>
      <span className="right">{Math.round(zoom * 100)}%</span>
    </div>
  )
}
