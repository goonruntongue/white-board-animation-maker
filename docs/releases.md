# デスクトップ版のリリースの記録

インストーラーは GitHub のリリース（https://github.com/goonruntongue/white-board-animation-maker/releases ）に置いている。
ファイルは大きく（1つ 150MB 前後）、Git のリポジトリには入れられない（GitHub は 100MB を超えるファイルを受け付けない）ため、リポジトリにはこの記録だけを残す。
紹介サイトのダウンロードボタンは「最新版」（`releases/latest/download/<ファイル名>`）を指すので、ファイル名は毎回同じにしている。

| ファイル名 | 対象 |
|---|---|
| `WhiteboardAnimationMaker-Setup.exe` | Windows 10 / 11（64bit）インストーラー |
| `WhiteboardAnimationMaker-Portable.exe` | Windows 10 / 11（64bit）インストール不要版 |
| `WhiteboardAnimationMaker-mac-arm64.dmg` | Mac（Apple シリコン：M1 以降） |
| `WhiteboardAnimationMaker-mac-x64.dmg` | Mac（Intel） |
| `WhiteboardAnimationMaker-linux-x86_64.AppImage` | Linux（x86_64） |

作り方：`v` で始まるタグを push すると、`.github/workflows/release.yml` が Windows・Mac・Linux のそれぞれのマシンで作って、リリースに載せる（Linux は v0.1.3 以降から自動）。

---

## v0.1.11（2026-11-22）

すべて GitHub Actions で作成（Windows・Windows インストール不要版・Mac arm64 / x64・Linux）。

主な変更（v0.1.10 から）：
- ブラシ・消しゴムの大きさ（プリセット・スライダー・数値）のポップヒントに、「[ キーで小さく、] キーで大きくできます」を足す（キーを変えていれば、変えたキーで出す）

## v0.1.10（2026-11-22）

すべて GitHub Actions で作成（Windows・Windows インストール不要版・Mac arm64 / x64・Linux）。

主な変更（v0.1.9 から）：
- 歯車のメニューの「キーボードショートカット」の横の文字が、メニューの右へはみ出していたのを直す（横にはキーだけを出し、入りきらない文字は … で切る）

## v0.1.9（2026-11-21）

すべて GitHub Actions で作成（Windows・Windows インストール不要版・Mac arm64 / x64・Linux）。

主な変更（v0.1.8 から）：
- タイムラインの表示倍率（Photoshop のナビゲーター風：倍率の数値・縮小・スライダー・拡大）。Ctrl＋ホイール、Alt+= / Alt+-、\ で全体表示。目盛りの間隔も倍率に合わせる
- 手描きの操作を V（選ぶ・動かす）・B（ブラシ）・E（消しゴム）・P（パス編集）で切り替える。グループを選ぶは Shift+V、グループから消すは Shift+E に移す
- パス編集のパス選択で Alt を押しているあいだは、アンカーポイントの切り替えになる
- Ctrl+K で環境設定（歯車のメニュー）、Ctrl+Shift+N で新しいグループ、Ctrl+Shift+A で描き順を自動で作る、Ctrl+Shift+Z でもやり直す
- キーボードショートカットの画面（Ctrl+Alt+Shift+K・歯車のメニュー）で、操作ごとにキーを足す・外す・既定に戻す
- ブラシのときの [ ] は、すでにある線ではなく、これから描くブラシの太さを変える（消しゴムでは消しゴムの大きさ）

## v0.1.8（2026-11-21）

すべて GitHub Actions で作成（Windows・Windows インストール不要版・Mac arm64 / x64・Linux）。

主な変更（v0.1.7 から）：
- 「描き直したら次の線へ進む」がオンのとき、グループの最後の線を描き直したら自動で「追加」に切り替え、続けてなぞると線を足していく（「グループ内の最後の線でした。続けてなぞると線 N として足されます」と知らせる）

## v0.1.7（2026-11-21）

すべて GitHub Actions で作成（Windows・Windows インストール不要版・Mac arm64 / x64・Linux）。

主な変更（v0.1.6 から）：
- ブラシ・消しゴムの大きさの数値を、マウスホイール（Shift で 10 ずつ）や、押して選んでから ↑↓ キー（Shift・PageUp / PageDown で 10 ずつ）で変えられるようにする

## v0.1.6（2026-11-19）

すべて GitHub Actions で作成（Windows・Windows インストール不要版・Mac arm64 / x64・Linux）。

主な変更（v0.1.5 から）：
- PC で画面の幅が狭いとき、ブラシの横の「描き直す｜追加」の文字が消えて空のボタンになっていたのを直す
- 線を選んでいて Shift を押している間は、ブラシのアイコンと「描き直す｜追加」の表示を「追加」にする

## v0.1.5（2026-11-19）

すべて GitHub Actions で作成（Windows・Windows インストール不要版・Mac arm64 / x64・Linux）。

主な変更（v0.1.4 から）：
- 手描きのブラシでなぞった線は、なぞった時間ではなく、自動で作った線と同じペンの速さで描く（線の長さで時間が決まる。線の中の緩急はそのまま）。描き直しも、なぞった線の長さで決める
- ブラシの ▼ に「なぞった速さのまま残す」（既定はオフ）
- グループの「線ごとの時間」に「すべての線を自動の速さにそろえる」
- スマホなど指で触る画面では、ブラシで線を選んでいる間、その線の書き始めに描く太さの円を出す

## v0.1.4（2026-11-19）

すべて GitHub Actions で作成（Windows・Windows インストール不要版・Mac arm64 / x64・Linux）。

主な変更（v0.1.3 から）：
- 線を選んでいるとき、ブラシの大きさの欄とカーソルの円がその線の太さになる（欄で変えた太さで描き直し・追加）
- ブラシの横に「描き直す／追加」の切り替えを置いた（PC は Shift を押しながらなぞると、その1回だけ追加）
- 描き直したら次の線へ進む（▼ でオフにできる）。元に戻すと、描き直した線の選択に戻る。追加は選んでいる線のすぐ後ろに入る
- なぞっている最中も、ペン先が通った所から絵が見えていく
- 「同一グループ」「区切る」をやめ、「新しいグループ」に（選んでいたグループのすぐ次にできる）
- 「全部消して線1から」：グループの線を全部消して、線1から描き直せる

## v0.1.3（2026-11-19）

すべて GitHub Actions で作成（Windows・Windows インストール不要版・Mac arm64 / x64・Linux）。Linux 版を GitHub Actions で作るのは、この版から。

主な変更（v0.1.2 から）：
- PC でもオプションバーを2段にできるようにした（既定は2段。歯車のメニュー「オプションバーを2段にする」で切り替え）
- ブラシのボタンの表示とアイコンを、▼ で選んだ項目（描き直す／追加）にいつも合わせる
- スマホで「AI 連携」などの画面が下のドックに隠れるのを直した。PC の歯車のメニューの項目が窮屈だったのを直した
- 「AI エージェントに作ってもらう」（指示文のコピー）を追加

## v0.1.2（2026-11-18〜19）

| ファイル | 作ったもの | 大きさ |
|---|---|---|
| Windows `.exe` | GitHub Actions（windows-latest） | 約 146MB |
| Mac `.dmg`（arm64・x64） | GitHub Actions（macos-latest）。最初の実行では Mac のマシンが割り当てられず15分で打ち切られたため、2026-11-19 に Mac の分だけ実行し直した | 約 146MB・153MB |
| Linux `.AppImage` | **別の AI エージェントが Linux で作ったもの**を、2026-11-19 に手で載せた | 158,198,473 バイト |

### Linux 版（AppImage）について

- SHA-256：`f6bc836467f8cebd10b28a63b5fb061330ffd9040f654020201e8c495b193dcd`
  （載せたあと、リリースからダウンロードし直して一致することを確かめた）
- 中身の確認（Windows 上で、AppImage の中のファイルシステムを開いて確かめた）
  - 形式：ELF の実行ファイル＋AppImage type 2（`AI\x02`）
  - アプリ本体 `resources/app.asar` の `package.json`：name `whiteboard-animation-maker`、**version 0.1.2**、productName `Whiteboard Animation Maker`
  - `whiteboard-animation-maker.desktop`：`X-AppImage-Version=0.1.2`、`Exec=AppRun --no-sandbox %U`、`Categories=Graphics;`
- Linux の実機では、まだ起動を確かめていない
- 使い方：`chmod +x WhiteboardAnimationMaker-linux-x86_64.AppImage` で実行の許可を付けてから起動する（紹介サイトのダウンロード欄にも案内を載せた）
- 次の版からは、GitHub Actions（ubuntu-latest）で `npm run dist:linux` から自動で作る。設定は `package.json` の `build.linux`（AppImage・x64・アイコン `assets/icon/app-icon-mac.png`・ファイル名固定）

## v0.1.1（2026-11-18）

Windows・Mac（arm64・x64）。GitHub Actions で作成。

## v0.1.0（2026-11-18）

最初の配布。Windows・Mac（arm64・x64）。GitHub Actions で作成。
