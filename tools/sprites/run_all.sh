#!/usr/bin/env bash
# Полный прогон без присмотра: генерация всех кандидатов и вырезка фона каждые 5 минут параллельно.
# Готовое пропускается — после обрыва просто запустить снова. Журналы: work/run.log, work/cut.log.
cd "$(dirname "$0")"
( while [ ! -f work/.gen_done ]; do ../../openings/.venv/Scripts/python.exe cutout.py jobs/all.json > work/cut.log 2>&1; sleep 300; done
  ../../openings/.venv/Scripts/python.exe cutout.py jobs/all.json > work/cut.log 2>&1; echo ВЫРЕЗКА ЗАВЕРШЕНА >> work/cut.log ) &
rm -f work/.gen_done
for i in 1 2 3; do .venv/Scripts/python.exe gen.py jobs/all.json 2>&1 | grep --line-buffered -v -i "warn\|float32"; done
touch work/.gen_done
wait
echo ПРОГОН ЗАВЕРШЁН
