# ink_boxes.py — 清書画像の中の「インクのかたまり」を見つけ、範囲（座標）と、番号・目盛りを重ねた確認用の画像を作る。
# Python 3 と Pillow が必要（pip install pillow）。
# 使い方：python ink_boxes.py <画像> [--gap 18] [--out ink-boxes]
#   出力：ink-boxes.json（かたまりの範囲。元の画像のピクセル）と ink-boxes.png（番号と 100px ごとの目盛りつき）
#   --gap：これより近いインクは、同じかたまりとして扱う（px。文字を1語にまとめたいときは大きく、絵を細かく分けたいときは小さく）
import argparse
import json
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument('image')
ap.add_argument('--gap', type=int, default=18)
ap.add_argument('--out', default='ink-boxes')
ap.add_argument('--min', type=int, default=60, help='これより小さいかたまり（面積 px²）は捨てる')
a = ap.parse_args()

src = Image.open(a.image).convert('RGB')
W, H = src.size
K = 4  # 1/4 に縮めて調べる（速さのため）
small = src.resize((W // K, H // K), Image.BILINEAR)
w, h = small.size
px = small.load()
# 白（背景）から離れた色をインクとみなす
ink = Image.new('L', (w, h), 0)
ip = ink.load()
for y in range(h):
    for x in range(w):
        r, g, b = px[x, y]
        if 765 - (r + g + b) > 60 or max(r, g, b) - min(r, g, b) > 40:
            ip[x, y] = 255
# 近いインクどうしをつなぐ
r = max(1, a.gap // K)
grown = ink.filter(ImageFilter.MaxFilter(r * 2 + 1))
gp = grown.load()
seen = bytearray(w * h)
boxes = []
for y in range(h):
    for x in range(w):
        if gp[x, y] and not seen[y * w + x]:
            stack = [(x, y)]
            seen[y * w + x] = 1
            x0 = x1 = x
            y0 = y1 = y
            while stack:
                cx, cy = stack.pop()
                x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and gp[nx, ny] and not seen[ny * w + nx]:
                        seen[ny * w + nx] = 1
                        stack.append((nx, ny))
            # 広げた分を戻して、元の大きさに直す
            bx = [max(0, (x0 + r) * K - 2), max(0, (y0 + r) * K - 2), min(W, (x1 - r + 1) * K + 2), min(H, (y1 - r + 1) * K + 2)]
            if (bx[2] - bx[0]) * (bx[3] - bx[1]) >= a.min:
                boxes.append(bx)
# 読む順（上の行から、左から右）。行は高さの中心で分ける
boxes.sort(key=lambda b: (round(((b[1] + b[3]) / 2) / 60), b[0]))
result = [{'id': i + 1, 'box': b, 'size': [b[2] - b[0], b[3] - b[1]]} for i, b in enumerate(boxes)]
with open(a.out + '.json', 'w', encoding='utf-8') as f:
    json.dump({'image': [W, H], 'gap': a.gap, 'boxes': result}, f, ensure_ascii=False, indent=1)

# 確認用の画像：100px ごとの目盛りと、かたまりの番号
view = src.copy()
d = ImageDraw.Draw(view)
try:
    font = ImageFont.truetype('arial.ttf', 22)
except OSError:
    font = ImageFont.load_default()
for gx in range(0, W, 100):
    d.line([(gx, 0), (gx, H)], fill=(0, 170, 255) if gx % 500 else (0, 90, 255), width=1)
    d.text((gx + 2, 2), str(gx), fill=(0, 90, 255), font=font)
for gy in range(0, H, 100):
    d.line([(0, gy), (W, gy)], fill=(0, 170, 255) if gy % 500 else (0, 90, 255), width=1)
    d.text((2, gy + 2), str(gy), fill=(0, 90, 255), font=font)
for it in result:
    b = it['box']
    d.rectangle(b, outline=(255, 0, 160), width=3)
    d.rectangle([b[0], b[1], b[0] + 34, b[1] + 26], fill=(255, 0, 160))
    d.text((b[0] + 4, b[1] + 2), str(it['id']), fill=(255, 255, 255), font=font)
view.save(a.out + '.png')
print(f'{len(result)} 個のかたまり → {a.out}.json / {a.out}.png')
for it in result:
    print(f"  {it['id']:3d}: {it['box']}")
