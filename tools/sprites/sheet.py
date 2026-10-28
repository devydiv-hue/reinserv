"""Лист сравнения для демо: по строке на объект — процедурный рисунок (как сейчас) и вырезанные сгенерированные
варианты, всё на фото-грунте с мягкой тенью, как на карте. Запуск: python sheet.py jobs/demo.json out.png"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, 'work')
TEX = os.path.join(HERE, '..', '..', 'assets', 'map', 'tex')
CELL = 96  # px на клетку в листе

def ground(w, h, tex='dust'):
    t = Image.open(os.path.join(TEX, tex + '.webp')).convert('RGB'); m = json.load(open(os.path.join(TEX, 'manifest.json'), encoding='utf-8'))['textures'][tex]
    s = round(m['cells']*CELL); t = t.resize((s, s), Image.LANCZOS); out = Image.new('RGB', (w, h))
    for y in range(0, h, s):
        for x in range(0, w, s): out.paste(t, (x, y))
    return out

def with_shadow(bg, spr, x, y):
    a = spr.getchannel('A').filter(ImageFilter.GaussianBlur(CELL*0.06)); sh = Image.new('RGBA', spr.size, (10, 8, 6, 0)); sh.putalpha(a.point(lambda v: int(v*0.45)))
    bg.alpha_composite(sh, (x + int(CELL*0.05), y + int(CELL*0.065))); bg.alpha_composite(spr, (x, y))

def main():
    jobs = json.load(open(sys.argv[1], encoding='utf-8')); out = sys.argv[2]
    cols = ['как сейчас', 'по кадру 1', 'по кадру 2', 'с нуля 1', 'с нуля 2']
    rows = []
    for j in jobs:
        key = f"{j['id']}_{j['v']}"; W, H = j['w']*CELL, j['h']*CELL
        cells = [Image.open(os.path.join(WORK, 'init', key + '.png')).convert('RGBA')]
        for f in ['i2i0', 'i2i1', 't2i0', 't2i1']:
            p = os.path.join(WORK, 'cut', key + '_' + f + '.webp'); cells.append(Image.open(p).convert('RGBA') if os.path.exists(p) else None)
        rows.append((j, [c.resize((W, H), Image.LANCZOS) if c else None for c in cells]))
    pad = 24; colw = max(j['w'] for j in jobs)*CELL + pad*2
    heights = [j['h']*CELL + pad*2 for j, _ in rows]; sheet = Image.new('RGBA', (180 + colw*len(cols), 40 + sum(heights)), (28, 24, 22, 255)); d = ImageDraw.Draw(sheet)
    try: font = ImageFont.truetype('arial.ttf', 18)
    except Exception: font = ImageFont.load_default()
    for i, c in enumerate(cols): d.text((180 + i*colw + 10, 10), c, fill=(240, 232, 214), font=font)
    y = 40
    for (j, cells), hh in zip(rows, heights):
        d.text((10, y + hh//2 - 10), j['id'], fill=(240, 232, 214), font=font)
        for i, c in enumerate(cells):
            g = ground(colw - 8, hh - 8).convert('RGBA')
            if c is not None: with_shadow(g, c, (g.width - c.width)//2, (g.height - c.height)//2)
            sheet.alpha_composite(g, (180 + i*colw + 4, y + 4))
        y += hh
    sheet.convert('RGB').save(out, quality=90); print('лист:', out, sheet.size)

if __name__ == '__main__':
    main()
