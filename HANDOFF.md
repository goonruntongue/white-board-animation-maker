# 引き継ぎメモ（2026-11-18 クラウドのセッションから、ローカルの PC へ）

ローカルの PC がネットにつながらない間に、クラウドのセッション（GitHub のリポジトリを直接使う）で作業した内容です。
ローカルの Claude は、このファイルを読んでから「ローカルで行うこと」を進めてください。

## 1. 変えたこと

### 手描きのブラシ：「区切る」をやめ、「同一グループ」の切り替えにした（コミット `aaed409`）

- **以前：** 何も選ばずにブラシで描くと、前の線から **1.5秒以内** に、**前の線の終わりの近く（画像の対角線の15%以内）** から描き始めた線だけが、自動で同じグループにまとまっていた。条件から外れると勝手に別のグループになり、「区切る」ボタンで手動でも区切れた。
- **今：** 時間と距離で自動でまとめる仕組みは、すべて取り除いた（`CHAIN_MS` と `CHAIN_DIST`）。
  - 「同一グループ」が **オフ**（起動したときの状態）：1本描くごとに、新しいグループになる。
  - 「同一グループ」が **オン**：オンの間に描いた線は、間があいても、離れた所から描いても、すべて1つのグループにまとまる。
  - オンにするたびに、新しいグループから始まる。次のまとまりに移るときは、オフにしてからもう一度オンにする。
  - グループを選んだとき、ブラシから別の操作に切り替えたとき、プロジェクトを開いたときも、次の線から新しいグループになる。
  - オンかオフかは保存しない。アプリを開き直すとオフに戻る。
- 変えたファイル：
  - `src/renderer/src/store.ts`：`sameGroup` と `setSameGroup` を追加し、`drawChain` をグループの ID だけにした
  - `src/renderer/src/components/Stage.tsx`：まとめるかどうかの判定
  - `src/renderer/src/components/LiveEditBar.tsx`：`BreakKey` を `SameGroupKey` に置き換えた
  - `src/renderer/src/lib/hints.ts`、`src/renderer/src/components/UsageGuide.tsx`、`README.md`：説明文
- 確かめたこと：
  - 型チェックが通った
  - ブラウザ版で、次のとおりにまとまった
    - オフで描いた2本は、別々のグループになった
    - オンにして、2.5秒あけて離れた所に描いた2本は、1つのグループになった
    - オフにしてからオンにし直した後の2本は、新しいグループになった
  - スマホの画面幅でも表示が崩れなかった

### `CLAUDE.md` を追加した（コミット `7cf2a77`）

- 変更は `main` に直接コミットして push する。作業用のブランチは作らない。
- 本番公開（Cloudflare Pages）と、Windows 版・Mac 版のパッケージ作りは、ローカルの PC で行う。

## 2. 今の状態

| 項目 | 状態 |
|---|---|
| GitHub の `main` | 最新。上の変更をすべて含む |
| 本番（whiteboard-animation-maker.pages.dev） | **公開済み**。GitHub Actions でコミット `08cd245` の内容を公開した（「同一グループ」入り） |
| Windows 版・Mac 版 | 作り直していない |
| GitHub の `claude/zen-cray-2rypmf` ブランチ | 中身は `main` と同じ。クラウドからは消せなかった。不要なので消してよい |

### クラウドから公開しようとして、できなかったこと

- クラウドの環境では、Cloudflare のトークンを中継（プロキシ）が自動で差し込む仕組みになっている。
- wrangler はファイルを送るとき、Cloudflare から受け取った一時的な鍵を使う。中継がこの鍵までトークンに置き換えてしまうため、ファイルを送る段階で認証に失敗する。
- API に直接送る方法も試した。公開は「成功」と表示されたが、本番のページが 500 エラーになった。そのため、すぐに前の版（デプロイ `0f236ba4`）に戻した。戻した後は、紹介サイトもアプリも正常に開けることを確かめてある。
- なお、この 500 は公開した直後だけの一時的なものだった可能性がある（GitHub Actions で公開したときも、直後の数十秒だけ 500 が返った）。
- 失敗したデプロイ（`ee673569`）は、Cloudflare の履歴に残っている。使わないので、ダッシュボードから消してもよい。

## 3. ローカルで行うこと

1. 最新の `main` を取り込む。

   ```powershell
   git checkout main
   git pull
   ```

2. 依存パッケージを入れ直す（`package.json` は変わっていないが、念のため）。

   ```powershell
   npm ci
   ```

3. 動きを確かめる（任意）。

   ```powershell
   npm run dev:web
   ```

   - 手描きのブラシで「同一グループ」をオン・オフして、まとまり方を見る。

4. 本番に公開する。**GitHub Actions で公開済みなので、この手順は要らない**（下の「5. 追記」を参照）。動いていないときだけ、README の「紹介サイトとアプリを一緒に公開する」と同じ手順で公開する。

   ```powershell
   npm run build:web
   if ($LASTEXITCODE -ne 0) { throw 'Web版のビルドに失敗しました' }
   $publishDir = Join-Path $env:TEMP ('whiteboard-site-' + [guid]::NewGuid())
   New-Item -ItemType Directory -Path $publishDir | Out-Null
   Copy-Item site/* $publishDir -Recurse -Force
   Copy-Item dist/web/* (Join-Path $publishDir 'app') -Recurse -Force
   npx.cmd wrangler pages deploy $publishDir --project-name whiteboard-animation-maker --branch main
   ```

   - 公開した後、https://whiteboard-animation-maker.pages.dev/ と https://whiteboard-animation-maker.pages.dev/app/ を開き、どちらも表示されることを確かめる。
   - アプリの手描きのバーに「同一グループ」が出ていることも確かめる。

5. Windows 版・Mac 版を作り直す（アプリの動きが変わったため）。

   ```powershell
   npm run dist:win
   ```

   - Mac 版は、これまでどおり GitHub のリリースの仕組みで作る。
   - 作ったものを GitHub のリリースに載せる。

6. 不要になったブランチを消す（任意）。

   ```powershell
   git push origin --delete claude/zen-cray-2rypmf
   ```

7. このファイル（`HANDOFF.md`）は、上の作業が終わったら消してよい。消したら、`main` にコミットして push する。

## 4. 補足：クラウドの環境について

- このリポジトリ専用のクラウドの環境「white-board-animation-maker」を作った。
- その環境には、Cloudflare の API トークン（api.cloudflare.com 用）が保存されている。通信先には `whiteboard-animation-maker.pages.dev` を足してある。

## 5. 追記：GitHub Actions で自動で公開するようにした

- `.github/workflows/deploy-site.yml` を追加した。`main` に push すると、GitHub Actions がブラウザ版をビルドし、紹介サイトと一緒に Cloudflare Pages に公開する。
  - Markdown だけを変えたときは動かない。
  - 手動で公開したいときは、Actions の画面で「Deploy site to Cloudflare Pages」の Run workflow を押す。
- 公開には、GitHub のリポジトリの Secrets に `CLOUDFLARE_API_TOKEN`（Cloudflare の API トークン）を登録しておく必要がある。
- `CLAUDE.md` と `README.md` も、この仕組みに合わせて書き直した。
- これで、クラウドのセッションからも公開できる。ローカルの PC からの公開も、これまでどおり使える。
