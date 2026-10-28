#!/usr/bin/env bash
# Скачивает RealVisXL V5.0 (fp16, формат diffusers) в tools/sprites/models/RealVisXL_V5.0 через curl:
# докачка (-C -), обрыв при скорости ниже 20 КБ/с за 30 с и повтор — сеть может «зависать» и рвать TLS.
cd "$(dirname "$0")"
REPO=SG161222/RealVisXL_V5.0
DST=models/RealVisXL_V5.0
FILES="model_index.json scheduler/scheduler_config.json
tokenizer/merges.txt tokenizer/special_tokens_map.json tokenizer/tokenizer_config.json tokenizer/vocab.json
tokenizer_2/merges.txt tokenizer_2/special_tokens_map.json tokenizer_2/tokenizer_config.json tokenizer_2/vocab.json
text_encoder/config.json text_encoder/model.fp16.safetensors
text_encoder_2/config.json text_encoder_2/model.fp16.safetensors
vae/config.json vae/diffusion_pytorch_model.fp16.safetensors
unet/config.json unet/diffusion_pytorch_model.fp16.safetensors"
for f in $FILES; do
  mkdir -p "$DST/$(dirname "$f")"
  url="https://huggingface.co/$REPO/resolve/main/$f"
  for i in $(seq 1 200); do
    if [ -f "$DST/$f.done" ]; then break; fi
    curl -sSL -C - --retry 3 --speed-limit 20000 --speed-time 30 --connect-timeout 30 -o "$DST/$f" "$url" && { touch "$DST/$f.done"; echo "OK $f $(du -h "$DST/$f" | cut -f1)"; break; }
    echo "повтор $i: $f ($(du -h "$DST/$f" 2>/dev/null | cut -f1))"; sleep 3
  done
done
echo ГОТОВО
