"""Встраивание выбранных фактур пола — только по выбору человека (work/tex/choices.json, страница /tex в review.js).
Выбранный кандидат work/tex/raw/<грунт>_c<k>.png → assets/map/tex/<грунт>.webp, масштаб (клеток на картинку) и яркость —
как выставлены на странице; «как сейчас» — прежняя запись манифеста остаётся.
Против повтора: природные грунты собираются в плитку вдвое больше по каждой стороне — поверх замощённой картинки
ложатся её же сдвинутые (и отражённые, повёрнутые) копии по плавной бесшовной маске, 128 px на клетку (как спрайты).
Полы с сеткой (кафель, доски, металл, ковролин) — как есть, 256 px на клетку: сдвиг сломал бы швы.
Запуск: .venv/Scripts/python.exe apply_tex.py (нужен numpy)"""
import json, os, time
import numpy as np
from PIL import Image, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'work', 'tex', 'raw')
OUT = os.path.join(HERE, '..', '..', 'assets', 'map', 'tex')
PX_CELL = 128
GRID = {'tiles', 'wood', 'metal', 'carpet'}  # узор с сеткой — без перемешивания
DIRECTED = {'sand'}                          # рябь по ветру — без поворотов, только сдвиг и отражение

def periodic_noise(n, size, rng):
    # гладкий бесшовный шум: случайная сетка n×n, растянутая с заворотом краёв
    g = rng.random((n, n)).astype(np.float32)
    big = np.tile(g, (3, 3)); im = Image.fromarray((big*255).astype(np.uint8)).resize((size*3, size*3), Image.BICUBIC)
    a = np.asarray(im, dtype=np.float32)[size:size*2, size:size*2]/255; return (a - a.min())/max(1e-3, a.max() - a.min())

def bomb(src, cells, tid):
    # src — бесшовная картинка на cells клеток; результат — бесшовная плитка на 2·cells клеток
    rng = np.random.default_rng(sum(map(ord, tid))*7919)
    p = int(round(cells*PX_CELL)); s = src.resize((p, p), Image.LANCZOS); S = p*2
    out = np.asarray(s, dtype=np.float32); out = np.tile(out, (2, 2, 1))
    for i in range(3):
        t = s
        if tid not in DIRECTED: t = t.rotate(90*int(rng.integers(0, 4)))
        if rng.random() < 0.5: t = t.transpose(Image.FLIP_LEFT_RIGHT)
        if tid not in DIRECTED and rng.random() < 0.5: t = t.transpose(Image.FLIP_TOP_BOTTOM)
        a = np.tile(np.asarray(t, dtype=np.float32), (2, 2, 1)); a = np.roll(a, (int(rng.integers(0, S)), int(rng.integers(0, S))), (0, 1))
        m = periodic_noise(4 + i, S, rng); m = np.clip((m - 0.5)/0.12 + 0.5, 0, 1)[..., None] # мягкий край ~ четверть клетки
        out = out*(1 - m) + a*m
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))

def main():
    ch = json.load(open(os.path.join(HERE, 'work', 'tex', 'choices.json'), encoding='utf-8'))
    mp = os.path.join(OUT, 'manifest.json'); man = json.load(open(mp, encoding='utf-8')) if os.path.exists(mp) else {'textures': {}}
    n = 0
    for tid, c in sorted(ch.items()):
        if c.get('pick') == 'keep' or not isinstance(c.get('pick'), int): continue
        im = Image.open(os.path.join(RAW, f"{tid}_c{c['pick']}.png")).convert('RGB'); cells = c['cells']
        if tid in GRID: im = im.resize((int(round(cells*PX_CELL*2)),)*2, Image.LANCZOS) # полы — как есть, 256 px на клетку (их видно вблизи)
        else: im = bomb(im, cells, tid); cells *= 2
        if abs(c.get('bright', 1) - 1) > 0.005: im = ImageEnhance.Brightness(im).enhance(c['bright'])
        im.save(os.path.join(OUT, tid + '.webp'), 'WEBP', quality=84, method=6)
        man['textures'][tid] = {'file': tid + '.webp', 'cells': cells, 'src': 'RealVisXL V5.0 (tools/sprites/gen_tex.py)'}; n += 1
    man['version'] = int(time.time()); man['pxPerCell'] = PX_CELL
    json.dump(man, open(mp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.endswith('.webp'))
    print(f'встроено фактур: {n}, всего в манифесте {len(man["textures"])}, {size/1e6:.1f} МБ')

if __name__ == '__main__':
    main()
