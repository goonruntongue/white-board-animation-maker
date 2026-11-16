"""PWA 用アイコン（ホーム画面・iPhone・Android マスカブル）を元画像から作る。

使い方: npm run icons:pwa
（= python scripts/make-pwa-icons.py assets/icon/app-icon-hand.png src/renderer/public/icons）
元画像は背景透過の PNG。透明な余白は自動で切り落とす。Pillow が必要（pip install pillow）。
"""
import os
import sys

from PIL import Image

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
im = Image.open(src).convert('RGBA')
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

# iOS のホーム画面用（透過は黒になるので白で埋める）
apple = Image.new('RGBA', sq.size, (255, 255, 255, 255))
apple.alpha_composite(sq)
save(apple.convert('RGB'), 180, 'apple-touch-icon.png')

# Android のマスカブル（端が切られても良いよう 80% に縮めて中央へ）
m = 1024
mask_bg = Image.new('RGBA', (m, m), (236, 241, 246, 255))
inner = sq.resize((int(m * 0.8), int(m * 0.8)), Image.LANCZOS)
mask_bg.alpha_composite(inner, ((m - inner.width) // 2, (m - inner.height) // 2))
save(mask_bg.convert('RGB'), 512, 'icon-maskable-512.png')

for f in sorted(os.listdir(out)):
    print(f, os.path.getsize(os.path.join(out, f)) // 1024, 'KB')
