# -*- coding: utf-8 -*-
"""
機器驗收閘門：檢查 Codex 交付的美術是否符合規格。
過閘＝可整合；未過閘＝寫退件單。
用法：
  python 驗收_部件.py 企鵝 boxer      驗收單一職業的部件
  python 驗收_部件.py 企鵝全部        驗收全部職業
  python 驗收_部件.py 敵人            驗收敵人圖
"""
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).parent.parent
DELIVER = ROOT / '交付'
REJECT = DELIVER / '退件單.md'

CHAR_PARTS = ['body', 'head', 'wing', 'foot']   # extra 選交
CHAR_IDS = ['boxer', 'wrestler', 'karate', 'kenshi', 'judo', 'sumo', 'muaythai', 'monk',
            'ninja', 'thug', 'nunchaku', 'ironhead', 'taichi', 'berserker', 'strongman', 'aikido']
ENEMY_IDS = ['grunt', 'runner', 'brute', 'thrower', 'charger', 'spiker', 'bomber',
             'splitter', 'splitling', 'shielder', 'healer', 'summoner', 'boss_champ', 'boss_yokozuna']

def check_image(path, min_size=768, min_content=0.05, max_content=0.92):
    """回傳問題清單（空＝過）"""
    issues = []
    if not path.exists():
        return [f'缺檔：{path.name}']
    try:
        img = Image.open(path)
    except Exception as e:
        return [f'{path.name} 打不開：{e}']
    w, h = img.size
    if w < min_size or h < min_size:
        issues.append(f'{path.name} 尺寸 {w}x{h} 低於 {min_size}')
    # 內容佔比：非白且非透明的像素比例（縮小取樣加速）
    small = img.convert('RGBA').resize((128, 128))
    px = list(small.getdata())
    content = sum(1 for r, g, b, a in px if a > 30 and not (r > 235 and g > 235 and b > 235))
    ratio = content / len(px)
    if ratio < min_content:
        issues.append(f'{path.name} 內容佔比 {ratio:.0%} 過低（近乎空白）')
    if ratio > max_content:
        issues.append(f'{path.name} 內容佔比 {ratio:.0%} 過高（可能沒留白底／全圖填滿）')
    return issues

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else '企鵝全部'
    all_issues = []
    checked = 0
    if mode == '企鵝':
        ids = [sys.argv[2]]
        mode = '企鵝全部'
    else:
        ids = CHAR_IDS
    if mode == '企鵝全部':
        for cid in ids:
            d = DELIVER / '企鵝部件' / cid
            if not d.exists():
                if len(ids) == 1:
                    all_issues.append(f'缺整個資料夾：交付/企鵝部件/{cid}/')
                continue
            for part in CHAR_PARTS:
                issues = check_image(d / f'{part}.png')
                checked += 1
                all_issues += [f'[{cid}] {i}' for i in issues]
    elif mode == '敵人':
        for eid in ENEMY_IDS:
            p = DELIVER / '敵人' / f'{eid}.png'
            if not p.exists():
                continue
            issues = check_image(p)
            checked += 1
            all_issues += [f'[敵人] {i}' for i in issues]

    if all_issues:
        lines = ['# 退件單（機器驗收未過）', '', '逐項修正後重新交付：', '']
        lines += [f'- {i}' for i in all_issues]
        REJECT.write_text('\n'.join(lines), encoding='utf-8')
        print(f'未過閘：{len(all_issues)} 個問題，已寫 交付/退件單.md')
        for i in all_issues:
            print('  ' + i)
        sys.exit(1)
    else:
        if REJECT.exists():
            REJECT.unlink()
        print(f'過閘：檢查 {checked} 張，零問題')
        sys.exit(0)

if __name__ == '__main__':
    main()
