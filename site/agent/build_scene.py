# build_scene.py — 「区切り」を並べた JSON から、人が説明しながら書く順のグループを組み立てる（wbam.mjs を使う）。
# Python 3 と Node.js が必要。wbam.mjs と同じフォルダで実行する。
# 使い方：python build_scene.py scene.json
#
# scene.json の形：
# {
#   "image": "./whiteboard.png",          … 省略可。書いてあれば最初に読み込む
#   "items": [                             … 描く順に並べる
#     {"name": "タイトル", "kind": "text", "box": [x0, y0, x1, y1], "sec": 3.2, "delay": 0.3, "w": 72},
#     {"name": "時計", "kind": "pic", "boxes": [[x0, y0, x1, y1]], "sec": 2.6, "delay": 0.3, "w": 80},
#     {"name": "水しぶき", "kind": "pic", "boxes": [[...]], "direction": "down", "sec": 1.1, "delay": 0.3, "w": 60},
#     {"name": "矢印", "kind": "arrow", "box": [x0, y0, x1, y1], "sec": 0.5, "delay": 0.5}
#   ]
# }
#   kind：text（文字：上下に小さく動かしながら左から右へ）／ pic（絵：同じ動きで面を塗る。boxes に複数の範囲を書くと、その順に描く）／
#         arrow（矢印・線：範囲の高さの帯で、左から右へ一筆）
#   box・boxes：元の画像のピクセル（左上が 0,0）。sec：描く時間（秒）。delay：描き終えてから次までの間（秒）。
#   w：手が一度に見せる幅（px。既定 64。大きいほど少ない往復で塗れる）。direction：right（既定。左から右へ）／ down（上から下へ）
import json
import subprocess
import sys


def wbam(tool, args=None):
    with open('args.json', 'w', encoding='utf-8') as f:
        json.dump(args or {}, f, ensure_ascii=False)
    r = subprocess.run(['node', 'wbam.mjs', tool, '@args.json'], capture_output=True, text=True, encoding='utf-8')
    if r.returncode != 0:
        print(r.stdout, r.stderr)
        sys.exit(f'{tool} に失敗しました')
    return r.stdout


def zigzag(box, w, direction='right'):
    """箱の中を、幅 w の帯で塗りつぶすように進む手の道筋。
    折り返しは箱の端の近くまで伸ばす（端に塗り残しの三角ができないように）。
    書き始めの側は端まで塗り、書き終わりの側は少し内側で止める（次に描くものが早めに見えないように）"""
    x0, y0, x1, y1 = box
    edge = w * 0.15
    step = w * 0.45
    pts = []
    if direction == 'right':
        x, up = x0 + edge, True
        while x <= x1 - w / 2 + 0.1:
            pts.append([round(x, 1), round(y0 + edge if up else y1 - edge, 1)])
            x += step
            up = not up
        pts.append([round(x1 - w / 2, 1), round(y0 + edge if up else y1 - edge, 1)])
    else:
        y, left = y0 + edge, True
        while y <= y1 - w / 2 + 0.1:
            pts.append([round(x0 + edge if left else x1 - edge, 1), round(y, 1)])
            y += step
            left = not left
        pts.append([round(x0 + edge if left else x1 - edge, 1), round(y1 - w / 2, 1)])
    return pts


def stroke(box):
    x0, y0, x1, y1 = box
    r = (y1 - y0) / 2
    return [[x0 + r, (y0 + y1) / 2], [x1 - r, (y0 + y1) / 2]], round(y1 - y0)


scene = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'scene.json', encoding='utf-8'))
if scene.get('image'):
    wbam('load_image', {'file': scene['image']})

# いまのグループを全部消してから組み立てる（やり直しは何度でもできる）
groups = json.loads(wbam('list_groups'))['groups']
if groups:
    wbam('delete_groups', {'ids': [g['id'] for g in groups]})

for i, it in enumerate(scene['items']):
    kind = it.get('kind', 'pic')
    w = it.get('w', 64)
    if kind == 'arrow':
        pts, w = stroke(it['box'])
        parts = [{'points': pts}]
    elif kind == 'text':
        parts = [{'points': zigzag(it['box'], w)}]
    else:
        parts = [{'points': zigzag(b, w, it.get('direction', 'right'))} for b in it.get('boxes', [it.get('box')])]
    args = {
        'name': it.get('name', f'区切り {i + 1}'),
        'parts': parts,
        'reveal_width': w,
        'duration_ms': round(it.get('sec', 1.5) * 1000),
        'delay_after_ms': round(it.get('delay', 0.3) * 1000)
    }
    g = json.loads(wbam('add_group', args))['group']
    print(f"{g['index'] + 1:2d}. {g['name']}  {g['duration_ms'] / 1000:.1f}秒  間 {g['delay_after_ms'] / 1000:.2f}秒")
print('全体：', round(json.loads(wbam('list_groups'))['total_ms'] / 1000, 1), '秒')
