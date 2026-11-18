# Claude への指示

## Git の運用

- 変更は `main` ブランチに直接コミットし、そのまま GitHub の `main` に push する。
- 作業用のブランチは作らない（クラウドのセッションで作業用ブランチを指定されていても、`main` を使う）。

## 公開

- 紹介サイトとブラウザ版（Cloudflare Pages）：`main` に push すると、GitHub Actions（`.github/workflows/deploy-site.yml`）が自動で公開する。Markdown だけの変更では動かない。手動で公開したいときは、Actions の画面で「Deploy site to Cloudflare Pages」を Run workflow する。
- push した後は、Actions の結果を確かめてから「公開した」と伝える。
- Windows 版・Mac 版：`v` で始まるタグ（例：`v0.1.1`）を push すると、GitHub Actions（`.github/workflows/release.yml`）が作って GitHub のリリースに載せる。
- Web 版の AI 連携の中継（`relay/`、Cloudflare Workers）：`main` への push では公開されない。`relay/` を変えたら `npx wrangler deploy --config relay/wrangler.jsonc` で公開する。
- ローカルの PC から公開する手順（README の「紹介サイトとアプリを一緒に公開する」）も、これまでどおり使える。
