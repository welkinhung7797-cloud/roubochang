# -*- coding: utf-8 -*-
"""立繪後製：白背景去透明（四角 flood fill）→ 裁邊 → 縮到 256px → assets/portraits/"""
from pathlib import Path
from PIL import Image
import sys

RAW = Path(__file__).parent.parent / 'assets' / 'portraits_raw'
OUT = Path(__file__).parent.parent / 'assets' / 'portraits'
OUT.mkdir(parents=True, exist_ok=True)

CATS = ['boxer', 'wrestler', 'karate', 'kenshi', 'judo', 'sumo', 'muaythai', 'monk',
        'ninja', 'thug', 'nunchaku', 'ironhead', 'taichi', 'berserker', 'strongman', 'aikido']

def flood_transparent(img, tol=18):
    """從四角 flood fill 掉近白背景。貼紙白描邊因為被輪廓線包住，不會被吃掉。"""
    img = img.convert('RGBA')
    w, h = img.size
    px = img.load()
    from collections import deque
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
        if not near_white(c):
            continue
        px[x, y] = (255, 255, 255, 0)
        dq.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
    return img

def process(cid):
    src = RAW / f'{cid}.png'
    if not src.exists():
        print(f'缺 {cid}.png')
        return False
    img = Image.open(src)
    img = flood_transparent(img)
    bbox = img.getbbox()
    if bbox:
        pad = 12
        bbox = (max(0, bbox[0] - pad), max(0, bbox[1] - pad),
                min(img.width, bbox[2] + pad), min(img.height, bbox[3] + pad))
        img = img.crop(bbox)
    img.thumbnail((256, 256), Image.LANCZOS)
    out = OUT / f'{cid}.png'
    img.save(out, optimize=True)
    print(f'{cid}.png -> {out.stat().st_size // 1024} KB {img.size}')
    return True

ok = 0
targets = sys.argv[1:] if len(sys.argv) > 1 else CATS
for cid in targets:
    if process(cid):
        ok += 1
print(f'完成 {ok}/{len(targets)}')
