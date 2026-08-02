# -*- coding: utf-8 -*-
"""
功夫貓立繪生成：gemini-2.5-flash-image
流程：先生一張風格錨定圖（拳擊手橘貓），確認後其餘 15 隻全部帶錨定圖當參考生成，
確保 16 張同一畫風。白背景輸出，之後用 flood_key 去背。
用法：
  python 生成立繪.py anchor          只生錨定圖（3 個候選）
  python 生成立繪.py rest            用 anchor.png 生其餘 15 隻
  python 生成立繪.py one <char_id>   重骰單隻
"""
import base64, json, sys, time, urllib.request
from pathlib import Path

KEY = Path.home().joinpath('.config/secrets/gemini_api_key').read_text().strip()
MODEL = 'gemini-2.5-flash-image'
URL = f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={KEY}'
OUT = Path(__file__).parent.parent / 'assets' / 'portraits_raw'
OUT.mkdir(parents=True, exist_ok=True)

STYLE = ('Cute chibi kung-fu cat game character, sticker style flat color illustration with '
         'thick dark brown outlines, big round head taking 60 percent of total height, huge '
         'sparkling round eyes, tiny plump body, short stubby arms and legs, small triangle '
         'cat ears, whiskers, expressive tail, full body, three-quarter front view, dynamic '
         'martial arts pose, plain pure white background, no text, no watermark')

CATS = {
    'boxer':     'orange tabby cat boxer wearing big red boxing gloves and a red headband, jabbing pose',
    'wrestler':  'brown muscular cat wrestler wearing a dark singlet and championship belt, arms spread grappling pose',
    'karate':    'white cat karate master wearing a white gi with black belt, knife-hand strike pose',
    'kenshi':    'black cat samurai swordsman holding a katana at the ready, calm stance',
    'judo':      'gray cat judo master wearing a white judo gi with blue belt, throwing stance with open palms',
    'sumo':      'huge cream-colored fat cat sumo wrestler wearing a mawashi loincloth, low crouching stance with palms forward',
    'muaythai':  'tan siamese cat kickboxer with rope-wrapped fists and colorful shorts, raised knee strike pose',
    'monk':      'orange and white cat monk wearing an ochre robe with prayer beads, palm strike meditation pose',
    'ninja':     'midnight dark blue cat ninja with face mask showing only glowing eyes, crouching sneaky pose holding a short blade',
    'thug':      'brown striped alley cat street fighter wearing a green beanie and holding a steel pipe, slouching cocky pose',
    'nunchaku':  'yellow cat fighter in a yellow jumpsuit spinning nunchaku, energetic pose',
    'ironhead':  'silver gray cat with a shiny metal helmet plate on its head, headbutt charging pose',
    'taichi':    'sage green-gray elderly cat taichi master with long white whisker beard wearing a silk tang suit, flowing cloud-hands pose',
    'berserker': 'reddish brown cat berserker with wild spiky messy fur and crazy grin holding a cleaver, frenzied pose',
    'strongman': 'big brown tabby strongman cat wearing a leopard singlet holding a huge sledgehammer over shoulder',
    'aikido':    'blue-gray cat aikido master wearing a black hakama over white gi, serene redirecting palm pose',
}

def call_gemini(parts):
    body = json.dumps({
        'contents': [{'parts': parts}],
        'generationConfig': {'responseModalities': ['IMAGE']},
    }).encode()
    req = urllib.request.Request(URL, data=body, headers={'Content-Type': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.loads(r.read())
            for part in data['candidates'][0]['content']['parts']:
                if 'inlineData' in part:
                    return base64.b64decode(part['inlineData']['data'])
            raise RuntimeError('回應沒有圖片')
        except Exception as e:
            print(f'  重試 {attempt+1}: {e}')
            time.sleep(8 * (attempt + 1))
    raise RuntimeError('連續失敗')

def gen_anchor():
    for i in range(1, 4):
        print(f'錨定候選 {i}/3 ...')
        png = call_gemini([{'text': STYLE + '. The cat is: ' + CATS['boxer'] + '.'}])
        (OUT / f'anchor_candidate_{i}.png').write_bytes(png)
        print(f'  -> anchor_candidate_{i}.png ({len(png)//1024} KB)')
    print('挑一張改名為 anchor.png 後跑 rest')

def gen_one(cid, anchor_bytes):
    prompt = ('Using the attached image as the exact art style reference (same chibi proportions, '
              'same outline thickness, same flat coloring, same white background, same framing), '
              'draw a DIFFERENT cat character in the identical style. ' + STYLE +
              '. The cat is: ' + CATS[cid] + '.')
    parts = [
        {'inlineData': {'mimeType': 'image/png', 'data': base64.b64encode(anchor_bytes).decode()}},
        {'text': prompt},
    ]
    png = call_gemini(parts)
    (OUT / f'{cid}.png').write_bytes(png)
    print(f'  {cid}.png ({len(png)//1024} KB)')

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'anchor'
    if mode == 'anchor':
        gen_anchor()
        return
    anchor = (OUT / 'anchor.png').read_bytes()
    if mode == 'rest':
        for cid in CATS:
            if cid == 'boxer':
                (OUT / 'boxer.png').write_bytes(anchor)
                continue
            if (OUT / f'{cid}.png').exists():
                print(f'  {cid}.png 已存在，略過')
                continue
            print(f'{cid} ...')
            gen_one(cid, anchor)
            time.sleep(2)
    elif mode == 'one':
        gen_one(sys.argv[2], anchor)

if __name__ == '__main__':
    main()
