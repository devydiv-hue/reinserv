"""Второй круг: перегенерация вариантов, отмеченных «перегенерировать» (R), и неполных спрайтов
(см. ниже). Правит jobs/all.json на месте, старые картинки этих вариантов уносит
в work/round1/, выбор по ним снимает (прежний — в work/choices_round1.json). Дальше — gen.py jobs/all.json, cutout.py.
  R  — описание вида сверху вручную (TOP); у нарисованных спереди — новый исходник сверху (BOX: простой силуэт
       нужного цвета, дорисовка сильная); кандидаты: i2i 0.62, i2i 0.8, t2i (у BOX — i2i 0.85, t2i, t2i).
  неполные — отмеченные на странице выбора в режиме «Проверка» (work/recheck.json): от старого рисунка с полями
       (pad: исходник уменьшен, вокруг запас, чтобы дорисовка не вышла за кадр), i2i 0.55 / 0.7 / 0.85.
Повторный запуск подхватывает только новое. Запуск: python make_redo.py"""
import json, os, shutil
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, 'work')
PAD = 0.14
TOP = {
 'apartment_block_2': 'flat concrete roof of a soviet apartment block, ring of sandbags with a machine gun nest, ammo boxes',
 'apartment_block_3': 'flat concrete roof of a soviet apartment block, one corner collapsed into a hole with rubble and rebar',
 'beast_bones_1': 'huge skeleton of a giant beast lying flat, ribs and long spine, overgrown with green moss',
 'billboard_0': 'top edge of a long thin holographic billboard, narrow metal beam with cyan glowing strip',
 'billboard_1': 'top edge of a long thin advertising billboard, narrow metal beam with red glowing strip',
 'billboard_2': 'top edge of a long thin broken billboard, bent metal beam, shattered glass shards around',
 'bridge_2': 'road bridge span with collapsed middle section, broken concrete deck ends, gap with rubble',
 'bunk_2': 'broken metal bunk bed, torn grey mattress on the top bunk, bent frame',
 'bus_stop_1': 'flat roof of a bus stop shelter, cracked plexiglass roof panels, metal frame',
 'bus_stop_2': 'collapsed bus stop shelter, bent metal frame and fallen roof panel lying flat',
 'canopy_3': 'camouflage net stretched over four poles, green and brown netting',
 'car_wreck_2': 'roof of an abandoned rusty sedan riddled with bullet holes, shattered windshield',
 'chair_0': 'wooden chair, square wooden seat and top of the backrest',
 'chair_2': 'white plastic garden chair, seat and curved backrest',
 'chalkboard_0': 'top of a long wall chalkboard, narrow wooden frame edge and chalk tray with white chalk',
 'chalkboard_1': 'top of a long wall chalkboard, narrow wooden frame edge and chalk tray with colored chalk',
 'chalkboard_2': 'cracked school chalkboard fallen flat on the floor, broken in two, chalk dust',
 'checkout_0': 'supermarket checkout counter, black conveyor belt, cash register with scanner',
 'checkout_1': 'looted supermarket checkout counter, smashed open cash register, empty drawer, scattered coins',
 'checkout_2': 'supermarket checkout counter tipped over on its side, conveyor belt, debris',
 'checkpoint_3': 'raider checkpoint, barrier of scrap metal with spikes, tires and oil barrels',
 'display_window_0': 'shop display window along a wall, thin glass pane, mannequins and clothes behind it',
 'dump_truck_1': 'giant mining dump truck, yellow cab, bed loaded with grey rock and ore, fills the frame',
 'escalator_0': 'flat escalator, two metal handrails and grooved steps between them',
 'escalator_1': 'flat escalator with collapsed middle section, broken steps, hole',
 'escalator_2': 'flat escalator buried under concrete rubble',
 'fridge_display_0': 'open-top refrigerated supermarket display case full of food packages',
 'garden_bed_2': 'raised wooden garden bed with huge mutated pumpkins and vines',
 'grand_arch_0': 'top of a monumental stone arch gate, long flat stone roof slab with carved cornice',
 'helipad_2': 'rooftop helipad with H marking and an abandoned rusty helicopter with rotor blades',
 'lamp_post_2': 'top of a bent street lamp, lamp head on a curved metal arm',
 'locker_1': 'row of metal lockers, flat dented tops, doors hanging open, scattered clothes',
 'mall_2': 'shopping mall roof with glass atrium and a survivor camp, tents, tarps, campfire, barrels',
 'market_stall_2': 'market table with rifles, pistols and ammo boxes laid out on canvas',
 'megatower_1': 'futuristic skyscraper roof with top floors collapsed, broken floors, exposed beams, rubble',
 'monument_2': 'toppled stone statue lying flat next to its empty pedestal, broken pieces',
 'office_desk_2': 'smashed office desk, broken computer monitor, scattered papers, overturned chair',
 'pack_animal_2': 'two-headed mutant ox, broad back and spine, two heads, saddle bags',
 'pack_animal_3': 'dead two-headed mutant cow lying on its side, blood',
 'pallet_2': 'wooden pallet with four oil barrels, round barrel lids',
 'pallet_3': 'wooden pallet with cargo boxes wrapped in shiny plastic stretch film',
 'pantry_shelves_2': 'looted pantry shelves, broken jars and spilled cans on the shelf tops',
 'phone_booth_2': 'roof of a smashed phone booth, broken glass scattered around',
 'plane_wreck_1': 'crashed military cargo plane wreck, broken fuselage and wings, fungus growth',
 'radar_1': 'lattice radar antenna, long rectangular grid array on a rotating base',
 'reception_0': 'L-shaped reception counter top, computer monitor, papers',
 'reception_1': 'looted reception counter, drawers pulled out, scattered papers, broken monitor',
 'reception_2': 'reception counter turned into a barricade, sandbags and furniture stacked against it',
 'road_sign_0': 'top of a stop sign, thin grey edge of the octagonal plate on a round pole',
 'sandbags_line_2': 'straight sandbag wall with firing slits between the bags',
 'school_desk_0': 'school desk with textbooks and notebooks, chair tucked in',
 'school_desk_1': 'empty school desk and chair',
 'school_desk_2': 'scratched school desk with trash and paper on top, chair',
 'semi_truck_1': 'refrigerated semi truck, cab and long white trailer roof with cooling unit, fills the frame',
 'semi_truck_3': 'jackknifed semi truck, cab at an angle to the trailer, spilled cargo boxes',
 'settlement_gate_2': 'smashed settlement gate, broken wooden gate leaves lying open, scrap metal posts',
 'sink_2': 'broken sink, cracked basin, shards',
 'sofa_3': 'sofa with a checkered plaid blanket on it',
 'statue_judge_0': 'bronze statue of a helmeted law enforcer, top of round helmet, shoulder pads, square pedestal',
 'statue_judge_1': 'beheaded bronze statue, broken neck stump, shoulder pads, head lying on the square pedestal',
 'table_dining_2': 'overturned dining table upside down with legs up, chairs knocked over',
 'toilet_2': 'smashed toilet, broken bowl, shards, puddle',
 'vault_door_1': 'heavy round steel bunker vault door swung open beside the doorway',
 'vending_0': 'top of a soda vending machine, flat red metal cabinet top, vent grille',
 'wardrobe_0': 'top of a closed wooden wardrobe, flat dusty wooden top panel',
 'wardrobe_1': 'top of a wooden wardrobe with doors swung open, clothes spilled on the floor',
}
# нарисованные спереди — новый исходник сверху: цвет крышки (и форма, если не прямоугольник)
BOX = {'billboard_0': (60, 66, 72), 'billboard_1': (60, 66, 72), 'billboard_2': (60, 66, 72), 'chalkboard_0': (120, 86, 52),
       'chalkboard_1': (120, 86, 52), 'display_window_0': (150, 170, 175), 'locker_1': (110, 120, 112), 'vending_0': (170, 40, 36),
       'wardrobe_0': (112, 78, 48), 'wardrobe_1': (112, 78, 48), 'reception_0': (96, 70, 50), 'grand_arch_0': (150, 145, 135),
       'road_sign_0': 'sign', 'statue_judge_0': 'statue', 'statue_judge_1': 'statue', 'phone_booth_2': (150, 40, 34)}

def box_init(key, w, h):
    W, H = int(w*128), int(h*128); im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im); kind = BOX[key]
    if kind == 'statue':
        d.rectangle((W*.08, H*.08, W*.92, H*.92), fill=(140, 136, 128, 255), outline=(90, 88, 84, 255), width=4)
        d.ellipse((W*.3, H*.3, W*.7, H*.7), fill=(110, 86, 52, 255)); d.ellipse((W*.18, H*.38, W*.82, H*.62), fill=(100, 78, 48, 255))
    elif kind == 'sign':
        d.rectangle((W*.2, H*.46, W*.8, H*.54), fill=(150, 30, 30, 255)); d.ellipse((W*.44, H*.44, W*.56, H*.56), fill=(120, 120, 124, 255))
    else:
        m = 0.06*min(W, H); dark = tuple(int(v*0.6) for v in kind) + (255,)
        y0, y1 = (H*0.36, H*0.64) if key.split('_')[0] in ('billboard', 'chalkboard', 'display') else (m, H - m)  # настенное: сверху видна узкая кромка
        d.rounded_rectangle((m, y0, W - m, y1), radius=m*0.5, fill=kind + (255,), outline=dark, width=max(3, int(m*0.6)))
    return im.filter(ImageFilter.GaussianBlur(1))

def pad_init(src, dst):
    im = Image.open(src).convert('RGBA'); W, H = im.size; k = 1 - 2*PAD
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0)); out.alpha_composite(im.resize((round(W*k), round(H*k)), Image.LANCZOS), (round(W*PAD), round(H*PAD)))
    out.save(dst)

def main():
    jp = os.path.join(HERE, 'jobs', 'all.json'); jobs = json.load(open(jp, encoding='utf-8'))
    ch = json.load(open(os.path.join(WORK, 'choices.json'), encoding='utf-8'))
    rp = os.path.join(WORK, 'recheck.json'); recheck = set(json.load(open(rp, encoding='utf-8'))) if os.path.exists(rp) else set()
    if not os.path.exists(os.path.join(WORK, 'choices_round1.json')): shutil.copyfile(os.path.join(WORK, 'choices.json'), os.path.join(WORK, 'choices_round1.json'))
    old = os.path.join(WORK, 'round1'); os.makedirs(os.path.join(old, 'init'), exist_ok=True); redo = cut = 0
    for j in jobs:
        key = f"{j['id']}_{j['v']}"; pick = ch.get(key)
        if pick == 'redo' and key in TOP:
            j['subject'] = TOP[key]; j['round'] = 2
            j['cands'] = [{'mode': 'i2i', 'strength': 0.85}, {'mode': 't2i'}, {'mode': 't2i'}] if key in BOX else [{'mode': 'i2i', 'strength': 0.62}, {'mode': 'i2i', 'strength': 0.8}, {'mode': 't2i'}]
            redo += 1
        elif isinstance(pick, int) and key in recheck:
            j['pad'] = PAD; j['round'] = 2; j['cands'] = [{'mode': 'i2i', 'strength': s} for s in (0.55, 0.7, 0.85)]; cut += 1
        else: continue
        ip = os.path.join(WORK, 'init', key + '.png')
        if not os.path.exists(os.path.join(old, 'init', key + '.png')): shutil.copyfile(ip, os.path.join(old, 'init', key + '.png'))
        if key in BOX and j.get('round') == 2 and 'pad' not in j: box_init(key, j['w'], j['h']).save(ip)
        elif 'pad' in j: pad_init(os.path.join(old, 'init', key + '.png'), ip)
        for sub in ('raw', 'cut'):
            os.makedirs(os.path.join(old, sub), exist_ok=True)
            for f in os.listdir(os.path.join(WORK, sub)):
                if f.startswith(key + '_c'): shutil.move(os.path.join(WORK, sub, f), os.path.join(old, sub, f))
        ch.pop(key, None)
    json.dump(jobs, open(jp, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    json.dump(ch, open(os.path.join(WORK, 'choices.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'перегенерация по R: {redo}, неполные: {cut}, картинок: {3*(redo + cut)}')

if __name__ == '__main__':
    main()
