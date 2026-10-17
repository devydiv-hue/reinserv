/* ======================================================================
   ENGINE
   ====================================================================== */
let character = null;
let pendingRoleplayChoices = []; // [{id, label, among, resolved:false}] — always manual, per rules ("в зависимости от отыгрыша")
let pendingChoices = []; // [{id, title, options:[{label, apply(c)}]}] — manual-mode-only point/choice allocation
let pendingItemRolls = []; // [{id, title, options:[{label, apply(c)}]}] — manual-mode-only item table rolls, rendered next to Инвентарь
// Режим «Случайный⚡»: всё, как в «случайном», и вдобавок выборы «в зависимости от отыгрыша» тоже делаются случайно
// (с учётом оговорки «к не самому высокому…»), а не ждут игрока.
let roleplayRandom = false;
let lostPendingNotice = 0; // сколько несделанных выборов генерации пропало при загрузке (см. applyLoadedPayload)
const GEN_MODE_KEY = 'reincarnator_gen_mode_v1';
let randomMode = true; // toggled by the "случайный/ручной" button — governs choice/distribute/reduceDistinct/choiceMixed/weaponChoice/abilityChoice

function randInt(n){ return 1 + Math.floor(Math.random()*n); }
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function rollTable(entries, diceMax){
  const r = randInt(diceMax);
  return entries.find(e => r>=e.min && r<=e.max) || entries[entries.length-1];
}

function uid(){ return 'id'+Math.random().toString(36).slice(2); }
// Pulls a weight tag like "(1 Вещь)", "(2 Вещи)", "(1 Крш.)" out of an item's description text,
// since starting-gear/table item text embeds its weight this way rather than as a separate field.
function extractItemWeight(text){
  // weight tag can be alone "(1 Крш.)" or followed by more info in the same parens, e.g. "(1 Крш., редкость)"
  const m = String(text||'').match(/\((\d+)\s*(Вещь|Вещи|Вещей|Крш\.?)(?=[,)])/);
  return m ? `${m[1]} ${m[2]}` : '—';
}
// Routes a generated item into "Вещи в рюкзаке" or "Крошечные вещи" based on its parsed weight,
// so a "(1 Крш.)" item lands in the tiny-items list rather than the backpack.
function addGeneratedInventoryItem(c, text, source, extra={}){
  const weight = extractItemWeight(text);
  const category = weight.includes('Крш') ? 'tiny' : 'backpack';
  c.inventory[category].push({id:uid(), name:text, weight, source, ...extra});
}
// Same as addGeneratedInventoryItem, but for pre-split {name, weight} pairs from an itemBundle row,
// where the weight is already known (sourced from ITEM_CATALOG) rather than parsed from free text.
function addKnownWeightItem(c, name, weight, source){
  const category = weight.includes('Крш') ? 'tiny' : 'backpack';
  c.inventory[category].push({id:uid(), name, weight, source});
}
function describeBundleRow(row){
  const fixedNames = (row.fixed||[]).map(it=>it.name).join(', ');
  const choiceDesc = row.choice && row.choice.length ? ` + довыбор: ${row.choice.map(it=>it.name).join(' / ')}` : '';
  const creditsDesc = row.credits!==undefined ? ` (+${typeof row.credits==='function'?'случайно':row.credits} кред.)` : '';
  return fixedNames + choiceDesc + creditsDesc;
}
function logEvent(c, text){
  if(!c) return;
  if(!c.history) c.history = [];
  c.history.push({ t: new Date().toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit', second:'2-digit'}), text });
  if(c.history.length > 500) c.history.splice(0, c.history.length - 500); // soft cap so the log can't grow forever
}
// Lists guaranteed ("fixed") stat bonuses from a mods list — i.e. bonuses that always apply
// regardless of random rolls or player choice — for use in log summaries.
function summarizeFixedMods(mods){
  return mods.filter(m=>m.t==='fixed').map(m=>`${STAT_LABELS[m.stat]} ${m.delta>0?'+':''}${m.delta}`);
}

function newCharacter(){
  const c = {
    name:'', player:'', level:0, xp:0, ageKey:'y20_29',
    archetypeKey:'avantyurist', subtypeKey:null,
    careerKey:null, originKey:null,
    alignment:null, religion:null,
    stats:{}, log:{}, // log[stat] = [{source, delta, note}]
    abilities:[], notes:[], abilitySelections:[], psiDisciplines:[], shamanConnection:null, cultReligion:null,
    advantages:[], flaws:[], // each entry: {id, text, source, forced}
    inventory:{ on_body:[], backpack:[], tiny:[], pockets:[] }, // each item: {id, name, weight, source}
    credits:0, creditsLog:[], // [{source, amount}] — summed money, shown as a quick-edit row above the backpack
    hugeItemsCapacity:'', // no formula given in the rules text extracted so far — manual field
    hpCurrent:null, psiCurrent:null, // set to full max once stats are known (end of generateCharacter)
    history:[], // [{t, text}] — log of generation/level-up/manual changes for THIS character sheet
    appearance:0, size:0, // numeric trackers — auto-shifted by generation/level-up events, editable by the player
    luck:1, // Удача — по умолчанию 1 у нового персонажа (явно просили); тратится на переброс любой проверки характеристики/способности, выдаёт Мастер (см. giveLuckToPlayer) или правится вручную
    xp:0, // Опыт — по умолчанию 0; Мастер начисляет всем подключённым игрокам разом отметкой деяния на вкладке "Начисление опыта" (см. toggleXpDeed/broadcastXp), либо правится вручную самим игроком
    bonusHpMax:0, bonusHpMaxLog:[], // e.g. Боец's "Живучий" ability (+1 max HP) — mirrors appearanceLog/sizeLog for clean removal
    bonusPsiMax:0, bonusPsiMaxLog:[], // e.g. Боевой психоник's "Душевная стойкость" (+2 max пси)
    appearanceLog:[], sizeLog:[], // [{source, delta}] — mirrors c.log[stat] so switching career/origin/subtype can cleanly revert only their contribution
    religionText:'', // player-editable free text; separate from the auto-generated hint note in c.notes
    specializationPicks: SPEC_SLOT_LEVELS.map(level=>({level, key:null, tier:null})), // 4 slots (lvl 5/9/13/17)
    siz:0, // СИЗ — protective equipment rating, page's "вредная среда" save = вын. + СИЗ; purely manual (gear-dependent)
    // Пси-сопротивление — книга задаёт [12 + пси-сопротивление] как Максимум спасброска от пси-поля
    // (стр. 31/188), но само пси-сопротивление персонажа в среднем поднимается очень редко (импланты,
    // отдельные способности подтипов) — так что 12 удобнее держать прямо как базовое значение поля, а
    // не отдельным слагаемым в формуле. psiSoprotLog мирроит appearanceLog/sizeLog — автоматические
    // бонусы (например, от способности подтипа) логируются и корректно снимаются при смене подтипа;
    // поле всё равно остаётся редактируемым вручную (импланты вроде «Пси-протектора» и т.п.).
    psiSoprot:12, psiSoprotLog:[],
    restEquipMod:0, // "мод. снаряжения" used by the "Отдых на Равнине" roll (вын. + мод. снаряжения)
    states:{ bodrost:true, istoshenie:false, ispug:false, stress:false }, // Состояния circles — бодрость по умолчанию активна при создании персонажа (просили явно; остальные три — не активны)
    conditionsNotes:'', // "Состояния и травмы" free text box
    // Оружие 1/2 — dl/pr:null означает "не показывать это поле в карточке" (не у всякого оружия есть
    // Дальность/Парирование), itemId/itemCategory/itemNameSnapshot — привязка к конкретному предмету
    // инвентаря, откуда слот заполнен (см. equipWeapon/resyncWeaponSlots), null у пустого/вручную
    // заполненного слота.
    weapons:[ blankWeaponSlot(), blankWeaponSlot() ],
    armor:{ body:0, helmet:0, properties:'' } // Броня block
  };
  ALL_STATS.forEach(s=>{ c.stats[s]=0; c.log[s]=[]; });
  // Body and Personality characteristics start from a base of 3 (per user correction);
  // Adventurer skills, Combat skills, and all Knowledge groups still start from 0.
  [...BODY, ...PERSONALITY].forEach(s=>{ addLog(c, s, 3, 'Базовое значение'); });
  return c;
}

function addLog(c, stat, delta, source){
  c.stats[stat] = (c.stats[stat]||0) + delta;
  c.log[stat].push({source, delta});
}

// Resolve one modifier. `auto` = true means resolve every choice randomly.
// Roleplay-tagged modifiers are NEVER auto-resolved — they are queued for the player.
function describeBundle(bundle){
  // Show everything the bundle actually grants, not just the first ability found — with multiple
  // abilities per bundle (e.g. a "3 abilities, pick 2 of 3" career choice encoded as 3 pair-bundles),
  // showing only the first name made otherwise-different bundles look identical in the picker. Covers
  // every mod type actually used inside a choiceMixed bundle anywhere in this file (checked by grep);
  // anything else still falls back to 'Вариант' rather than crashing on an unrecognized type.
  const parts = [];
  bundle.forEach(m=>{
    if(m.t==='ability') parts.push((m.name && m.name!=='Профессия') ? m.name : (m.text || m.name || 'Способность'));
    else if(m.t==='fixed') parts.push(`${STAT_LABELS[m.stat]} ${m.delta>0?'+':''}${m.delta}`);
    else if(m.t==='note') parts.push(m.text);
    else if(m.t==='appearance') parts.push(`Внешний вид ${m.delta>0?'+':''}${m.delta}`);
    else if(m.t==='size') parts.push(`Размер ${m.delta>0?'+':''}${m.delta}`);
    else if(m.t==='item') parts.push(m.text);
    else if(m.t==='credits') parts.push(m.label || 'Кредиты');
    else if(m.t==='choice') parts.push(m.options.map(o=>`${STAT_LABELS[o.stat]} ${o.delta>0?'+':''}${o.delta}`).join('/'));
    else if(m.t==='distribute') parts.push(`${m.points} очк.: ${m.among.map(s=>STAT_LABELS[s]).join('/')}`);
  });
  return parts.length ? parts.join(' + ') : 'Вариант';
}
function queueDistributeManual(source, points, among, maxPer){
  const used = {};
  let remaining = points;
  function pushNext(){
    if(remaining<=0) return;
    const options = among.filter(s => (used[s]||0) < maxPer);
    if(!options.length) return; // pool exhausted early (shouldn't normally happen)
    pendingChoices.push({
      id: uid(), source, title: `${source}: распределите очко (осталось ${remaining})`,
      options: options.map(s=>({
        label: STAT_LABELS[s],
        apply: (ch)=>{
          addLog(ch, s, 1, source+' (распределение, выбор игрока)');
          used[s] = (used[s]||0)+1;
          remaining--;
          pushNext();
        }
      }))
    });
  }
  pushNext();
}
function queueReduceDistinctManual(source, count, among, delta){
  const used = new Set();
  let remaining = count;
  function pushNext(){
    if(remaining<=0) return;
    const options = among.filter(s=>!used.has(s));
    if(!options.length) return;
    pendingChoices.push({
      id: uid(), source, title: `${source}: выберите характеристику для снижения (осталось ${remaining})`,
      options: options.map(s=>({
        label: STAT_LABELS[s],
        apply: (ch)=>{
          addLog(ch, s, delta, source+' (снижение, выбор игрока)');
          used.add(s);
          remaining--;
          pushNext();
        }
      }))
    });
  }
  pushNext();
}

// Shared dedup for plain named abilities — M.ability grants, weaponChoice/abilityChoice results,
// abilityPool picks. Mirrors addCatalogAbility's name-based dedup (below) so the same ability granted
// twice from different sources (e.g. both an origin and a career giving "Грамота") never creates a
// second entry. Returns whether it actually added anything, so callers can skip logging a no-op.
function grantAbility(c, name, text, source){
  if(c.abilities.some(a=>a.name===name)) return false;
  c.abilities.push({id:uid(), name, text, source, userNote:''});
  return true;
}
// A choiceMixed bundle is redundant when every ability it would grant is already owned — offering it
// would waste the pick (manual) or the roll (random) on nothing new. Bundles are still offered if they
// mix a new ability with an already-owned one (or have no abilities at all, just stat bonuses): the
// stat bonus or the new ability is still worth having, and grantAbility's dedup silently no-ops the
// already-owned part rather than duplicating it.
function isBundleRedundant(c, bundle){
  const abilityMods = bundle.filter(m=>m.t==='ability');
  return abilityMods.length>0 && abilityMods.every(m=>c.abilities.some(a=>a.name===m.name));
}

function addCatalogAbility(c, name, source, group, tier=''){
  // Dedup by name alone (not name+source): reconcileMysticUnlocks re-checks eligibility on every
  // level/career/origin batch and may call this again for an already-granted ability with a
  // different `source` string as the character progresses — name-based dedup prevents duplicates.
  // Returns whether it actually added anything, so callers can log real grants without duplicating
  // a log entry on every no-op re-check (reconcileMysticUnlocks runs on every level/career/origin).
  if(c.abilities.some(a=>a.name===name)) return false;
  c.abilities.push({id:uid(),name,text:ABILITY_TEXT_LOOKUP[name]||'',source,userNote:'',abilityGroup:group,abilitySource:source,abilityTier:tier});
  return true;
}
function queueCatalogPick(c, source, group, options, count, auto, onDone){
  // Filter out anything the character already has (e.g. a career already granted "Считка личности"
  // outright via M.psiGrant) — offering an already-owned ability here would waste the pick on nothing
  // new: in random mode addCatalogAbility's dedup would silently no-op it, and in manual mode the
  // player could knowingly pick something they can already use for free, for no benefit.
  options = options.filter(o=>!c.abilities.some(a=>a.name===o));
  // auto=true resolves immediately with random picks (no dangling pendingChoices left behind when
  // the player is generating in "🎲 Режим: случайный") — mirrors how every other choice-type mod
  // (case 'choice', 'distribute', etc.) behaves for the same flag; auto=false queues one manual pick
  // at a time exactly as before.
  if(auto){
    const picked = []; let pool = options.slice();
    for(let i=0;i<count && pool.length;i++){
      const o = pick(pool);
      addCatalogAbility(c,o,source,group,group);
      picked.push(o);
      pool = pool.filter(x=>x!==o);
    }
    if(picked.length) logEvent(c, `Способности получены случайно (${group}): ${picked.join(', ')}.`);
    if(onDone) onDone();
    return;
  }
  if(!options.length){ if(onDone) onDone(); return; } // nothing new left to offer
  const chosen=new Set();
  const ask=()=>{
    if(chosen.size>=count || chosen.size>=options.length){ if(onDone) onDone(); return; }
    pendingChoices.push({id:uid(),source,title:`${group}: выберите способность (${chosen.size+1}/${Math.min(count,options.length)})`,options:options.filter(o=>!chosen.has(o)).map(o=>({label:o,apply:ch=>{chosen.add(o);addCatalogAbility(ch,o,source,group,group);ask();}}))});
  };
  ask();
}
// Disciplines where the character owns at least one ability from the given tier — used to gate the
// next tier up (стр. 111: each discipline's tiers are learned in order). `c.psiDisciplines` alone
// isn't enough for this: it just marks a discipline as "started" (pushed the moment it's chosen, even
// before any ability from it is actually granted), so using it directly let a high-level character's
// generation offer a Сильная pick in a discipline that only had a Тривиальная — or none yet at all.
function psiDisciplinesWithTier(c, tier){
  return Object.keys(PSI_ABILITY_CATALOG).filter(d=>(PSI_ABILITY_CATALOG[d][tier]||[]).some(n=>c.abilities.some(a=>a.name===n)));
}
// Whether the character owns any ability at all from this discipline, at any tier — the correct test
// for "is this discipline actually new to them", as opposed to `c.psiDisciplines.includes(d)` which
// can be true slightly ahead of any ability existing (see above).
function psiDisciplineStarted(c, d){
  return Object.values(PSI_ABILITY_CATALOG[d]).some(arr=>arr.some(n=>c.abilities.some(a=>a.name===n)));
}
function allPsiOptions(disciplines, tier){
  return disciplines.flatMap(d=>Object.entries(PSI_ABILITY_CATALOG[d]||{}).filter(([k])=>k===tier).flatMap(([,v])=>v.map(name=>({name,discipline:d,tier}))));
}
function addShamanConnection(c, connection, source){
  // Only records the connection + grants the 3 abilities every shaman knows from level 0 (p.208).
  // Connection-specific abilities are NOT dumped here — they unlock gradually as мистика rises,
  // via reconcileMysticUnlocks (called after every level/career/origin batch, see applyModifierList).
  c.shamanConnection=connection;
  c.shamanConnectionSource=source; // stable source tag so later-unlocked abilities share it (cleanup on subtype/archetype switch)
  const granted = SHAMAN_GENERAL_ABILITIES.filter(n=>addCatalogAbility(c,n,source,'Шаманизм (общее, ур.0+)','Общие'));
  if(granted.length) logEvent(c, `Общие способности шамана получены (${source}): ${granted.join(', ')}.`);
  reconcileMysticUnlocks(c, source);
}
function addCultReligion(c,religion,source){
  // Only records the religion — group unlocks (Послушание/Молитва/Культовый символ/Катарсис) are
  // gated by level via reconcileMysticUnlocks, not granted all at once (see p.107: "каждая следующая
  // категория открывается постепенно, с ростом уровня культиста").
  c.cultReligion=religion; c.religion=religion;
  c.cultReligionSource=source; // stable source tag so later-unlocked groups share it (cleanup on subtype/archetype switch)
  reconcileMysticUnlocks(c, source);
}
// Re-checks, on every level/career/origin application, whether the character's current level (for
// cultist religion groups) or мистика (for shaman connection tiers) newly qualifies them for more of
// their already-chosen religion/connection's named abilities — and grants exactly those, no more.
// This is the core fix for "future abilities shown as already obtained": nothing here is ever granted
// ahead of the book's own unlock condition, and addCatalogAbility's name-based dedup keeps re-checks safe.
function reconcileMysticUnlocks(c, source){
  if(c.cultReligion){
    const cat = CULTIST_ABILITY_CATALOG[c.cultReligion] || {};
    const src = c.cultReligionSource || source;
    Object.entries(cat).forEach(([group,names])=>{
      const reqLevel = CULT_GROUP_LEVEL[group];
      if(reqLevel!==undefined && c.level>=reqLevel){
        const granted = names.filter(n=>addCatalogAbility(c,n,src,c.cultReligion,group));
        if(granted.length) logEvent(c, `Способности культа открыты (${c.cultReligion} → ${group}, ур.${reqLevel}): ${granted.join(', ')}.`);
      }
    });
    // Катарсис (Мать-Природа): a one-time choiceMixed pick between the 3 mutation paths (see
    // MOTHER_NATURE_CATHARSIS_BUNDLES above), not a flat ability list like every other religion's
    // Катарсис — triggered once via a character-side flag so re-running this function on every later
    // level/career batch doesn't queue the choice again. Uses its own source suffix (still prefixed by
    // src, so a full religion/archetype switch's removeBonusesBySource(src) still cleans it up too) so
    // a level-down can prune just this mutation without touching Послушание/Молитва/Культовый символ.
    if(c.cultReligion==='Поклонение Матери-Природе' && c.level>=CULT_GROUP_LEVEL['Катарсис'] && !c._motherNatureCatharsisTriggered){
      c._motherNatureCatharsisTriggered = true;
      applyModifier(c, M.choiceMixed(MOTHER_NATURE_CATHARSIS_BUNDLES), src+' → катарсис-мутация', randomMode);
    }
  }
  if(c.shamanConnection){
    const cat = SHAMAN_ABILITY_CATALOG[c.shamanConnection] || {};
    const src = c.shamanConnectionSource || source;
    Object.entries(cat).forEach(([tier,names])=>{
      const reqMist = SHAMAN_TIER_MISTIKA[tier];
      if(reqMist!==undefined && c.stats.mistika>=reqMist){
        const granted = names.filter(n=>addCatalogAbility(c,n,src,c.shamanConnection,tier));
        if(granted.length) logEvent(c, `Способности шамана открыты (${c.shamanConnection} → ${tier}): ${granted.join(', ')}.`);
      }
    });
  }
}

// Мистика — знание нового мира только для мистических архетипов: у всех остальных её убирают из вариантов
// ВЫБОРА в бонусах карьеры, происхождения, архетипа и подтипа (по архетипу самого персонажа — карьера и
// происхождение не привязаны к одному архетипу). Фиксированный «+мистика» и специализации не трогаются; если мистика —
// единственный вариант, выбор остаётся как есть.
const MYSTIC_ARCHETYPES = ['kultist','shaman','psionik'];
function withoutMistikaChoice(c, mod, source){
  if(!c || MYSTIC_ARCHETYPES.indexOf(c.archetypeKey)>=0 || !/^(Карьера|Происхождение|Архетип|Подтип): /.test(source||'')) return mod;
  if(mod.t==='choice'){
    const options = mod.options.filter(o=>o.stat!=='mistika');
    return options.length && options.length<mod.options.length ? Object.assign({}, mod, {options}) : mod;
  }
  if((mod.t==='distribute' || mod.t==='reduceDistinct' || mod.t==='roleplay') && Array.isArray(mod.among)){
    const among = mod.among.filter(s=>s!=='mistika');
    return among.length && among.length<mod.among.length ? Object.assign({}, mod, {among}) : mod;
  }
  return mod;
}
function applyModifier(c, mod, source, auto){
  mod = withoutMistikaChoice(c, mod, source);
  switch(mod.t){
    case 'fixed': {
      addLog(c, mod.stat, mod.delta, source);
      logEvent(c, `${STAT_LABELS[mod.stat]} ${mod.delta>0?'+':''}${mod.delta} (${source}) → сейчас ${c.stats[mod.stat]}.`);
      break;
    }
    case 'choice': {
      if(auto){
        const opt = pick(mod.options);
        addLog(c, opt.stat, opt.delta, source+' (выбор)');
        logEvent(c, `${STAT_LABELS[opt.stat]} ${opt.delta>0?'+':''}${opt.delta} (${source}, случайный выбор) → сейчас ${c.stats[opt.stat]}.`);
      } else {
        pendingChoices.push({
          id: uid(), source, title: `${source}: выберите бонус`,
          options: mod.options.map(o=>({
            label: `${STAT_LABELS[o.stat]} ${o.delta>0?'+':''}${o.delta}`,
            apply: (ch)=> addLog(ch, o.stat, o.delta, source+' (выбор игрока)')
          }))
        });
      }
      break;
    }
    case 'choiceMixed': {
      // Filter out bundles that would grant nothing new (see isBundleRedundant) before offering, in
      // both modes — a bundle that mixes a new ability with an already-owned one is still offered,
      // since grantAbility's dedup safely no-ops just the already-owned part when it's applied.
      const available = mod.options.filter(bundle=>!isBundleRedundant(c, bundle));
      const pool = available.length ? available : mod.options; // everything redundant — still offer rather than leave nothing to pick; grants will just no-op
      if(auto){
        const bundle = pick(pool);
        bundle.forEach(m2 => applyModifier(c, m2, source+' (выбор)', auto));
      } else {
        pendingChoices.push({
          id: uid(), source, title: `${source}: выберите вариант`,
          options: pool.map(bundle=>({
            label: describeBundle(bundle),
            apply: (ch)=> bundle.forEach(m2 => applyModifier(ch, m2, source+' (выбор игрока)', randomMode))
          }))
        });
      }
      break;
    }
    case 'distribute': {
      if(auto){
        let pts = mod.points; const used = {};
        let pool = mod.among.slice();
        while(pts>0 && pool.length){
          const s = pick(pool);
          used[s] = (used[s]||0)+1;
          addLog(c, s, 1, source+' (распределение)');
          pts--;
          if(used[s] >= mod.maxPer) pool = pool.filter(x=>x!==s);
        }
        const summary = Object.entries(used).map(([s,n])=>`${STAT_LABELS[s]} +${n}`).join(', ');
        if(summary) logEvent(c, `Случайное распределение очков (${source}): ${summary}.`);
      } else {
        queueDistributeManual(source, mod.points, mod.among, mod.maxPer);
      }
      break;
    }
    case 'reduceDistinct': {
      if(auto){
        let pool = mod.among.slice(); let count = mod.count;
        const chosen = [];
        while(count>0 && pool.length){
          const s = pick(pool);
          addLog(c, s, mod.delta, source+' (снижение)');
          chosen.push(STAT_LABELS[s]);
          pool = pool.filter(x=>x!==s);
          count--;
        }
        if(chosen.length) logEvent(c, `Случайное снижение характеристик (${source}): ${chosen.join(', ')} (${mod.delta>0?'+':''}${mod.delta} каждой).`);
      } else {
        queueReduceDistinctManual(source, mod.count, mod.among, mod.delta);
      }
      break;
    }
    case 'weaponChoice': {
      if(c.abilities.some(a=>a.name===mod.label)) break; // already have this named ability — nothing new any option here could grant
      if(auto){
        const stat = pick(mod.among);
        grantAbility(c, mod.label, `Атака оружием категории «${STAT_LABELS[stat]}» получает модификатор +3.`, source);
        logEvent(c, `Способность получена случайно (${source}): «${mod.label}» (категория: ${STAT_LABELS[stat]}).`);
      } else {
        pendingChoices.push({
          id: uid(), source, title: `${mod.label} (${source})`,
          options: mod.among.map(stat=>({
            label: STAT_LABELS[stat],
            apply: (ch)=> grantAbility(ch, mod.label, `Атака оружием категории «${STAT_LABELS[stat]}» получает модификатор +3.`, source)
          }))
        });
      }
      break;
    }
    case 'abilityChoice': {
      if(c.abilities.some(a=>a.name===mod.name)) break; // already have this named ability — nothing new any option here could grant
      if(auto){
        const stat = pick(mod.among);
        grantAbility(c, mod.name, mod.textFn(STAT_LABELS[stat]), source);
        logEvent(c, `Способность получена случайно (${source}): «${mod.name}» (категория: ${STAT_LABELS[stat]}).`);
      } else {
        pendingChoices.push({
          id: uid(), source, title: `${mod.name} (${source})`,
          options: mod.among.map(stat=>({
            label: STAT_LABELS[stat],
            apply: (ch)=> grantAbility(ch, mod.name, mod.textFn(STAT_LABELS[stat]), source)
          }))
        });
      }
      break;
    }
    case 'mysticPick': {
      if(mod.kind==='psi4'){
        const disciplines=Object.keys(PSI_ABILITY_CATALOG);
        // isAuto is threaded through explicitly (not read from the outer `auto` closure) because this
        // same `choose` runs from two different contexts: the immediate auto-roll below, and later,
        // once per manual pick, from inside a pendingChoices button's apply() — at that point we're
        // always still in manual mode, regardless of what `auto` happened to be when the case first ran.
        const choose=(ch,d,isAuto)=>{
          if(!ch.psiDisciplines.includes(d)) ch.psiDisciplines.push(d);
          const opts=PSI_ABILITY_CATALOG[d]['Тривиальные']||[];
          queueCatalogPick(ch,source,`Псионик → ${d} → Тривиальные`,opts,2,isAuto);
        };
        if(auto){ const d=pick(disciplines); logEvent(c, `Пси-дисциплина выбрана случайно (${source}): «${d}».`); choose(c,d,true); }
        else pendingChoices.push({id:uid(),source,title:'Псионик: выберите пси-дисциплину',options:disciplines.map(d=>({label:d,apply:ch=>choose(ch,d,false)}))});
      } else if(mod.kind==='psi8'){
        const buildOptions = (ch)=>{
          const startedTrivial=psiDisciplinesWithTier(ch,'Тривиальные');
          const opts=[];
          startedTrivial.forEach(d=>(PSI_ABILITY_CATALOG[d]['Средние']||[]).filter(n=>!ch.abilities.some(a=>a.name===n)).forEach(n=>opts.push({label:`Средняя → ${d}: ${n}`,type:'medium',d,n})));
          Object.keys(PSI_ABILITY_CATALOG).filter(d=>!psiDisciplineStarted(ch,d)).forEach(d=>opts.push({label:`Новая дисциплина → ${d} (2 тривиальные)`,type:'new',d}));
          return opts;
        };
        const choose=(ch,o,isAuto)=>{
          if(o.type==='medium'){
            addCatalogAbility(ch,o.n,source,o.d,'Средние');
            if(isAuto) logEvent(ch, `Пси-способность получена случайно (${source}): «${o.n}» (${o.d}, средняя).`);
          } else {
            if(!ch.psiDisciplines.includes(o.d)) ch.psiDisciplines.push(o.d);
            if(isAuto) logEvent(ch, `Новая пси-дисциплина выбрана случайно (${source}): «${o.d}».`);
            queueCatalogPick(ch,source,`Псионик → ${o.d} → Тривиальные`,PSI_ABILITY_CATALOG[o.d]['Тривиальные']||[],2,isAuto);
          }
        };
        if(auto){
          const options=buildOptions(c);
          if(options.length) choose(c,pick(options),true);
        } else if(buildOptions(c).length){
          // Options are rebuilt fresh on every render (see renderPending) rather than baked in once
          // here: generating straight to a high level applies every level's mods in one synchronous
          // batch, so this pick can be queued before an EARLIER level's own discipline pick (psi4) has
          // actually been resolved by the player yet. Recomputing at render/click time means it always
          // reflects what's true by then — instead of permanently offering a discipline as "new" that
          // the player is about to start elsewhere, or hiding a medium option that becomes available
          // the moment the earlier pick lands.
          pendingChoices.push({id:uid(),source,title:'Псионик: развитие пси-дисциплины',rebuildOptions:(ch)=>buildOptions(ch).map(o=>({label:o.label,apply:ch2=>choose(ch2,o,false)}))});
        }
      } else if(mod.kind==='psi11'){
        // Book (стр. 111, "Уровень 12" — and the identical archetype-level wording): "Персонаж получает
        // 1 сильную пси-способность из уже известных ему пси-дисциплин" — "known discipline" here just
        // means the character has ANY ability there already (even only a Тривиальная), not specifically
        // a Средняя. (Correcting an earlier over-strict reading that required a medium ability first.)
        const buildOptions = (ch)=>allPsiOptions(psiDisciplinesWithTier(ch,'Тривиальные'),'Сильные').filter(o=>!ch.abilities.some(a=>a.name===o.name));
        if(auto){
          const options=buildOptions(c);
          if(options.length){
            const o=pick(options); addCatalogAbility(c,o.name,source,o.discipline,'Сильные');
            logEvent(c, `Сильная пси-способность получена случайно (${source}): «${o.name}» (${o.discipline}).`);
          }
        } else if(buildOptions(c).length){
          // Rebuilt fresh each render (see renderPending) so it stays correct if this pick was queued
          // before an earlier discipline pick it depends on has actually been resolved.
          pendingChoices.push({id:uid(),source,title:'Псионик: выберите сильную пси-способность',rebuildOptions:(ch)=>buildOptions(ch).map(o=>({label:`${o.discipline}: ${o.name}`,apply:ch2=>addCatalogAbility(ch2,o.name,source,o.discipline,'Сильные')}))});
        }
      } else if(mod.kind==='shaman0'){
        const connections=Object.keys(SHAMAN_ABILITY_CATALOG);
        const choose=(ch,d,isAuto)=>{ addShamanConnection(ch,d,source); if(isAuto) logEvent(ch, `Тип связи с Асу выбран случайно (${source}): «${d}».`); };
        if(auto) choose(c,pick(connections),true);
        else pendingChoices.push({id:uid(),source,title:'Шаман: выберите тип связи с Асу',options:connections.map(d=>({label:d,apply:ch=>choose(ch,d,false)}))});
      } else if(mod.kind==='cult1'){
        const religions=CULTIST_RELIGIONS;
        const choose=(ch,r,isAuto)=>{ addCultReligion(ch,r,source); if(isAuto) logEvent(ch, `Религия выбрана случайно (${source}): «${r}».`); };
        if(auto) choose(c,pick(religions),true);
        else pendingChoices.push({id:uid(),source,title:'Культист: выберите религию',options:religions.map(r=>({label:r,apply:ch=>choose(ch,r,false)}))});
      } else if(mod.kind==='specDisciplineEntry'){
        // Used by the "Развитые ... навыки" specializations (стр. 124-125): if the character doesn't
        // yet know this specific pси-discipline, they open it and learn 2 trivial abilities from it;
        // if they already know it, they instead learn 1 medium ability from it. Discipline is fixed
        // by the specialization (mod.data.discipline), unlike the free-choice psi4/psi8 archetype picks.
        const d = mod.data.discipline;
        const alreadyKnown = psiDisciplinesWithTier(c,'Тривиальные').includes(d);
        if(alreadyKnown){
          const buildOptions = (ch)=>(PSI_ABILITY_CATALOG[d]['Средние']||[]).filter(n=>!ch.abilities.some(a=>a.name===n));
          const choose=(ch,n,isAuto)=>{ addCatalogAbility(ch,n,source,d,'Средние'); if(isAuto) logEvent(ch,`Пси-способность получена случайно (${source}): «${n}» (${d}, средняя).`); };
          if(auto){ const options=buildOptions(c); if(options.length) choose(c,pick(options),true); }
          else if(buildOptions(c).length) pendingChoices.push({id:uid(),source,title:`${d}: выберите среднюю пси-способность`,rebuildOptions:(ch)=>buildOptions(ch).map(n=>({label:n,apply:ch2=>choose(ch2,n,false)}))});
        } else {
          if(!c.psiDisciplines.includes(d)) c.psiDisciplines.push(d);
          queueCatalogPick(c,source,`${d} → Тривиальные`,PSI_ABILITY_CATALOG[d]['Тривиальные']||[],2,auto);
        }
      } else if(mod.kind==='specDisciplineMedium'){
        // Tier 2 of the same specializations: an unconditional 1 medium pick from the (by then
        // guaranteed-known, since tier 1 is always resolved first — see computeSlotOptions) discipline.
        const d = mod.data.discipline;
        const buildOptions = (ch)=>(PSI_ABILITY_CATALOG[d]['Средние']||[]).filter(n=>!ch.abilities.some(a=>a.name===n));
        const choose=(ch,n,isAuto)=>{ addCatalogAbility(ch,n,source,d,'Средние'); if(isAuto) logEvent(ch,`Пси-способность получена случайно (${source}): «${n}» (${d}, средняя).`); };
        if(auto){ const options=buildOptions(c); if(options.length) choose(c,pick(options),true); }
        else if(buildOptions(c).length) pendingChoices.push({id:uid(),source,title:`${d}: выберите среднюю пси-способность`,rebuildOptions:(ch)=>buildOptions(ch).map(n=>({label:n,apply:ch2=>choose(ch2,n,false)}))});
      } else if(mod.kind==='kapellan1'){
        // Специализация «Капеллан» (стр. 122), ступень 1: resolved against "Культовый символ" (стр.
        // 198) of the character's faith. Cultists use whichever religion they actually follow
        // (c.cultReligion). A shaman-знахарь has no cultReligion in this data model (that's a
        // cultist-only mechanic) — but per the book's own associations, a знахарь's practice centers on
        // the same духи жизни Асу a "Вера в духов жизни Асу" cultist follows, so their faith is treated
        // as fixed to that religion here rather than left unresolved. Only that religion's Культовый
        // символ group applies — a знахарь never gets Послушание/Молитва/Катарсис from it, since those
        // are the cultist archetype's own separate devotion mechanic, not part of what Капеллан grants.
        // Grants every Культовый символ ability not yet known (not just one) — a знахарь has no other
        // path to the second one (cultists would eventually get both anyway via their own religion
        // reaching ур.11 — see reconcileMysticUnlocks — so this just grants both outright either way).
        const effectiveReligion = c.cultReligion || (c.archetypeKey==='shaman' && c.subtypeKey==='znahar' ? 'Вера в духов жизни Асу' : null);
        if(effectiveReligion){
          const symbolAbilities = (CULTIST_ABILITY_CATALOG[effectiveReligion] && CULTIST_ABILITY_CATALOG[effectiveReligion]['Культовый символ']) || [];
          const missing = symbolAbilities.filter(n=>!c.abilities.some(a=>a.name===n));
          if(missing.length){
            missing.forEach(n=>addCatalogAbility(c,n,source,effectiveReligion,'Культовый символ (капеллан)'));
            if(auto) logEvent(c, `Капеллан: способности культового символа получены (${source}): ${missing.join(', ')}.`);
          } else {
            addCatalogAbility(c,'Чудо веры',source,effectiveReligion,'Капеллан');
            logEvent(c, `Капеллан (${source}): персонаж уже владеет всеми способностями культового символа — получена способность «Чудо веры».`);
          }
        } else {
          // Safety net only — shouldn't be reachable given the specialization's own requirement check
          // (only cultists and shaman-знахарь can take Капеллан in the first place).
          c.notes.push({text:'Капеллан: персонаж должен получить одну способность культового символа своей веры (см. стр. 198) или, если владеет всеми, способность «Чудо веры» — не удалось определить веру персонажа, внесите способность вручную по книге.', source});
          logEvent(c, `Требуется выбор игрока (${source}): способность капеллана — не удалось определить веру, см. заметки.`);
        }
      }
      break;
    }
    case 'abilityPool': {
      const opts=(mod.options||[]).filter(o=>!c.abilities.some(a=>a.name===(o.name||o)));
      const add=(ch,o)=>{
        const name = o.name||o;
        if(ch.abilities.some(a=>a.name===name)) return; // guards against duplicate names within opts itself
        ch.abilities.push({id:uid(),name,text:o.text||'',source, userNote:'', abilityGroup:mod.group, abilitySource:mod.meta.sourceLabel||mod.source||source, abilityTier:o.tier||mod.meta.tier||''});
      };
      if(auto){
        const picked = opts.slice().sort(()=>Math.random()-.5).slice(0,Math.min(mod.count,opts.length));
        picked.forEach(o=>add(c,o));
        if(picked.length) logEvent(c, `Способности получены случайно (${mod.group}): ${picked.map(o=>o.name||o).join(', ')}.`);
      }
      else { const chosen=new Set(); const ask=()=>{ if(chosen.size>=Math.min(mod.count,opts.length))return; pendingChoices.push({id:uid(),source,title:`${mod.group}: выберите способность (${chosen.size+1}/${Math.min(mod.count,opts.length)})`,options:opts.filter(o=>!chosen.has(o.name||o)).map(o=>({label:o.name||o,apply:ch=>{chosen.add(o.name||o);add(ch,o);ask();}}))});}; ask(); }
      break;
    }
    case 'roleplay': {
      if(roleplayRandom && mod.among && mod.among.length){
        let pool = mod.among.slice();
        if(/не самому высокому|не самое высокое|не самого высокого/i.test(mod.label)){ const mx = Math.max.apply(null, pool.map(st=>c.stats[st]||0)); const lower = pool.filter(st=>(c.stats[st]||0) < mx); if(lower.length) pool = lower; }
        const stat = pool[Math.floor(Math.random()*pool.length)];
        addLog(c, stat, 1, source+' (отыгрыш — случайно)');
        logEvent(c, `Отыгрыш (случайно): «${mod.label}» → ${STAT_LABELS[stat] || stat} +1 (источник: ${source}).`);
        break;
      }
      pendingRoleplayChoices.push({
        id: 'rp'+Math.random().toString(36).slice(2),
        label: mod.label, among: mod.among, source
      });
      break;
    }
    case 'ability': {
      if(grantAbility(c, mod.name, mod.text, source)) logEvent(c, `Способность получена (${source}): «${mod.name}».`);
      break;
    }
    case 'psiGrant': {
      let discipline=null, tier=null;
      for(const d of Object.keys(PSI_ABILITY_CATALOG)){
        for(const t of Object.keys(PSI_ABILITY_CATALOG[d])){
          if(PSI_ABILITY_CATALOG[d][t].includes(mod.name)){ discipline=d; tier=t; break; }
        }
        if(discipline) break;
      }
      if(discipline){
        if(!c.psiDisciplines.includes(discipline)) c.psiDisciplines.push(discipline);
        if(addCatalogAbility(c, mod.name, source, discipline, tier)) logEvent(c, `Пси-способность получена (${source}): «${mod.name}» (${discipline}, ${tier}).`);
      } else {
        // Data-integrity guard, not a normal runtime path: every M.psiGrant() call in this file names
        // an ability that exists in PSI_ABILITY_CATALOG, so this only fires if that ever drifts out of
        // sync — better a visible journal entry than a silently missing ability.
        logEvent(c, `Внимание: не удалось найти пси-способность «${mod.name}» в каталоге (${source}).`);
      }
      break;
    }
    case 'psiGrantOrEnhance': {
      // Сама архетипная способность (лор-текст) — как и раньше, отдельная строка через grantAbility.
      if(grantAbility(c, mod.name, mod.text, source)) logEvent(c, `Способность получена (${source}): «${mod.name}».`);
      // Дальше — механика: найти каталожную способность (см. комментарий у M.psiGrantOrEnhance) и
      // либо выдать её (тот же поиск дисциплины/ступени, что и у psiGrant выше), либо, если персонаж
      // уже ею владеет, просто пометить усиленной — addCatalogAbility сам не выдаст дубликат (дедуп по
      // имени), поэтому здесь достаточно проверить исход её вызова, не результат заранее.
      let discipline=null, tier=null;
      for(const d of Object.keys(PSI_ABILITY_CATALOG)){
        for(const t of Object.keys(PSI_ABILITY_CATALOG[d])){
          if(PSI_ABILITY_CATALOG[d][t].includes(mod.psiName)){ discipline=d; tier=t; break; }
        }
        if(discipline) break;
      }
      if(discipline){
        const hadAlready = c.abilities.some(a=>a.name===mod.psiName);
        if(!c.psiDisciplines.includes(discipline)) c.psiDisciplines.push(discipline);
        if(addCatalogAbility(c, mod.psiName, source, discipline, tier)){
          logEvent(c, `Пси-способность получена (${source}): «${mod.psiName}» (${discipline}, ${tier}).`);
        } else if(hadAlready){
          logEvent(c, `Пси-способность «${mod.psiName}» усилена благодаря «${mod.name}» (${source}).`);
        }
        const psiEntry = c.abilities.find(a=>a.name===mod.psiName);
        if(psiEntry){ psiEntry.enhancedText = mod.enhanceText; psiEntry.enhancedSource = mod.name; }
      } else {
        // Тот же страховочный лог, что и у psiGrant — сигнал, что psiName разошёлся с каталогом.
        logEvent(c, `Внимание: не удалось найти пси-способность «${mod.psiName}» в каталоге (${source}).`);
      }
      break;
    }
    case 'item': {
      addGeneratedInventoryItem(c, mod.text, source);
      logEvent(c, `Предмет получен (${source}): «${mod.text}».`);
      break;
    }
    case 'religion': c.notes.push({text:'Религия ('+source+'): требует выбора из '+mod.options.join(', '), source}); break;
    case 'note': c.notes.push({text:mod.text, source}); break;
    case 'appearance': {
      c.appearanceLog.push({source, delta: mod.delta});
      c.appearance += mod.delta;
      logEvent(c, `Внешний вид ${mod.delta>0?'+':''}${mod.delta} (${source}) → сейчас ${c.appearance}.`);
      break;
    }
    case 'size': {
      c.sizeLog.push({source, delta: mod.delta});
      c.size += mod.delta;
      logEvent(c, `Размер ${mod.delta>0?'+':''}${mod.delta} (${source}) → сейчас ${c.size}.`);
      break;
    }
    case 'psiSoprot': {
      c.psiSoprotLog.push({source, delta: mod.delta});
      c.psiSoprot += mod.delta;
      logEvent(c, `Пси-сопротивление ${mod.delta>0?'+':''}${mod.delta} (${source}) → сейчас ${c.psiSoprot}.`);
      break;
    }
    case 'bonusHpMax': {
      c.bonusHpMaxLog.push({source, delta: mod.delta});
      c.bonusHpMax += mod.delta;
      logEvent(c, `Максимум ОЗ ${mod.delta>0?'+':''}${mod.delta} (${source}) → бонус сейчас ${c.bonusHpMax}.`);
      break;
    }
    case 'bonusPsiMax': {
      c.bonusPsiMaxLog.push({source, delta: mod.delta});
      c.bonusPsiMax += mod.delta;
      logEvent(c, `Максимум пси ${mod.delta>0?'+':''}${mod.delta} (${source}) → бонус сейчас ${c.bonusPsiMax}.`);
      break;
    }
    case 'table': {
      const row = rollTable(mod.rows, mod.diceMax);
      // Deformities/madness are forced consequences — per rules they always apply, and the user
      // asked that they land in Недостатки even when this pushes the character over the age-based cap.
      c.flaws.push({id:uid(), text: mod.label+': '+row.text, source, forced:true});
      logEvent(c, `Случайный бросок «${mod.label}» (${source}): ${row.text}.`);
      if(row.app){
        c.appearanceLog.push({source, delta: row.app});
        c.appearance += row.app;
        logEvent(c, `Внешний вид ${row.app>0?'+':''}${row.app} (${mod.label}: ${source}) → сейчас ${c.appearance}.`);
      }
      break;
    }
    case 'itemTable': {
      const resolveRow = (ch, row) => {
        const itemId = uid();
        if(row.credits !== undefined){
          const amt = typeof row.credits==='function' ? row.credits() : row.credits;
          ch.creditsLog.push({source, amount:amt, itemId: row.creditsOnly ? null : itemId});
          ch.credits += amt;
          logEvent(ch, `Кредиты +${amt} (${mod.label}: ${source}) → всего ${ch.credits}.`);
        }
        if(!row.creditsOnly){
          addGeneratedInventoryItem(ch, row.text, source, {fromTable:{label:mod.label, diceMax:mod.diceMax}, id:itemId});
        }
      };
      if(auto){
        for(let i=0;i<mod.rolls;i++){
          const row = rollTable(mod.rows, mod.diceMax);
          resolveRow(c, row);
          if(!row.creditsOnly) logEvent(c, `Предмет получен случайно по таблице «${mod.label}» (${source}): ${row.text}.`);
        }
      } else {
        for(let i=0;i<mod.rolls;i++){
          pendingItemRolls.push({
            id: uid(), source, title: `${mod.label} (${source}): выберите предмет`,
            options: mod.rows.map(row=>({
              label: row.text,
              apply: (ch)=> resolveRow(ch, row)
            }))
          });
        }
      }
      break;
    }
    case 'credits': {
      const amount = typeof mod.amount==='function' ? mod.amount() : mod.amount;
      c.creditsLog.push({source, amount});
      c.credits += amount;
      logEvent(c, `Кредиты +${amount} (${mod.label || source}) → всего ${c.credits}.`);
      break;
    }
    case 'itemBundle': {
      const applyFixedAndCredits = (ch, row) => {
        if(row.credits !== undefined){
          const amt = typeof row.credits==='function' ? row.credits() : row.credits;
          ch.creditsLog.push({source, amount:amt});
          ch.credits += amt;
          logEvent(ch, `Кредиты +${amt} (${mod.label}: ${source}) → всего ${ch.credits}.`);
        }
        (row.fixed||[]).forEach(it=>{
          addKnownWeightItem(ch, it.name, it.weight, source);
        });
      };
      const resolveSubChoice = (ch, row) => {
        if(!row.choice || !row.choice.length) return;
        if(randomMode){
          const it = pick(row.choice);
          addKnownWeightItem(ch, it.name, it.weight, source);
        } else {
          pendingItemRolls.push({
            id: uid(), source, title: `${mod.label} (${source}): довыберите один предмет из набора`,
            options: row.choice.map(it=>({
              label: `${it.name} (вес: ${it.weight})`,
              apply: (ch2)=> addKnownWeightItem(ch2, it.name, it.weight, source)
            }))
          });
        }
      };
      if(auto){
        for(let i=0;i<mod.rolls;i++){
          const row = rollTable(mod.rows, mod.diceMax);
          applyFixedAndCredits(c, row);
          resolveSubChoice(c, row);
          logEvent(c, `Набор снаряжения получен случайно по таблице «${mod.label}» (${source}): ${describeBundleRow(row)}.`);
        }
      } else {
        for(let i=0;i<mod.rolls;i++){
          pendingItemRolls.push({
            id: uid(), source, title: `${mod.label} (${source}): выберите набор снаряжения`,
            options: mod.rows.map(row=>({
              label: describeBundleRow(row),
              apply: (ch)=> { applyFixedAndCredits(ch, row); resolveSubChoice(ch, row); }
            }))
          });
        }
      }
      break;
    }
    case 'itemSet': {
      mod.items.forEach(entry=>{
        if(entry.choice){
          if(randomMode){
            const it = pick(entry.choice);
            addKnownWeightItem(c, it.name, it.weight, source);
            logEvent(c, `Предмет получен случайно (${source}): «${it.name}».`);
          } else {
            pendingItemRolls.push({
              id: uid(), source, title: `${source}: выберите один из вариантов`,
              options: entry.choice.map(it=>({
                label: `${it.name} (вес: ${it.weight})`,
                apply: (ch)=> addKnownWeightItem(ch, it.name, it.weight, source)
              }))
            });
          }
        } else {
          addKnownWeightItem(c, entry.name, entry.weight, source);
          logEvent(c, `Предмет получен (${source}): «${entry.name}».`);
        }
      });
      break;
    }
  }
}

function applyModifierList(c, mods, source, auto){
  mods.forEach(m => applyModifier(c, m, source, auto));
  // Re-check mystic (cultist/shaman) ability unlocks after every batch — level-up, career, origin —
  // since any of these can change c.level or c.stats.mistika, the two gating values. Cheap no-op if
  // the character isn't a cultist/shaman with a religion/connection chosen yet.
  reconcileMysticUnlocks(c, source);
}

// Reverts every effect previously applied under a given source (or any source starting with it —
// e.g. removing 'Подтип: Вор' also removes 'Подтип: Вор (ур.4)', '(ур.8)', etc.). Used when the
// player switches career/origin/subtype so the old choice's bonuses — random, chosen, or fixed —
// are fully un-applied before the new one is rolled/chosen.
function removeBonusesBySource(c, sourcePrefix){
  ALL_STATS.forEach(s=>{
    let removed = 0;
    c.log[s] = c.log[s].filter(entry=>{
      if(entry.source.startsWith(sourcePrefix)){ removed += entry.delta; return false; }
      return true;
    });
    c.stats[s] -= removed;
  });
  { let removed = 0; c.appearanceLog = c.appearanceLog.filter(e=>{ if(e.source.startsWith(sourcePrefix)){ removed += e.delta; return false; } return true; }); c.appearance -= removed; }
  { let removed = 0; c.sizeLog = c.sizeLog.filter(e=>{ if(e.source.startsWith(sourcePrefix)){ removed += e.delta; return false; } return true; }); c.size -= removed; }
  { let removed = 0; c.psiSoprotLog = c.psiSoprotLog.filter(e=>{ if(e.source.startsWith(sourcePrefix)){ removed += e.delta; return false; } return true; }); c.psiSoprot -= removed; }
  { let removed = 0; c.bonusHpMaxLog = c.bonusHpMaxLog.filter(e=>{ if(e.source.startsWith(sourcePrefix)){ removed += e.delta; return false; } return true; }); c.bonusHpMax -= removed; }
  { let removed = 0; c.bonusPsiMaxLog = c.bonusPsiMaxLog.filter(e=>{ if(e.source.startsWith(sourcePrefix)){ removed += e.delta; return false; } return true; }); c.bonusPsiMax -= removed; }
  { let removed = 0; c.creditsLog = c.creditsLog.filter(e=>{ if(e.source.startsWith(sourcePrefix)){ removed += e.amount; return false; } return true; }); c.credits -= removed; }
  c.abilities = c.abilities.filter(a=>!a.source.startsWith(sourcePrefix));
  c.inventory.backpack = c.inventory.backpack.filter(it=>!it.source.startsWith(sourcePrefix));
  c.inventory.tiny = c.inventory.tiny.filter(it=>!it.source.startsWith(sourcePrefix));
  c.flaws = c.flaws.filter(f=>!f.source.startsWith(sourcePrefix));
  c.notes = c.notes.filter(n=>!(n.source && n.source.startsWith(sourcePrefix)));
  pendingRoleplayChoices = pendingRoleplayChoices.filter(p=>!p.source.startsWith(sourcePrefix));
  pendingChoices = pendingChoices.filter(p=>!(p.source && p.source.startsWith(sourcePrefix)));
  pendingItemRolls = pendingItemRolls.filter(p=>!(p.source && p.source.startsWith(sourcePrefix)));
}

// Applies exactly one more level's worth of bonuses (archetype + subtype) and stops — used instead of
// looping through every level up to the target in one synchronous batch, because that batch approach
// let a later level's psi/mystic pick evaluate against a character state that an EARLIER level's still-
// unresolved pendingChoice hadn't actually reached yet (e.g. a level-11 "pick a strong ability" mod
// deciding there's nothing to offer, because the level-8 medium pick it depends on was still sitting in
// the pending list, unresolved — permanently skipping the level-11 pick since it's only evaluated once).
// Processing one level at a time, and only moving on once that level's pending choices are cleared,
// makes every later level's evaluation see the true, fully-resolved state of everything before it —
// exactly matching how a table-top player actually plays through levels one at a time. Continues
// automatically for as long as a level leaves nothing pending (e.g. pure random-mode levels with no
// roleplay-only choice); stops the moment something needs the player's attention, and resumes itself
// once that's resolved — see the hook at the top of renderAll().
function processNextLevelIfReady(c, fullHealEachStep){
  if(!c || !c._levelUpTarget) return;
  // Ждём только выборов, от которых зависят следующие уровни. Выбор предметов по таблице (стартовое снаряжение
  // и т.п.) живёт в «Инвентаре» и на характеристики не влияет — раньше он молча блокировал повышение уровня.
  if(pendingChoices.length || pendingRoleplayChoices.length) return; // still waiting on the current level
  delete c._lvlCheckpoint; delete c._genCheckpoint; // выборы разобраны — точки восстановления больше не нужны
  if(c.level >= c._levelUpTarget){
    // Target reached. This can happen either on the very first call or, more often, partway through
    // the recursion below — so this is the ONLY reliable place to fire what's supposed to happen once
    // levelling finishes (starting gear from generateCharacter()); a caller checking c.level against
    // c._levelUpTarget AFTER calling this function sees _levelUpTarget already deleted here and never
    // notices target was reached, silently skipping it.
    delete c._levelUpTarget; delete c._levelUpFullHeal;
    if(c._pendingStartingGear){ applyStartingGear(c); delete c._pendingStartingGear; }
    return;
  }
  const oldLevel = c.level;
  const nextLevel = oldLevel + 1;
  const arch = currentArchetype(c);
  const fixedSummary = [];
  // Set c.level to the new value BEFORE applying this level's mods, not after: reconcileMysticUnlocks
  // (called from inside applyModifierList, for cultist Катарсис/Культовый символ/etc. level gating)
  // needs to see the level the character is AT, not the one they're leaving — otherwise a threshold
  // that first becomes true exactly at this level (e.g. reaching level 15 for Катарсис) gets missed on
  // this pass and only fires on some later level's reconcile call instead.
  // Точка восстановления: несделанные выборы ручного режима — функции в памяти, в сохранение они не попадают.
  // Если страницу обновят (или персонажа загрузят) посреди выборов этого уровня, лист вернётся к состоянию
  // до него и предложит выборы уровня заново (см. restoreLevelCheckpoint), а не перескочит через них.
  c._lvlCheckpoint = levelCheckpointOf(c);
  c.level = nextLevel;
  if(arch.baseLevels[nextLevel]){
    const mods = arch.baseLevels[nextLevel];
    const fixed = summarizeFixedMods(mods);
    if(fixed.length) fixedSummary.push(`архетип ур.${nextLevel}: ${fixed.join(', ')}`);
    applyModifierList(c, mods, `Архетип: ${arch.name} (ур.${nextLevel})`, randomMode);
  }
  if(c.subtypeKey){
    const sub = arch.subtypes[c.subtypeKey];
    if(sub.levels[nextLevel]){
      const mods = sub.levels[nextLevel];
      const fixed = summarizeFixedMods(mods);
      if(fixed.length) fixedSummary.push(`подтип «${sub.name}» ур.${nextLevel}: ${fixed.join(', ')}`);
      applyModifierList(c, mods, 'Подтип: '+sub.name+' (ур.'+nextLevel+')', randomMode);
    }
  }
  logEvent(c, `Уровень повышен: ${oldLevel} → ${nextLevel}.`
    + (fixedSummary.length ? ` Фиксированные бонусы: ${fixedSummary.join('; ')}.` : ' Фиксированных бонусов на этом уровне нет.'));
  if(fullHealEachStep){ c.hpCurrent = hpMax(c); c.psiCurrent = psiMax(c); } // freshly-generated character hasn't taken any damage yet
  else reclampVitals(c); // an already-played character keeps its current damage/expenditure, only reclamped if the new max shrank below it
  offerSizeBonusIfEligible(c);
  // Recurse: if THIS level left nothing pending, keep going immediately (matches random-mode's old
  // all-at-once feel when nothing actually needs the player); stops itself the moment something does.
  processNextLevelIfReady(c, fullHealEachStep);
}
// Once per character, ever: if after a level-up Сила or Выносливость is a multiple of 3 and 6+, the
// player gets a one-time offer to increase Размер by 1 — always a real choice (like a roleplay pick,
// never auto-resolved by "случайный" mode) since bigger size trades Скрытность away, not a pure upgrade.
// Increasing size also shifts Сила/Скрытность by it, per the book's own size-change rule (стр. 81).
function offerSizeBonusIfEligible(c){
  if(c._sizeBonusOffered) return;
  const eligible = ['sila','vynoslivost'].find(s=>c.stats[s]%3===0 && c.stats[s]>=6);
  if(!eligible) return;
  c._sizeBonusOffered = true;
  pendingChoices.push({
    id: uid(), source: `Уровень ${c.level}`,
    title: `${STAT_LABELS[eligible]} достигла ${c.stats[eligible]} — разовый шанс увеличить размер персонажа`,
    options: [
      { label: 'Да, увеличить размер на 1', apply: ch => {
        ch.sizeLog.push({source:'Разовый бонус размера (рост характеристик)', delta:1});
        ch.size += 1;
        addLog(ch, 'sila', 1, 'Увеличение размера (бонус характеристик)');
        addLog(ch, 'skrytnost', -1, 'Увеличение размера (бонус характеристик)');
        logEvent(ch, `Размер увеличен на 1 (разовый бонус за характеристику «${STAT_LABELS[eligible]}»): сила +1, скрытность −1. Теперь размер ${ch.size}.`);
      }},
      { label: 'Нет, оставить размер как есть', apply: ch => {
        logEvent(ch, `Разовый шанс увеличить размер (характеристика «${STAT_LABELS[eligible]}») — отклонён.`);
      }}
    ]
  });
}

// Sibling of processNextLevelIfReady, for the OTHER place this codebase re-applies a run of levels'
// bonuses in one go: switching an already-generated character's archetype and/or subtype backfills
// every level up to their CURRENT level for the newly-set one(s) — character.level itself doesn't
// change here, so this tracks its own separate progress counter instead of reusing c.level. Same
// one-level-at-a-time reasoning applies: without it, a later level's pick could evaluate against an
// earlier level's bonus that was only queued, not actually resolved yet, during the backfill.
function levelCheckpointOf(c){ const o = JSON.parse(JSON.stringify(c)); delete o._lvlCheckpoint; delete o._genCheckpoint; return o; }
// После загрузки (автосохранение при обновлении страницы, слот, файл): если выборы уровня не были доделаны —
// вернуться к состоянию до этого уровня; renderAll() сам применит уровень заново и предложит выборы.
function restoreLevelCheckpoint(c){
  if(!c) return c;
  if(c._genCheckpoint && c._levelUpTarget){ // посреди выборов самой генерации — повторить бонусы карьеры/происхождения/архетипа
    const cp = c._genCheckpoint;
    applyGenerationMods(cp);
    logEvent(cp, 'Страница была обновлена посреди выборов создания персонажа — эти выборы предложены заново.');
    return cp;
  }
  if(!c._lvlCheckpoint || !(c._levelUpTarget || c._backfillTarget)) return c;
  const cp = c._lvlCheckpoint;
  logEvent(cp, `Страница была обновлена посреди выборов уровня ${c.level} — выборы этого уровня предложены заново.`);
  return cp;
}
function processNextBackfillLevelIfReady(c){
  if(!c || !c._backfillTarget) return;
  if(pendingChoices.length || pendingRoleplayChoices.length) return;
  delete c._lvlCheckpoint;
  if(c._backfillProgress >= c._backfillTarget){
    delete c._backfillTarget; delete c._backfillProgress; delete c._backfillArchetype; delete c._backfillSubtype;
    return;
  }
  const nextLevel = c._backfillProgress + 1;
  c._lvlCheckpoint = levelCheckpointOf(c);
  const arch = currentArchetype(c);
  const fixedSummary = [];
  if(c._backfillArchetype && arch.baseLevels[nextLevel]){
    const mods = arch.baseLevels[nextLevel];
    const fixed = summarizeFixedMods(mods);
    if(fixed.length) fixedSummary.push(`архетип ур.${nextLevel}: ${fixed.join(', ')}`);
    applyModifierList(c, mods, `Архетип: ${arch.name} (ур.${nextLevel})`, randomMode);
  }
  if(c._backfillSubtype && c.subtypeKey){
    const sub = arch.subtypes[c.subtypeKey];
    if(sub && sub.levels[nextLevel]){
      const mods = sub.levels[nextLevel];
      const fixed = summarizeFixedMods(mods);
      if(fixed.length) fixedSummary.push(`подтип «${sub.name}» ур.${nextLevel}: ${fixed.join(', ')}`);
      applyModifierList(c, mods, 'Подтип: '+sub.name+' (ур.'+nextLevel+')', randomMode);
    }
  }
  c._backfillProgress = nextLevel;
  if(fixedSummary.length) logEvent(c, `Бонусы нового уровня ${nextLevel} применены: ${fixedSummary.join('; ')}.`);
  reclampVitals(c);
  offerSizeBonusIfEligible(c);
  processNextBackfillLevelIfReady(c);
}

function generateCharacter(){
  pendingRoleplayChoices = [];
  pendingChoices = [];
  pendingItemRolls = [];
  const c = newCharacter();
  c.level = 1;

  const isLocked = (id) => { const el = document.getElementById(id); return !!(el && el.checked); };
  const selVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
  // Архетип/Подтип/Карьера/Происхождение are now hover-hint dropdowns (see wireSuggestDropdown) whose
  // .value holds the display LABEL, not the internal key — the key lives in .dataset.key instead.
  const selKey = (id) => { const el = document.getElementById(id); return el ? (el.dataset.key||'') : ''; };

  // 0) archetype — locked: use the "Архетип" field as-is; unlocked: pick randomly among all archetypes.
  c.archetypeKey = isLocked('fArchetypeLock') && ARCHETYPES[selKey('fArchetypeSelect')]
    ? selKey('fArchetypeSelect')
    : pick(Object.keys(ARCHETYPES));
  const arch = currentArchetype(c);

  // 1) career — locked: use the "Карьера" select as-is (even if not a natural fit for the archetype,
  //    same as a manual post-generation switch would allow); unlocked: random among careers whose
  //    `archetypes` list includes the current archetype.
  const careerPool = Object.keys(CAREERS).filter(k => CAREERS[k].archetypes.some(a => a.includes(arch.name)));
  if(isLocked('fCareerLock') && CAREERS[selKey('fCareerSelect')]){
    c.careerKey = selKey('fCareerSelect');
    if(!careerPool.includes(c.careerKey)){
      c.notes.push({text:`Внимание: зафиксированная карьера «${CAREERS[c.careerKey].name}» не входит в список карьер архетипа «${arch.name}» по таблице создания персонажа (стр. 51).`, source:'Генерация'});
    }
  } else {
    c.careerKey = pick(careerPool);
  }
  const career = CAREERS[c.careerKey];

  // 2) origin — locked: use the "Происхождение" select as-is; unlocked: random among origins
  //    compatible with the chosen career.
  if(isLocked('fOriginLock') && ORIGINS[selKey('fOriginSelect')]){
    c.originKey = selKey('fOriginSelect');
    if(!career.origins.includes(c.originKey)){
      c.notes.push({text:`Внимание: зафиксированное происхождение «${ORIGINS[c.originKey].name}» не входит в список совместимых с карьерой «${career.name}» по таблице создания персонажа (стр. 51).`, source:'Генерация'});
    }
  } else {
    c.originKey = pick(career.origins);
  }
  const origin = ORIGINS[c.originKey];

  // 3) subtype — locked: use the "Подтип" select as-is (if it's a subtype of the CURRENT archetype);
  //    unlocked: random among the current archetype's subtypes. Bonuses apply once level reaches the threshold.
  if(isLocked('fSubtypeLock') && arch.subtypes[selKey('fSubtypeSelect')]){
    c.subtypeKey = selKey('fSubtypeSelect');
  } else {
    c.subtypeKey = pick(Object.keys(arch.subtypes));
  }

  // 5) alignment — locked: use the "Мировоззрение" field as typed/selected (free text, not restricted
  //    to the 8 named options — see wireSuggestDropdown); unlocked: random pick from the fixed list.
  c.alignment = (isLocked('fAlignmentLock') && selVal('fAlignment').trim()) ? selVal('fAlignment').trim() : pick(ALIGNMENTS).name;

  // 6) advantages/flaws — age bracket is locked: use the "Возраст" field as-is (now holds the bracket's
  //    label text, not its key — see wireSuggestDropdown — so resolve it back to a key); unlocked:
  //    random bracket. Any forced flaws from deformity/madness tables (rolled during career/origin
  //    application above) are already sitting in c.flaws at this point and are exempt from the age cap.
  const lockedAgeKey = Object.keys(AGE_BRACKETS).find(k=>AGE_BRACKETS[k].label===selVal('fAge').trim());
  c.ageKey = isLocked('fAgeLock') && lockedAgeKey ? lockedAgeKey : pick(Object.keys(AGE_BRACKETS));
  const bracket = AGE_BRACKETS[c.ageKey];
  for(let i=0;i<bracket.required;i++){
    c.advantages.push({id:uid(), text: rollTable(ADVANTAGE_TABLE,20).text, source:'Случайно (возраст)', forced:false});
  }
  for(let i=0;i<bracket.required;i++){
    c.flaws.push({id:uid(), text: rollTable(FLAW_TABLE,12).text, source:'Случайно (возраст)', forced:false});
  }

  // Generate directly at a chosen starting level — locked: use "Уровень при генерации" as-is;
  // unlocked: always start fresh at level 1 (there's no book convention for a "random" starting level).
  c._levelUpTarget = isLocked('fLevelLock') ? parseInt(selVal('fLevel'),10) : 1;
  c._levelUpFullHeal = true; // fresh character, hasn't taken any damage yet — see processNextLevelIfReady
  // Стартовое снаряжение зависит от ИТОГОВОГО уровня — выдаётся, когда повышение дойдёт до цели (processNextLevelIfReady)
  c._pendingStartingGear = true;
  c._genCheckpoint = levelCheckpointOf(c); // см. restoreLevelCheckpoint
  applyGenerationMods(c);
  // One level at a time (see processNextLevelIfReady) rather than applying every level in one batch —
  // this call advances as far as it can immediately (e.g. all the way, in pure random mode with no
  // roleplay-only choices along the way) and stops the moment a level leaves something pending; the
  // renderAll() hook resumes it automatically once the player clears that.
  processNextLevelIfReady(c, true);
  return c;
}
// Бонусы карьеры, происхождения и 1 уровня архетипа (4 — стр. 86) + стартовые ОЗ/пси и запись в журнал.
// Отдельно от generateCharacter, чтобы повторить их по точке восстановления (restoreLevelCheckpoint).
function applyGenerationMods(c){
  const arch = currentArchetype(c), career = CAREERS[c.careerKey], origin = ORIGINS[c.originKey], bracket = AGE_BRACKETS[c.ageKey];
  applyModifierList(c, career.mods, 'Карьера: '+career.name, randomMode);
  applyModifierList(c, origin.mods, 'Происхождение: '+origin.name, randomMode);
  applyModifierList(c, arch.baseLevels[1], `Архетип: ${arch.name} (ур.1)`, randomMode);
  // 7) health / psi start at full max (3 + выносливость + размер / 3 + дух); recomputed once more
  //    after any pre-generation level-up, so a character generated straight at a high level
  //    starts at ITS max, not the level-1 max frozen in place. During play these track current
  //    damage/expenditure and can go negative down to -max — see hpMax()/psiMax() below.
  c.hpCurrent = hpMax(c);
  c.psiCurrent = psiMax(c);

  {
    const careerFixed = summarizeFixedMods(career.mods);
    const originFixed = summarizeFixedMods(origin.mods);
    const archFixed = summarizeFixedMods(arch.baseLevels[1]);
    const parts = [];
    if(careerFixed.length) parts.push(`карьера «${career.name}»: ${careerFixed.join(', ')}`);
    if(originFixed.length) parts.push(`происхождение «${origin.name}»: ${originFixed.join(', ')}`);
    if(archFixed.length) parts.push(`архетип (ур.1): ${archFixed.join(', ')}`);
    logEvent(c, `Персонаж сгенерирован — архетип «${arch.name}», карьера «${career.name}», происхождение «${origin.name}», подтип «${arch.subtypes[c.subtypeKey].name}», возраст: ${bracket.label}.`
      + (parts.length ? ` Фиксированные бонусы: ${parts.join('; ')}.` : ' Фиксированных бонусов нет.'));
  }
}

// General starting equipment (pages 82-84), independent of career — bracket depends on final level.
function applyStartingGear(c){
  const source = 'Стартовое снаряжение';
  if(c.level <= 5){
    applyModifier(c, M.itemTable('Снаряжение (общий выбор)', STARTING_GEAR_CHOICE_TABLE.length, STARTING_GEAR_CHOICE_TABLE, 1), source, randomMode);
  }
  if(c.level <= 1){
    applyModifier(c, M.credits(50, 'Хлам: запас местной валюты'), source, true);
    JUNK_GEN_BASE_ITEMS.forEach(text => applyModifier(c, M.item(text), source, true));
    applyModifier(c, M.itemTable('Медикаменты (Хлам)', JUNK_GEN_MEDS_TABLE.length, JUNK_GEN_MEDS_TABLE, 1), source, randomMode);
    applyModifier(c, M.itemBundle('Оружие (Хлам)', JUNK_GEN_WEAPON_TABLE.length, JUNK_GEN_WEAPON_TABLE, 1), source, randomMode);
  } else if(c.level>=2 && c.level<=5){
    applyModifier(c, M.credits(250, 'Снаряжение 2-5 ур.: запас денег'), source, true);
    LEVEL2_5_BASE_ITEMS.forEach(text => applyModifier(c, M.item(text), source, true));
    applyModifier(c, M.itemBundle('Снаряжение 2-5 ур. (выбор)', LEVEL2_5_CHOICE_TABLE.length, LEVEL2_5_CHOICE_TABLE, 1), source, randomMode);
  } else if(c.level>=6 && c.level<=11){
    // Таблицы 1-3 (файл "начальное снаряжение 8-11 уровня") общие для всего диапазона 6-11;
    // таблица 4 — только 6-7 ур., таблица 5 — только 8-11 ур. (расширенное вооружение).
    applyModifier(c, M.itemTable('Снаряжение 6-11 ур. (общий выбор)', LEVEL6_11_CHOICE_TABLE_A.length, LEVEL6_11_CHOICE_TABLE_A, 1), source, randomMode);
    applyModifier(c, M.credits(500, 'Снаряжение 6-11 ур.: запас денег'), source, true);
    LEVEL6_11_BASE_ITEMS.forEach(text => applyModifier(c, M.item(text), source, true));
    applyModifier(c, M.itemTable('Медикаменты 6-11 ур. (выбор)', LEVEL6_11_MEDS_TABLE.length, LEVEL6_11_MEDS_TABLE, 1), source, randomMode);
    if(c.level<=7){
      applyModifier(c, M.itemBundle('Снаряжение 6-7 ур. (выбор)', LEVEL6_7_CHOICE_TABLE.length, LEVEL6_7_CHOICE_TABLE, 1), source, randomMode);
    } else {
      applyModifier(c, M.itemBundle('Снаряжение 8-11 ур. (выбор)', LEVEL8_11_CHOICE_TABLE.length, LEVEL8_11_CHOICE_TABLE, 1), source, randomMode);
    }
    c.notes.push({text:`Альтернатива книги: вместо этих таблиц можно закупить снаряжение самостоятельно на ${c.level<=7?'10 000':'15 000'} кредитов — до двух дефицитных предметов Феодальных княжеств по удвоенной цене, любые базовые предметы Феодальных княжеств, дефицитные и базовые вещи Свалки, любой Хлам (стр. 82). Каталог предметов — в разделе «Инвентарь» ниже.`, source});
  } else {
    c.notes.push({text:'Начальное снаряжение для персонажей 12+ уровня в книге не описано отдельной таблицей — закупается самостоятельно (см. стр. 82).', source});
  }
}

function hpMax(c){ return 3 + c.stats.vynoslivost + c.size + c.bonusHpMax; } // book: "выносливость + размер + 3" (стр. 80) + any bonusHpMax abilities (e.g. Боец «Живучий»)
function psiMax(c){ return 3 + c.stats.duh + c.bonusPsiMax; }
function reclampVitals(c){
  c.hpCurrent = clampLower(c.hpCurrent, hpMax(c));
  c.psiCurrent = clampLower(c.psiCurrent, psiMax(c));
}
// Only the lower bound is a hard wall (-max). Values above max are kept as-is and
// displayed as "max+N" (see formatMetric) rather than clamped away.
function clampLower(v, max){ return v < -max ? -max : v; }
function formatMetric(value, max){
  return value > max ? `${max}+${value-max}` : `${value}`;
}

function applyLevelUp(c, newLevel){
  // One level at a time (see processNextLevelIfReady) — advances as far as immediately possible and
  // stops the moment a level leaves something pending for the player; the renderAll() hook resumes it
  // automatically once that's resolved. Preserves current damage/expenditure (reclamp only), unlike
  // generateCharacter()'s fresh-character path which fully heals at each step.
  c._levelUpTarget = newLevel;
  c._levelUpFullHeal = false; // an already-played character keeps its current damage/expenditure — see processNextLevelIfReady
  processNextLevelIfReady(c, false);
}

// Mirror of applyLevelUp: fully reverts every bonus (fixed, chosen, or random) tied to the levels
// being given up, using the same source-tag removal as career/origin/subtype switching. Also drops
// any specialization pick whose slot level is no longer reached (with the usual tier-2 cascade).
function applyLevelDown(c, newLevel){
  delete c._levelUpTarget; // cancel any in-progress level-by-level advance — the player is going the other way now
  delete c._backfillTarget; delete c._backfillProgress; delete c._backfillArchetype; delete c._backfillSubtype; // and any in-progress archetype/subtype-switch backfill
  const oldLevel = c.level;
  c.level = newLevel;
  const arch = currentArchetype(c);
  const removedLevels = [];
  Object.keys(arch.baseLevels).forEach(lvlStr=>{
    const lvl = parseInt(lvlStr,10);
    if(lvl>newLevel && lvl<=oldLevel){
      removeBonusesBySource(c, `Архетип: ${arch.name} (ур.${lvl})`);
      removedLevels.push('архетип ур.'+lvl);
    }
  });
  if(c.subtypeKey){
    const sub = arch.subtypes[c.subtypeKey];
    Object.keys(sub.levels).forEach(lvlStr=>{
      const lvl = parseInt(lvlStr,10);
      if(lvl>newLevel && lvl<=oldLevel){
        removeBonusesBySource(c, 'Подтип: '+sub.name+' (ур.'+lvl+')');
        removedLevels.push(`подтип «${sub.name}» ур.${lvl}`);
      }
    });
  }
  c.specializationPicks.forEach((slot, i)=>{
    if(slot.key && newLevel < slot.level){
      const specName = SPECIALIZATIONS[slot.key].name;
      clearSpecSlot(i);
      removedLevels.push(`специализация «${specName}» (слот ур.${slot.level})`);
    }
  });
  // Cultist/shaman mystic abilities (see reconcileMysticUnlocks) are tagged with the STABLE source of
  // the original religion/connection pick, not the per-level source they actually unlocked at — so the
  // per-level removeBonusesBySource() calls above can't catch them. Prune separately here by re-checking
  // eligibility against the character's new (lower) level/мистика, same gating tables as the unlock path.
  if(c.cultReligion){
    const cat = CULTIST_ABILITY_CATALOG[c.cultReligion] || {};
    Object.entries(cat).forEach(([group,names])=>{
      if(c.level < (CULT_GROUP_LEVEL[group]||0)){
        c.abilities = c.abilities.filter(a=>!names.includes(a.name));
      }
    });
    if(c.cultReligion==='Поклонение Матери-Природе' && c.level < CULT_GROUP_LEVEL['Катарсис']){
      removeBonusesBySource(c, (c.cultReligionSource||'')+' → катарсис-мутация');
      c._motherNatureCatharsisTriggered = false; // allow it to re-trigger if the player levels back up
    }
  }
  if(c.shamanConnection){
    const cat = SHAMAN_ABILITY_CATALOG[c.shamanConnection] || {};
    Object.entries(cat).forEach(([tier,names])=>{
      if(c.stats.mistika < (SHAMAN_TIER_MISTIKA[tier]||0)){
        c.abilities = c.abilities.filter(a=>!names.includes(a.name));
      }
    });
  }
  logEvent(c, `Уровень понижен: ${oldLevel} → ${newLevel}.`
    + (removedLevels.length ? ` Отменены бонусы: ${removedLevels.join('; ')}.` : ' На отменённых уровнях бонусов не было.'));
  reclampVitals(c);
}

// One-click career/origin/subtype switching: fully reverts everything the old choice granted
// (random rolls, player choices, and guaranteed/fixed bonuses alike) before rolling/choosing
// the new one's bonuses the same way generation does.
function switchCareer(newKey){
  if(!character || !CAREERS[newKey] || newKey === character.careerKey) return;
  const oldCareer = character.careerKey ? CAREERS[character.careerKey] : null;
  const newCareer = CAREERS[newKey];
  if(oldCareer) removeBonusesBySource(character, 'Карьера: '+oldCareer.name);
  character.careerKey = newKey;
  applyModifierList(character, newCareer.mods, 'Карьера: '+newCareer.name, randomMode);
  const fixed = summarizeFixedMods(newCareer.mods);
  logEvent(character, `Карьера изменена: «${oldCareer?oldCareer.name:'—'}» → «${newCareer.name}».`
    + (fixed.length ? ` Фиксированные бонусы: ${fixed.join(', ')}.` : ' Фиксированных бонусов нет.'));
  if(character.originKey && !newCareer.origins.includes(character.originKey)){
    logEvent(character, `Внимание: текущее происхождение «${ORIGINS[character.originKey].name}» не входит в список совместимых с карьерой «${newCareer.name}» по таблице создания персонажа (стр. 51).`);
  }
  {
    const arch = currentArchetype(character);
    if(!newCareer.archetypes.some(a=>a.includes(arch.name))){
      logEvent(character, `Внимание: карьера «${newCareer.name}» не входит в список карьер архетипа «${arch.name}» по таблице создания персонажа (стр. 51).`);
    }
  }
  reclampVitals(character);
  renderAll();
}
function switchOrigin(newKey){
  if(!character || !ORIGINS[newKey] || newKey === character.originKey) return;
  const oldOrigin = character.originKey ? ORIGINS[character.originKey] : null;
  const newOrigin = ORIGINS[newKey];
  if(oldOrigin) removeBonusesBySource(character, 'Происхождение: '+oldOrigin.name);
  character.originKey = newKey;
  applyModifierList(character, newOrigin.mods, 'Происхождение: '+newOrigin.name, randomMode);
  const fixed = summarizeFixedMods(newOrigin.mods);
  logEvent(character, `Происхождение изменено: «${oldOrigin?oldOrigin.name:'—'}» → «${newOrigin.name}».`
    + (fixed.length ? ` Фиксированные бонусы: ${fixed.join(', ')}.` : ' Фиксированных бонусов нет.'));
  reclampVitals(character);
  renderAll();
}
function switchSubtype(newKey){
  const arch = currentArchetype(character);
  if(!character || !arch.subtypes[newKey] || newKey === character.subtypeKey) return;
  const oldSub = character.subtypeKey ? arch.subtypes[character.subtypeKey] : null;
  const newSub = arch.subtypes[newKey];
  if(oldSub) removeBonusesBySource(character, 'Подтип: '+oldSub.name);
  character.subtypeKey = newKey;
  logEvent(character, `Подтип изменён: «${oldSub?oldSub.name:'—'}» → «${newSub.name}».`
    + (character.level>=4 ? ' Бонусы применяются по уровням, по очереди — см. журнал ниже.' : ' Уровень персонажа ниже 4 — бонусов подтипа ещё нет.'));
  // Same one-level-at-a-time backfill as switchArchetype (see processNextBackfillLevelIfReady) —
  // archetype itself hasn't changed here, only the subtype, so only that gets backfilled.
  character._backfillTarget = character.level;
  character._backfillProgress = 0;
  character._backfillArchetype = false;
  character._backfillSubtype = true;
  processNextBackfillLevelIfReady(character);
  reclampVitals(character);
  renderAll();
}
// One-click archetype switching: reverts EVERY level of the old archetype's base progression and
// the old subtype's progression, then re-applies the new archetype's levels up to the current
// character level and picks a fresh (random) subtype valid for it. Career/origin are left as-is,
// with a warning logged if they're no longer a valid fit for the new archetype.
function switchArchetype(newKey){
  if(!character || !ARCHETYPES[newKey] || newKey === character.archetypeKey) return;
  const oldArch = currentArchetype(character);
  const oldSub = character.subtypeKey ? oldArch.subtypes[character.subtypeKey] : null;
  Object.keys(oldArch.baseLevels).forEach(lvl=>{
    removeBonusesBySource(character, `Архетип: ${oldArch.name} (ур.${lvl})`);
  });
  if(oldSub){
    Object.keys(oldSub.levels).forEach(lvl=>{
      removeBonusesBySource(character, `Подтип: ${oldSub.name} (ур.${lvl})`);
    });
  }
  // Clear mystic-system state tied to the OLD archetype (shaman connection, cult religion, known psi
  // disciplines) — removeBonusesBySource above only strips the abilities themselves. Without this,
  // this state stayed stale, and reconcileMysticUnlocks (called by every applyModifierList — including
  // the new archetype's own mods applied just below) would silently re-grant an old-archetype ability
  // right back using it, e.g. a shaman ability reappearing right after switching to psionik.
  character.shamanConnection = null; character.shamanConnectionSource = null;
  character.cultReligion = null; character.cultReligionSource = null; character.religion = null;
  character.psiDisciplines = [];
  character.archetypeKey = newKey;
  const newArch = currentArchetype(character);
  const subKeys = Object.keys(newArch.subtypes);
  character.subtypeKey = pick(subKeys);
  const newSub = newArch.subtypes[character.subtypeKey];
  logEvent(character, `Архетип изменён: «${oldArch.name}» → «${newArch.name}». Подтип переопределён на «${newSub.name}». Бонусы применяются по уровням, по очереди — см. журнал ниже.`);
  if(character.careerKey && !CAREERS[character.careerKey].archetypes.some(a=>a.includes(newArch.name))){
    logEvent(character, `Внимание: текущая карьера «${CAREERS[character.careerKey].name}» не входит в список карьер архетипа «${newArch.name}» по таблице создания персонажа (стр. 51) — при необходимости смените её вручную.`);
  }
  // Backfill the new archetype's and subtype's bonuses one level at a time (see
  // processNextBackfillLevelIfReady) instead of applying every level in one batch — a later level's
  // pick (e.g. a psi tier upgrade) must only ever see an earlier level's bonus once it's actually been
  // resolved, not merely queued; the renderAll() hook resumes this automatically once the player clears
  // whatever an earlier level left pending.
  character._backfillTarget = character.level;
  character._backfillProgress = 0;
  character._backfillArchetype = true;
  character._backfillSubtype = true;
  processNextBackfillLevelIfReady(character);
  reclampVitals(character);
  renderAll();
}

/* ---- Specializations engine ---- */
function specSlotSource(level){ return `Специализация (ур.${level})`; }
function isSpecAllowed(c, key){
  const spec = SPECIALIZATIONS[key];
  if(!spec) return false;
  if(spec.requirement && !spec.requirement.check(c)) return false;
  return true;
}
// Map of specKey -> tier(1|2) already taken across all slots, optionally excluding one slot index
// (so a slot can still show/keep its own current pick as a valid option while being recomputed).
function specTakenMap(c, excludeIndex){
  const map = {};
  c.specializationPicks.forEach((p,i)=>{
    if(i===excludeIndex || !p.key) return;
    map[p.key] = p.tier;
  });
  return map;
}
function computeSlotOptions(c, slotIndex){
  const taken = specTakenMap(c, slotIndex);
  const options = [];
  Object.keys(SPECIALIZATIONS).forEach(key=>{
    if(!isSpecAllowed(c, key)) return;
    const spec = SPECIALIZATIONS[key];
    const takenTier = taken[key];
    if(!takenTier){
      options.push({value:key+':1', label:`${spec.name} (ступень 1)`});
    } else if(takenTier===1){
      options.push({value:key+':2', label:`${spec.name} (ступень 2)`});
    }
    // takenTier===2 -> fully used elsewhere, no option offered
  });
  options.sort((a,b)=>a.label.localeCompare(b.label,'ru'));
  return options;
}
function applySpecSlot(slotIndex, key, tier){
  const c = character;
  const slot = c.specializationPicks[slotIndex];
  const spec = SPECIALIZATIONS[key];
  const source = specSlotSource(slot.level);
  removeBonusesBySource(c, source); // clear whatever this slot held before
  slot.key = key; slot.tier = tier;
  const mods = tier===1 ? spec.tier1 : spec.tier2;
  applyModifierList(c, mods, source+`: ${spec.name} (ступень ${tier})`, randomMode);
  logEvent(c, `Специализация (ур.${slot.level}): выбрано «${spec.name}», ступень ${tier}.`);
}
function clearSpecSlot(slotIndex){
  const c = character;
  const slot = c.specializationPicks[slotIndex];
  if(!slot.key) return;
  const oldKey = slot.key, oldTier = slot.tier;
  const source = specSlotSource(slot.level);
  removeBonusesBySource(c, source);
  slot.key = null; slot.tier = null;
  if(oldTier===1){
    // any other slot holding tier 2 of this same spec loses its prerequisite — clear it too
    c.specializationPicks.forEach((p,i)=>{
      if(i!==slotIndex && p.key===oldKey && p.tier===2){
        const dependentSource = specSlotSource(p.level);
        removeBonusesBySource(c, dependentSource);
        logEvent(c, `Специализация (ур.${p.level}): «${SPECIALIZATIONS[oldKey].name}» (ступень 2) снята — убрана ступень 1 в другом слоте.`);
        p.key = null; p.tier = null;
      }
    });
  }
}
window.pickSpecSlot = function(slotIndex, value){
  // value is "" (clear) or "key:tier"
  clearSpecSlot(slotIndex);
  if(!value) { reclampVitals(character); renderAll(); return; }
  const [key, tierStr] = value.split(':');
  applySpecSlot(slotIndex, key, parseInt(tierStr,10));
  reclampVitals(character);
  renderAll();
};

