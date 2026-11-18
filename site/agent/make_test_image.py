# make_test_image.py — 実験用のホワイトボード清書画像（1536×1024 の PNG）を作る。Pillow が必要（pip install pillow）
# 使い方：python make_test_image.py [出力ファイル名]
import os
import sys
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else "whiteboard-test.png"
W, H = 1536, 1024
BLACK, BLUE, RED, GREEN = "#222222", "#1f6feb", "#e5484d", "#2f9e44"

# 日本語が出るフォントを探す（Windows / Mac / Linux）
CANDIDATES = [
    "C:/Windows/Fonts/YuGothB.ttc", "C:/Windows/Fonts/meiryob.ttc", "C:/Windows/Fonts/msgothic.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
]
FONT = next((p for p in CANDIDATES if os.path.exists(p)), None)
if FONT is None:
    sys.exit("日本語のフォントが見つかりません。日本語フォント（例：Noto Sans CJK）を入れてから、もう一度実行してください")


def font(size):
    return ImageFont.truetype(FONT, size)


img = Image.new("RGB", (W, H), "#ffffff")
d = ImageDraw.Draw(img)


def text_center(cx, y, s, size, color):
    f = font(size)
    w = d.textlength(s, font=f)
    d.text((cx - w / 2, y), s, font=f, fill=color)


# タイトルと下線
text_center(W / 2, 60, "朝のルーティン", 120, BLACK)
d.line([(W / 2 - 380, 215), (W / 2 + 380, 215)], fill=RED, width=10, joint="curve")

cols = [W * 1 / 6, W * 3 / 6, W * 5 / 6]
labels = ["起きる", "顔を洗う", "朝ごはん"]
for i, (cx, label) in enumerate(zip(cols, labels)):
    # 丸囲みの番号
    d.ellipse([cx - 45, 280, cx + 45, 370], outline=BLUE, width=8)
    text_center(cx, 285, str(i + 1), 64, BLUE)
    text_center(cx, 395, label, 72, BLACK)

# 1. 目覚まし時計
cx, cy = cols[0], 690
d.ellipse([cx - 130, cy - 130, cx + 130, cy + 130], outline=BLACK, width=10)
d.line([(cx, cy), (cx, cy - 85)], fill=BLACK, width=10)
d.line([(cx, cy), (cx + 60, cy + 30)], fill=BLACK, width=10)
d.pieslice([cx - 175, cy - 205, cx - 75, cy - 105], 180, 360, outline=RED, width=9)
d.pieslice([cx + 75, cy - 205, cx + 175, cy - 105], 180, 360, outline=RED, width=9)
d.line([(cx - 90, cy + 120), (cx - 120, cy + 165)], fill=BLACK, width=10)
d.line([(cx + 90, cy + 120), (cx + 120, cy + 165)], fill=BLACK, width=10)

# 2. 蛇口としずく
cx, cy = cols[1], 640
d.rounded_rectangle([cx - 150, cy - 70, cx + 60, cy - 10], radius=20, outline=BLACK, width=10)
d.rounded_rectangle([cx + 20, cy - 70, cx + 80, cy + 60], radius=20, outline=BLACK, width=10)
d.line([(cx - 60, cy - 70), (cx - 60, cy - 120)], fill=BLACK, width=10)
d.line([(cx - 110, cy - 120), (cx - 10, cy - 120)], fill=BLACK, width=10)
for k, (dx, dy) in enumerate([(0, 110), (-40, 190), (40, 190)]):
    x, y = cx + 50 + dx, cy + dy
    d.polygon([(x, y - 40), (x - 22, y), (x + 22, y)], outline=BLUE, width=8)
    d.ellipse([x - 22, y - 20, x + 22, y + 22], outline=BLUE, width=8)

# 3. お皿とトースト
cx, cy = cols[2], 720
d.ellipse([cx - 190, cy + 20, cx + 190, cy + 120], outline=BLACK, width=10)
d.rounded_rectangle([cx - 110, cy - 160, cx + 110, cy + 60], radius=50, outline=GREEN, width=10)
d.rounded_rectangle([cx - 80, cy - 125, cx + 80, cy + 30], radius=35, outline=GREEN, width=6)

# 区切りのあいだの矢印
for x in (W / 3, W * 2 / 3):
    d.line([(x - 60, 700), (x + 50, 700)], fill=BLUE, width=10)
    d.line([(x + 50, 700), (x + 15, 665)], fill=BLUE, width=10)
    d.line([(x + 50, 700), (x + 15, 735)], fill=BLUE, width=10)

text_center(W / 2, 930, "今日もいい一日を！", 56, RED)
img.save(OUT)
print("保存しました:", os.path.abspath(OUT), "（フォント:", FONT + "）")
