import { useEffect, useRef, useState, type ReactNode } from 'react'
import { buildStandaloneHtml, defaultHtmlOptions, embedSnippet, type HtmlExportOptions } from '../export/exportHtml'
import { pageProjects } from '../export/sequence'
import { exportWebm, pickVideoFormat, type VideoExportHandle } from '../export/exportVideo'
import { formatTime } from '../engine/project'
import { buildTimeline } from '../engine/wb-engine'
import { formatBytes } from '../lib/imageTools'
import { isDesktop, revealInFolder, saveBlobFile, saveTextFile } from '../lib/platform'
import { useEditor } from '../store'
import { Icon } from './Icon'

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && onClose) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" role="dialog" aria-modal aria-label={title}>
        <header>
          <h2>{title}</h2>
          {onClose && (
            <button className="icon-btn" onClick={onClose} title="閉じる (Esc)">
              <Icon name="x" />
            </button>
          )}
        </header>
        {children}
      </div>
    </div>
  )
}

export function ExportDialogs(): React.JSX.Element | null {
  const dialog = useEditor((s) => s.dialog)
  if (dialog === 'html') return <HtmlExportDialog />
  if (dialog === 'video') return <VideoExportDialog />
  return null
}

function HtmlExportDialog(): React.JSX.Element {
  const project = useEditor((s) => s.project)
  const { openDialog, notify } = useEditor.getState()
  const [o, setO] = useState<HtmlExportOptions>(() => defaultHtmlOptions(project))
  const [size, setSize] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<HtmlExportOptions>): void => setO((prev) => ({ ...prev, ...patch }))
  const pages = pageProjects(project)
  const totalMs = pages.reduce((sum, pg) => sum + buildTimeline(pg).total, 0)

  // 設定が変わるたびに出力サイズを見積もる
  useEffect(() => {
    let alive = true
    setSize(null)
    const id = setTimeout(() => {
      buildStandaloneHtml(project, o)
        .then((html) => alive && setSize(new Blob([html]).size))
        .catch(() => alive && setSize(-1))
    }, 250)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [project, o])

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const html = await buildStandaloneHtml(project, o)
      const saved = await saveTextFile(html, `${o.title || 'whiteboard'}.html`, [{ name: 'HTML', extensions: ['html'] }])
      if (saved) {
        notify(isDesktop ? `書き出しました: ${saved}` : 'HTMLをダウンロードしました')
        revealInFolder(saved)
        openDialog(null)
      }
    } catch (e) {
      notify('書き出しに失敗しました: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={pages.length > 1 ? 'HTMLスライドとして書き出す' : '単一HTMLとして書き出す'} onClose={() => openDialog(null)}>
      <div className="modal-body">
        <p className="lead">
          画像・手素材・再生プログラムを1つのHTMLに内包します。ネット接続なしで、どのPCのブラウザでも再生できます。
          {pages.length > 1 ? `全 ${pages.length} ページを、ページ送りできるスライドにします。` : ''}
        </p>
        <div className="form-grid">
          <label>タイトル</label>
          <input className="text-input" value={o.title} onChange={(e) => set({ title: e.target.value })} />

          <label>画像形式</label>
          <select className="text-input" value={o.imageFormat} onChange={(e) => set({ imageFormat: e.target.value as HtmlExportOptions['imageFormat'] })}>
            <option value="webp">WebP（推奨・軽量）</option>
            <option value="jpeg">JPEG</option>
            <option value="original">元の形式のまま</option>
          </select>

          {o.imageFormat !== 'original' && (
            <>
              <label>画質</label>
              <div className="inline-range">
                <input
                  type="range"
                  min={0.5}
                  max={1}
                  step={0.05}
                  style={{ '--fill': `${((o.quality - 0.5) / 0.5) * 100}%` } as React.CSSProperties}
                  value={o.quality} onChange={(e) => set({ quality: Number(e.target.value) })} />
                <span>{Math.round(o.quality * 100)}%</span>
              </div>
            </>
          )}

          <label>最大幅</label>
          <select className="text-input" value={o.maxWidth} onChange={(e) => set({ maxWidth: Number(e.target.value) })}>
            <option value={0}>制限なし（{project.image?.width}px）</option>
            <option value={2560}>2560px</option>
            <option value={1920}>1920px（Full HD）</option>
            <option value={1280}>1280px（HD）</option>
            <option value={960}>960px</option>
          </select>

          <label>再生の始め方</label>
          <select className="text-input" value={o.start} onChange={(e) => set({ start: e.target.value as HtmlExportOptions['start'] })}>
            <option value="auto">開いたらすぐ再生</option>
            <option value="click">クリックしたら再生</option>
            <option value="visible">画面に見えたら再生（スライドへの埋め込み向け）</option>
          </select>

          {pages.length > 1 && (
            <>
              <label>ページの進め方</label>
              <select className="text-input" value={o.advance} onChange={(e) => set({ advance: e.target.value as HtmlExportOptions['advance'] })}>
                <option value="click">クリック・矢印キーで次へ（スライド）</option>
                <option value="auto">描き終わったら自動で次へ</option>
              </select>
            </>
          )}

          <label>まわりの背景</label>
          <select className="text-input" value={o.background} onChange={(e) => set({ background: e.target.value as HtmlExportOptions['background'] })}>
            <option value="dark">暗い</option>
            <option value="white">白</option>
            <option value="transparent">透過（ほかのスライドに重ねる）</option>
          </select>

          <label>その他</label>
          <div className="checks">
            <label>
              <input type="checkbox" checked={o.showControls} onChange={(e) => set({ showControls: e.target.checked })} /> 操作バーを表示
            </label>
            <label>
              <input type="checkbox" checked={o.loop} onChange={(e) => set({ loop: e.target.checked })} /> 終わったら最初から
            </label>
            <label title="ブラウザの決まりで、音は画面を一度クリックしたあとから鳴ります">
              <input type="checkbox" checked={o.sound} onChange={(e) => set({ sound: e.target.checked })} /> マーカーの書く音
            </label>
          </div>
        </div>
        <div className="estimate">
          推定ファイルサイズ: <strong>{size === null ? '計算中…' : size < 0 ? '—' : formatBytes(size)}</strong>
          <span className="dim">
            {' '}
            ・ {pages.length > 1 ? `${pages.length} ページ ・ ` : ''}再生時間 {formatTime(totalMs)}
          </span>
        </div>
        <details className="embed-help">
          <summary>スライドに埋め込むには</summary>
          <p>保存した HTML を、スライドと同じフォルダに置いて次のように読み込みます（「画面に見えたら再生」がおすすめ）。</p>
          <code>{embedSnippet(`${o.title || 'whiteboard'}.html`, pages[0]?.image ? pages[0].image.width / pages[0].image.height : 1.5)}</code>
          <p>
            外から操作するとき：<code>frame.contentWindow.postMessage({'{'} source: 'wb', cmd: 'play' {'}'}, '*')</code>
            （cmd は play / pause / toggle / next / prev / goto / rewind）
          </p>
        </details>
      </div>
      <footer className="modal-footer">
        <button className="btn" onClick={() => openDialog(null)}>
          キャンセル
        </button>
        <button className="btn primary" disabled={busy} onClick={() => void run()}>
          <Icon name="code" /> {busy ? '書き出し中…' : '書き出す'}
        </button>
      </footer>
    </Modal>
  )
}

function VideoExportDialog(): React.JSX.Element {
  const project = useEditor((s) => s.project)
  const { openDialog, notify } = useEditor.getState()
  const [fps, setFps] = useState(30)
  const [maxWidth, setMaxWidth] = useState(1920)
  const [bitrate, setBitrate] = useState(8)
  const [progress, setProgress] = useState<number | null>(null)
  const handle = useRef<VideoExportHandle | null>(null)
  const total = pageProjects(project).reduce((sum, pg) => sum + buildTimeline(pg).total, 0)

  useEffect(() => () => handle.current?.cancel(), [])

  const run = async (): Promise<void> => {
    setProgress(0)
    const h = exportWebm(project, { fps, maxWidth, bitrateMbps: bitrate }, setProgress)
    handle.current = h
    try {
      const blob = await h.promise
      const { ext } = pickVideoFormat()
      const saved = await saveBlobFile(blob, `${project.name || 'whiteboard'}.${ext}`, [
        { name: ext === 'mp4' ? 'MP4 動画' : 'WebM 動画', extensions: [ext] }
      ])
      if (saved) {
        notify(isDesktop ? `書き出しました: ${saved}` : '動画をダウンロードしました')
        revealInFolder(saved)
        openDialog(null)
      }
    } catch (e) {
      if (!(e instanceof Error && e.message === 'cancelled')) {
        notify('動画の書き出しに失敗しました: ' + (e instanceof Error ? e.message : String(e)), 'error')
      }
    } finally {
      handle.current = null
      setProgress(null)
    }
  }

  const running = progress !== null

  return (
    <Modal title={`動画 (${pickVideoFormat().ext.toUpperCase()}) として書き出す`} onClose={running ? undefined : () => openDialog(null)}>
      <div className="modal-body">
        <p className="lead">
          ブラウザの録画機能で動画（この端末では {pickVideoFormat().ext.toUpperCase()}）を作ります。実時間で記録するため、書き出しには再生時間（{formatTime(total)}）と同じだけかかります。MP4 が必要な場合は外部ツールで変換してください。
        </p>
        <div className="form-grid">
          <label>フレームレート</label>
          <select className="text-input" disabled={running} value={fps} onChange={(e) => setFps(Number(e.target.value))}>
            <option value={24}>24 fps</option>
            <option value={30}>30 fps</option>
            <option value={60}>60 fps</option>
          </select>
          <label>最大幅</label>
          <select className="text-input" disabled={running} value={maxWidth} onChange={(e) => setMaxWidth(Number(e.target.value))}>
            <option value={3840}>3840px（4K）</option>
            <option value={1920}>1920px（Full HD）</option>
            <option value={1280}>1280px（HD）</option>
          </select>
          <label>ビットレート</label>
          <select className="text-input" disabled={running} value={bitrate} onChange={(e) => setBitrate(Number(e.target.value))}>
            <option value={4}>4 Mbps</option>
            <option value={8}>8 Mbps</option>
            <option value={16}>16 Mbps</option>
          </select>
        </div>
        {running && (
          <div className="progress">
            <div className="progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
            <span>{Math.round(progress * 100)}%</span>
          </div>
        )}
      </div>
      <footer className="modal-footer">
        {running ? (
          <button className="btn" onClick={() => handle.current?.cancel()}>
            中止
          </button>
        ) : (
          <>
            <button className="btn" onClick={() => openDialog(null)}>
              キャンセル
            </button>
            <button className="btn primary" onClick={() => void run()}>
              <Icon name="film" /> 録画を開始
            </button>
          </>
        )}
      </footer>
    </Modal>
  )
}
