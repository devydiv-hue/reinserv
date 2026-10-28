"""Бесшовные фактуры грунтов и полов той же моделью, что и спрайты (RealVisXL V5.0): у всех свёрток UNet и VAE
замкнутые края (padding_mode='circular') — картинка сама стыкуется с собой по обоим направлениям.
Кандидаты — work/tex/raw/<грунт>_c<k>.png (1024 px = TEX[id][1] клеток); выбор — review_tex (страница /tex),
встраивание — apply_tex.py. Уже готовые пропускаются.
Запуск: .venv/Scripts/python.exe gen_tex.py [id1,id2,...] [--n 3]"""
import json, os, sys, time
import torch
from diffusers import StableDiffusionXLPipeline, DPMSolverMultistepScheduler

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get('TEX_OUT') or os.path.join(HERE, 'work', 'tex', 'raw')
LOCAL = os.path.join(HERE, 'models', 'RealVisXL_V5.0')
REPO = LOCAL if os.path.exists(os.path.join(LOCAL, 'model_index.json')) else 'SG161222/RealVisXL_V5.0'
STYLE = ('drone photo looking straight down at {s}, photogrammetry ground scan, natural uneven variation, grime, stains, '
         'small debris, photorealistic, highly detailed, 8k, soft overcast light')
NEG = ('perspective, horizon, sky, wall, edge, border, frame, vignette, object, people, text, watermark, logo, cartoon, drawing, '
       'painting, illustration, 3d render, blurry, lowres, smooth, plain, uniform, plaster, flowers, harsh shadows, symmetric, kaleidoscope')
# задания: jobs/tex.json — [{id, name, subject (описание по-английски), cells (клеток на картинку 1024 px, клетка — 3 м),
# subject2?, neg?}]: кандидаты с 3-го и дальше — по subject2 (уточнённое описание, если первые три не вышли), neg — свой запрет
JOBS = {j['id']: j for j in json.load(open(os.path.join(HERE, 'jobs', 'tex.json'), encoding='utf-8'))}
TEX = {k: (j['subject'], j['cells']) for k, j in JOBS.items()}

def circular(model):
    for m in model.modules():
        if isinstance(m, torch.nn.Conv2d): m.padding_mode = 'circular'

def main():
    only = next((set(a.split(',')) for a in sys.argv[1:] if not a.startswith('--') and not a.isdigit()), None)
    n = int(sys.argv[sys.argv.index('--n') + 1]) if '--n' in sys.argv else 3
    os.makedirs(OUT, exist_ok=True)
    todo = [(t, k) for t in TEX if not only or t in only for k in range(n) if not os.path.exists(os.path.join(OUT, f'{t}_c{k}.png'))]
    print('осталось картинок:', len(todo), flush=True)
    if not todo: return
    p = StableDiffusionXLPipeline.from_pretrained(REPO, torch_dtype=torch.float16, variant='fp16')
    p.scheduler = DPMSolverMultistepScheduler.from_config(p.scheduler.config, use_karras_sigmas=True)
    circular(p.unet); circular(p.vae)
    p.enable_model_cpu_offload(); p.set_progress_bar_config(disable=True)
    t0 = time.time()
    for i, (t, k) in enumerate(todo, 1):
        g = torch.Generator('cuda').manual_seed(7000 + k*7919 + sum(map(ord, t)))
        j = JOBS[t]; subj = j.get('subject2') if k >= 3 and j.get('subject2') else j['subject']
        img = p(prompt=STYLE.format(s=subj), negative_prompt=NEG + (', ' + j['neg'] if j.get('neg') else ''), width=1024, height=1024, num_inference_steps=32,
                guidance_scale=6.5, generator=g).images[0]
        img.save(os.path.join(OUT, f'{t}_c{k}.png'))
        el = time.time() - t0
        print(f'{i}/{len(todo)} {t}_c{k}  прошло {el/60:.0f} мин, осталось ~{el/i*(len(todo) - i)/60:.0f} мин', flush=True)

if __name__ == '__main__':
    main()
