"""Фото-фактуры грунтов для карт: качает диффузные карты из Poly Haven (CC0), приводит к масштабу клетки
(128 px на клетку 3 м), подстраивает тон и сохраняет в assets/map/tex/<грунт>.webp + manifest.json.
Запуск: python tools/sprites/fetch_textures.py  (повторный запуск докачивает недостающее)."""
import json, os, sys, time, urllib.request, io
from PIL import Image, ImageEnhance, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'map', 'tex')
CACHE = os.path.join(os.path.dirname(__file__), 'cache', 'polyhaven')
PX_PER_CELL = 128

# грунт карты -> (текстура Poly Haven, клеток на плитку, яркость, насыщенность)
MAP = {
    'sand':     ('aerial_sand', 4, 1.0, 0.85),
    'dust':     ('dirt_aerial_02', 4, 1.0, 0.8),
    'dirt':     ('dirt_aerial_03', 4, 0.95, 0.85),
    'mud':      ('brown_mud_02', 1.5, 0.9, 0.85),
    'grass':    ('grass_path_2', 1.5, 0.95, 0.75),
    'rock':     ('rock_ground_02', 2, 0.95, 0.7),
    'gravel':   ('gravel_ground_01', 2, 1.0, 0.75),
    'ash':      ('burned_ground_01', 1.5, 0.85, 0.6),
    'saltflat': ('mud_cracked_dry_riverbed_002', 2, 1.45, 0.25),
    'asphalt':  ('asphalt_04', 2, 0.62, 0.6),
    'cracked':  ('asphalt_02', 2, 0.85, 0.7),
    'concrete': ('dirty_concrete', 2, 1.0, 0.7),
    'tiles':    ('interior_tiles', 1, 0.92, 0.7),
    'metal':    ('metal_plate', 1, 0.95, 0.6),
    'wood':     ('old_wood_floor', 1.5, 0.9, 0.85),
    'frost':    ('snow_03', 2, 1.0, 0.7),
    'cave':     ('rocks_ground_02', 2, 0.55, 0.6),
    'bedrock':  ('rock_face', 2, 0.55, 0.5),
}

def get(url, tries=8):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'reincarnator-map-tools'}), timeout=60) as r:
                return r.read()
        except Exception as e:
            print('  повтор', i + 1, e); time.sleep(2 + i*2)
    raise RuntimeError('не скачалось: ' + url)

def fetch(ph):
    src = os.path.join(CACHE, ph + '_1k.jpg')
    if not os.path.exists(src):
        files = json.loads(get('https://api.polyhaven.com/files/' + ph))
        print('скачиваю', ph); open(src, 'wb').write(get(files['Diffuse']['1k']['jpg']['url']))
    return src

def main():
    os.makedirs(OUT, exist_ok=True); os.makedirs(CACHE, exist_ok=True)
    man = {}
    for tid, (ph, cells, bright, sat) in MAP.items():
        im = Image.open(fetch(ph)).convert('RGB')
        px = max(256, int(round(cells*PX_PER_CELL))) # мелкие полы — не меньше 256 px, масштаб задаёт cells
        im = im.resize((px, px), Image.LANCZOS)
        if bright != 1: im = ImageEnhance.Brightness(im).enhance(bright)
        if sat != 1: im = ImageEnhance.Color(im).enhance(sat)
        dst = os.path.join(OUT, tid + '.webp'); im.save(dst, 'WEBP', quality=82, method=6)
        man[tid] = {'file': tid + '.webp', 'cells': cells, 'src': 'https://polyhaven.com/a/' + ph}
        print(tid, '<-', ph, px, 'px', os.path.getsize(dst)//1024, 'КБ')
    json.dump({'version': int(time.time()), 'pxPerCell': PX_PER_CELL, 'textures': man}, open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main()
