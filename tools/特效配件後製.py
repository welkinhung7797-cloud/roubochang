# -*- coding: utf-8 -*-
"""特效（黑底直接縮圖）與配件（白底去背裁切）後製進資產區"""
import sys
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).parent))

ROOT = Path(__file__).parent.parent
FX_SRC = ROOT / '交付' / 'fx'
ACC_SRC = ROOT / '交付' / 'acc'
FX_OUT = ROOT / 'assets' / 'fx'
ACC_OUT = ROOT / 'assets' / 'acc'
FX_OUT.mkdir(parents=True, exist_ok=True)
ACC_OUT.mkdir(parents=True, exist_ok=True)

# 特效：黑底＝加法混合的透明，直接縮 512
for f in sorted(FX_SRC.glob('*.png')):
    img = Image.open(f).convert('RGB')
    img = img.resize((512, 512), Image.LANCZOS)
    out = FX_OUT / f.name
    img.save(out, optimize=True)
    print(f'{f.name} -> {out.stat().st_size // 1024} KB')

# 配件：白底去背＋裁切＋縮 256，改名為職業 id
from collections import deque
def flood_transparent(img, tol=16):
    img = img.convert('RGBA')
    w, h = img.size
    px = img.load()
    seen = [[False] * w for _ in range(h)]
    dq = deque([(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (0, h // 2), (w - 1, h // 2), (w // 2, h - 1)])
    def near_white(c):
        r, g, b = c[0], c[1], c[2]
        return r > 255 - 3 * tol and g > 255 - 3 * tol and b > 255 - 3 * tol and max(r, g, b) - min(r, g, b) < tol
    while dq:
        x, y = dq.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or seen[y][x]:
            continue
        seen[y][x] = True
        c = px[x, y]
        if c[3] == 0:
            dq.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
            continue
        if not near_white(c):
            continue
        px[x, y] = (255, 255, 255, 0)
        dq.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
    return img

RENAME = {'acc_karate': 'karate', 'acc_wrestler': 'wrestler', 'acc_kenshi': 'kenshi'}
for f in sorted(ACC_SRC.glob('*.png')):
    img = flood_transparent(Image.open(f))
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    img.thumbnail((256, 256), Image.LANCZOS)
    name = RENAME.get(f.stem, f.stem)
    out = ACC_OUT / f'{name}.png'
    img.save(out, optimize=True)
    print(f'{f.name} -> {out.name} {out.stat().st_size // 1024} KB')
print('完成')
