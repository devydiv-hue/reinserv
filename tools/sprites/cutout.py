"""Вырезка фона у сгенерированных спрайтов и подгонка под габарит объекта (128 px на клетку, webp с прозрачностью).
«По рисунку» (i2i) — по силуэту исходного процедурного кадра; «с нуля» (t2i) — rembg (isnet-general-use), обрезка и вписывание в w×h клеток.
rembg плохо отличает крыши, разметку и лужи от земли — поэтому у дорисовок силуэт берётся из исходника.
Вход: work/raw/<id>_<v>_c<k>.png и задания; выход: work/cut/<то же>.webp. Готовое пропускается.
Запуск (нужен rembg): python cutout.py jobs/all.json"""
import json, os, sys
from PIL import Image, ImageFilter
os.environ.setdefault('U2NET_HOME', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'openings', 'cache', 'models'))
from rembg import remove, new_session

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, 'work')
PX = 128

def fit(im, w, h, margin=0.04):
    a = im.getchannel('A'); box = a.point(lambda v: 255 if v > 24 else 0).getbbox()
    if not box: return None
    im = im.crop(box); W, H = int(w*PX), int(h*PX); mw, mh = W*(1 - 2*margin), H*(1 - 2*margin)
    k = min(mw/im.width, mh/im.height); im = im.resize((max(1, round(im.width*k)), max(1, round(im.height*k))), Image.LANCZOS)
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0)); out.alpha_composite(im, ((W - im.width)//2, (H - im.height)//2)); return out

def by_init(raw, job, solid):
    # силуэт исходного кадра: дорисовка сохраняет форму, поэтому совпадает точно. solid — без полупрозрачной
    # процедурной тени (у объектов тень рисует сама карта), у наземных — как есть
    W, H = int(job['w']*PX), int(job['h']*PX)
    a = Image.open(os.path.join(WORK, 'init', f"{job['id']}_{job['v']}.png")).convert('RGBA').getchannel('A')
    if solid: a = a.point(lambda v: 255 if v > 170 else 0)
    mask = a.resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1))
    out = raw.convert('RGB').resize((W, H), Image.LANCZOS).convert('RGBA'); out.putalpha(mask); return out

def main():
    jobs = {j['id'] + '_' + str(j['v']): j for j in json.load(open(sys.argv[1], encoding='utf-8'))}
    sess = new_session('isnet-general-use'); os.makedirs(os.path.join(WORK, 'cut'), exist_ok=True); n = 0
    for f in sorted(os.listdir(os.path.join(WORK, 'raw'))):
        if not f.endswith('.png'): continue
        key = '_'.join(f[:-4].split('_')[:-1]); job = jobs.get(key)
        if not job: continue
        dst = os.path.join(WORK, 'cut', f[:-4] + '.webp')
        if os.path.exists(dst) and os.path.getmtime(dst) > os.path.getmtime(os.path.join(WORK, 'raw', f)): continue
        raw = Image.open(os.path.join(WORK, 'raw', f)); cand = job['cands'][int(f[:-4].split('_c')[-1])]
        out = by_init(raw, job, not job.get('g')) if cand['mode'] == 'i2i' else fit(remove(raw.convert('RGB'), session=sess), job['w'], job['h'])
        if out is None: print('пусто:', f, flush=True); continue
        out.save(dst, 'WEBP', quality=86, method=6); n += 1
        if n % 25 == 0: print('вырезано', n, flush=True)
    print('готово, вырезано', n, flush=True)

if __name__ == '__main__':
    main()
