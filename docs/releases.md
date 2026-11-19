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
