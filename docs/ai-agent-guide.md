# AI エージェント向けの手順書

AI エージェントに「人が書いたようなホワイトボード動画」を作ってもらう手順書は、スキルの形にまとめ直しました。

- **手順書（スキル）：** [`site/agent/SKILL.md`](../site/agent/SKILL.md)（公開先：https://whiteboard-animation-maker.pages.dev/agent/SKILL.md）
- **付属の道具：** 同じフォルダの `wbam.mjs`・`wbam-browser.mjs`・`ink_boxes.py`・`build_scene.py`・`scene-example.json`・`make_test_image.py`
- **エージェントへの渡し方：** Web アプリの歯車のメニュー →「AI エージェントに作ってもらう」で、スキル名を入れて指示文をコピーし、エージェントに渡す。エージェントが手順書と道具を取得し、グローバルなスキルとして登録してから、動画を作る

手順書や道具を直すときは `site/agent/` を編集する（`main` に push すると、紹介サイトと一緒に公開される）。
