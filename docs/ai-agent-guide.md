# AI エージェント向け：Whiteboard Animation Maker で「人が書いたようなホワイトボード動画」を自動で作る

> **このファイルを読んだ AI エージェントへ**
> このファイルの手順に沿って、**最初から最後まで自分で進めてください**。
> 利用者の手が要るのは、下に **【利用者にお願い】** と書いた所だけです。それ以外は、利用者に確認を求めずに進めてかまいません。
> 対象は Claude Code・Codex・Cursor・Gemini CLI・Windsurf などのコーディングエージェントと、claude.ai・ChatGPT などのチャット型 AI の両方です。できることに合わせて道を選びます（フェーズ 0）。

## ゴール

1. Whiteboard Animation Maker（Web 版）を開き、AI から操作できる状態にする
2. 操作できることを確かめる
3. ホワイトボードの清書画像を用意して読み込む（なければ作る）
4. 人が書いているように見える描き順・速さ・間に整える
5. **MP4 と編集用プロジェクト（.wbanim）を書き出して、手元に保存する**
6. 利用者に報告する

作業フォルダ（以下 `wbam-work/`）に、最後はこうなっているのが完成です。

```
wbam-work/
  wbam.mjs  wbam-browser.mjs  make_test_image.py   … 付録のスクリプト
  wbam-endpoint.txt                                  … エンドポイントの URL（合言葉入り。外に出さない）
  whiteboard-test.png                                … 使った画像
  wbam-out/  ○○.mp4  ○○.wbanim  （確認用の PNG）     … 成果物
```

## アプリについて（最初に知っておくこと）

- **Whiteboard Animation Maker**：ホワイトボードの清書画像を隠しておき、ペンを持った手がなぞった所から見えていく「描いていく動画」を作るアプリ。Web 版：https://whiteboard-animation-maker.pages.dev/app/
- 動画は **グループ** の並びでできている。グループは1本以上の **線**（ペン先が通る点の並び）を、決めた順・速さで描く。
- AI からの操作は **MCP**（Model Context Protocol）で行う。MCP の中身は **HTTP の JSON-RPC** なので、MCP に対応していないエージェントでも、付録の `wbam.mjs` で同じ操作ができる。
- 流れ：`AI ──HTTP──▶ 中継（Cloudflare）──WebSocket──▶ ブラウザで開いているアプリ`。**操作はブラウザのアプリが行う**ので、作業中はアプリを開いたままにする。
- エンドポイントの URL は `https://whiteboard-mcp-relay.goonruntongue.workers.dev/mcp/<合言葉>`。合言葉は **24〜64 文字の英数字と `-` `_`**。合言葉を知っている人は誰でもアプリを操作できるので、**ログ・報告・コミットなど外に出す所には書かない**。
- 書き出したファイルは中継に **2時間だけ** 置かれ、ダウンロード用の URL が返る。作品がサーバーに保管されることはない。

---

## フェーズ 0：できることを調べて、道を決める

次を確かめ、どの道で進めるかを決めます（利用者に聞かずに、自分で調べる）。

| 調べること | 調べ方の例 |
|---|---|
| シェルでコマンドを実行できるか | `node -v` などを実行してみる |
| Node.js 18 以上があるか | `node -v` |
| Python と Pillow があるか（画像を作るとき） | `python -c "import PIL"`（なければ `pip install pillow`） |
| ブラウザを自動で動かせるか | Playwright を入れられるか（下の道 A）。または、自分のブラウザ操作の道具（ブラウザのツール・Computer Use など）があるか |
| MCP のツールを今のセッションで使えるか | すでに `whiteboard` などの MCP サーバーがつながっているか |

**道の選び方**

- **道 A（いちばん自動）**：シェル＋Node.js があり、Playwright を入れられる → ブラウザを自動で開いて、合言葉も自分で決める。**利用者の手は要らない**
- **道 B**：シェル＋Node.js はあるが、ブラウザを自動で動かせない → **アプリを開いて URL を渡すことだけ、利用者にお願いする**
- **道 C**：シェルがない（claude.ai・ChatGPT などのチャット型） → **アプリの準備・コネクタの登録・画像の読み込みを利用者にお願いし**、あとは MCP のツールで進める
- 自分のブラウザ操作の道具がある場合は、道 B の利用者の作業（アプリを開いてオンにし、URL を写す）を自分で行ってよい

---

## フェーズ 1：作業フォルダとスクリプトを用意する（道 A・B）

1. 作業フォルダ `wbam-work/` を作って移る
2. 付録の3つのスクリプトを、**中身を変えずに** そのファイル名で保存する
   - `wbam.mjs`：エンドポイントを HTTP で直接呼ぶ道具（MCP に対応していなくても使える。画像の受け渡しとダウンロードもこれが行う）
   - `wbam-browser.mjs`：アプリをブラウザで開き、AI 連携をオンにして待つ道具（道 A）
   - `make_test_image.py`：テスト用の清書画像を作る道具

## フェーズ 2：アプリを開いて、AI から操作できるようにする

### 道 A（自動）

```bash
cd wbam-work
npm init -y
npm i playwright
npx playwright install chromium        # 失敗したら、下の「Chrome を使う」へ
node wbam-browser.mjs                  # 背景（バックグラウンド）で動かし、止めない
```

- 標準出力に `READY https://…/mcp/…` が出て、`wbam-endpoint.txt` ができたら準備完了
- `wbam-browser.mjs` は **作業が終わるまで止めない**（止めるとアプリが閉じて、操作できなくなる）。エージェントの「背景で実行」の機能を使う。なければ別のターミナルで動かす
- **Chrome を使う**：Chromium を入れられないときや、MP4 が作れないとき（下のフェーズ 6）は、入っている Chrome・Edge を使う
  - `npm i playwright-core` のあと、`WBAM_CHANNEL=chrome node wbam-browser.mjs`（Edge は `msedge`。Windows の PowerShell なら `$env:WBAM_CHANNEL='chrome'; node wbam-browser.mjs`）
- 画面を見せたいときは `HEADLESS=0` を付ける
- `NOT_CONNECTED` と出たら：ネットワークの制限（`whiteboard-animation-maker.pages.dev` と `whiteboard-mcp-relay.goonruntongue.workers.dev` へ出られるか）を確かめる。直らなければ道 B に切り替える

### 道 B・道 C（利用者にお願い）

> **【利用者にお願い】** 次の手順で、AI がアプリを操作できるようにしてください。
> 1. ブラウザで https://whiteboard-animation-maker.pages.dev/app/ を開く（古い画面が出たら、画面下の「再読み込み」を押すか開き直す）
> 2. 歯車のメニュー →「AI 連携（MCP）」→「AI からの接続を受け付ける」をオンにする（「受け付け中」と出れば OK）
> 3. 「エンドポイントの URL」の「コピー」を押し、AI に貼り付けて渡す
> 4. 作業が終わるまで、**そのタブを開いたままにする**（スマホは画面を消したり、ほかのアプリに切り替えたりしない）

- 道 B では、渡された URL を `wbam-work/wbam-endpoint.txt` に1行で保存する
- 道 C では、次のフェーズ 3 に進む

## フェーズ 3：MCP のコネクタとして登録する（任意。道 C では必須）

**道 A・B では、登録しなくても `wbam.mjs` で全部の操作ができます。** 多くのエージェントは、途中で追加した MCP サーバーを、今のセッションでは使えません（開き直しが必要）。そのため、まずは `wbam.mjs` で進め、登録は「次回から MCP のツールとして使うため」に行います。登録したかどうかは、報告に書きます。

| AI | 登録のしかた |
|---|---|
| Claude Code | `claude mcp add --transport http whiteboard <URL>`（確認：`claude mcp list`） |
| Codex | `~/.codex/config.toml` に `[mcp_servers.whiteboard]` と `url = "<URL>"` を追加 |
| Cursor | `~/.cursor/mcp.json`（またはプロジェクトの `.cursor/mcp.json`）の `mcpServers` に `"whiteboard": { "url": "<URL>" }` |
| Gemini CLI | `~/.gemini/settings.json` の `mcpServers` に `"whiteboard": { "httpUrl": "<URL>" }` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` の `mcpServers` に `"whiteboard": { "serverUrl": "<URL>" }` |
| そのほか | 「HTTP（Streamable HTTP）」の MCP サーバーとして `<URL>` を登録する（認証なし） |
| claude.ai・Claude のアプリ（道 C） | 下の【利用者にお願い】 |

設定ファイルの場所や書き方は、AI のバージョンで変わることがあります。違っていたら、その AI の説明書（MCP の項目）に従ってください。設定ファイルを書き換えるときは、**今ある設定を消さずに足す** こと。

> **【利用者にお願い】（道 C：claude.ai・Claude のアプリ）**
> Claude の「設定」→「コネクタ」→「カスタムコネクタを追加」で、名前に `Whiteboard Animation Maker`、URL にフェーズ 2 でコピーした URL を入れて追加してください（認証は「なし」）。
> 追加したら **新しいチャット** を開き、入力欄の「＋」（ツール）でこのコネクタがオンになっていることを確かめてから、このファイルを渡し直してください。

## フェーズ 4：つながったかを確かめる

- 道 A・B：`node wbam.mjs get_status`
- 道 C（MCP のツール）：`get_status` を呼ぶ

作品名・ページ数・画像の有無が返れば OK。うまくいかないときは、末尾の「困ったとき」を見る。

## フェーズ 5：画像を用意して読み込む

1. **利用者から画像を渡されている**とき：それを使う（PNG・JPEG・WebP）
2. **渡されていない**とき：テスト用の画像を作る
   - 道 A・B：`python make_test_image.py whiteboard-test.png`（日本語のフォントがないと止まる。そのときはフォントを入れるか、下の「画像を作れる AI に頼む指示文」を利用者に案内する）
   - できた画像を自分で見て、文字が正しく出ている（豆腐［□］や文字化けがない）ことを確かめる
3. 読み込む
   - 道 A・B：`node wbam.mjs load_image '{"file":"./whiteboard-test.png"}'`
     （`wbam.mjs` が base64 にして送るので、**自分で base64 の文字を書き出さないこと**）
   - 道 C：**画像の中身を base64 で書き出して渡すのは現実的ではない**（百万文字を超える）。インターネット上にあり、ほかのサイトから読み込める画像（GitHub の raw の URL など）なら `load_image` に `url` で渡す。そうでなければ ↓

> **【利用者にお願い】（道 C で、画像が URL で渡せないとき）**
> アプリの画面に画像をドラッグ＆ドロップするか、メニューの「画像を読み込む」で読み込んでから、「読み込んだ」と AI に伝えてください。

**画像を作れる AI に頼む指示文**（利用者に案内するとき用）

```text
ホワイトボードに手描きで清書したような説明図を1枚作ってください。横長 3:2（1536×1024px）、背景は真っ白の無地（質感・影なし）。
黒・青・赤・緑のマーカーの、太くはっきりした線だけで描く（グラデーション・写真・陰影なし）。文字と絵は重ねず、余白を多めに。
内容：上の中央に大きなタイトル「朝のルーティン」。その下に左から右へ番号つきの3つ（1「起きる」と目覚まし時計、2「顔を洗う」と蛇口と水しぶき、
3「朝ごはん」とお皿とトースト）を並べ、あいだを右向きの矢印でつなぐ。いちばん下に小さく「今日もいい一日を！」。
日本語は正しい字形で、上に書いた文字だけにする。
```

## フェーズ 6：人が書いたように整える

### 進め方

1. `get_image`（`max_width` 1024）で絵を見て、何がどこにあるか（タイトル・見出し・本文・絵・矢印・飾り）を把握する
2. `auto_trace`（`mode: natural`）で下書きを作る
3. `list_groups` と `get_image`（`show_groups: true`。枠の番号＝`index + 1`）で、どのグループが絵のどこかを対応づける
4. 下の「自然さの基準」に合うよう直す
   - 順番：`reorder_groups`（`order` に id を新しい順に並べる）
   - 時間・間：`update_group` の `duration_ms`・`delay_after_ms`
   - 書き順が不自然な文字・まとまりの悪い所：`get_group` で線を見てから、`update_group` の `parts` で描き直す。または `add_group` で1画ずつ作り直し（`index` で位置を指定）、元のグループを `delete_groups` で消す
   - 細かすぎるグループ：`merge_groups`
5. `render_frame`（`progress` 0.25・0.5・0.75・1.0）で途中のコマを見て、変な所があれば直す
6. 間違えたら `undo`

### 自然さの基準

- **順番**：人が説明しながら書く順。基本は、タイトル → 上から下・左から右。ひとまとまり（見出しと、その絵）を書き終えてから次へ
- **文字**：日本語の書き順を守る（横画が先・上から下・左から右 など）。1文字の中で手があちこちに飛ばない
- **絵**：輪郭が先、中の細かい所や塗りはあと
- **飾り**：矢印・下線・囲みは、それが指す内容を書いたあと
- **速さ**：文字は1文字 0.4〜0.8 秒。大きなタイトルは少しゆっくり、小さな文字は速め。絵は大きさに合わせる
- **間**：同じまとまりの中は 0.1〜0.3 秒、まとまりが変わるときは 0.5〜1.0 秒
- **全体の長さ**：30〜60 秒が目安（`list_groups` の `total_ms`）

### 守ること

- 座標はすべて **元の画像のピクセル**（左上が 0,0）。`get_image` の縮小画像の座標は、元の大きさに直してから使う
- `parts` の点は `[x, y]`（一定の速さ）か `[x, y, t]`（t は線を描き始めてからのミリ秒）。線と線のあいだは、アプリが自動でペンを上げて移動する
- 同じ失敗を3回くり返したら、そのやり方をやめる。直しきれない所は、報告に書いて先へ進む
- 利用者が画面を見ていることがある。大きく作り直すときは、先に1行で知らせる（返事は待たなくてよい）

## フェーズ 7：書き出して、手元に保存する

- 道 A・B：
  - `node wbam.mjs export '{"format":"mp4","max_width":1280}'`
  - `node wbam.mjs export '{"format":"project"}'`
  - どちらも、ダウンロードまで自動で行い、`wbam-out/` に保存する
- 道 C：`export` を呼び、返ってきたダウンロード URL（2時間有効）を利用者に伝える
- **MP4 が作れないと言われたら**：`webm` を試し、それも駄目なら `gif`（`max_width` 640・`fps` 10）にする。道 A なら、Chrome を使う（`WBAM_CHANNEL=chrome`）と MP4 を作れることが多い
- 必要なら `html`（1ファイルでオフライン再生できる）も書き出す

## フェーズ 8：片付けと報告

1. 道 A：`wbam-browser.mjs` を止める（アプリも閉じる）
2. 道 B・C：
   > **【利用者にお願い】** アプリの「AI 連携（MCP）」の受け付けをオフにしてください。URL が人に知られた心配があるときは「合言葉を作り直す」も押してください。
3. 利用者に、次の形で報告する（**合言葉の入った URL は書かない**。ダウンロード URL も、道 C で利用者に渡すとき以外は書かない）

```text
## できたもの
- MP4：<保存した場所>（長さ ○○ 秒）
- 編集用プロジェクト：<保存した場所>（アプリのメニュー「開く」で開くと、続きを手で直せる）

## 直したこと
- 順番：…
- 書き順：…
- 速さ・間：…

## 自信がない所・直しきれなかった所
- …

## 進め方の記録
- 選んだ道（A / B / C）と、利用者にお願いしたこと
- MCP のコネクタとして登録したか（どの AI に、どこへ）
- 道具を使った回数のおおよそ

## アプリの道具（MCP ツール）への意見
- 足りなかったこと・使いにくかったこと
```

---

## 困ったとき

| 起きたこと | 原因と対処 |
|---|---|
| 「アプリが開いていません」 | アプリのタブが閉じたか、受け付けがオフ。道 A は `wbam-browser.mjs` が動いているか確かめ、止まっていれば動かし直す（同じ合言葉で動かし直すなら `WBAM_TOKEN=<合言葉>`）。道 B・C は利用者に、タブを開いてオンにするようお願いする |
| タブは開いているのに「アプリが開いていません」 | 合言葉を作り直す前の古い URL を使っている。今の URL をもらい直す |
| 「ほかのタブが同じ URL でつなぎました」 | 同じ URL を2つのタブで開いている。あとから開いた方につながる。使わない方を閉じる |
| HTTP 404 | URL の写し間違い（途中で切れているなど） |
| HTTP 403（エラー 1010） | Cloudflare が「名乗らない機械的なアクセス」として弾いた。`User-Agent` を付けて送る（`wbam.mjs` は付けている） |
| 返事が来ない・時間切れ | MP4 の書き出しは、作品の長さによって数十秒〜数分かかる。待つ。道 B・C では、利用者にタブを裏に回さないようお願いする |
| 古い画面・「AI 連携（MCP）」が見つからない | アプリが前の版を覚えている。開き直す（道 B・C は利用者にお願い） |
| 文字化け・豆腐（□）の画像ができた | 日本語のフォントがない。フォントを入れるか、「画像を作れる AI に頼む指示文」を利用者に案内する |

## 道具（MCP ツール）の一覧

`node wbam.mjs tools` で、今の一覧と引数を表示できる（アプリの更新で増えることがある）。

| 道具 | すること |
|---|---|
| `get_status` | 作品名・ページ・画像の大きさ・グループ数・全体の長さ・設定 |
| `new_project` | 新しい作品を始める |
| `load_image` | 画像を読み込む（`data`：base64・data URL ／ `url`。`wbam.mjs` では `file` も使える） |
| `get_image` | 今のページの画像（`show_groups` でグループの範囲と番号を重ねる） |
| `auto_trace` | 描き順の下書きを自動で作る（`mode`：natural ／ group、`detail`、`speed`、`motion`、`append`） |
| `list_groups` | グループの一覧（id・範囲・線の数・時間） |
| `get_group` | グループの線（点の並び） |
| `add_group` | 線を指定して新しいグループを作る（`parts`、`index`、時間など） |
| `update_group` | グループの名前・時間・間・幅・表示を変える。`parts` で描き直す |
| `reorder_groups` | 描く順を並べ替える |
| `delete_groups` | グループを消す |
| `merge_groups` | 複数のグループを1つにまとめる |
| `update_settings` | 全体の速さ・前後の待ち時間・背景色・手の表示など |
| `goto_page` | ページを切り替える |
| `render_frame` | 途中の1コマを画像で返す |
| `undo` | 直前の操作を取り消す |
| `export` | 書き出す（`project` ／ `mp4` ／ `webm` ／ `gif` ／ `html`） |

---

## 付録：スクリプト（中身を変えずに保存する）

### `wbam.mjs`

エンドポイントを HTTP（JSON-RPC）で直接呼ぶ道具。Node.js 18 以上。

```js
// wbam.mjs — Whiteboard Animation Maker の MCP エンドポイントを、HTTP（JSON-RPC）で直接呼ぶ小さな道具。Node 18 以上。
// 使い方：
//   node wbam.mjs tools                          道具の一覧
//   node wbam.mjs <道具の名前> '<JSON の引数>'    道具を呼ぶ（例：node wbam.mjs get_image '{"show_groups":true}'）
//   node wbam.mjs load_image '{"file":"./whiteboard-test.png"}'   手元の画像を読み込ませる（file はこの道具が base64 にして送る）
//   node wbam.mjs add_group @args.json          引数を JSON のファイルから読む（長い引数や、Windows の PowerShell のとき）
// エンドポイント：環境変数 WBAM_URL、なければ ./wbam-endpoint.txt
// 返ってきた画像は ./wbam-out/ に PNG で保存し、その場所を表示する。書き出したファイルも自動でダウンロードして ./wbam-out/ に保存する
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

const OUT = process.env.WBAM_OUT || 'wbam-out'
const UA = 'wbam-agent-client/1.0' // 名前のない機械的なアクセスは Cloudflare に弾かれることがあるので名乗る
const url = process.env.WBAM_URL || (existsSync('wbam-endpoint.txt') ? (await readFile('wbam-endpoint.txt', 'utf-8')).trim() : '')
if (!/^https?:\/\/.+\/mcp\/[A-Za-z0-9_-]{24,64}$/.test(url)) {
  console.error('エンドポイントの URL がありません。WBAM_URL を設定するか、wbam-endpoint.txt に書いてください')
  process.exit(2)
}
const [, , tool, argText = '{}'] = process.argv
if (!tool) {
  console.error('使い方：node wbam.mjs <道具の名前|tools> [JSON の引数]')
  process.exit(2)
}

let seq = 0
async function rpc(method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'User-Agent': UA },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, ...(params ? { params } : {}) })
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const j = await res.json()
  if (j.error) throw new Error(`MCP エラー ${j.error.code}: ${j.error.message}`)
  return j.result
}

await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'wbam-agent-client', version: '1.0' } })

if (tool === 'tools') {
  const { tools } = await rpc('tools/list')
  for (const t of tools) console.log(`- ${t.name}: ${t.description}\n  引数: ${JSON.stringify(t.inputSchema.properties ?? {})}`)
  process.exit(0)
}

let args
try {
  // 「@ファイル名」なら、そのファイルの JSON を引数にする（Windows の PowerShell 5 は、コマンドの中の " を崩すことがあるため）
  args = JSON.parse(argText.startsWith('@') ? await readFile(argText.slice(1), 'utf-8') : argText)
} catch {
  console.error('引数は JSON で渡してください（例：\'{"show_groups":true}\'、または @args.json）')
  process.exit(2)
}
// 手元の画像ファイルは、ここで base64 にして送る（AI が長い文字を書き出さなくてよいように）
if (tool === 'load_image' && args.file) {
  const buf = await readFile(args.file)
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(args.file).toLowerCase()] ?? 'image/png'
  args = { ...args, data: `data:${mime};base64,${buf.toString('base64')}`, name: args.name ?? basename(args.file) }
  delete args.file
}

const result = await rpc('tools/call', { name: tool, arguments: args })
await mkdir(OUT, { recursive: true })
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
let n = 0
for (const c of result.content ?? []) {
  if (c.type === 'text') {
    console.log(c.text)
    const m = c.text.match(/ダウンロード URL[^:：]*[:：]\s*(\S+)/)
    if (m) {
      const res = await fetch(m[1], { headers: { 'User-Agent': UA } })
      if (res.ok) {
        const name = decodeURIComponent(m[1].split('/').pop() || `export-${stamp}`)
        const path = join(OUT, name)
        await writeFile(path, Buffer.from(await res.arrayBuffer()))
        console.log(`保存しました: ${path}`)
      } else console.log(`ダウンロードに失敗しました（${res.status}）`)
    }
  } else if (c.type === 'image') {
    const path = join(OUT, `${tool}-${stamp}-${++n}.png`)
    await writeFile(path, Buffer.from(c.data, 'base64'))
    console.log(`画像を保存しました: ${path}`)
  }
}
process.exit(result.isError ? 1 : 0)
```

### `wbam-browser.mjs`

アプリをブラウザで開き、AI 連携をオンにして待つ道具（道 A）。`playwright`（または `playwright-core`）が必要。

```js
// wbam-browser.mjs — Whiteboard Animation Maker（Web 版）をブラウザで開き、AI 連携（MCP）をオンにして待つ。
// 使い方：node wbam-browser.mjs        （開いたままにしておく。止めるときは Ctrl+C）
// 環境変数：WBAM_TOKEN（合言葉。省略時は自動で作る）/ HEADLESS=0（画面を出す）/ WBAM_CHANNEL（chrome / msedge。省略時は Playwright の Chromium）
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  ;({ chromium } = await import('playwright-core'))
}

const APP = 'https://whiteboard-animation-maker.pages.dev/app/'
const RELAY = 'https://whiteboard-mcp-relay.goonruntongue.workers.dev'
const token = process.env.WBAM_TOKEN || randomBytes(24).toString('base64url')

const browser = await chromium.launch({
  headless: process.env.HEADLESS !== '0',
  ...(process.env.WBAM_CHANNEL ? { channel: process.env.WBAM_CHANNEL } : {})
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
// アプリは合言葉と「オン」を localStorage に覚え、開いたときに自動で中継につなぐ。その仕組みを使う
await page.addInitScript((t) => {
  try {
    localStorage.setItem('wbam.mcp', JSON.stringify({ enabled: true, token: t }))
  } catch {}
}, token)
page.on('console', (m) => m.type() === 'error' && console.error('[app]', m.text()))
await page.goto(APP, { waitUntil: 'load' })

// タブが中継につながるまで待つ（最大 60 秒）
let ok = false
for (let i = 0; i < 60 && !ok; i++) {
  await new Promise((r) => setTimeout(r, 1000))
  try {
    ok = (await (await fetch(`${RELAY}/status/${token}`)).json()).tab === true
  } catch {}
}
if (!ok) {
  console.error('NOT_CONNECTED: アプリが中継につながりませんでした')
  await browser.close()
  process.exit(1)
}
const url = `${RELAY}/mcp/${token}`
await writeFile('wbam-endpoint.txt', url + '\n')
console.log('READY ' + url)
console.log('（このプロセスを止めるとアプリも閉じます。作業が終わるまで動かしたままにしてください）')
const stop = async () => {
  await browser.close().catch(() => {})
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
await new Promise(() => {})
```

### `make_test_image.py`

テスト用の清書画像を作る道具。Python 3 と Pillow が必要。

```python
# make_test_image.py — 実験用のホワイトボード清書画像（1536×1024 の PNG）を作る。Pillow が必要（pip install pillow）
# 使い方：python make_test_image.py [出力ファイル名]
import os
import sys
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else "whiteboard-test.png"
W, H = 1536, 1024
BLACK, BLUE, RED, GREEN = "#222222", "#1f6feb", "#e5484d", "#2f9e44"

# 日本語が出るフォントを探す（Windows / Mac / Linux）
CANDIDATES = [
    "C:/Windows/Fonts/YuGothB.ttc", "C:/Windows/Fonts/meiryob.ttc", "C:/Windows/Fonts/msgothic.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
]
FONT = next((p for p in CANDIDATES if os.path.exists(p)), None)
if FONT is None:
    sys.exit("日本語のフォントが見つかりません。日本語フォント（例：Noto Sans CJK）を入れてから、もう一度実行してください")


def font(size):
    return ImageFont.truetype(FONT, size)


img = Image.new("RGB", (W, H), "#ffffff")
d = ImageDraw.Draw(img)


def text_center(cx, y, s, size, color):
    f = font(size)
    w = d.textlength(s, font=f)
    d.text((cx - w / 2, y), s, font=f, fill=color)


# タイトルと下線
text_center(W / 2, 60, "朝のルーティン", 120, BLACK)
d.line([(W / 2 - 380, 215), (W / 2 + 380, 215)], fill=RED, width=10, joint="curve")

cols = [W * 1 / 6, W * 3 / 6, W * 5 / 6]
labels = ["起きる", "顔を洗う", "朝ごはん"]
for i, (cx, label) in enumerate(zip(cols, labels)):
    # 丸囲みの番号
    d.ellipse([cx - 45, 280, cx + 45, 370], outline=BLUE, width=8)
    text_center(cx, 285, str(i + 1), 64, BLUE)
    text_center(cx, 395, label, 72, BLACK)

# 1. 目覚まし時計
cx, cy = cols[0], 690
d.ellipse([cx - 130, cy - 130, cx + 130, cy + 130], outline=BLACK, width=10)
d.line([(cx, cy), (cx, cy - 85)], fill=BLACK, width=10)
d.line([(cx, cy), (cx + 60, cy + 30)], fill=BLACK, width=10)
d.pieslice([cx - 175, cy - 205, cx - 75, cy - 105], 180, 360, outline=RED, width=9)
d.pieslice([cx + 75, cy - 205, cx + 175, cy - 105], 180, 360, outline=RED, width=9)
d.line([(cx - 90, cy + 120), (cx - 120, cy + 165)], fill=BLACK, width=10)
d.line([(cx + 90, cy + 120), (cx + 120, cy + 165)], fill=BLACK, width=10)

# 2. 蛇口としずく
cx, cy = cols[1], 640
d.rounded_rectangle([cx - 150, cy - 70, cx + 60, cy - 10], radius=20, outline=BLACK, width=10)
d.rounded_rectangle([cx + 20, cy - 70, cx + 80, cy + 60], radius=20, outline=BLACK, width=10)
d.line([(cx - 60, cy - 70), (cx - 60, cy - 120)], fill=BLACK, width=10)
d.line([(cx - 110, cy - 120), (cx - 10, cy - 120)], fill=BLACK, width=10)
for k, (dx, dy) in enumerate([(0, 110), (-40, 190), (40, 190)]):
    x, y = cx + 50 + dx, cy + dy
    d.polygon([(x, y - 40), (x - 22, y), (x + 22, y)], outline=BLUE, width=8)
    d.ellipse([x - 22, y - 20, x + 22, y + 22], outline=BLUE, width=8)

# 3. お皿とトースト
cx, cy = cols[2], 720
d.ellipse([cx - 190, cy + 20, cx + 190, cy + 120], outline=BLACK, width=10)
d.rounded_rectangle([cx - 110, cy - 160, cx + 110, cy + 60], radius=50, outline=GREEN, width=10)
d.rounded_rectangle([cx - 80, cy - 125, cx + 80, cy + 30], radius=35, outline=GREEN, width=6)

# 区切りのあいだの矢印
for x in (W / 3, W * 2 / 3):
    d.line([(x - 60, 700), (x + 50, 700)], fill=BLUE, width=10)
    d.line([(x + 50, 700), (x + 15, 665)], fill=BLUE, width=10)
    d.line([(x + 50, 700), (x + 15, 735)], fill=BLUE, width=10)

text_center(W / 2, 930, "今日もいい一日を！", 56, RED)
img.save(OUT)
print("保存しました:", os.path.abspath(OUT), "（フォント:", FONT + "）")
```
