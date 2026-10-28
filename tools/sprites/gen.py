"""Генерация реалистичных спрайтов объектов карты (вид сверху) моделью RealVisXL V5.0 (SDXL, openrail++).

Задания — jobs/<набор>.json (make_jobs.py): по каждому варианту объекта несколько кандидатов
  i2i — дорисовка по исходному кадру процедурного объекта (work/init/<id>_<v>.png) с силой strength:
        вид строго сверху и габарит сохраняются;
  t2i — только по описанию.
Результат — work/raw/<id>_<v>_c<k>.png (на сером фоне; вырезает фон cutout.py). Уже готовые пропускаются —
прогон можно прерывать и запускать снова. Части модели, которые сейчас не считают, ждут в обычной памяти
(enable_model_cpu_offload): на картинку это не влияет, только экономит видеопамять.
Запуск: .venv/Scripts/python.exe gen.py jobs/all.json [id1,id2,...]"""
import json, os, sys, time
import torch
from PIL import Image
from diffusers import StableDiffusionXLImg2ImgPipeline, StableDiffusionXLPipeline, DPMSolverMultistepScheduler

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, 'work')
LOCAL = os.path.join(HERE, 'models', 'RealVisXL_V5.0') # dl_model.sh качает сюда; иначе — из Hugging Face
REPO = LOCAL if os.path.exists(os.path.join(LOCAL, 'model_index.json')) else 'SG161222/RealVisXL_V5.0'
STYLE = ('top-down view from directly above, orthographic overhead photo of {s}, photorealistic, highly detailed, '
         'tabletop battle map asset, post-apocalyptic, soft diffuse overcast light, centered, single object, '
         'isolated on a plain flat light grey background')
STYLE_G = ('top-down view from directly above, orthographic overhead photo of {s}, photorealistic, highly detailed, '
           'tabletop battle map texture, post-apocalyptic, soft diffuse overcast light')
NEG = ('perspective, side view, isometric, three-quarter view, horizon, sky, landscape, people, person, hands, text, '
       'watermark, logo, signature, frame, border, cartoon, drawing, illustration, painting, 3d render, blurry, lowres, '
       'cropped, cut off, multiple objects, collage, grid')
# второй круг (job['round'] == 2): короче — весь промпт влезает в 77 токенов CLIP (у первого хвост про фон обрезался),
# строго в надир; в негативе — вид спереди, лица, тоннели, «маленький объект на улице»
STYLE2 = 'nadir top-down photo, camera pointing straight down, orthographic, {s}, photorealistic, detailed, soft overcast light, single object, plain light grey background'
NEG2 = ('perspective, side view, isometric, front view, frontal, facade, elevation, face looking at camera, upright, vanishing point, '
        'tunnel, street scene, tiny, horizon, people, text, watermark, frame, cartoon, drawing, 3d render, blurry, cropped, cut off, collage')
BUCKETS = [(1024, 1024), (896, 1152), (832, 1216), (768, 1344), (640, 1536), (1152, 896), (1216, 832), (1344, 768), (1536, 640)]
BG = (196, 194, 188)

def bucket(w, h):
    r = w/h
    return min(BUCKETS, key=lambda b: abs(b[0]/b[1] - r))

def init_image(job, size):
    im = Image.open(os.path.join(WORK, 'init', f"{job['id']}_{job['v']}.png")).convert('RGBA')
    bg = Image.new('RGBA', im.size, BG + (255,)); bg.alpha_composite(im)
    return bg.convert('RGB').resize(size, Image.LANCZOS)

def main():
    jobs = json.load(open(sys.argv[1], encoding='utf-8'))
    only = set(sys.argv[2].split(',')) if len(sys.argv) > 2 else None
    os.makedirs(os.path.join(WORK, 'raw'), exist_ok=True)
    todo = [(j, k, c) for j in jobs if not only or j['id'] in only for k, c in enumerate(j['cands'])
            if not os.path.exists(os.path.join(WORK, 'raw', f"{j['id']}_{j['v']}_c{k}.png"))]
    print('осталось картинок:', len(todo), flush=True)
    if not todo: return
    i2i = StableDiffusionXLImg2ImgPipeline.from_pretrained(REPO, torch_dtype=torch.float16, variant='fp16')
    i2i.scheduler = DPMSolverMultistepScheduler.from_config(i2i.scheduler.config, use_karras_sigmas=True)
    t2i = StableDiffusionXLPipeline(**i2i.components)
    for p in (i2i, t2i): p.enable_model_cpu_offload(); p.set_progress_bar_config(disable=True)
    t0 = time.time()
    for n, (job, k, c) in enumerate(todo, 1):
        size = bucket(job['w'], job['h']); r2 = job.get('round') == 2; neg = NEG2 if r2 else NEG
        prompt = (STYLE2 if r2 else STYLE_G if job.get('g') else STYLE).format(s=job['subject'])
        g = torch.Generator('cuda').manual_seed(1000 + k*7919 + job['v']*31 + (500009 if r2 else 0))
        try:
            if c['mode'] == 'i2i':
                img = i2i(prompt=prompt, negative_prompt=neg, image=init_image(job, size), strength=c['strength'],
                          num_inference_steps=34, guidance_scale=6.0, generator=g).images[0]
            else:
                img = t2i(prompt=prompt, negative_prompt=neg, width=size[0], height=size[1], num_inference_steps=30,
                          guidance_scale=6.0, generator=g).images[0]
        except Exception as e:
            print('ошибка', job['id'], job['v'], k, e, flush=True); continue
        img.save(os.path.join(WORK, 'raw', f"{job['id']}_{job['v']}_c{k}.png"))
        el = time.time() - t0
        print(f"{n}/{len(todo)} {job['id']}_{job['v']}_c{k}  прошло {el/60:.0f} мин, осталось ~{el/n*(len(todo) - n)/60:.0f} мин", flush=True)

if __name__ == '__main__':
    main()
