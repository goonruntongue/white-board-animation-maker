---
name: whiteboard-video
description: ホワイトボード動画作成。ホワイトボードの清書画像から、人が手で書いているように見える動画（MP4）を Whiteboard Animation Maker（Web 版）で作る。「ホワイトボード動画を作って」「この画像を手描きアニメーションにして」と頼まれたときに使う。
---

# ホワイトボード動画作成（Whiteboard Animation Maker）

ホワイトボードの清書画像を、**人が説明しながら手で書いているように見える動画（MP4）** にする手順です。
アプリは https://whiteboard-animation-maker.pages.dev/app/ （無料・ログイン不要）。AI はアプリの道具（MCP）を使って操作します。

> **このスキルを使う AI へ**
> 最初から最後まで、自分で進めてください。利用者の手が要るのは **【利用者にお願い】** の所だけです。
> このフォルダの付属ファイル（`wbam.mjs`・`wbam-browser.mjs`・`build_scene.py`・`ink_boxes.py`・`make_test_image.py`・`scene-example.json`）を使います。
> 付属ファイルが手元にないときは、`https://whiteboard-animation-maker.pages.dev/agent/<ファイル名>` から取得してください。

## 完成の条件

- 作業フォルダの `wbam-out/` に **MP4** と **編集用プロジェクト（.wbanim）** がある
- 動画は「タイトル → ひとまとまりずつ（見出し → その絵 → つなぎの矢印）→ 締めの一言」のように、**人が説明する順** に描かれる
- どの文字・絵も **欠けずに** 描き終わる（途中のコマで確かめてある）

## 大事な考え方（うまくいったやり方）

1. **自動の下書き（`auto_trace`）に任せきりにしない。** 自動では「見出しを全部 → 絵を全部」や「行ごとに上から塗る」順になり、人の説明の順にならない。
2. 絵を **「区切り」** に分け、**人が説明する順** に並べて、区切りごとにグループを作る（`build_scene.py`）。
   - 文字（`text`）：手を小さく上下させながら、左から右へ
   - 絵（`pic`）：同じ動きで面を塗る（水しぶきのように上から下が自然なものは `direction: "down"`）
   - 矢印・線（`arrow`）：帯で左から右へ一筆
3. **途中のコマを見て、欠けを直す。** 欠けていたら、その区切りの範囲を広げるか、`w`（手が一度に見せる幅）を変えて組み立て直す（何度でもやり直せる）。

---

## 手順

### 1. 作業フォルダと道具を用意する

1. 作業フォルダを作る（例：`wbam-work/`。スキルのフォルダの中ではなく、作業用の場所に）
2. 付属ファイルを作業フォルダに写す
3. 必要なもの：**Node.js 18 以上**、**Python 3 と Pillow**（`pip install pillow`）

### 2. アプリを開いて、AI から操作できるようにする

**道 A（自動・利用者の手なし）**：ブラウザを自動で動かせる環境なら、これを使う。

```bash
npm init -y && npm i playwright-core     # Chrome / Edge が入っているとき（MP4 を確実に作れる）
WBAM_CHANNEL=chrome node wbam-browser.mjs   # 背景で動かし、止めない（Windows の PowerShell：$env:WBAM_CHANNEL='chrome'; node wbam-browser.mjs）
```

- `READY https://…/mcp/…` と出て `wbam-endpoint.txt` ができたら準備完了。**作業が終わるまで止めない**
- Chrome がないとき：`npm i playwright && npx playwright install chromium` のあと `node wbam-browser.mjs`（この場合 MP4 が作れないことがある → 手順 7）
- `NOT_CONNECTED` のとき：`whiteboard-animation-maker.pages.dev` と `whiteboard-mcp-relay.goonruntongue.workers.dev` へ出られるか確かめ、だめなら道 B

**道 B（ブラウザを動かせないとき）**

> **【利用者にお願い】**
> 1. https://whiteboard-animation-maker.pages.dev/app/ を開く（古い画面なら、画面下の「再読み込み」）
> 2. 歯車のメニュー →「AI 連携（MCP）」→「AI からの接続を受け付ける」をオン
> 3. 「エンドポイントの URL」をコピーして AI に渡す。作業が終わるまでタブを開いたまま

渡された URL を `wbam-endpoint.txt` に1行で保存する。

**道 C（シェルがないチャット型の AI：claude.ai・ChatGPT など）**

> **【利用者にお願い】** 道 B の手順で URL を出し、AI のコネクタ設定（claude.ai は「設定 → コネクタ → カスタムコネクタを追加」、認証なし）に登録して、新しいチャットでこのスキルの内容を渡し直してください。画像はアプリの画面に自分で読み込んでください。

道 C では付属の道具が使えないので、MCP のツールを直接呼んで、下の手順の考え方で `add_group` を組み立てる。

**つながったかの確認**：`node wbam.mjs get_status`（作品名などが返れば OK）

> **合言葉の入った URL（`/mcp/` のあと）は秘密。** 報告・ログ・コミットには書かない。

### 3. 画像を用意して、読み込む

- 利用者から画像をもらっていれば、それを使う（PNG・JPEG・WebP。大きさは 2560px までに自動で縮む）
- なければ：`python make_test_image.py whiteboard.png`（日本語のフォントが要る）
- 読み込む：`node wbam.mjs load_image '{"file":"./whiteboard.png"}'`
  （base64 は `wbam.mjs` が作る。**自分で base64 の文字を書き出さない**）

### 4. 絵を見て、区切りを決める

```bash
python ink_boxes.py whiteboard.png --gap 18 --out boxes-18   # 語・絵のまとまりの単位
python ink_boxes.py whiteboard.png --gap 8  --out boxes-8    # もっと細かい単位（近い矢印・飾りが分かれる）
```

- `boxes-18.png` と `boxes-8.png`（番号・100px の目盛りつき）を **自分の目で見て**、`.json` の座標と見比べる
- 2つを組み合わせて区切りを決める。目安：
  - タイトル（飾りのキラキラは別の区切りにして、タイトルのあと）
  - 見出し（番号つきなら番号ごと）
  - 見出しに対応する絵（絵が複数の部品なら、描く順に `boxes` を並べる）
  - つなぎの矢印
  - 締めの一言（両端の飾りは最後）
- 範囲は、見つかったかたまりより **上下左右に 6〜12px 広げる**。隣の区切りと重ならないように（重なると、先に少し見えてしまう）

### 5. 描く順と時間を決めて、組み立てる

`scene-example.json`（今回うまくいった「朝のルーティン」の例）をまねて `scene.json` を書き、組み立てる。

```bash
python build_scene.py scene.json      # いまのグループを全部消してから、書いた順に作り直す
```

**順番**：人が説明しながら書く順。基本は、タイトル → 上から下・左から右。**ひとまとまり（見出し → その絵 → 次へつなぐ矢印）を書き終えてから次へ**。飾り（キラキラ・下線・両端の線）は、それが付く内容のあと。

**時間の目安（今回の合格した値）**

| 区切り | 描く時間 `sec` | 次までの間 `delay` | 手の幅 `w` |
|---|---|---|---|
| 大きなタイトル（7文字） | 3.2 | 0.3 | 72 |
| 見出し（4〜5文字） | 2.0〜2.2 | 0.25 | 64 |
| 1行の文（9文字） | 3.4 | 0.2 | 70 |
| 大きな絵（時計・トースト） | 2.6 | 0.15〜0.3 | 80 |
| 中くらいの絵（蛇口） | 1.5 | 0.15 | 70 |
| 小さな絵・水しぶき | 1.1 | 0.3 | 60 |
| 飾り（キラキラ・線） | 0.5〜0.8 | 0〜0.7 | 50〜60 |
| 矢印 | 0.5 | 0.5 | （範囲の高さ） |

- 文字はおよそ **1文字 0.4 秒**（タイトルは少しゆっくり）
- まとまりの切れ目の間は **0.5〜0.7 秒**、まとまりの中は **0.15〜0.3 秒**
- 全体は **20〜60 秒** を目安に

### 6. 途中のコマを見て、欠けを直す

```bash
node wbam.mjs render_frame '{"progress":0.35,"max_width":1536,"hand":false}'
node wbam.mjs render_frame '{"progress":0.65,"max_width":1536,"hand":false}'
node wbam.mjs render_frame '{"progress":1,"max_width":1536,"hand":false}'
```

- 保存された PNG（`wbam-out/`）を **自分の目で見る**。描き終わった区切りの文字・絵の **端（上下・左右・脚・縁）が欠けていないか** を確かめる
  - 最後のコマは「描き終わったら画像全体を表示」で補われるので、**途中のコマ** で確かめるのが大事
- 欠けていたら：その区切りの範囲を欠けた側へ広げる、または `w` を大きくして、`build_scene.py` をもう一度
- 先に見えてはいけない所が見えていたら：範囲を狭める、または順番を見直す
- 手が入ったコマ（`"hand":true`）で、動きの雰囲気も1〜2枚見ておく

### 7. 書き出して、手元に保存する

```bash
node wbam.mjs export '{"format":"mp4","max_width":1536}'
node wbam.mjs export '{"format":"project"}'
```

- どちらも `wbam-out/` に自動で保存される
- MP4 が作れないと言われたら：Chrome を使う（`WBAM_CHANNEL=chrome`）。だめなら `webm`、それもだめなら `gif`（`max_width` 640・`fps` 10）

### 8. 片付けと報告

1. 道 A：`wbam-browser.mjs` を止める（自分が動かしたプロセスだけを止める）
2. 道 B・C：
   > **【利用者にお願い】** アプリの「AI 連携（MCP）」の受け付けをオフにしてください（URL が人に知られた心配があれば「合言葉を作り直す」も）。
3. 報告（合言葉の入った URL は書かない）

```text
## できたもの
- MP4：<場所>（長さ ○○ 秒）
- 編集用プロジェクト：<場所>（アプリのメニュー「開く」で開くと、手で続きを直せる）
## 描く順
1. … 2. … （区切りの名前を順に）
## 直したこと・自信がない所
- …
## 道具への意見（足りなかったこと・使いにくかったこと）
- …
```

---

## 困ったとき

| 起きたこと | 対処 |
|---|---|
| 「アプリが開いていません」 | 道 A：`wbam-browser.mjs` が動いているか確かめ、止まっていたら動かし直す（同じ URL を使い続けるなら `WBAM_TOKEN=<合言葉>`）。道 B・C：利用者にタブを開いてオンにしてもらう |
| 「ほかのタブが同じ URL でつなぎました」 | 同じ URL を2か所で開いている。使わない方を閉じる |
| HTTP 404 | URL の写し間違い |
| HTTP 403（エラー 1010） | 名乗らないアクセスとして弾かれた。`User-Agent` を付ける（`wbam.mjs` は付けている） |
| 返事が遅い | MP4 の書き出しは数十秒〜数分かかる。待つ |
| Windows の PowerShell で JSON の引数が崩れる | 引数をファイルに書き、`node wbam.mjs add_group @args.json` のように渡す |
| `ink_boxes.py` で近いものが1つにまとまる | `--gap` を小さくする。それでも分かれなければ、目盛りを見て範囲を自分で書く |
| 文字化け・豆腐（□） | 日本語のフォントを入れる |

## 道具（MCP ツール）

`node wbam.mjs tools` で一覧と引数を表示できる。主に使うもの：

| 道具 | すること |
|---|---|
| `get_status` | 作品名・画像の大きさ・グループ数・長さ |
| `load_image` | 画像を読み込む（`wbam.mjs` では `file` で手元のファイル） |
| `get_image` | 今の画像を見る（`show_groups` で各グループの範囲と番号） |
| `auto_trace` | 自動の下書き（参考に使う。仕上げには使わない） |
| `list_groups` / `get_group` | グループの一覧・中身 |
| `add_group` / `update_group` / `delete_groups` / `reorder_groups` / `merge_groups` | グループを作る・直す・消す・並べ替える・まとめる（`build_scene.py` が使う） |
| `update_settings` | 全体の速さ・前後の待ち・手の表示など |
| `render_frame` | 途中の1コマを画像で見る |
| `undo` | 直前の操作を取り消す |
| `export` | 書き出す（`mp4`・`webm`・`gif`・`html`・`project`） |

## 付属ファイル

| ファイル | 役目 |
|---|---|
| `wbam.mjs` | アプリの道具を HTTP で直接呼ぶ（画像の受け渡し・書き出したファイルのダウンロードもする） |
| `wbam-browser.mjs` | アプリを画面なしのブラウザで開き、AI 連携をオンにして待つ（道 A） |
| `ink_boxes.py` | 画像のインクのかたまりを見つけ、範囲と、番号・目盛りつきの確認画像を作る |
| `build_scene.py` | `scene.json` から、人が説明する順のグループを組み立てる |
| `scene-example.json` | 「朝のルーティン」で合格した組み立ての例 |
| `make_test_image.py` | テスト用の清書画像を作る |
