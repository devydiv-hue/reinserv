"""Скачивает модель RealVisXL V5.0 (fp16, формат diffusers) в кэш Hugging Face с повторами — сеть может рвать
крупные загрузки, недокачанное докачивается при следующей попытке."""
import time, sys
from huggingface_hub import snapshot_download

REPO = 'SG161222/RealVisXL_V5.0'
PATTERNS = ['model_index.json', 'scheduler/*', 'tokenizer/*', 'tokenizer_2/*', '*/config.json',
            'text_encoder/model.fp16.safetensors', 'text_encoder_2/model.fp16.safetensors',
            'unet/diffusion_pytorch_model.fp16.safetensors', 'vae/diffusion_pytorch_model.fp16.safetensors']

for i in range(60):
    try:
        p = snapshot_download(REPO, allow_patterns=PATTERNS, max_workers=2)
        print('OK', p); sys.exit(0)
    except Exception as e:
        print('попытка', i + 1, type(e).__name__, str(e)[:160], flush=True); time.sleep(5)
sys.exit(1)
