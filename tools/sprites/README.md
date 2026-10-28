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
