# -*- coding: utf-8 -*-
"""基底動畫幀後製：去背（白底→透明）→ 統一縮到 512（不裁切，保幀間對位）→ assets/frames/"""
from pathlib import Path
from PIL import Image
from collections import deque

SRC = Path(__file__).parent.parent / '交付' / 'base_frames'
OUT = Path(__file__).parent.parent / 'assets' / 'frames'
OUT.mkdir(parents=True, exist_ok=True)

def flood_transparent(img, tol=16):
    img = img.convert('RGBA')
    w, h = img.size
    px = img.load()
    seen = [[False] * w for _ in range(h)]
    dq = deque()
    for x, y in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]:
        dq.append((x, y))
    def near_white(c):
        r, g, b = c[0], c[1], c[2]
        return r > 255 - 3 * tol and g > 255 - 3 * tol and b > 255 - 3 * tol and \
               max(r, g, b) - min(r, g, b) < tol
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

n = 0
for f in sorted(SRC.glob('*.png')):
    img = Image.open(f)
    img = flood_transparent(img)
    img = img.resize((512, 512), Image.LANCZOS)   # 不裁切：幀間對位靠原始構圖
    out = OUT / f.name
    img.save(out, optimize=True)
    n += 1
    print(f'{f.name} -> {out.stat().st_size // 1024} KB')
print(f'完成 {n} 幀')
