# -*- coding: utf-8 -*-
"""妖怪敵人立繪後製：白底去背 → 裁切 → 縮 256 → assets/enemies/"""
from pathlib import Path
from PIL import Image
from collections import deque

SRC = Path(__file__).parent.parent / '交付' / 'enemies'
OUT = Path(__file__).parent.parent / 'assets' / 'enemies'
OUT.mkdir(parents=True, exist_ok=True)

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

n = 0
for f in sorted(SRC.glob('*.png')):
    img = flood_transparent(Image.open(f))
    bbox = img.getbbox()
    if bbox:
        pad = 10
        bbox = (max(0, bbox[0] - pad), max(0, bbox[1] - pad),
                min(img.width, bbox[2] + pad), min(img.height, bbox[3] + pad))
        img = img.crop(bbox)
    img.thumbnail((256, 256), Image.LANCZOS)
    out = OUT / f.name
    img.save(out, optimize=True)
    n += 1
    print(f'{f.name} -> {out.stat().st_size // 1024} KB')
print(f'完成 {n} 隻')
