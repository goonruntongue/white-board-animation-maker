// AI（MCP クライアント）からこのアプリを操作するための、MCP（Model Context Protocol）のやり取り。
// デスクトップ版のエンドポイント（Electron のメイン処理）と、Web 版の中継（Cloudflare）の両方で使う。
// 実際の操作はアプリの画面側（renderer の automation.ts）が行い、ここは「道具の一覧」と「JSON-RPC の受け答え」だけを持つ。
// 通信は Streamable HTTP の最小限：POST で JSON-RPC を受け、JSON で返す（ストリームは使わない）。

export const MCP_PROTOCOL_VERSION = '2025-06-18'
export const SERVER_INFO = { name: 'whiteboard-animation-maker', title: 'Whiteboard Animation Maker', version: '0.1.0' }

/** 道具の実行結果（MCP の content と同じ形） */
export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

/** 書き出したファイル（エンドポイント側で保存・アップロードして、場所を AI に伝える） */
export interface ToolFile {
  name: string
  mimeType: string
  data: Uint8Array
}

export interface ToolOutcome {
  content: ToolContent[]
  isError?: boolean
  file?: ToolFile
}

const pt = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 3, description: '[x, y] または [x, y, t]（画像のピクセル座標、t は線を描き始めてからのミリ秒）' }
const partSchema = {
  type: 'object',
  properties: {
    points: { type: 'array', items: pt, minItems: 2, description: 'ペン先が通る点の並び（描く順）。t を省くと一定の速さで描く' },
    width: { type: 'number', description: 'この線で見せる幅（px）。省くとグループの幅' }
  },
  required: ['points']
}
const groupFields = {
  name: { type: 'string', description: 'グループの名前' },
  duration_ms: { type: 'number', description: '描き終えるまでの時間（ミリ秒）' },
  delay_after_ms: { type: 'number', description: '描き終えてから次のグループまでの待ち時間（ミリ秒）' },
  reveal_width: { type: 'number', description: 'ペン先のまわりで絵を見せる幅（px）。文字の線より少し太め' },
  hidden: { type: 'boolean', description: 'true で再生と書き出しから外す' }
}

/** AI に見せる道具の一覧 */
export const TOOLS = [
  {
    name: 'get_status',
    description:
      'アプリの今の状態（作品名・ページ・画像の大きさ・グループ数・全体の長さ・設定）を返す。最初に呼ぶ。' +
      'このアプリは、画像（ホワイトボードの清書）を隠しておき、手がペンでなぞった所から見えていく「描いていく動画」を作る。' +
      '動画は「グループ」の並びでできていて、各グループは1本以上の線（ペン先が通る点の並び）を、描き順どおりに描く。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'new_project',
    description: '新しい作品を始める（今の作品は消える。必要なら先に export で project を書き出す）',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } } }
  },
  {
    name: 'load_image',
    description: '描かせたい画像を読み込む。今のページに画像がなければそこへ、あれば新しいページとして足す。data（base64 または data URL）か url のどちらかを渡す',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'string', description: 'PNG / JPEG / WebP の base64、または data URL' },
        url: { type: 'string', description: '画像の URL（CORS で読めるもの）' },
        name: { type: 'string', description: 'ファイル名（作品名にも使う）' },
        replace: { type: 'boolean', description: 'true で今のページの画像を差し替える（グループは残す）' }
      }
    }
  },
  {
    name: 'get_image',
    description: '今のページの画像を見る。show_groups で各グループの範囲と番号を重ねて描く（どのグループがどこかを確かめるのに使う）',
    inputSchema: {
      type: 'object',
      properties: {
        max_width: { type: 'number', description: '返す画像の幅の上限（既定 1024）' },
        show_groups: { type: 'boolean', description: 'グループの範囲と番号を重ねる' }
      }
    }
  },
  {
    name: 'auto_trace',
    description:
      '画像を解析して、描き順の下書き（グループの並び）を自動で作る。今のページのグループは置き換わる（append で後ろに足す）。' +
      'natural は文字の大きさから区切って、近いまとまりから自然な順に書く。group はかたまりごとに塗る。' +
      'このあと list_groups・get_image で確かめ、日本語の書き順や人らしい順になるよう並べ替え・描き直しをする',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['natural', 'group'], description: '既定 natural' },
        detail: { type: 'string', enum: ['fine', 'normal', 'coarse'], description: 'かたまりの大きさ（既定 normal）' },
        speed: { type: 'string', enum: ['slow', 'normal', 'fast'], description: '書く速さ（既定 normal）' },
        motion: { type: 'string', enum: ['smooth', 'vertical', 'horizontal', 'both'], description: '手の動き（既定 smooth）' },
        append: { type: 'boolean', description: 'true で今のグループの後ろに足す' }
      }
    }
  },
  {
    name: 'list_groups',
    description: '今のページのグループを描く順に返す（番号・id・名前・範囲・線の数・時間）',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_group',
    description: 'グループの線（ペン先が通る点の並び）を返す。点は間引いて返す',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, max_points: { type: 'number', description: '1本の線あたりの点の上限（既定 60）' } },
      required: ['id']
    }
  },
  {
    name: 'add_group',
    description:
      '線を指定して新しいグループを作る。日本語の書き順どおりに1画ずつ parts に入れると、その順で描く。' +
      '線と線のあいだはペンを上げて移動する。index で入れる位置（0 始まり）を選べる（省くと最後）',
    inputSchema: {
      type: 'object',
      properties: { parts: { type: 'array', items: partSchema, minItems: 1 }, index: { type: 'number' }, ...groupFields },
      required: ['parts']
    }
  },
  {
    name: 'update_group',
    description: 'グループの名前・時間・待ち時間・幅・表示を変える。parts を渡すと線を描き直す（範囲の制限はそのまま）',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, parts: { type: 'array', items: partSchema, minItems: 1 }, ...groupFields },
      required: ['id']
    }
  },
  {
    name: 'reorder_groups',
    description: 'グループの描く順を並べ替える。order に id を新しい順で並べる（書かなかったグループは後ろに元の順で残る）',
    inputSchema: { type: 'object', properties: { order: { type: 'array', items: { type: 'string' } } }, required: ['order'] }
  },
  {
    name: 'delete_groups',
    description: 'グループを消す',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] }
  },
  {
    name: 'merge_groups',
    description: '複数のグループを1つにまとめる（線は描く順につながる）',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 2 } }, required: ['ids'] }
  },
  {
    name: 'update_settings',
    description: '作品全体の設定を変える',
    inputSchema: {
      type: 'object',
      properties: {
        speed: { type: 'number', description: '全体の速さ（倍率。2 で2倍速）' },
        start_delay_ms: { type: 'number' },
        end_hold_ms: { type: 'number', description: '描き終えたあと完成画を止めて見せる時間' },
        board_color: { type: 'string', description: '背景の色（#rrggbb）' },
        show_hand: { type: 'boolean' },
        hand_size: { type: 'number', description: '手の大きさ（画像の高さに対する比率）' },
        finish_full: { type: 'boolean', description: '描き終えたら画像全体を見せる' }
      }
    }
  },
  {
    name: 'goto_page',
    description: 'ページを切り替える（0 始まり）',
    inputSchema: { type: 'object', properties: { index: { type: 'number' } }, required: ['index'] }
  },
  {
    name: 'render_frame',
    description: '再生の途中の1コマを画像で返す（仕上がりを確かめる）。time_ms か progress（0〜1）を渡す',
    inputSchema: {
      type: 'object',
      properties: {
        time_ms: { type: 'number' },
        progress: { type: 'number', description: '0〜1（今のページの長さに対する割合）' },
        max_width: { type: 'number', description: '既定 768' },
        hand: { type: 'boolean', description: '手を描く（既定 true）' }
      }
    }
  },
  {
    name: 'undo',
    description: '直前の操作を取り消す',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'export',
    description:
      '作品を書き出す。project（編集用 .wbanim）・mp4・webm・gif・html。全ページをつなげて書き出す。' +
      'デスクトップ版は保存したファイルの場所、Web 版はダウンロード用の URL を返す',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['project', 'mp4', 'webm', 'gif', 'html'] },
        max_width: { type: 'number', description: '動画・GIF の幅の上限（既定 mp4 は 1920、gif は 640）' },
        fps: { type: 'number', description: '動画・GIF のコマ数（既定 mp4 は 30、gif は 10）' }
      },
      required: ['format']
    }
  }
] as const

export type ToolName = (typeof TOOLS)[number]['name']

const INSTRUCTIONS =
  'Whiteboard Animation Maker を操作します。おすすめの流れ：get_status → load_image（画像がなければ）→ get_image で絵を見る → ' +
  'auto_trace で下書き → list_groups と get_image(show_groups) で確かめる → 日本語の書き順・人が書く自然な順になるよう reorder_groups・update_group・add_group で直す → ' +
  'render_frame で仕上がりを見る → export で書き出す。座標はすべて画像のピクセル（左上が 0,0）。操作はアプリの画面にそのまま表示され、利用者が手で直すこともある'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } }

/**
 * JSON-RPC のメッセージ（1つ、または配列）を受けて、返すべき応答を作る。通知だけなら null。
 * callTool は道具を実行する関数（デスクトップ版は画面側へ渡し、Web 版はブラウザのタブへ中継する）。
 */
export async function handleMcpMessage(
  body: unknown,
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolOutcome>
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleOne(m, callTool)))).filter((r): r is JsonRpcResponse => r !== null)
    return out.length ? out : null
  }
  return handleOne(body, callTool)
}

async function handleOne(
  msg: unknown,
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolOutcome>
): Promise<JsonRpcResponse | null> {
  const req = msg as JsonRpcRequest
  if (!req || typeof req !== 'object' || typeof req.method !== 'string') {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }
  }
  // id のないものは通知（返事をしない）
  if (req.id === undefined) return null
  const id = req.id
  const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result })
  switch (req.method) {
    case 'initialize': {
      const asked = typeof req.params?.protocolVersion === 'string' ? (req.params.protocolVersion as string) : MCP_PROTOCOL_VERSION
      return ok({
        protocolVersion: asked < MCP_PROTOCOL_VERSION ? asked : MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS
      })
    }
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({ tools: TOOLS })
    case 'tools/call': {
      const name = String(req.params?.name ?? '')
      if (!TOOLS.some((t) => t.name === name)) return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${name}` } }
      const args = (req.params?.arguments as Record<string, unknown>) ?? {}
      try {
        const r = await callTool(name, args)
        return ok({ content: r.content, isError: r.isError ?? false })
      } catch (e) {
        return ok({ content: [{ type: 'text', text: 'エラー: ' + (e instanceof Error ? e.message : String(e)) }], isError: true })
      }
    }
    case 'resources/list':
      return ok({ resources: [] })
    case 'prompts/list':
      return ok({ prompts: [] })
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${req.method}` } }
  }
}
