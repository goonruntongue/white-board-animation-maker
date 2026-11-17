import { importImageDialog, openAutoTrace, newProject, openExport, openProject, saveProject } from '../commands'
import { isDesktop } from '../lib/platform'
import { SELECTION_TOOLS, useEditor, type Tool } from '../store'
import { Icon, type IconName } from './Icon'
import { PenSizePicker } from './PenSizePicker'
import { SelectionModeBar } from './SelectionModeBar'
import { ThemeSwitch } from './ThemeSwitch'
import { HelpMenu } from './HelpMenu'
import { LiveEditBar } from './LiveEditBar'

const TOOLS: { id: Tool; icon: IconName; label: string; key: string }[] = [
  { id: 'erase', icon: 'eraser', label: '消す', key: 'E' },
  { id: 'select', icon: 'cursor', label: 'グループを選ぶ', key: 'V' },
  { id: 'live', icon: 'liveEdit', label: '手描き', key: 'W' },
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
        <button className="icon-btn" title="自動バックアップから復元" onClick={() => useEditor.getState().openDialog('recovery')}>
          <Icon name="history" />
        </button>
        <button className="icon-btn" data-tour="import-alt" title="画像を読み込む (Ctrl+I)" onClick={() => void importImageDialog()}>
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
            className={`tool-btn ${tool === t.id || (t.id === 'live' && tool === 'draw') ? 'on' : ''}`}
            data-tour={t.id === 'live' ? 'draw' : undefined}
            title={`${t.label} (${t.key})`}
            disabled={!hasImage}
            onClick={() => setTool(t.id)}
          >
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="tb-group">
        <button
          className="tool-btn"
          data-tour="auto"
          title="描き順を自動で作る：画像を解析して、手が順番に書いていくグループの下書きを作ります"
          disabled={!hasImage}
          onClick={openAutoTrace}
        >
          <Icon name="sparkle" />
          <span>自動</span>
        </button>
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
      </div>

      {/* オプションバー：選択ツールなら合成モード、それ以外はペン先サイズ */}
      {SELECTION_TOOLS.includes(tool) ? (
        <SelectionModeBar />
      ) : tool === 'live' || tool === 'draw' ? (
        <LiveEditBar />
      ) : (
        <PenSizePicker disabled={!hasImage} kind={tool === 'erase' ? 'eraser' : 'pen'} />
      )}

      <div className="doc-title">
        {name}
        {dirty && <span className="dirty-dot" title="未保存の変更があります" />}
        {!isDesktop && <span className="env-badge">ブラウザ版</span>}
      </div>

      <div className="tb-group end">
        <ThemeSwitch />
        <HelpMenu />
        <button className="btn" onClick={() => openExport('video')} title="動画・GIF として書き出す">
          <Icon name="film" /> 動画・GIF
        </button>
        <button className="btn primary" data-tour="export" onClick={() => openExport('html')} title="単一HTMLとして書き出す (Ctrl+E)">
          <Icon name="code" /> HTMLを書き出す
        </button>
      </div>
    </header>
  )
}
