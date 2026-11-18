"""PWA 用アイコン（ホーム画面・iPhone・Android マスカブル）を元画像から作る。

使い方: npm run icons:pwa
（= python scripts/make-pwa-icons.py assets/icon/app-icon-hand.png src/renderer/public/icons）
元画像は背景透過の PNG。透明な余白は自動で切り落とし、本体から離れた半透明の点々（透過のゴミ）も取り除く。Pillow が必要（pip install pillow）。
"""
import os
import sys

from PIL import Image, ImageChops, ImageFilter

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
im = Image.open(src).convert('RGBA')


def clean_alpha(img):
    """背景透過の「ゴミ」を取り除く。
    本体（ほぼ不透明な部分）から離れた半透明の点々を消し、縁のなめらかさ（アンチエイリアス）は残す。
    　1. ほぼ不透明な画素だけのマスクを作る
    　2. 開く処理（縮めてから広げる）で小さな点を消す
    　3. 少し広げてぼかし、元のアルファと重ねる（縁は元の階調を使う）
    """
    alpha = img.getchannel('A')
    body = alpha.point(lambda a: 255 if a >= 200 else 0)
    body = body.filter(ImageFilter.MinFilter(9)).filter(ImageFilter.MaxFilter(9))  # 点々を除去
    body = body.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1.5))  # 縁に少し余裕
    cleaned = ImageChops.multiply(alpha, body)
    out = img.copy()
    out.putalpha(cleaned)
    return out


im = clean_alpha(im)
# 透明な余白を切り落とす
im = im.crop(im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox())
side = max(im.size)
sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2))


def save(img, size, name):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(out, name), optimize=True)


# 通常アイコン（透過のまま）
save(sq, 192, 'icon-192.png')
save(sq, 512, 'icon-512.png')

# アイコンの外側（透過）を埋める色：アイコンの暗い枠になじむ色
BG = (27, 28, 30, 255)  # #1B1C1E（マスカブル版の背景と同じ）

# iOS のホーム画面用（透過は黒になるので背景色で埋める）
# iOS は角丸に切り抜くので、絵を 84% に縮めて余白を取る（右下の再生ボタンが切れないように）
apple = Image.new('RGBA', sq.size, BG)
inner_a = sq.resize((int(sq.width * 0.84), int(sq.height * 0.84)), Image.LANCZOS)
apple.alpha_composite(inner_a, ((sq.width - inner_a.width) // 2, (sq.height - inner_a.height) // 2))
save(apple.convert('RGB'), 180, 'apple-touch-icon.png')

# Android のマスカブル（端が切られても良いよう 80% に縮めて中央へ）
m = 1024
mask_bg = Image.new('RGBA', (m, m), BG)
inner = sq.resize((int(m * 0.8), int(m * 0.8)), Image.LANCZOS)
mask_bg.alpha_composite(inner, ((m - inner.width) // 2, (m - inner.height) // 2))
save(mask_bg.convert('RGB'), 512, 'icon-maskable-512.png')

for f in sorted(os.listdir(out)):
    print(f, os.path.getsize(os.path.join(out, f)) // 1024, 'KB')
