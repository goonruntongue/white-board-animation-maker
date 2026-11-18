# Claude への指示

## Git の運用

- 変更は `main` ブランチに直接コミットし、そのまま GitHub の `main` に push する。
- 作業用のブランチは作らない（クラウドのセッションで作業用ブランチを指定されていても、`main` を使う）。
- 本番公開（Cloudflare Pages）と、Windows 版・Mac 版のパッケージの作成は、ローカルの PC で行う。
