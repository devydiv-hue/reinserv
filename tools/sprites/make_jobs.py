"""Задания на полный набор: по каждому варианту каждого объекта (work/init/all_meta.json) — описание предмета
по-английски (SUBJ) + слова варианта (переводятся по словарю KW). Пишет jobs/all.json."""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
SUBJ = {
 'house_small': 'roof of a small one-storey house', 'house_mid': 'roof of a medium two-storey house',
 'apartment_block': 'flat roof of a soviet apartment block with vents and parapet', 'ruin_house': 'ruined roofless house with broken walls and rubble inside',
 'ruin_corner': 'collapsed corner of a building, broken walls and debris', 'yard': 'abandoned children playground with swings and sandbox',
 'crossroad': 'faded road markings on asphalt crossroad', 'zebra': 'pedestrian zebra crossing stripes on asphalt', 'parking': 'parking lot markings on asphalt',
 'car_wreck': 'abandoned rusty car wreck', 'car_burnt': 'burnt out car wreck, charred metal', 'bus_wreck': 'abandoned bus wreck',
 'rubble_pile': 'pile of rubble and debris', 'rubble_big': 'large pile of building rubble, concrete slabs and rebar', 'jersey': 'jersey road barrier blocks',
 'bridge': 'road bridge span seen from above', 'overpass_pillar': 'concrete overpass pillar top', 'lamp_post': 'street lamp post seen from above',
 'road_sign': 'road sign on a pole seen from above', 'bus_stop': 'bus stop shelter roof', 'kiosk': 'small street kiosk roof', 'dumpster': 'metal garbage dumpster',
 'hydrant': 'fire hydrant', 'phone_booth': 'telephone booth roof', 'megatower': 'roof of a futuristic megatower skyscraper', 'megablock': 'roof of a huge cyberpunk residential megablock',
 'fortress_tower': 'roof of a fortified concrete tower', 'skywalk': 'elevated multi-level walkway', 'monument': 'stone monument statue on a pedestal', 'grand_arch': 'monumental stone arch gate',
 'ramp': 'concrete ramp', 'roof_vent': 'rooftop ventilation shaft', 'antenna': 'lattice antenna mast', 'helipad': 'rooftop helipad with H marking',
 'sky_bridge': 'glass skybridge between towers', 'billboard': 'holographic billboard frame', 'statue_judge': 'statue of a helmeted law enforcer', 'mall': 'roof of a shopping mall with glass atrium',
 'shop': 'roof of a small shop', 'market_stall': 'market stall table with goods', 'market_tent': 'market tent canopy', 'warehouse': 'roof of a warehouse',
 'shelf': 'store shelf rack with goods', 'display_window': 'shop display window', 'broken_window': 'broken shop window', 'checkout': 'supermarket checkout counter',
 'carts': 'shopping carts', 'food_court': 'food court table with chairs', 'escalator': 'escalator', 'pallet': 'wooden pallet with cargo', 'fridge_display': 'refrigerated display case',
 'vending': 'vending machine', 'bed': 'bed', 'bunk': 'bunk bed', 'sofa': 'sofa', 'table_dining': 'dining table with chairs', 'chair': 'chair', 'wardrobe': 'wardrobe',
 'stove': 'kitchen stove', 'fridge': 'refrigerator', 'sink': 'sink', 'toilet': 'toilet', 'shower': 'shower cabin', 'bathtub': 'bathtub', 'office_desk': 'office desk with computer',
 'hospital_bed': 'hospital bed', 'stretcher': 'medical stretcher gurney', 'school_desk': 'school desk', 'chalkboard': 'school chalkboard', 'reception': 'reception counter desk',
 'restaurant_table': 'restaurant table with chairs', 'locker': 'row of metal lockers', 'washing': 'washing machine', 'pantry_shelves': 'pantry shelves with jars and cans',
 'tank_big': 'large round industrial storage tank top', 'tank_horiz': 'horizontal fuel tank cylinder', 'generator': 'diesel generator', 'transformer': 'electrical transformer',
 'pipe_straight': 'straight industrial pipe', 'pipe_corner': 'industrial pipe elbow', 'valve': 'pipeline valve with handwheel', 'cooling_tower': 'cooling tower of a power plant',
 'chimney': 'industrial chimney stack top', 'hangar': 'roof of an aircraft hangar', 'conveyor': 'industrial conveyor belt', 'lathe': 'metal lathe machine', 'workbench': 'workbench with tools',
 'press': 'hydraulic press machine', 'barrels_group': 'group of oil barrels', 'crane_beam': 'overhead crane beam', 'boiler': 'industrial boiler', 'solar_panels': 'solar panels',
 'pump_jack': 'oil pump jack', 'bunker': 'concrete military bunker', 'pillbox': 'concrete pillbox', 'checkpoint': 'military checkpoint with barrier', 'sandbags_arc': 'curved sandbag wall',
 'sandbags_line': 'straight sandbag wall', 'czech_hedgehog': 'czech hedgehog anti-tank obstacle', 'barbed_wire': 'barbed wire coil', 'watchtower': 'watchtower roof',
 'barracks': 'roof of military barracks', 'ammo_crate': 'military ammo crate', 'weapon_rack': 'weapon rack with rifles', 'lab_bench': 'laboratory bench with equipment',
 'vault_door': 'heavy bunker vault door', 'radar': 'radar dish', 'tank_wreck': 'destroyed military tank wreck', 'apc_wreck': 'wrecked armored personnel carrier',
 'mine_field': 'minefield warning sign', 'turret': 'automated gun turret', 'tent': 'camping tent', 'big_tent': 'large canvas tent', 'campfire': 'campfire ringed with stones',
 'gas_station': 'abandoned gas station canopy roof and pumps', 'fuel_pump': 'old fuel pump', 'scrap_shack': 'shack built from rusty corrugated metal sheets',
 'scrap_tower': 'guard tower built from scrap metal', 'pickup_rust': 'rusty pickup truck', 'buggy': 'raider dune buggy', 'war_rig': 'armored war rig truck',
 'scrap_pile': 'pile of rusty scrap metal', 'junk_mound': 'junkyard mound', 'plane_wreck': 'crashed airplane wreck', 'moisture_trap': 'moisture vaporator',
 'water_tower': 'water tower tank', 'windmill': 'small windmill turbine', 'skull_totem': 'totem pole of skulls', 'caravan_cart': 'caravan wagon', 'settlement_gate': 'settlement gate',
 'oil_drum_fire': 'burning oil drum fire barrel', 'garden_bed': 'vegetable garden bed', 'latrine': 'outhouse latrine', 'canopy': 'canopy shelter on poles',
 'drying_rack': 'drying rack', 'field_kitchen': 'field kitchen with cauldron', 'water_cistern': 'water cistern', 'cage': 'metal cage', 'animal_pen': 'animal pen fence',
 'pack_animal': 'two-headed mutant cow pack animal', 'arena_pit': 'fighting arena pit', 'banner': 'banner flag on a pole', 'signpost': 'wooden signpost',
 'searchlight': 'searchlight', 'radio_mast': 'radio mast', 'trophy_pole': 'trophy pole', 'anom_gravity': 'gravity anomaly vortex distorting debris',
 'anom_electro': 'electric anomaly with lightning arcs', 'anom_thermal': 'heat anomaly with scorched glowing ground', 'toxic_puddle': 'toxic chemical puddle',
 'crystal_growth': 'cluster of glowing crystals', 'mutant_tree': 'mutated alien tree', 'glow_mushrooms': 'cluster of glowing mushrooms', 'rift': 'deep crack rift in the ground',
 'lab_ruin': 'ruined research lab building', 'rad_sign': 'radiation warning sign', 'containment_pod': 'specimen containment pod', 'artifact': 'mysterious glowing artifact',
 'cocoon': 'organic cocoon webbed', 'bone_field': 'field of scattered bones and skulls', 'sewer_grate': 'sewer drain grate', 'manhole': 'manhole cover',
 'collector': 'sewer collector tunnel cross-section', 'metro_car': 'subway train car roof', 'platform_edge': 'subway platform edge', 'turnstiles': 'metro turnstiles',
 'stairs_down': 'stairs going down into an underground entrance', 'electric_panel': 'electrical panel box', 'catacomb_niche': 'catacomb burial niche with bones',
 'bone_pile': 'pile of bones', 'column': 'stone column top', 'mine_props': 'mine tunnel timber supports', 'maintenance_hatch': 'maintenance hatch in the floor',
 'pump_station': 'water pump station', 'rock_big': 'large rock boulder', 'boulder': 'boulder', 'rocks_scatter': 'scattered rocks', 'dune': 'sand dune', 'ravine': 'dry ravine gully',
 'dead_tree': 'dead leafless tree', 'tree_sparse': 'sparse scraggly tree crown', 'cactus': 'cactus', 'dry_bush': 'dry bush', 'mutant_plant': 'carnivorous mutant plant',
 'stumps': 'tree stumps', 'reeds': 'clump of reeds', 'nature_ruins': 'overgrown ancient stone columns', 'crater': 'explosion crater', 'beast_bones': 'skeleton of a giant beast',
 'puddle': 'puddle', 'door': 'door', 'double_door': 'double door', 'window': 'window', 'gate_metal': 'metal gate', 'stairs': 'staircase', 'ladder': 'ladder',
 'partition': 'room partition', 'crate_wood': 'wooden crate', 'crate_metal': 'metal crate', 'barrel': 'barrel', 'barrel_toxic': 'barrel of toxic waste with hazard markings',
 'shipping_container': 'shipping container', 'trash': 'pile of trash', 'barricade': 'barricade of planks', 'barricade_car': 'barricade of wrecked cars',
 'bear_trap': 'bear trap', 'tripwire': 'tripwire trap', 'landmine': 'landmine', 'safe': 'metal safe', 'terminal': 'computer terminal', 'radio': 'radio transceiver',
 'medkit': 'first aid medkit', 'lamp': 'lamp', 'rug': 'rug', 'corpse': 'dead body', 'blood': 'blood splatter', 'sleeping_bag': 'sleeping bag', 'table_small': 'small table',
 'tv': 'old television', 'bookshelf': 'bookshelf with books', 'cover_concrete': 'concrete cover block', 'tire_stack': 'stack of old tires',
 'monolith': 'black obsidian monolith slab', 'pipe_forest': 'dense forest of vertical metal pipes', 'ship_hull': 'crashed starship hull section',
 'ship_nozzle': 'starship engine nozzle', 'cryo_pod': 'cryogenic sleep pod', 'radio_dish': 'large radio telescope dish', 'greenhouse': 'long hydroponic greenhouse',
 'crystal_tree': 'tree made of crystals', 'mineral_spikes': 'cluster of sharp mineral spikes', 'geyser': 'geyser vent', 'tesla_mast': 'tesla coil lightning mast',
 'satellite': 'crashed satellite with solar wings', 'accel_ring': 'particle accelerator ring', 'sarcophagus': 'reinforced concrete sarcophagus over a reactor',
 'cable_bridge': 'cable-stayed bridge', 'barge': 'rusty barge ship', 'polyhedron': 'concrete geometric sculpture', 'antigrav_car': 'sleek maglev train car',
 'power_pylon': 'power line pylon', 'robot_wreck': 'destroyed robot wreck', 'aerocar': 'crashed cargo hover vehicle', 'war_mech': 'wrecked military walker mech',
 'statue_head': 'giant fallen stone statue head', 'bio_tank': 'spherical bio storage tank', 'web_mass': 'sticky spider web mass', 'slag_pool': 'pool of molten slag',
 'ore_vein': 'rock with ore vein', 'stalagmites': 'cluster of stalagmites', 'mine_cart': 'mine cart', 'mine_headframe': 'mine shaft headframe',
 'drill_rig': 'drilling rig', 'excavator': 'excavator', 'dump_truck': 'mining dump truck', 'pipe_rack': 'pipe rack with parallel pipes', 'silo': 'grain silo',
 'gantry_crane': 'port gantry crane', 'container_stack': 'stack of shipping containers', 'semi_truck': 'semi truck with trailer', 'road_billboard': 'roadside billboard',
 'server_rack': 'server rack',
}
KW = [  # слова варианта -> английские (по корням)
 ('сгор|выгор|обгор', 'burnt, charred'), ('ржав', 'rusty'), ('разби|разгром|расколот|трещин|сломан', 'broken, cracked'), ('разграб|вскры|взлом', 'looted, broken open'),
 ('обруш|провал|рухнул|рухнула', 'collapsed'), ('опрокинут|перевёрнут|повален|упал|лежит', 'tipped over'), ('зарос|мох|мшист', 'overgrown with moss and weeds'),
 ('открыт|распахн', 'open'), ('закрыт', 'closed'), (r'\bкров(ь|и|ью|авый|авая|авое|авые)\b|в крови', 'bloody'), (r'скелет|\bкост(и|ей|ями|ях|ь)\b', 'with bones'), ('течёт|протека|подтека|разлив', 'leaking, spill'),
 ('гор(ит|ящ)|тлеет|тлеющ', 'burning, embers'), ('потух|зола', 'extinguished, ashes'), (r'\bпуст(ая|ой|ые|о)\b', 'empty'), (r'\bполн(ый|ая|ые|ое)\b', 'full'),
 (r'\bкрасн', 'red'), (r'\bсин(?!т)', 'blue'), ('зелён', 'green'), ('жёлт', 'yellow'), (r'\bбел(ый|ая|ые|ое)\b', 'white'), (r'\bсер(ый|ая|ые|ое)\b', 'grey'), ('чёрн|тёмн', 'dark'), ('фиолет|аметист|пурпур', 'purple'),
 ('голуб|бирюз', 'cyan'), ('янтар', 'amber'), ('розов', 'pink'), ('деревян|доск', 'wooden'), ('металл|жест|стальн', 'metal'), ('бетон', 'concrete'), ('кирпич', 'brick'),
 ('пластик', 'plastic'), ('кожан', 'leather'), ('брезент|тент', 'canvas tarp'), ('черепиц', 'clay roof tiles'), ('шифер', 'slate roof'), ('профнастил', 'corrugated metal roof'),
 ('рубероид|плоская крыша', 'flat tar roof'), ('солнечн', 'solar panel'), ('огород|грядк|сады', 'rooftop garden'), ('граффити|исписан', 'graffiti'),
 (r'светит|светящ|сиян|\bсвет\b', 'glowing'), ('искрит|молни|разряд|гроза', 'sparking electricity'), (r'\bпар\b', 'steam'), (r'\bвод(а|ой|у|ы)\b|затоп|ручь', 'water'), ('песк|песч', 'sand'),
 (r'\bлёд|обледен|\bиней|холодн', 'frost, ice'), ('камуфляж|армейск|военн', 'military'), ('рейдер|шип', 'raider spikes'), (r'\bчереп(?!иц)', 'skulls'), ('пулемёт', 'machine gun'),
 ('мешк', 'sacks'), ('ящик', 'crates'), ('бочк|бочек', 'barrels'), ('покрышк', 'tires'), ('колюч|егоза', 'barbed wire'), ('свеч', 'candles'), ('ламп', 'lamp'),
 ('прожектор', 'searchlight'), ('мусор|хлам|замусор', 'litter'), ('плесен|гряз', 'dirty, mold'), ('раскал|жар', 'red hot glowing'), ('спор|гриб', 'fungus spores'),
 ('кокон', 'cocoons'), ('руд', 'ore'), ('медь', 'copper green'), ('железо', 'iron red'), ('бронз', 'bronze'), ('кристалл', 'crystals'), ('вагон', 'wagon'),
 ('седан', 'sedan'), ('хэтчбек', 'hatchback'), ('пикап', 'pickup'), ('фургон', 'van'), ('школьн', 'yellow school'), ('троллейбус', 'trolleybus'),
]
GROUND_STRENGTHS = [0.55, 0.7, 0.85]

def variant_words(name):
    n = name.lower(); out = []
    for pat, en in KW:
        if re.search(pat, n) and en not in out: out.append(en)
    return ', '.join(out)

def main():
    meta = json.load(open(os.path.join(HERE, 'work', 'init', 'all_meta.json'), encoding='utf-8'))
    jobs = []; miss = []
    for m in meta:
        base = SUBJ.get(m['id'])
        if not base: miss.append(m['id']); continue
        for v, vn in enumerate(m['vn']):
            words = variant_words(vn); subj = base + (', ' + words if words else '')
            j = {'id': m['id'], 'v': v, 'w': m['w'], 'h': m['h'], 'g': m['g'], 'cat': m['cat'], 'name': m['name'], 'vname': vn, 'subject': subj}
            j['cands'] = [{'mode': 'i2i', 'strength': s} for s in GROUND_STRENGTHS] if m['g'] else [{'mode': 'i2i', 'strength': 0.62}, {'mode': 'i2i', 'strength': 0.8}, {'mode': 't2i'}]
            jobs.append(j)
    os.makedirs(os.path.join(HERE, 'jobs'), exist_ok=True)
    json.dump(jobs, open(os.path.join(HERE, 'jobs', 'all.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print('заданий:', len(jobs), 'картинок:', sum(len(j['cands']) for j in jobs), 'без описания:', miss)

if __name__ == '__main__':
    main()
