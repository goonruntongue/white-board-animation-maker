# 「永久コネクター型」への改修：棚卸しと設計（Step 1・Step 2）

作成：2026-11-18 ／ 状態：**設計案。承認待ち（実装はまだしない）**

---

## Step 1：今のコードの棚卸し（どこがブラウザに頼っているか）

### 全体の形（今のセッション型）

```
AI ──POST /mcp/<合言葉>──▶ 中継（Cloudflare Workers + Durable Object） ──WebSocket──▶ ブラウザのタブ（アプリ本体が道具を実行）
デスクトップ版：AI ──▶ Electron のメイン処理（127.0.0.1:39271） ──IPC──▶ 同じアプリ本体
```

道具の一覧と JSON-RPC の受け答えは `src/shared/mcp.ts` に1か所でまとまっており、実際の操作は画面側の `src/renderer/src/automation.ts` が行う。

### ブラウザに頼っている所

| 機能 | ファイル | 頼っているもの | サーバーでの扱い |
|---|---|---|---|
| 描画（1コマを描く） | `engine/wb-engine.js`（`WBRenderer`） | Canvas 2D、`HTMLImageElement`（`loadImage`） | Node 単体では動かない（`node-canvas` に移すと書き換えが要る） |
| 描き順の自動作成 | `engine/autoTrace.ts`、`engine/fillSelection.ts` | Canvas で画素を読む（`getImageData`） | 同上 |
| MP4 の書き出し | `export/exportVideo.ts` | **WebCodecs**（`VideoEncoder`・H.264）＋ `mp4-muxer` | H.264 が入ったブラウザ（Google Chrome）が要る |
| WebM の書き出し | `export/exportVideo.ts` | `MediaRecorder`（**再生時間と同じだけかかる**） | 同上 |
| GIF の書き出し | `export/exportGif.ts` | Canvas ＋ `gifenc` | 同上 |
| HTML の書き出し | `export/exportHtml.ts` | 文字列を組み立てるだけ（手の画像の縮小に Canvas） | ほぼそのまま動く |
| 画像の読み込み・縮小 | `lib/imageTools.ts` | Canvas で縮小・再圧縮 | 同上 |
| 作品の状態 | `store.ts`（zustand） | タブのメモリ | **タブを閉じると消える** |
| 自動バックアップ | `lib/recovery.ts` | IndexedDB・localStorage | その端末・そのブラウザの中だけ |
| 端末ごとの設定 | `lib/*.ts`（テーマ・バーの段数など） | localStorage | AI の操作には関係しない |
| 作品ファイル | `engine/project.ts` の `serializeProject` / `parseProject` | なし（JSON の文字列） | **そのまま使える**。サーバーの保存形式にできる |

### 分かったこと

- **描画・自動の描き順づくり・書き出しは、すべてブラウザの機能でできている。** Node に移すには `wb-engine.js`・`autoTrace.ts`・書き出し3種を書き換える必要があり、見た目が今とずれる危険もある。
- 一方、**ブラウザごとサーバーで動かせば、コードはほぼ100%そのまま使える。** これは `docs/ai-agent-guide.md` の `wbam-browser.mjs` で、画面を出さない Chrome でアプリを開き、MP4（H.264）まで作れることを確かめ済み（2026-11-18）。
- 道具の意味は `src/shared/mcp.ts` と `automation.ts` で決まっているので、サーバー版もこの2つを使えば、道具の意味は変わらない。
- 足りないのは次の3つだけ。
  1. 常に動いていること
  2. 長期の API キーで認証すること
  3. 作品と書き出したファイルを、タブの外（サーバー）に保存すること

---

## Step 2：設計案と比較

### 3つの案の比較

| | A. さくらの VPS に常駐 | B. Cloudflare（Workers + R2/D1 + Browser Rendering） | C. ハイブリッド（A の最小版） |
|---|---|---|---|
| 形 | VPS で Node の MCP サーバーと、画面を出さない Chrome を常に動かす。Chrome の中で今の Web アプリを開いたままにし、道具はそのアプリに実行させる | Workers が MCP を受け、描画は Browser Rendering（Cloudflare のブラウザ）を都度呼ぶ。保存は R2・D1 | A と同じ。ただし最初は「MCP・認証・保存」だけを作り、描画と書き出しは A と同じく Chrome の中の今のアプリに任せる |
| 今のコードの使い回し | **ほぼ100%**（アプリをそのまま開く） | 描画はブラウザなので使い回せるが、呼ぶたびにブラウザを立ち上げ、作品を読み込み直す仕組みが要る | **ほぼ100%** |
| MP4 | ◎ Google Chrome の H.264（WebCodecs）でそのまま作れる（確認済み）。ffmpeg は保険として WebM → MP4 の変換に使える | △ Browser Rendering の Chromium で H.264 を作れるかは未確認。作れない場合は別の変換先が要る | ◎ A と同じ |
| 1回の書き出しにかかる時間 | MP4・GIF は再生時間より短い（1コマずつ作るため）。WebM は再生時間と同じ | 同じ。ただしブラウザの立ち上げに毎回数秒かかる | A と同じ |
| 作品の保存 | VPS のディスク（`.wbanim` の JSON と画像） | R2（画像・動画）＋ D1（作品の一覧・キー） | VPS のディスク |
| 認証 | `Authorization: Bearer <長期キー>`。キーは SHA-256 で保存 | 同じ（D1 にハッシュ） | 同じ |
| 月額の目安 | **追加 0 円**（今の VPS の料金のみ）。Chrome にメモリを 1GB ほど使う | Workers 有料プラン 月 $5 から。Browser Rendering は使った時間に応じて追加 | **追加 0 円** |
| 運用の手間 | VPS の更新・監視・TLS（Let's Encrypt）・Chrome の更新 | ほぼなし（サーバーの面倒はない） | A と同じ |
| 難しさ | 中 | **高**（描画の層の分け方と、ブラウザの都度起動が一番の山） | **低〜中** |
| 弱いところ | VPS が止まると使えない。同時にたくさんの依頼は苦手（1つの Chrome で順番に処理） | 費用が使った分だけ増える。H.264 が不確か | A と同じ |

### おすすめ：C（ハイブリッド）を、さくらの VPS で始める

理由は次の3つ。

1. **今の描画と書き出しが、ほぼそのまま使える。** 見た目のずれも、書き換えの手間も小さい。動くことは、手元で確かめ済み。
2. **追加の費用がかからない。** MP4 も確実に作れる（Google Chrome の H.264）。
3. **あとから B に移れる。** 道具の層（`src/shared/mcp.ts`）と保存の層を分けて作るので、Cloudflare に移すときは「どこで Chrome を動かすか」だけを差し替えればよい。

### C の構成

```
AI（Muse・Claude・Codex など）
   │  POST https://<ホスト名>/mcp     Authorization: Bearer <長期キー>
   ▼
nginx（TLS：Let's Encrypt）
   ▼
wbam-server（Node・systemd で常駐）
   ├─ 認証：キーの SHA-256 を keys.json と照らし合わせる（違えば 401）
   ├─ MCP：src/shared/mcp.ts の handleMcpMessage をそのまま使う
   ├─ 作品の保存：/var/lib/wbam/<キーの持ち主>/projects/<作品ID>.wbanim
   ├─ 書き出し：/var/lib/wbam/<持ち主>/exports/…（署名つきの期限つき URL で配る。既定 24 時間）
   └─ 実行役：Playwright ＋ Google Chrome（画面なし）で Web アプリを開いたまま持つ
          └─ 持ち主ごとに1つのページ。道具は page.evaluate で automation.ts の runTool を呼ぶ
             （中継・WebSocket は使わない。サーバーの中で直接つなぐ）
```

- **作品が消えないように：** 作品を変える道具を実行するたびに、作品を `.wbanim` としてディスクに保存する。Chrome が落ちても、開き直して読み込めば元に戻る。
- **新しく足す道具**（今の道具の意味は変えない）：
  - `list_projects`：保存した作品の一覧
  - `open_project`：保存した作品を開く
  - `save_project`：名前を付けて保存する
  - `load_image` の `upload_url`：大きな画像を、別の HTTP で先に送ってから読み込む。AI が base64 を書き出さなくて済む
- **キーの発行・失効：** サーバーの中のコマンドで行う（`wbam-keys create <名前>` ／ `revoke <名前>` ／ `list`）。平文のキーは作ったときに一度だけ画面に出し、保存するのはハッシュだけ。ログ・レスポンス・コミットには出さない。
- **Web アプリは変えない：** 手で使う Web 版・デスクトップ版・今のセッション型の AI 連携（中継）は、そのまま残す。サーバーは別のものとして足す。

### Muse への登録に必要な情報（サーバーができたら README に書く）

| 項目 | 値 |
|---|---|
| provider | `whiteboard-animation-maker` |
| api_hosts | 決めるホスト名（例：`wbam.<お持ちのドメイン>`） |
| auth_scheme | `api_key` |
| placement | `bearer_header` |
| 疎通確認 | `get_status`（読むだけで、作品を変えない） |

### このあとの手順（承認後）

| Step | すること | 終わりの目安 |
|---|---|---|
| 3 | 最小の実装：サーバー・認証・`get_status`・`load_image`・`auto_trace`・`export`（mp4）。VPS に入れて systemd で常駐 | タブを全部閉じた状態で、curl から `get_status` が返る。画像 → 下書き → MP4 のダウンロードまで通る。キーなし・違うキーは 401 |
| 4 | 残りの道具と、作品の保存（`list_projects` など）。キーの発行・失効のコマンド。README（デプロイ・キーの作り直し・Muse の登録情報） | 受け入れ条件を全部通す。Web 版の手動編集と書き出しに影響がないことを確かめる |

各 Step で、変えたファイル・テストの結果・残りの課題を短く報告する。

### 決めてほしいこと（承認と一緒に教えてください）

1. **案：** C（さくらの VPS）でよいか
2. **ホスト名：** VPS で使う名前。例：`wbam.<お持ちのドメイン>`。DNS の A レコードを VPS に向ける必要がある
3. **VPS の空き：** メモリが 1GB ほど余っているか。分からなければ、こちらで読み取り専用で調べる
4. **キーの持ち主の単位：** 最初は「村上さん1人分のキー」でよいか（人ごとに作品の置き場所を分ける作りにはしておく）
5. **書き出したファイルの保存期間：** 既定 24 時間でよいか（作品の `.wbanim` は消さない）
