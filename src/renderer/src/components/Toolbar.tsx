import { deselect, importImageDialog, newProject, openExport, openProject, saveProject } from '../commands'
import { isDesktop } from '../lib/platform'
import { useEditor, type Tool } from '../store'
import { Icon, type IconName } from './Icon'
import { PenSizePicker } from './PenSizePicker'

const TOOLS: { id: Tool; icon: IconName; label: string; key: string }[] = [
  { id: 'draw', icon: 'pen', label: '描く', key: 'D' },
  { id: 'select', icon: 'cursor', label: '軌跡を選ぶ', key: 'V' },
  { id: 'pan', icon: 'hand', label: '移動', key: 'H' }
]

const SEL_TOOLS: { id: Tool; icon: IconName; label: string; key: string }[] = [
  { id: 'rect', icon: 'selRect', label: '長方形選択', key: 'M' },
  { id: 'ellipse', icon: 'selEllipse', label: '楕円形選択', key: 'Shift+M' },
  { id: 'lasso', icon: 'lasso', label: '投げ縄（ドラッグで自由形 / クリックで多角形）', key: 'L' }
]

export function Toolbar(): React.JSX.Element {
  const tool = useEditor((s) => s.tool)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const dirty = useEditor((s) => s.dirty)
  const name = useEditor((s) => s.project.name)
  const hasImage = useEditor((s) => !!s.project.image)
  const hasSelection = useEditor((s) => !!s.selection)
  const { setTool, undo, redo } = useEditor.getState()

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="logo">
          <Icon name="pen" size={15} />
        </span>
        <span className="brand-name">Whiteboard Animation Maker</span>
      </div>

      <div className="tb-group">
        <button className="icon-btn" title="新規 (Ctrl+N)" onClick={newProject}>
          <Icon name="file" />
        </button>
        <button className="icon-btn" title="開く (Ctrl+O)" onClick={() => void openProject()}>
          <Icon name="folder" />
        </button>
        <button className="icon-btn" title="保存 (Ctrl+S)" onClick={() => void saveProject()}>
          <Icon name="save" />
        </button>
        <button className="icon-btn" title="画像を読み込む (Ctrl+I)" onClick={() => void importImageDialog()}>
          <Icon name="image" />
        </button>
      </div>

      <div className="tb-group">
        <button className="icon-btn" title="元に戻す (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
          <Icon name="undo" />
        </button>
        <button className="icon-btn" title="やり直す (Ctrl+Y)" disabled={!canRedo} onClick={redo}>
          <Icon name="redo" />
        </button>
      </div>

      <div className="tb-group tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tool-btn ${tool === t.id ? 'on' : ''}`}
            title={`${t.label} (${t.key})`}
            disabled={!hasImage}
            onClick={() => setTool(t.id)}
          >
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="tb-group" title="選択範囲：範囲の外はマスクが外れません（Shift で追加・Alt で除外）">
        {SEL_TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tool-btn icon-only ${tool === t.id ? 'on' : ''}`}
            title={`${t.label} (${t.key})
Shift+ドラッグで追加 / Alt+ドラッグで除外`}
            disabled={!hasImage}
            onClick={() => setTool(t.id)}
          >
            <Icon name={t.icon} />
          </button>
        ))}
        <button className="icon-btn" title="選択を解除 (Ctrl+D)" disabled={!hasSelection} onClick={deselect}>
          <Icon name="deselect" />
        </button>
      </div>

      <PenSizePicker disabled={!hasImage} />

      <div className="doc-title">
        {name}
        {dirty && <span className="dirty-dot" title="未保存の変更があります" />}
        {!isDesktop && <span className="env-badge">ブラウザ版</span>}
      </div>

      <div className="tb-group end">
        <button className="btn" onClick={() => openExport('video')} title="動画 (WebM) として書き出す">
          <Icon name="film" /> 動画
        </button>
        <button className="btn primary" onClick={() => openExport('html')} title="単一HTMLとして書き出す (Ctrl+E)">
          <Icon name="code" /> HTMLを書き出す
        </button>
      </div>
    </header>
  )
}
