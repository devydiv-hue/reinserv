# Реалистичные картинки для карт

Два набора, которые раздаёт сервер из `assets/map/` и подхватывает редактор карт и игровой стол:

- **Фото-фактуры грунтов** — `assets/map/tex/` (CC0, [Poly Haven](https://polyhaven.com)). Собирает `fetch_textures.py`:
  качает диффузные карты, подгоняет под клетку 3 м (128 px на клетку), тон и насыщенность — таблица `MAP` в скрипте.
  Жидкости, аномальные грунты и радиация остаются процедурными.
- **Спрайты объектов** (вид сверху) — `assets/map/sprites/`. Генерирует локально нейросеть RealVisXL V5.0 (SDXL,
  лицензия openrail++) на видеокарте. У объекта и варианта без картинки рисуется прежний процедурный рисунок.

## Установка (один раз)

Нужны [uv](https://docs.astral.sh/uv/) и видеокарта NVIDIA (проверено на RTX 5070, 12 ГБ).

```
uv venv --python 3.12 tools/sprites/.venv
uv pip install --python tools/sprites/.venv/Scripts/python.exe "torch==2.10.0+cu130" --index-url https://download.pytorch.org/whl/cu130
uv pip install --python tools/sprites/.venv/Scripts/python.exe diffusers transformers accelerate safetensors huggingface_hub pillow numpy rembg onnxruntime
bash tools/sprites/dl_model.sh        # ~7 ГБ модели, с докачкой — можно запускать повторно
```

Модель вырезки фона (`isnet-general-use.onnx`) — в `openings/cache/models` или в папке из переменной `U2NET_HOME`.

## Как делаются спрайты

1. `node tools/sprites/receiver.js` — приёмник на 127.0.0.1:3002.
2. В браузере (страница листа на тестовом сервере) отрисовать нужные процедурные объекты в PNG и отправить в приёмник
   (`work/init/<объект>_<вариант>.png`) — исходный кадр задаёт вид строго сверху и габарит в клетках.
3. `python gen.py jobs/<набор>.json` — генерация (`work/raw`): `i2i` — по исходному кадру, `t2i` — только по описанию.
4. `python cutout.py jobs/<набор>.json` — вырезка фона и вписывание в габарит (`work/cut`, 128 px на клетку).
5. `python sheet.py jobs/<набор>.json лист.png` — лист сравнения «как сейчас / новые».
6. Отобранные — в `assets/map/sprites/` и в `manifest.json` (`{"version": N, "sprites": {"car_wreck": {"0": "car_wreck_0.webp"}}}`).

Задание — список `{id, v, w, h, subject, n, strength?, modes?}`: `subject` — описание предмета по-английски, `v` —
вариант процедурного объекта, к которому относится картинка.

## Выбор, проверка и второй круг

- `node review.js` → http://127.0.0.1:3003 — выбор кандидата по каждому варианту (`work/choices.json`), «оставить как есть»
  или «перегенерировать». `python apply.py` встраивает только выбранное.
- `/check` — все выбранные спрайты на грунте с тенью; щелчок — «переделать от старого рисунка» (`work/recheck.json`).
- `python make_redo.py` — второй круг: отмеченные «перегенерировать» получают описание вида строго сверху (таблица `TOP`),
  нарисованные спереди — новый исходник сверху (`BOX`), отмеченные на `/check` — исходник с полями (обрезка по краю).
  Прежние raw/cut/init — в `work/round1/`, задания помечены `round: 2` (свой промпт `STYLE2`/`NEG2` в gen.py).

## Фактуры пола (грунты, полы, жидкости)

1. `jobs/tex.json` — грунт → описание по-английски и сколько клеток покрывает картинка.
2. `.venv/Scripts/python.exe gen_tex.py [id1,id2] [--n 3]` — бесшовные фактуры той же моделью (у свёрток UNet и VAE
   замкнутые края), `work/tex/raw/<грунт>_c<k>.png`, 1024 px.
3. `/tex` на странице выбора — каждый грунт замощён, с сеткой клеток и предметами для масштаба; выбор варианта
   или «как сейчас», масштаб (клеток на картинку) и яркость → `work/tex/choices.json`.
4. `.venv/Scripts/python.exe apply_tex.py` — выбранное в `assets/map/tex/` (до 256 px на клетку) и в манифест. `fetch_textures.py`
   (фото Poly Haven) встроенные так фактуры не перезаписывает.
