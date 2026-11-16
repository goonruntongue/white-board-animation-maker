import { useState } from 'react'
import { importHandDialog, importImageDialog, selectHandPreset } from '../commands'
import { builtinHand } from '../engine/handAsset'
import { getHandPresets } from '../engine/handPresets'
import { dataUrlBytes, formatBytes } from '../lib/imageTools'
import { useEditor } from '../store'
import { ColorField, Section, SliderField, ToggleField } from './Field'
import { Icon } from './Icon'
import { SheetBar } from './SheetBar'

type Tab = 'stroke' | 'project' | 'assets'

const builtinSvgThumb = builtinHand('#1f6feb').dataUrl

export function Inspector(): React.JSX.Element {
  const selectedId = useEditor((s) => s.selectedId)
  const [tab, setTab] = useState<Tab>('stroke')
  const active: Tab = tab === 'stroke' && !selectedId ? 'project' : tab

  return (
    <aside className="panel right">
      <SheetBar title="設定" />
      <div className="tabs">
        <button className={active === 'stroke' ? 'on' : ''} disabled={!selectedId} onClick={() => setTab('stroke')}>
          軌跡
        </button>
        <button className={active === 'project' ? 'on' : ''} onClick={() => setTab('project')}>
          再生
        </button>
        <button className={active === 'assets' ? 'on' : ''} onClick={() => setTab('assets')}>
          素材
        </button>
      </div>
      <div className="panel-scroll">
        {active === 'stroke' && <StrokeInspector />}
        {active === 'project' && <ProjectInspector />}
        {active === 'assets' && <AssetInspector />}
      </div>
    </aside>
  )
}

function StrokeInspector(): React.JSX.Element | null {
  const stroke = useEditor((s) => s.project.strokes.find((x) => x.id === s.selectedId))
  const index = useEditor((s) => s.project.strokes.findIndex((x) => x.id === s.selectedId))
  const selection = useEditor((s) => s.selection)
  const { updateStroke, setRerecord, removeStroke, setSelection } = useEditor.getState()
  if (!stroke) return null
  const set = (patch: Parameters<typeof updateStroke>[1]): void => updateStroke(stroke.id, patch)
  const recorded = stroke.points.length > 1 ? stroke.points[stroke.points.length - 1].t - stroke.points[0].t : 0

  return (
    <>
      <Section title={`#${index + 1}  ${stroke.name}`}>
        <label className="field">
          <span className="field-label">名前</span>
          <input className="text-input" value={stroke.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <SliderField
          label="見せる幅"
          hint="マスクを消す太さ。文字や図の線より少し太めにすると欠けにくい"
          value={stroke.revealWidth}
          min={4}
          max={200}
          unit="px"
          onChange={(v) => set({ revealWidth: v })}
        />
        <SliderField
          label="再生時間"
          value={stroke.duration}
          min={100}
          max={20000}
          step={50}
          divisor={1000}
          unit="秒"
          onChange={(v) => set({ duration: Math.max(50, v) })}
        />
        <SliderField
          label="描いた後の待機"
          value={stroke.delayAfter}
          min={0}
          max={5000}
          step={50}
          divisor={1000}
          unit="秒"
          onChange={(v) => set({ delayAfter: Math.max(0, v) })}
        />
        <ToggleField
          label="なぞった速さの緩急を再現"
          hint="オフにすると一定の速さで描きます"
          checked={stroke.useRecordedTiming}
          onChange={(v) => set({ useRecordedTiming: v })}
        />
        <ToggleField label="再生に含める" checked={!stroke.hidden} onChange={(v) => set({ hidden: !v })} />
        <ColorField label="表示色" value={stroke.color} onChange={(v) => set({ color: v })} />
      </Section>
      <Section title="表示できる範囲">
        <p className="muted-text">
          {stroke.clip
            ? `選択範囲で制限されています（図形 ${stroke.clip.shapes.length} 個）。範囲の外はこの軌跡では表示されません。`
            : '制限なし。なぞった幅の分だけ表示されます。'}
        </p>
        <div className="btn-row wrap">
          <button
            className="btn"
            disabled={!selection}
            title="いまの選択範囲を、この軌跡の表示範囲にする"
            onClick={() => set({ clip: selection ?? undefined })}
          >
            いまの選択範囲を適用
          </button>
          {stroke.clip && (
            <>
              <button className="btn" title="この軌跡の範囲を選択範囲として読み込む" onClick={() => setSelection(stroke.clip ?? null)}>
                範囲を選択に読み込む
              </button>
              <button className="btn" onClick={() => set({ clip: undefined })}>
                制限を外す
              </button>
            </>
          )}
        </div>
      </Section>
      <Section title="情報">
        <dl className="info">
          <dt>点の数</dt>
          <dd>{stroke.points.length}</dd>
          <dt>なぞった時間</dt>
          <dd>{(recorded / 1000).toFixed(2)} 秒</dd>
        </dl>
        <div className="btn-row">
          <button className="btn" onClick={() => set({ duration: Math.max(300, Math.round(recorded)) })}>
            なぞった時間に戻す
          </button>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => setRerecord(stroke.id)}>
            <Icon name="record" /> 録り直す
          </button>
          <button className="btn danger" onClick={() => removeStroke(stroke.id)}>
            <Icon name="trash" /> 削除
          </button>
        </div>
      </Section>
    </>
  )
}

function ProjectInspector(): React.JSX.Element {
  const project = useEditor((s) => s.project)
  const { updateSettings, commit } = useEditor.getState()
  const st = project.settings

  return (
    <>
      <Section title="プロジェクト">
        <label className="field">
          <span className="field-label">名前</span>
          <input
            className="text-input"
            value={project.name}
            onChange={(e) => {
              const name = e.target.value
              commit((p) => ({ ...p, name }), 'project-name')
            }}
          />
        </label>
      </Section>
      <Section title="再生設定">
        <SliderField label="全体速度" value={st.speed} min={0.25} max={4} step={0.05} unit="×" onChange={(v) => updateSettings({ speed: v })} />
        <SliderField
          label="開始前の待機"
          value={st.startDelay}
          min={0}
          max={5000}
          step={50}
          divisor={1000}
          unit="秒"
          onChange={(v) => updateSettings({ startDelay: v })}
        />
        <SliderField
          label="終了後の静止"
          value={st.endHold}
          min={0}
          max={10000}
          step={100}
          divisor={1000}
          unit="秒"
          onChange={(v) => updateSettings({ endHold: v })}
        />
      </Section>
      <Section title="新しい軌跡の既定値">
        <SliderField
          label="見せる幅"
          hint="ショートカット: [ と ] で調整"
          value={st.defaultRevealWidth}
          min={4}
          max={200}
          unit="px"
          onChange={(v) => updateSettings({ defaultRevealWidth: v })}
        />
        <SliderField
          label="描いた後の待機"
          value={st.defaultDelayAfter}
          min={0}
          max={5000}
          step={50}
          divisor={1000}
          unit="秒"
          onChange={(v) => updateSettings({ defaultDelayAfter: v })}
        />
      </Section>
      <Section title="一括操作">
        <div className="btn-row wrap">
          <button
            className="btn"
            disabled={project.strokes.length === 0}
            onClick={() => commit((p) => ({ ...p, strokes: p.strokes.map((s) => ({ ...s, revealWidth: st.defaultRevealWidth })) }))}
          >
            全軌跡の幅を既定値に
          </button>
          <button
            className="btn"
            disabled={project.strokes.length === 0}
            onClick={() => commit((p) => ({ ...p, strokes: p.strokes.map((s) => ({ ...s, delayAfter: st.defaultDelayAfter })) }))}
          >
            全軌跡の待機を既定値に
          </button>
        </div>
      </Section>
    </>
  )
}

function AssetInspector(): React.JSX.Element {
  const project = useEditor((s) => s.project)
  const { updateSettings, commit } = useEditor.getState()
  const st = project.settings
  const hand = project.hand
  const presets = getHandPresets()
  const isCustom = !hand.builtin && !hand.presetId

  const setTip = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const tipX = Math.round(((e.clientX - rect.left) / rect.width) * hand.width)
    const tipY = Math.round(((e.clientY - rect.top) / rect.height) * hand.height)
    commit((p) => ({ ...p, hand: { ...p.hand, tipX, tipY } }))
  }

  return (
    <>
      <Section title="元画像">
        {project.image ? (
          <>
            <div className="thumb">
              <img src={project.image.dataUrl} alt="" />
            </div>
            <dl className="info">
              <dt>ファイル</dt>
              <dd title={project.image.name}>{project.image.name}</dd>
              <dt>サイズ</dt>
              <dd>
                {project.image.width} × {project.image.height}
              </dd>
              <dt>容量</dt>
              <dd>{formatBytes(dataUrlBytes(project.image.dataUrl))}</dd>
            </dl>
          </>
        ) : (
          <p className="muted-text">画像が読み込まれていません</p>
        )}
        <div className="btn-row">
          <button className="btn" onClick={() => void importImageDialog()}>
            <Icon name="image" /> {project.image ? '差し替える…' : '読み込む…'}
          </button>
        </div>
      </Section>

      <Section title="ボード">
        <ColorField label="背景色" value={st.boardColor} onChange={(v) => updateSettings({ boardColor: v })} />
      </Section>

      <Section title="手・ペン素材">
        <div className="hand-grid" role="listbox" aria-label="手素材">
          {presets.map((p) => (
            <button
              key={p.id}
              role="option"
              aria-selected={hand.presetId === p.id}
              className={`hand-card ${hand.presetId === p.id ? 'on' : ''}`}
              title={p.id}
              onClick={() => selectHandPreset(p.id)}
            >
              <span className="hand-thumb">
                <img src={p.url} alt="" draggable={false} />
              </span>
              <span className="hand-label">{p.label}</span>
            </button>
          ))}
          <button
            className={`hand-card ${hand.builtin ? 'on' : ''}`}
            title="シンプルなイラストの手（ペンの色を変えられます）"
            onClick={() => selectHandPreset('builtin-svg')}
          >
            <span className="hand-thumb">
              <img src={builtinSvgThumb} alt="" draggable={false} />
            </span>
            <span className="hand-label">イラスト</span>
          </button>
          {isCustom && (
            <button className="hand-card on" title={hand.name}>
              <span className="hand-thumb">
                <img src={hand.dataUrl} alt="" draggable={false} />
              </span>
              <span className="hand-label">自作：{hand.name.replace(/\.[^.]+$/, '')}</span>
            </button>
          )}
          <button className="hand-card upload" title="自作の透過PNG / WebP / SVG を読み込む" onClick={() => void importHandDialog()}>
            <span className="hand-thumb">
              <Icon name="upload" size={22} />
            </span>
            <span className="hand-label">アップロード</span>
          </button>
        </div>
        <p className="muted-text small">
          PNG / WebP / SVG（背景透過）を使えます。ペン先が左上を向いた構図だと、位置を自動で合わせます。
        </p>

        <div className="field">
          <span className="field-label">ペン先の位置（クリックで調整）</span>
          <div className="hand-preview" onClick={setTip} title="クリックしてペン先の位置を指定">
            <img src={hand.dataUrl} alt="" draggable={false} />
            <span
              className="tip-marker"
              style={{ left: `${(hand.tipX / hand.width) * 100}%`, top: `${(hand.tipY / hand.height) * 100}%` }}
            />
          </div>
          <span className="muted-text small">
            {hand.name} ・ ペン先 ({Math.round(hand.tipX)}, {Math.round(hand.tipY)})
          </span>
        </div>

        <SliderField
          label="手の大きさ"
          hint="画像の高さに対する比率"
          value={st.handSize}
          min={0.1}
          max={1.2}
          step={0.01}
          unit="×"
          onChange={(v) => updateSettings({ handSize: v })}
        />
        {hand.builtin && <ColorField label="ペンの色" value={st.penColor} onChange={(v) => updateSettings({ penColor: v })} />}
        <ToggleField label="手を表示する" checked={st.showHand} onChange={(v) => updateSettings({ showHand: v })} />
        <ToggleField label="手の影" checked={st.handShadow} onChange={(v) => updateSettings({ handShadow: v })} />
        <ToggleField
          label="進行方向に合わせて傾ける"
          checked={st.handFollowDirection}
          onChange={(v) => updateSettings({ handFollowDirection: v })}
        />
      </Section>
    </>
  )
}
