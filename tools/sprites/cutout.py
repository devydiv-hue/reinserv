"""Вырезка фона у сгенерированных спрайтов и подгонка под габарит объекта (128 px на клетку, webp с прозрачностью).
«По рисунку» (i2i) — маска по ровному серому фону генерации ∩ rembg, тонкое — по фону, при сбое — силуэт исходника
(by_key); «с нуля» (t2i) — rembg (isnet-general-use), обрезка и вписывание в w×h клеток. Наземные — силуэт исходника.
Вход: work/raw/<id>_<v>_c<k>.png и задания; выход: work/cut/<то же>.webp. Готовое пропускается.
Запуск (нужен rembg): python cutout.py jobs/all.json [--chosen] [--force]"""
import json, os, sys
import numpy as np
from scipy import ndimage as ndi
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

def init_alpha(job, size, solid):
    a = Image.open(os.path.join(WORK, 'init', f"{job['id']}_{job['v']}.png")).convert('RGBA').getchannel('A')
    if solid: a = a.point(lambda v: 255 if v > 170 else 0)
    return a.resize(size, Image.LANCZOS)

def keyed(raw):
    # маска объекта по фону: генерация рисует на ровном светло-сером фоне (цвет — медиана кромки кадра). Фон — гладкие
    # серые пятна того же оттенка (светлее или в тени), связанные с краем кадра, и крупные такие же пятна внутри
    # (между ножками, в кольце). Затем фон дорастает на 3 px по близким к нему пикселям и ещё на 1 px — снимает серую кайму
    a = np.asarray(raw.convert('RGB'), dtype=np.float32)/255; h, w, _ = a.shape
    edge = np.concatenate([a[:4].reshape(-1, 3), a[-4:].reshape(-1, 3), a[:, :4].reshape(-1, 3), a[:, -4:].reshape(-1, 3)])
    c = np.median(edge, 0); L = a.mean(2); cL = max(c.mean(), 1e-3)
    tint = np.abs((a - L[..., None]) - (c - cL)).max(2); ratio = L/cL
    std = np.sqrt(np.maximum(ndi.uniform_filter(L*L, 7) - ndi.uniform_filter(L, 7)**2, 0))
    cand = (tint < 0.05) & (ratio > 0.3) & (ratio < 1.12) & (std < 0.025)
    lab, n = ndi.label(cand, np.ones((3, 3)))
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    size = np.bincount(lab.ravel(), minlength=n + 1)
    near = (tint < 0.03) & (ratio > 0.85) & (ratio < 1.1)
    inner = [i for i in range(1, n + 1) if size[i] > h*w*0.004 and near[lab == i].mean() > 0.9]
    bg = np.isin(lab, [i for i in border if i] + inner)
    loose = (tint < 0.1) & (ratio > 0.3) & (ratio < 1.2)
    for _ in range(3): bg |= ndi.binary_dilation(bg) & loose
    bg = ndi.binary_dilation(bg)
    obj = ~bg; lab, n = ndi.label(obj, np.ones((3, 3)))
    if n: size = np.bincount(lab.ravel()); obj = np.isin(lab, np.nonzero(size >= h*w*0.0008)[0][1:])
    return obj, (tint < 0.1) & (ratio > 0.8), c  # второе — светлое, близкое к фону: кайма в тонком; третье — цвет фона

def by_key(raw, job, solid, sess):
    # i2i: маска по фону (keyed) ∩ rembg — rembg снимает светлую кайму и тени на фоне, ключ — серые островки,
    # которые rembg пропускает; тонкое (ветки, проволока, ножки) rembg теряет — берётся по ключу. Если вместе они
    # не узнали и 60 % силуэта исходника (серая крыша во весь кадр и т. п.) — добавляется силуэт целиком.
    # Наземные первого круга — силуэт исходника как есть; второго (job['round']) — по ключу без rembg (лужи, кровь
    # и воронки он не узнаёт), край шире и мягче. solid — без полупрозрачной процедурной тени (у объектов тень рисует
    # сама карта). Второе значение — доля кромки кадра, где объект упёрся в край там, где исходник её не касался:
    # дорисовка вышла за кадр, спрайт неполный — его надо перегенерировать
    W, H = int(job['w']*PX), int(job['h']*PX)
    if not solid and not job.get('round'): return with_alpha(raw, init_alpha(job, (W, H), False).filter(ImageFilter.GaussianBlur(1)), W, H), 0
    init = np.asarray(init_alpha(job, raw.size, True)) > 128; key, light, c = keyed(raw)
    if solid:
        rm = np.asarray(remove(raw.convert('RGB'), session=sess, only_mask=True).convert('L')) > 100
        thin = key & ~ndi.binary_opening(key, iterations=4) & ~light
        obj = key & (ndi.binary_dilation(rm, iterations=2) | thin)
    else:  # наземные: ещё и светлые островки фона внутри (блики, подсветка у края воронки), мелочь — прочь
        a = np.asarray(raw.convert('RGB'), dtype=np.float32)/255; L = a.mean(2); cL = max(float(np.mean(c)), 1e-3)
        bgish = (np.abs(a - c).max(2) < 0.12) & (np.abs((a - L[..., None]) - (c - cL)).max(2) < 0.05) & (L/cL > 0.85) & (L/cL < 1.25)
        obj = key & ~ndi.binary_opening(bgish, iterations=2); lab, n = ndi.label(obj, np.ones((3, 3)))
        if n: obj = np.isin(lab, np.nonzero(np.bincount(lab.ravel()) >= obj.size*0.0008)[0][1:])
    if (obj & init).sum() < 0.6*max(1, init.sum()): obj |= init
    im = matte(raw, obj, c, 3 if solid else 8)
    out = fit(im, job['w'], job['h'], 0.01) if job.get('pad') else im.resize((W, H), Image.LANCZOS)  # с полями — вписать по габариту
    return out, edge_hit(Image.fromarray(((obj & ~ndi.binary_dilation(init, iterations=6))*255).astype(np.uint8)))

def matte(raw, obj, c, band):
    # мягкий край: в полосе band px у границы маски прозрачность — по отличию от цвета фона, и фон вычитается из цвета
    # (иначе полупрозрачные пиксели несут светло-серую кайму)
    a = np.asarray(raw.convert('RGB'), dtype=np.float32)/255
    soft = np.clip(np.abs(a - c).max(2)/0.2, 0, 1); inner = ndi.binary_erosion(obj, iterations=band)
    al = np.where(inner, 1.0, np.where(obj, soft, 0.0)); al = ndi.gaussian_filter(al, 0.6)*obj
    rgb = np.where((obj & ~inner)[..., None], c + (a - c)/np.maximum(al, 0.15)[..., None], a)
    return Image.fromarray((np.dstack([np.clip(rgb, 0, 1), al])*255).astype(np.uint8), 'RGBA')

def with_alpha(raw, mask, W, H):
    out = raw.convert('RGB').resize((W, H), Image.LANCZOS).convert('RGBA'); out.putalpha(mask); return out

def edge_hit(m):
    # доля пикселей кромки (4 px) с объектом
    w, h = m.size; px = m.point(lambda v: 255 if v > 128 else 0)
    strips = [px.crop((0, 0, w, 4)), px.crop((0, h - 4, w, h)), px.crop((0, 0, 4, h)), px.crop((w - 4, 0, w, h))]
    on = sum(s.histogram()[255] for s in strips); return on/(8*(w + h))

def main():
    # ключи: --chosen — только выбранные кандидаты (work/choices.json), --force — вырезать заново и готовое.
    # Доля кромки кадра, где объект упёрся в край, пишется в work/edge.json (см. by_key)
    jobs = {j['id'] + '_' + str(j['v']): j for j in json.load(open(sys.argv[1], encoding='utf-8'))}
    force = '--force' in sys.argv; chosen = None
    if '--chosen' in sys.argv:
        ch = json.load(open(os.path.join(WORK, 'choices.json'), encoding='utf-8')); chosen = {f'{k}_c{v}' for k, v in ch.items() if isinstance(v, int)}
    ep = os.path.join(WORK, 'edge.json'); edge = json.load(open(ep, encoding='utf-8')) if os.path.exists(ep) else {}
    sess = new_session('isnet-general-use'); os.makedirs(os.path.join(WORK, 'cut'), exist_ok=True); n = 0
    for f in sorted(os.listdir(os.path.join(WORK, 'raw'))):
        if not f.endswith('.png') or (chosen is not None and f[:-4] not in chosen): continue
        key = '_'.join(f[:-4].split('_')[:-1]); job = jobs.get(key)
        if not job: continue
        dst = os.path.join(WORK, 'cut', f[:-4] + '.webp')
        if not force and os.path.exists(dst) and os.path.getmtime(dst) > os.path.getmtime(os.path.join(WORK, 'raw', f)): continue
        raw = Image.open(os.path.join(WORK, 'raw', f)); cand = job['cands'][int(f[:-4].split('_c')[-1])]
        if cand['mode'] == 'i2i': out, hit = by_key(raw, job, not job.get('g'), sess)
        else: cut = remove(raw.convert('RGB'), session=sess); hit = edge_hit(cut.getchannel('A')); out = fit(cut, job['w'], job['h'])
        edge[f[:-4]] = round(hit, 4)
        if out is None: print('пусто:', f, flush=True); continue
        out.save(dst, 'WEBP', quality=86, method=6); n += 1
        if n % 25 == 0: print('вырезано', n, flush=True); json.dump(edge, open(ep, 'w', encoding='utf-8'))
    json.dump(edge, open(ep, 'w', encoding='utf-8')); print('готово, вырезано', n, flush=True)

if __name__ == '__main__':
    main()
