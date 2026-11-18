// 「AI エージェントに作ってもらう」：Claude Code・Codex などの AI エージェントに渡す指示文をコピーする。
// 指示文は、紹介サイトの /agent/SKILL.md（手順書）と付属の道具を取得させ、
// 作業フォルダに依存しないグローバルなスキルとして登録させてから、動画を作らせる。スキル名は利用者が決められる。
import { useEffect, useState } from 'react'
import { Icon } from './Icon'

const SITE = 'https://whiteboard-animation-maker.pages.dev'
const AGENT_BASE = `${SITE}/agent`
const FILES = ['SKILL.md', 'wbam.mjs', 'wbam-browser.mjs', 'ink_boxes.py', 'build_scene.py', 'scene-example.json', 'make_test_image.py']
const NAME_KEY = 'wbam.agentSkillName'
const DEFAULT_NAME = 'whiteboard-video'

/** スキル名：自由に決められる（前後の空白と改行だけ取り除く） */
function normalize(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 64)
}

export function agentPrompt(skill: string): string {
  return `あなたは AI エージェントです。Whiteboard Animation Maker（${SITE}/app/）を使って、ホワイトボードの清書画像から「人が説明しながら手で書いているように見える動画（MP4）」を作ってください。

## 1. 手順書（スキル）と道具を取得する
次の手順書と付属ファイルを取得してください（どれも同じ場所にあります）。
- 手順書：${AGENT_BASE}/SKILL.md
- 付属ファイル：${FILES.slice(1).map((f) => `${AGENT_BASE}/${f}`).join(' / ')}

インターネットからファイルを取得できない環境なら、そのことを私に伝えてください（手順書の全文を貼り付けて渡します）。

## 2. グローバルなスキルとして登録する
取得したものを、作業フォルダに依存しない「グローバル（ユーザー全体）のスキル」として、スキル名「${skill}」で登録してください。
- 手順書の先頭（--- で囲まれた所）の name: を「${skill}」に書き換え、付属ファイルと同じフォルダに置きます
- スキル名に、そのエージェントで使えない文字（日本語・空白・記号など）が含まれるときは、英小文字・数字・ハイフンだけの名前（例：whiteboard-video）に置き換え、description の先頭に「${skill}」を入れて、「${skill}」と頼めば呼び出されるようにしてください（置き換えた名前も教えてください）
- 置き場所の例：Claude Code は ~/.claude/skills/${skill}/SKILL.md。ほかのエージェントは、そのエージェントの説明書で「グローバルなスキル（またはユーザー共通の指示）」の置き場所を確かめてください
- すでに同じ名前のスキルがあれば、上書きしてよいか私に確かめてください
- スキルの仕組みがないエージェントなら、その旨を伝え、手順書を読んだうえで、このまま作業を続けてください
- 登録したら、置いた場所を教えてください

## 3. 手順書に沿って動画を作る
登録した手順書に沿って、最初から最後まで自分で進めてください。私の作業が要るのは、手順書の【利用者にお願い】の所だけです。
- 画像：私が渡したものを使ってください。渡していなければ、手順書の方法でテスト用の画像を作ってください
- 最後に、MP4 と編集用プロジェクト（.wbanim）の保存場所と、描いた順番を報告してください
- 合言葉の入った URL（/mcp/ のあと）は、報告やログに書かないでください`
}

export function AgentPromptDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) || DEFAULT_NAME
    } catch {
      return DEFAULT_NAME
    }
  })
  const [copied, setCopied] = useState<'prompt' | 'skill' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const skill = normalize(name) || DEFAULT_NAME
  const text = agentPrompt(skill)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const remember = (v: string): void => {
    setName(v)
    try {
      localStorage.setItem(NAME_KEY, v)
    } catch {
      // 覚えられなくても使える
    }
  }

  const copy = async (kind: 'prompt' | 'skill'): Promise<void> => {
    setError(null)
    try {
      let value = text
      if (kind === 'skill') {
        // 手順書の全文（インターネットを見られないエージェントに貼り付けて渡す用）。name をスキル名にしておく
        const res = await fetch(`${AGENT_BASE}/SKILL.md`, { cache: 'no-store' })
        if (!res.ok) throw new Error(`手順書を取得できませんでした（${res.status}）`)
        value = (await res.text()).replace(/^name:\s*.*$/m, `name: ${skill}`)
      }
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 1800)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal mcp-modal" role="dialog" aria-modal aria-label="AI エージェントに作ってもらう">
        <header>
          <h2>AI エージェントに作ってもらう</h2>
          <span className="modal-head-actions">
            <button className="icon-btn" onClick={onClose} title="閉じる (Esc)" aria-label="閉じる">
              <Icon name="x" />
            </button>
          </span>
        </header>
        <div className="modal-body mcp-body">
          <p className="mcp-lead">
            Claude Code・Codex などの AI エージェントに、下の指示文を渡すと、手順書（スキル）を取得してグローバルなスキルとして登録し、
            このアプリを使って「人が書いているような」ホワイトボード動画を最後まで作ります。一度登録すれば、次からはスキル名で頼めます。
          </p>
          <label className="field">
            <span className="field-label">スキル名</span>
            <input className="text-input" value={name} onChange={(e) => remember(e.target.value)} placeholder={DEFAULT_NAME} spellCheck={false} />
          </label>
          <p className="mcp-note">
            自由に決められます（例：<code>ホワイトボード動画作成</code>）。エージェントのスキル名に使えない文字（日本語など）があるときは、エージェントが英数字の名前に置き換え、この名前で呼び出せるように登録します。
          </p>
          <div className="btn-row">
            <button className="btn primary" onClick={() => void copy('prompt')}>
              <Icon name={copied === 'prompt' ? 'check' : 'share'} size={14} /> {copied === 'prompt' ? 'コピーしました' : '指示文をコピー'}
            </button>
            <button className="btn" onClick={() => void copy('skill')} title="インターネットを見られないエージェントに、手順書の全文を貼り付けて渡すとき">
              <Icon name={copied === 'skill' ? 'check' : 'file'} size={14} /> {copied === 'skill' ? 'コピーしました' : '手順書の全文をコピー'}
            </button>
          </div>
          {error && <p className="mcp-state">{error}</p>}
          <h3>指示文</h3>
          <pre className="agent-prompt">{text}</pre>
          <p className="mcp-note">
            渡すときは、作ってほしい画像も一緒に渡してください（渡さなければ、エージェントがテスト用の画像を作ります）。
            手順書と道具は {AGENT_BASE}/ にあります。
          </p>
        </div>
      </div>
    </div>
  )
}
