"""Встраивание выбранных спрайтов в приложение — только по выбору человека (work/choices.json, страница review.js).
Выбранный кандидат каждого варианта копируется в assets/map/sprites/<id>_<v>.webp, манифест пересобирается.
«оставить как сейчас» и «перегенерировать» — процедурный рисунок (файла нет). Запуск: python apply.py"""
import json, os, shutil, time

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, 'work')
OUT = os.path.join(HERE, '..', '..', 'assets', 'map', 'sprites')

def main():
    ch = json.load(open(os.path.join(WORK, 'choices.json'), encoding='utf-8'))
    os.makedirs(OUT, exist_ok=True); sprites = {}; n = 0
    for f in os.listdir(OUT):
        if f.endswith('.webp'): os.remove(os.path.join(OUT, f))
    for key, pick in sorted(ch.items()):
        if not isinstance(pick, int): continue
        src = os.path.join(WORK, 'cut', f'{key}_c{pick}.webp')
        if not os.path.exists(src): print('нет файла:', src); continue
        aid, v = key.rsplit('_', 1); dst = f'{key}.webp'
        shutil.copyfile(src, os.path.join(OUT, dst)); sprites.setdefault(aid, {})[v] = dst; n += 1
    json.dump({'version': int(time.time()), 'sprites': sprites}, open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8'), indent=1)
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f'встроено спрайтов: {n} (объектов {len(sprites)}), {size/1e6:.1f} МБ')

if __name__ == '__main__':
    main()
