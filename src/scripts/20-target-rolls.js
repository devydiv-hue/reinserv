/* ======================================================================
   БРОСОК ЦЕЛИ: способности существ, где бросает цель («Бросок рефлексов (−6)», «спасбросок от пси-поля (+3)»),
   встречные проверки существа против характеристики цели («Бросок мистики (19) против воли цели» — из Максимума
   существа вычитается характеристика цели) и урон без броска («наносит всем в радиусе 6 м по 2к6 ран»).
   - Мастер: меню жетона → «🎯 Бросок цели…» (у существа) или «🎯 Потребовать бросок…» (у игрока); ▶ у способности
     в карточке существа открывает ту же форму, заполненную по тексту (AbilityKit.parse). Форма: проверка и
     модификатор (или Максимум существа и против чего, или «без броска»), цели, последствия: попадания по профилю
     (к12 против МУ − защиты, как у атаки с карты), потеря ОЗ и пси, состояния листа (испуг, истощение, стресс),
     отметки на жетоне (шок, сбит с ног, схвачен, оглушён, ослеплён, пропускает ход) на N кругов (можно «к6»).
   - Из текста способности дополнительно: «всем» (урон до броска — получают все цели), «кат. 2» / «15−» (ещё
     последствия при провале категории 2 / с итогом 15−), «затем» (следующий бросок для поражённых), «каждый круг»
     (напоминание Мастеру в начале круга), «сама» (расход существа), условия (решает Мастер).
   - Игрок получает окно «Бросок по требованию Мастера» → «🎲 Бросить» открывает его обычное окно броска с нужной
     характеристикой и модификатором; результат сам уходит Мастеру. За NPC и встречные проверки бросает приложение.
   - Панель результатов у Мастера: кто прошёл и кто провалил; последствия — только после «Применить».
     Невосприимчивость существ к состояниям («Робот», «Неистовство») учитывается при применении.
   Сообщения: tr-req (Мастер → игрок), tr-res (игрок → Мастер).
   ====================================================================== */
const TargetRolls = (function(){
  const esc = (s)=>escapeHtml(s==null ? '' : String(s));
  const GT = ()=>typeof GameTable!=='undefined' ? GameTable : null;
  const AK = ()=>typeof AbilityKit!=='undefined' ? AbilityKit : null;
  const CHECKS = [['volya', 'Бросок воли'], ['refleksy', 'Бросок рефлексов'], ['vynoslivost', 'Бросок выносливости'], ['sila', 'Бросок силы'],
    ['duh', 'Бросок духа'], ['smekalka', 'Бросок смекалки'], ['legkaya_atletika', 'Бросок лёгкой атлетики'], ['lovkost_ruk', 'Бросок ловкости рук'],
    ['vospriyatie', 'Бросок восприятия'], ['hladnokrovie', 'Проверка хладнокровия (воля)'], ['save_psi_pole', 'Спасбросок от пси-поля'],
    ['save_vrednaya_sreda', 'Спасбросок от вредной среды (химия, радиация, болезни)'], ['save_pryamoy_kontakt', 'Спасбросок: прямой контакт'],
    ['save_kislotnost', 'Спасбросок от кислотности'], ['psi_plus', 'Проверка с Максимумом [N + пси-сопротивление]'], ['psi_cur_plus', 'Проверка с Максимумом [N + текущие пси]']];
  const VS = [['', '— (обычная атака, без вычета)'], ['volya', 'воли'], ['refleksy', 'рефлексов'], ['sila', 'силы'], ['smekalka', 'смекалки'], ['duh', 'духа'], ['vynoslivost', 'выносливости'], ['legkaya_atletika', 'лёгкой атлетики']];
  const LABEL = Object.fromEntries(CHECKS);
  const RU = {vynoslivost:'выносливость', legkaya_atletika:'л[её]гкая атлетика', refleksy:'рефлексы', sila:'сила', volya:'воля', duh:'дух', smekalka:'смекалка', lovkost_ruk:'ловкость рук', vospriyatie:'восприятие', mistika:'мистика'};
  const BODY = ['vynoslivost', 'legkaya_atletika', 'refleksy', 'sila', 'lovkost_ruk'];
  const SHEET_STATES = [['ispug', 'испуг'], ['istoshenie', 'истощение'], ['stress', 'стресс']];
  const MU_TYPES = ['удар', 'патрон', 'энергия', 'температура', 'взрыв'];
  const sgn = (n)=>(n >= 0 ? '+' : '−') + Math.abs(n);
  const realKey = (k)=>k==='hladnokrovie' ? 'volya' : k;
  const NPLUS = (k)=>k==='psi_plus' || k==='psi_cur_plus';
  // Категория провала: 1 — итог 16–20, 2 — итог 15 и меньше (выше Максимума). Максимум ниже 0 — бросок невозможен.
  const failCat = (roll)=>roll > 0 && roll <= 15 ? 2 : 1;
  const RMODE = [['', 'обычно'], ['advantage', 'Упрощённо'], ['disadvantage', 'Осложнённо']];
  const mixMode = (a, b)=>!a || a==='plain' ? (b || 'plain') : !b || b==='plain' || a===b ? a : 'plain'; // Упрощено + Осложнено = обычный бросок

  /* ---------- общие правила книги ---------- */
  // Срыв после провала хладнокровия, если пси 0 и меньше: по к20 этой проверки (таблица срывов персонажа, стр. 28)
  const SRYV = [[20, 20, 'Дрожь', 'до конца круга все физические действия Осложнены'],
    [19, 19, '«Сдохни, тварь!»', 'выбор: −1 пси или до конца круга бездумно атакует источник страха со штрафом −3'],
    [18, 18, 'Ступор', 'обездвижен; в конце каждого круга спасбросок воли (−3), успех — приходит в себя'],
    [17, 17, 'Бегство', 'действие и реакция — на побег; в конце каждого круга спасбросок воли (−3), успех — приходит в себя'],
    [16, 16, 'Напуган', 'выбор: −1 пси или до конца дня любой риск даёт ему стресс'],
    [15, 15, 'Ужасающий крик', 'выбор: −3 пси или кричит, не действуя до конца круга; слышащие союзники — проверка хладнокровия (−3)'],
    [14, 14, 'Паника', 'выбор: −2 пси или совершает одну глупость (решает Мастер)'],
    [13, 13, 'Панические настроения', 'двигается лишь к укрытию; до конца дня разводит панику, слышащие получают стресс; сдержаться — −1 пси за раз'],
    [11, 11, 'Травмирующий опыт', 'безумие ПТСР, пси-запас не восстанавливается; выбор: −2 пси или до конца сцены цепляется за союзника'],
    [10, 10, 'Сердечный приступ', 'погибает на месте'],
    [6, 9, 'Фобия', 'ползёт от источника ужаса и прячется; раз в час спасбросок воли (−3); безумие — фобия'],
    [2, 5, 'Посттравматический синдром', 'кататония; раз в конце дня спасбросок воли (−3); безумие ПТСР'],
    [1, 1, 'Сходит с ума', 'полностью безумен, переходит под контроль Мастера']];
  const sryvOf = (roll)=>SRYV.find(r=>roll >= r[0] && roll <= r[1]) || null;
  // Пси-мутация (спасбросок от пси-поля провален с итогом 15−): часть тела выбирает Мастер, к12 (куато — к6); здесь — кратко, полностью — стр. 32
  const MUT = {
    'рука':[12, [[1, 4, 'месиво неразвитых рук: мелкая моторика −3'], [5, 7, '«мясной рулет» вместо руки: связанные проверки Осложнены'], [8, 9, 'щупальце: моторика −3, сила +3, естественное оружие'],
      [10, 10, '2к6 тонких «шлангов» с ладошками: проверки этой рукой −3'], [11, 11, 'чужая рука, пытается убить персонажа'], [12, 12, 'фрактальные многогранники: телекинез как при мистике 9, отдых −3']]],
    'нога':[12, [[1, 4, '«мясной рулет» вместо ноги: проверки Осложнены, стрельба по нему +3'], [5, 7, 'нога и таз в неразвитых ногах: бег −2'], [8, 9, 'пучки белёсых нитей: бег −3'],
      [10, 10, 'лишняя нога: вид отталкивающий, доработка брони'], [11, 11, 'нога забывшего — нападает на персонажа'], [12, 12, 'мясной шар вместо низа: бег +3, выносливость +1, размер +1, чудовищный']]],
    'голова':[12, [[1, 4, 'язык со ртами и Асу: проверка питания дважды'], [5, 7, '+1к6 копий лица: чудовищный, социальные проверки Осложнены'], [8, 9, 'опухоль с Асу: отталкивающий, при 13 — знания Осложнены до конца дня'],
      [10, 10, 'новые органы чувств вместо глаз: эмоции в 150 м, понимание людей −3, −1 пси за встречу'], [11, 11, 'козий глаз на лбу: сенсорика как при мистике 9, шёпот Равнины'], [12, 12, 'полная пси-деформация — выбывает из игры']]],
    'тело':[12, [[1, 4, 'бугристое тело: +2 ОЗ, рефлексы и лёгкая атлетика Осложнены'], [5, 7, 'из тела растут тела: рефлексы −3, броня +100%'], [8, 9, 'симбиот куато — бросьте «куато»'],
      [10, 10, '1к6 каменных наростов: скрытность −3'], [11, 11, 'пласты тела вне реальности: раз в день отменить 1к6 попаданий'], [12, 12, 'светопоглощающая дыра в теле: безумие одержимость']]],
    'куато':[6, [[1, 2, 'волнуется рядом с пси-полем (12 м)'], [3, 3, 'раз за встречу +1к6 ОЗ носителю'], [4, 4, 'пси-щит носителю (Максимум 16)'], [5, 5, 'визг: проверка хладнокровия (−3) угрожающим'], [6, 6, 'разумный, телекинез с мистикой 9']]]};
  function rollMutation(name, part){ const [d, rows] = MUT[part], k = 1 + Math.floor(Math.random()*d), r = rows.find(x=>k >= x[0] && k <= x[1]);
    recordAndShareQuickRoll({abilityUse:true, text:`${name}: пси-мутация (${part}), к${d}=${k} — ${r ? r[2] : '?'}. Подробно — таблица пси-мутаций, стр. 32`}); }
  const psiOf = (c)=>c && c.psiCurrent!=null && isFinite(+c.psiCurrent) ? +c.psiCurrent : null;

  /* ---------- значения характеристик целей ---------- */
  function npcStat(t, key){
    const cr = t.creature || {}, txt = [cr.body, cr.mind, cr.skills, cr.know].filter(Boolean).join(' ; ');
    // пси-сопротивление: как у персонажа по умолчанию 12, плюс бонус из способностей («пси-сопротивление +3»)
    if(key==='psi'){ const m = /пси-сопротивлени\S*\s*\+\s*(\d+)(?!\s*\))/i.exec((cr.abil || []).map(a=>a[1]).join(' ')); return 12 + (m ? +m[1] : 0); }
    if(RU[key]){ const m = new RegExp(RU[key] + '\\s+([−-]?\\d+)', 'i').exec(txt); if(m) return +m[1].replace('−', '-'); }
    if(key==='refleksy' && t.reflexes!=null && !cr.body) return +t.reflexes;
    const m = /^\s*([−-]?\d+)/.exec(BODY.indexOf(key) >= 0 ? (cr.body || '') : (cr.mind || ''));
    return m ? +m[1].replace('−', '-') : (key==='refleksy' && t.reflexes!=null ? +t.reflexes : 2);
  }
  function sheetStat(c, key){ return c && c.stats && isFinite(+c.stats[key]) ? +c.stats[key] : 2; }
  // Максимум проверки цели: Бросок = значение + 10; спасбросок пси-поля = пси-сопротивление; вредная среда = 10 + выносливость
  function baseFor(t, key, n){
    const gt = GT(), c = t.kind==='player' && gt ? gt.sheetOfToken(t) : null, k = realKey(key);
    const st = (s)=>t.kind==='player' ? sheetStat(c, s) : npcStat(t, s), psi = t.kind==='player' ? (c && isFinite(+c.psiSoprot) ? +c.psiSoprot : 12) : npcStat(t, 'psi');
    if(k==='psi_plus') return (+n || 0) + psi;
    if(k==='psi_cur_plus') return (+n || 0) + (c ? +c.psiCurrent || 0 : 0);
    if(k==='save_psi_pole') return psi;
    if(k.indexOf('save_')===0) return 10 + st('vynoslivost') + (c ? +c.siz || 0 : 0);
    return 10 + st(k);
  }
  const statValue = (t, key)=>{ if(!key) return 0; const gt = GT(), c = t.kind==='player' && gt ? gt.sheetOfToken(t) : null; return t.kind==='player' ? sheetStat(c, key) : npcStat(t, key); };
  const tokName = (t)=>{ const gt = GT(), v = gt && gt.vitalsOf(t); return (v && v.name) || t.name || (t.kind==='player' ? 'Игрок' : 'Жетон'); };

  /* ---------- текст последствий ---------- */
  const hitTraits = (h)=>(h.pul ? ', пул (лучший из [категория успеха] к12)' : '') + (h.razryv ? ', разрыв' : '') + (h.moshh || !h.traits ? '' : /мощь/.test(h.traits) ? ', мощь' : '');
  const DICE_N = (h)=>!!(h && !h.byRoll && !h.byCat && h.nExpr && /^[кkdд]\d+$/i.test(h.nExpr)); // «к6 попаданий» — бросок для каждой цели
  const hitsN = (h)=>(h.pul || h.razryv) && (h.byCat || h.byRoll) ? 1 : h.byCat ? `[${h.n ? h.n + ' + ' : ''}категория успеха]` : h.byRoll ? '[выпавшее на к20]' : DICE_N(h) ? h.nExpr : h.n;
  function consText(c){
    if(!c) return '';
    const out = [];
    if(c.hits && (c.hits.n || c.hits.byCat || c.hits.byRoll)) out.push(`${hitsN(c.hits)} ${hitsN(c.hits)===1 ? 'попадание' : c.hits.byCat || c.hits.byRoll || DICE_N(c.hits) ? 'попаданий' : c.hits.n===1 ? 'попадание' : c.hits.n < 5 ? 'попадания' : 'попаданий'} с МУ ${c.hits.mu} ${c.hits.muType}, раны ${c.hits.moshh ? 'к12 (мощь)' : c.hits.wounds}${c.hits.travma ? ', травма' : ''}${hitTraits(c.hits)}`);
    if(c.hp) out.push(`−${c.hp} ОЗ`);
    if(c.psi) out.push(`−${c.psi} пси`);
    (c.states || []).forEach(k=>out.push((SHEET_STATES.find(s=>s[0]===k) || [, k])[1]));
    (c.marks || []).forEach(m=>out.push((GT() ? GT().MARKS[m.k] : m.k).toLowerCase() + (m.r && m.r!==1 ? ` (${m.r} кр.)` : m.r===1 ? ' (1 кр.)' : '')));
    if(c.note) out.push(c.note);
    return out.join(' · ');
  }
  const consEmpty = (c)=>!c || !consText(Object.assign({}, c, {note:''}));
  const exName = (e, r)=>AK() ? AK().extraName(e, !r || r.mode==='target') : e.when==='cat2' ? 'кат. 2' : 'итог 15−';
  const exText = (e)=>(e.viaCheck ? e.viaCheck + ' → ' : '') + (consEmpty(e.cons) && !e.cons.note ? (AK() ? AK().extraText(e) : e.text) : consText(e.cons));
  // полный текст для игрока: всё, что может случиться
  function fullConsText(r){
    const p = [];
    if(r.always && !consEmpty(r.always)) p.push('в любом случае: ' + consText(r.always));
    const main = consText(r.cons); if(main) p.push(main);
    (r.extras || []).forEach(e=>p.push(exName(e, r) + ': ' + exText(e)));
    if(r.sryv) p.push(r.sryv==='always' ? 'и срыв по к20' : 'если пси 0 и меньше — срыв по к20');
    return p.join('; ') || 'на усмотрение Мастера';
  }

  /* ---------- форма Мастера ---------- */
  let formEl = null;
  function closeForm(){ if(formEl){ formEl.remove(); formEl = null; } }
  const CONS_HEAD = {target:'При провале цели', creature:'При успехе существа (цель поражена)', auto:'Последствия (получат все отмеченные цели)'};
  function open(opts){
    opts = opts || {}; const gt = GT(); if(!gt) return;
    if(typeof session!=='undefined' && session.role==='player') return;
    closeForm();
    const toks = Object.values(gt.state.tokens || {}), src = opts.src ? gt.getToken(opts.src) : null;
    const pre = new Set((opts.targets || []).filter(id=>id!==opts.src));
    const tRow = (t)=>`<label class="tr-tg"><input type="checkbox" data-t="${esc(t.id)}" ${pre.has(t.id) ? 'checked' : ''}> ${esc(tokName(t))}${t.kind==='player' ? ' <span class="gs-muted">игрок</span>' : t.hidden ? ' <span class="gs-muted">скрыт</span>' : ''}</label>`;
    formEl = document.createElement('div'); formEl.className = 'ui-dlg-back tr-back show';
    formEl.innerHTML = `<div class="ui-dlg tr-form" role="dialog" aria-modal="true">
      <div class="ui-dlg-title">🎯 ${src ? esc(tokName(src)) + ': ' : ''}бросок цели</div>
      <label class="ui-dlg-field"><span>Способность</span><input data-f="title" type="text" maxlength="80" value="${esc(opts.title || '')}" placeholder="например, Угнетение"></label>
      <div class="rx-seg tr-mode"><button type="button" data-mode="target" class="on">Бросает цель</button><button type="button" data-mode="creature">Бросает существо против цели</button><button type="button" data-mode="auto">Без броска</button></div>
      <div class="tr-sec" data-sec="target"><div class="tr-row"><select data-f="stat">${CHECKS.map(([k, l])=>`<option value="${k}">${l}</option>`).join('')}</select>
        <label>модификатор <input data-f="mod" type="number" min="-21" max="21" step="1" value="0"></label><label class="tr-n" style="display:none">N <input data-f="n" type="number" min="0" max="40" value="12"></label>
        <select data-f="rmode" title="Упрощённый или Осложнённый бросок цели">${RMODE.map(([k, l])=>`<option value="${k}">${l}</option>`).join('')}</select></div></div>
      <div class="tr-sec" data-sec="creature" style="display:none"><div class="tr-row"><label>Максимум существа <input data-f="max" type="number" min="-10" max="60" value="16"></label>
        <label>против <select data-f="vs">${VS.map(([k, l])=>`<option value="${k}">${l}</option>`).join('')}</select> цели</label>
        <label title="Сколько атак: по одной на каждую отмеченную цель; если целей меньше — остальные атаки по кругу по тем же целям">атак <input data-f="an" type="number" min="1" max="12" value="1" style="width:44px"></label></div>
        <div class="gs-muted">Из Максимума вычитается характеристика каждой цели. Успех существа — цель поражена.</div></div>
      <div class="tr-sec" data-sec="auto" style="display:none"><div class="gs-muted">Броска нет: последствия получат все отмеченные цели (после «Применить»).</div></div>
      <div class="gs-sub">Цели</div>
      <div class="tr-row tr-area"><button type="button" class="gs-btn small" data-ar="pick" title="Шаблон области на столе: размеры из текста способности (или задайте ниже); задетые жетоны станут целями">📐 Область на столе</button>
        <select data-f="ashape"><option value="circle">круг</option><option value="line">полоса / луч</option><option value="cone">конус</option><option value="rect">квадрат</option></select>
        <label><input data-f="asize" type="number" min="0" max="999" step="0.5" style="width:60px" placeholder="м" title="Радиус круга, длина полосы/конуса или сторона квадрата, м; пусто — протянуть на столе"> м</label>
        <label class="tr-aw"><input data-f="aw" type="number" min="0" max="99" step="0.5" style="width:52px" value="1"> ширина, м</label>
        <select data-f="aat"><option value="self">от существа</option><option value="point">в точке</option></select>
        <button type="button" class="gs-btn small" data-ar="all" title="Все жетоны на поле, кроме существа">Все на поле</button><button type="button" class="gs-btn small" data-ar="none">Снять все</button></div>
      <div class="tr-targets">${toks.filter(t=>t.id!==opts.src).map(tRow).join('') || '<span class="gs-muted">На столе нет жетонов</span>'}</div>
      <div class="gs-sub tr-chead">${CONS_HEAD.target}</div>
      <div class="tr-row"><label>попаданий <input data-f="hn" type="text" size="3" value="0" title="Число или «к6» — бросок для каждой цели"></label>
        <select data-f="hk" title="Сколько попаданий: число; число + категория успеха существа; столько, сколько выпало на к20 существа"><option value="">шт.</option><option value="cat">+ категория успеха</option><option value="roll">= выпавшее к20</option></select>
        <label>МУ <input data-f="mu" type="number" min="0" max="40" value="12"></label><select data-f="mut">${MU_TYPES.map(m=>`<option>${m}</option>`).join('')}</select>
        <label>раны <input data-f="wounds" type="text" value="2" size="4" title="число или кубы: 3, к6, 1к6+3"></label><label><input type="checkbox" data-f="travma"> травма</label>
        <label title="Раны = выпавшее на к12 (если раны не указаны числом)"><input type="checkbox" data-f="moshh"> мощь</label><label title="Одно попадание: к12 по категории успеха существа, берётся лучший"><input type="checkbox" data-f="pul"> пул</label><label title="Одно попадание; +4 раны, если на к20 существа выпало 11+"><input type="checkbox" data-f="razryv"> разрыв</label></div>
      <div class="tr-row"><label>−ОЗ <input data-f="hp" type="text" size="5" placeholder="2к6" title="число или кубы"></label><label>−пси <input data-f="psi" type="number" min="0" max="20" value="0"></label>
        ${SHEET_STATES.map(([k, l])=>`<label><input type="checkbox" data-st="${k}"> ${l}</label>`).join('')}</div>
      <div class="tr-row">${Object.keys(gt.MARKS).filter(k=>k!=='fear').map(k=>`<label><input type="checkbox" data-mk="${k}"> ${gt.MARKS[k].toLowerCase()}</label>`).join('')}
        <label>на <input data-f="mr" type="text" size="3" value="1" title="Кругов: число или «к6»; 0 — пока не снимут"> кр.</label></div>
      <label class="ui-dlg-field"><span>Ещё (текстом — игрок увидит)</span><input data-f="note" type="text" maxlength="200" placeholder="например, отброшена на к6 м"></label>
      <div class="tr-extra"></div>
      <div class="ui-dlg-btns"><button type="button" class="ui-dlg-btn" data-x="cancel">Отмена</button><button type="button" class="ui-dlg-btn primary" data-x="go">Бросок</button></div></div>`;
    document.body.appendChild(formEl);
    let mode = 'target';
    const q = (s)=>formEl.querySelector(s);
    formEl.querySelector('.tr-mode').onclick = (e)=>{ const b = e.target.closest('[data-mode]'); if(!b) return; mode = b.dataset.mode;
      formEl.querySelectorAll('.tr-mode button').forEach(x=>x.classList.toggle('on', x===b));
      formEl.querySelectorAll('.tr-sec').forEach(s=>{ s.style.display = s.dataset.sec===mode ? '' : 'none'; });
      q('.tr-chead').textContent = CONS_HEAD[mode]; q('[data-x="go"]').textContent = mode==='auto' ? 'Далее' : 'Бросок'; };
    q('[data-f="stat"]').onchange = (e)=>{ q('.tr-n').style.display = NPLUS(e.target.value) ? '' : 'none'; };
    const syncArea = ()=>{ const sh = q('[data-f="ashape"]').value; q('.tr-aw').style.display = sh==='line' ? '' : 'none'; };
    q('[data-f="ashape"]').onchange = syncArea; syncArea();
    if(!src){ q('[data-f="aat"]').value = 'point'; q('[data-f="aat"]').disabled = true; }
    formEl.querySelector('.tr-area').addEventListener('click', (e)=>{
      const b = e.target.closest('[data-ar]'); if(!b) return;
      const boxes = [...formEl.querySelectorAll('[data-t]')];
      if(b.dataset.ar==='all'){ boxes.forEach(c=>{ c.checked = true; }); return; }
      if(b.dataset.ar==='none'){ boxes.forEach(c=>{ c.checked = false; }); return; }
      if(typeof AreaTemplates==='undefined') return;
      const sh = q('[data-f="ashape"]').value, size = +q('[data-f="asize"]').value || 0;
      const spec = {shape:sh, at:q('[data-f="aat"]').value, r:sh==='circle' ? size : 0, len:sh==='line' || sh==='cone' ? size : 0, side:sh==='rect' ? size : 0, w:+q('[data-f="aw"]').value || 1};
      formEl.style.display = 'none';
      const hidden = [...document.querySelectorAll('.bst-float, .tr-panel, #gmScreen.open')].filter(el=>el.style.visibility!=='hidden'); // карточка и панели не закрывают стол
      hidden.forEach(el=>{ el.style.visibility = 'hidden'; });
      if(typeof toggleMainTab==='function') toggleMainTab('table');
      setTimeout(()=>AreaTemplates.pick(spec, src ? src.id : null, q('[data-f="title"]').value || 'Область', (ids)=>{
        formEl.style.display = ''; hidden.forEach(el=>{ el.style.visibility = ''; });
        if(ids){ boxes.forEach(c=>{ c.checked = ids.indexOf(c.dataset.t) >= 0; }); uiToast(`Целей в области: ${ids.length}`, {icon:'📐'}); }
      }), 120);
    });
    formEl.addEventListener('click', (e)=>{ const x = e.target.closest('[data-x]'); if(!x) return;
      if(x.dataset.x==='cancel'){ closeForm(); return; }
      const val = (f)=>q(`[data-f="${f}"]`).value, num = (f)=>Math.round(+val(f) || 0);
      const targets = [...formEl.querySelectorAll('[data-t]:checked')].map(c=>c.dataset.t);
      if(!targets.length){ uiToast('Отметьте хотя бы одну цель', {icon:'🎯'}); return; }
      const mrRaw = String(val('mr')).trim(), mr = /[кkdд]/i.test(mrRaw) ? mrRaw.replace(/^1(?=[кkdд])/i, '') : Math.max(0, Math.round(+mrRaw || 0));
      const marks = [...formEl.querySelectorAll('[data-mk]:checked')].map(c=>({k:c.dataset.mk, r:mr}));
      const hk = val('hk'), hnRaw = String(val('hn')).trim(), hnDice = !hk && /^1?[кkdд]\d+$/i.test(hnRaw) ? hnRaw.replace(/^1/, '') : '';
      const cons = {hits:num('hn') > 0 || hk || hnDice ? {n:hnDice ? 1 : Math.max(0, num('hn')), nExpr:hnDice || null, byCat:hk==='cat', byRoll:hk==='roll', mu:num('mu'), muType:val('mut'), wounds:val('wounds').trim() || '1', travma:q('[data-f="travma"]').checked,
          moshh:q('[data-f="moshh"]').checked, pul:q('[data-f="pul"]').checked, razryv:q('[data-f="razryv"]').checked} : null,
        hp:val('hp').trim(), psi:Math.max(0, num('psi')), states:[...formEl.querySelectorAll('[data-st]:checked')].map(c=>c.dataset.st), marks, note:val('note').trim()};
      const sp = formEl._spec, on = (k)=>{ const el = q(`[data-xo="${k}"]`); return !!(el && el.checked); };
      const req = {id:'tr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title:val('title').trim() || 'Способность', src:src ? tokName(src) : 'Мастер', srcId:src ? src.id : null, mode,
        stat:val('stat'), mod:Math.max(-21, Math.min(21, num('mod'))), n:num('n'), max:num('max'), vs:val('vs'), rmode:mode==='target' ? val('rmode') : '', cons, rows:[],
        tgtFilter:sp && sp.tgtFilter || null, sryv:mode==='target' && val('stat')==='hladnokrovie' ? (sp && sp.sryv) || 'auto' : null, drain:!!(sp && sp.drain), oddNote:sp && sp.oddNote || '', cstat:sp && sp.opp ? sp.opp.stat : null, voidish:!!(sp && sp.voidish), atk:mode==='creature' && !!(sp && sp.atk), an:mode==='creature' ? Math.max(1, Math.min(12, num('an') || 1)) : 1};
      if(sp){
        if(mode!=='auto' && on('always')) req.always = sp.always;
        req.extras = (sp.extras || []).filter((e, i)=>on('ex' + i));
        if(on('chain')) req.chain = sp.chain;
        if(on('also')) req.also = sp.also;
        if(on('ongoing')) { req.ongoing = sp.ongoing; req.duration = sp.duration || null; }
        if(on('self')) req.selfCost = sp.selfCost;
        req.notes = sp.notes || [];
      }
      const fired = formEl._onFired; closeForm(); start(req, targets); if(fired) try{ fired(); }catch(err){}
    });
    formEl.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ e.stopPropagation(); closeForm(); } });
    if(opts.prefill) prefill(opts.prefill, q, (m)=>{ formEl.querySelector(`.tr-mode [data-mode="${m}"]`).click(); }, src);
    formEl._onFired = opts.onFired || null;
    if(opts.auto){ formEl.style.display = 'none'; q('[data-x="go"]').click(); if(formEl) formEl.style.display = ''; return; } // не прошло (нет целей) — форма для правки
    setTimeout(()=>{ const i = q('[data-f="title"]'); if(i) i.focus(); }, 30);
  }
  // Заполнить форму из разобранной способности (AbilityKit.parse)
  function prefill(s, q, setMode, src){
    const set = (f, v)=>{ const el = q(`[data-f="${f}"]`); if(el && v!=null){ el.value = v; el.dispatchEvent(new Event('change', {bubbles:true})); } };
    const auto = s.kind==='auto';
    if(auto) setMode('auto');
    else if(s.opp || s.atk){ setMode('creature'); set('max', (s.opp || s.atk).max); set('vs', s.opp ? s.opp.vs : ''); if(s.atk && s.atk.n) set('an', s.atk.n); }
    else if(s.check){ set('stat', s.check.stat); set('mod', s.check.mod || 0); if(s.check.n) set('n', s.check.n); if(s.check.rmode) set('rmode', s.check.rmode);
      if(s.check.vsSrc && src){ const v = statValue(src, s.check.vsSrc.stat) + s.check.vsSrc.bonus; set('mod', Math.max(-21, -v)); } } // «против воли пустоты»
    const c = auto ? (s.always || {}) : (s.cons || {});
    if(c.hits){ set('hn', DICE_N(c.hits) ? c.hits.nExpr : c.hits.byCat ? c.hits.n || 0 : c.hits.n || 1); set('hk', c.hits.byCat ? 'cat' : c.hits.byRoll ? 'roll' : ''); set('mu', c.hits.mu); set('mut', c.hits.muType); set('wounds', c.hits.wounds); ['travma', 'moshh', 'pul', 'razryv'].forEach(k=>{ q(`[data-f="${k}"]`).checked = !!c.hits[k]; }); }
    if(c.hp) set('hp', c.hp);
    if(c.psi) set('psi', c.psi);
    (c.states || []).forEach(k=>{ const el = formEl.querySelector(`[data-st="${k}"]`); if(el) el.checked = true; });
    (c.marks || []).forEach(m=>{ const el = formEl.querySelector(`[data-mk="${m.k}"]`); if(el){ el.checked = true; set('mr', m.r); } });
    const a = s.areaSpec;
    if(a && a.shape==='all'){ const boxes = [...formEl.querySelectorAll('[data-t]')], n = a.n ? GT().rollWoundsExpr(a.n) : boxes.length;
      const pl = (cb)=>((GT().getToken(cb.dataset.t) || {}).kind==='player' ? 0 : 1); // сначала персонажи игроков
      boxes.slice().sort((x, y)=>pl(x) - pl(y)).forEach((cb, i)=>{ cb.checked = i < n; });
      if(a.n) uiToast(`${a.n} = ${n}: отмечено ${Math.min(n, boxes.length)} целей — поправьте выбор`, {icon:'🎲'}); }
    else if(a){ set('ashape', a.shape); set('asize', a.shape==='circle' ? a.r : a.shape==='rect' ? a.side : a.len); if(a.w) set('aw', a.w); const at = q('[data-f="aat"]'); if(!at.disabled) at.value = a.at || 'self';
      q('[data-f="ashape"]').dispatchEvent(new Event('change')); q('.tr-area').classList.add('hl'); }
    const notes = [c.note || '', c.hits && c.hits.nExpr && !c.hits.byRoll && !DICE_N(c.hits) ? `попаданий ${c.hits.nExpr}` : '', c.hits && c.hits.woundsNote ? c.hits.woundsNote : ''].filter(Boolean).join('; ');
    if(notes) set('note', notes.slice(0, 200));
    // что ещё сказано в тексте — галочками (по умолчанию включено)
    formEl._spec = s;
    const box = q('.tr-extra'), li = [], ck = (k, html)=>li.push(`<label class="tr-x-i"><input type="checkbox" data-xo="${k}" checked> ${html}</label>`);
    if(!auto && s.always && !consEmpty(s.always)) ck('always', `<b>всем</b> (до броска, при любом исходе): ${esc(consText(s.always))}`);
    const tgtMode = !(s.opp || s.atk) && s.kind!=='auto';
    (s.extras || []).forEach((e, i)=>ck('ex' + i, `<b>${exName(e, {mode:tgtMode ? 'target' : 'creature'})}</b>: ${esc(exText(e))} <span class="gs-muted">${e.when==='rollGt' ? `— отметится само, если к20 существа выше ${esc(AbilityKit.extraName(e).replace(/^к20 выше /, ''))}` : e.when==='sizeLe' ? '— отметится само по размеру цели (у персонажа 0)' : e.when==='srcBigger' ? '— отметится само по размерам существа и цели (у персонажа 0)' : tgtMode ? '— у провалов с итогом 15 и меньше отметится само' : e.when==='cat2' ? '— при успехе существа кат. 2+ отметится само' : '— отметка в панели'}</span>`));
    if(s.also) ck('also', `<b>ещё ${s.also.atk.n > 1 ? s.also.atk.n + ' атаки' : 'атака'}</b> (Максимум ${s.also.atk.max}): ${esc(consText(s.also.cons))} <span class="gs-muted">— кнопка «▶ Ещё атака» после применения, цели выберете</span>`);
    if(s.chain) ck('chain', `<b>затем</b> для поражённых: ${esc(s.chain.check ? AbilityKit.CHECK_LABEL(s.chain.check) : s.chain.opp ? `Максимум ${s.chain.opp.max}${s.chain.opp.vs ? ' против цели' : ''}` : 'следующий бросок')}${consEmpty(s.chain.cons) ? '' : ' → ' + esc(consText(s.chain.cons))} <span class="gs-muted">— кнопка «▶ Дальше» после применения</span>`);
    if(s.ongoing && s.ongoing.length) ck('ongoing', `<b>каждый круг</b> (напоминание у поражённых${s.duration ? `, ${s.duration.base ? s.duration.base : ''}${s.duration.plusCat ? (s.duration.base ? ' + ' : '') + 'кат.' : ''} кр.` : ''}): ${esc(s.ongoing.join(' ').slice(0, 200))}`);
    if(s.selfCost && s.selfCost.length) ck('self', `<b>сама</b>: ${esc(s.selfCost.join(', '))} <span class="gs-muted">— существу при броске</span>`);
    const cond = (s.notes || []).filter(Boolean);
    box.innerHTML = (li.length ? `<div class="gs-sub">Ещё из текста способности</div>${li.join('')}` : '') +
      (cond.length ? `<div class="tr-cond"><b>Условия — решает Мастер:</b> ${cond.map(esc).join(' · ')}</div>` : '');
  }

  /* ---------- запуск: запросы игрокам, автоброски ---------- */
  let cur = null; // текущий запрос Мастера
  function rollD20(max, mode){
    if(max < 0) return {roll:0, max, success:false, cat:null, mode:'plain', rolls:[], impossible:true};
    const r1 = 1 + Math.floor(Math.random()*20), r2 = 1 + Math.floor(Math.random()*20), m = mode || 'plain';
    const r = m==='plain' ? r1 : pickD20ForMode(r1, r2, max, m), ev = evaluateD20Check(r, max); return {roll:r, max, success:ev.success, cat:ev.category, mode:m, rolls:m==='plain' ? [r1] : [r1, r2]}; }
  const checkLabel = (r)=>r.mode==='auto' ? `${r.src}: без броска` : r.mode==='creature' ? (r.vs ? `${r.src}: Максимум ${r.max} против ${(VS.find(v=>v[0]===r.vs) || [, r.vs])[1]} цели` : `${r.src}: Максимум ${r.max}`) :
    (r.stat==='psi_plus' ? `Проверка с Максимумом [${r.n} + пси-сопротивление]` : r.stat==='psi_cur_plus' ? `Проверка с Максимумом [${r.n} + текущие пси]` : `${LABEL[r.stat]} (${sgn(r.mod)})`);
  function start(req, ids){
    const gt = GT(), ak = AK(); cur = req;
    // расход самого существа («Пустота …, теряя 6 ОЗ»)
    if(req.selfCost && req.srcId){ const s = gt.getToken(req.srcId), m = /−(\d+)\s*ОЗ/.exec(req.selfCost.join(' ')); if(s && m && s.hp!=null) gt.updateToken(s.id, {hp:s.hp - +m[1]}); }
    const list = req.mode==='creature' && req.an > ids.length ? Array.from({length:req.an}, (_, i)=>[ids[i % ids.length], Math.floor(i / ids.length)]) : ids.map(id=>[id, 0]);
    list.forEach(([id, k])=>{ const t = gt.getToken(id); if(!t) return;
      const row = {id, key:id + (k ? '#' + k : ''), name:tokName(t) + (k ? ` (атака ${k + 1})` : ''), kind:t.kind, ownerId:t.ownerId || '', status:'wait', apply:false};
      req.rows.push(row);
      if(req.tgtFilter){ const f = req.tgtFilter, v = statValue(t, f.stat); if(f.le ? v > f.n : v < f.n){ Object.assign(row, {status:'done', roll:0, affected:false, apply:false, cat:null, pnote:`не действует: ${f.text.replace(/^\S+\s+с\s+/i, '')} — у цели ${v}`}); return; } }
      if(req.mode==='auto'){ Object.assign(row, {status:'done', roll:0, affected:true, apply:true}); return; }
      if(req.mode==='creature'){ const sv = statValue(t, req.vs), s0 = req.atk && ak && req.srcId ? gt.getToken(req.srcId) : null, am = s0 ? ak.abilityAtkMod(s0, t) : {mod:0, tags:[]}, r = rollD20(req.max - sv + am.mod);
        const pn = am.tags.concat(req.oddNote && r.roll % 2 ? ['нечётное к20: ' + req.oddNote.replace(/^если[^,]*,\s*(?:то\s+)?/i, '')] : []);
        Object.assign(row, r, {status:'done', stat:sv, affected:r.success}, pn.length ? {pnote:pn.join('; ')} : {}); row.apply = row.affected; return; }
      if(t.kind==='player'){
        const online = typeof session!=='undefined' && session.role==='gm' && session.players[t.ownerId];
        const over = req.stat==='hladnokrovie' && psiOf(gt.sheetOfToken(t))!=null && psiOf(gt.sheetOfToken(t)) <= 0; // нейропсихическая перегрузка
        if(over) row.pnote = 'нейропсихическая перегрузка (пси 0−): Осложнено';
        if(online){ sendMsg({type:'tr-req', req:{id:req.id, title:req.title, src:req.src, stat:req.stat, mod:req.mod, n:req.n, rmode:over ? mixMode(req.rmode, 'disadvantage') : req.rmode || '', cons:fullConsText(req)}}, t.ownerId); return; }
        row.status = 'offline'; return; // не на связи (или свой жетон на столе без сессии) — «🎲 за игрока»
      }
      const sp = ak ? ak.savePassives(t, realKey(req.stat)) : {mod:0, mode:'plain', immune:false, notes:[]};
      let max = baseFor(t, req.stat, req.n) + (NPLUS(req.stat) ? 0 : req.mod) + sp.mod;
      if(sp.altMax && sp.altMax.max + req.mod > max){ max = sp.altMax.max + req.mod; sp.notes.push(`${sp.altMax.name}: мистика (${sp.altMax.max})`); ak.bump(t.id, sp.altMax.key, 1); }
      if(sp.consume) ak.consumeBuff(t.id, sp.consume);
      const r = sp.immune ? {roll:0, max:0, success:true, cat:1, mode:'plain'} : rollD20(max, mixMode(req.rmode, sp.mode));
      Object.assign(row, r, {status:'done', affected:!r.success, pnote:sp.notes.join('; ')}); row.apply = row.affected;
    });
    render();
  }
  // за игрока (не на связи или не отвечает): по копии его листа у Мастера
  function rollFor(row){
    const gt = GT(), t = gt.getToken(row.id); if(!t || !cur) return;
    const over = cur.stat==='hladnokrovie' && psiOf(gt.sheetOfToken(t))!=null && psiOf(gt.sheetOfToken(t)) <= 0;
    const base = baseFor(t, cur.stat, cur.n), r = rollD20(base + (NPLUS(cur.stat) ? 0 : cur.mod), over ? mixMode(cur.rmode, 'disadvantage') : cur.rmode || 'plain');
    Object.assign(row, r, {status:'done', affected:!r.success, byGm:true, ex:null}); row.apply = row.affected; render();
  }

  /* ---------- панель результатов ---------- */
  let panel = null;
  // дополнительные последствия по умолчанию: у броска цели «кат. 2» и «15−» — провал категории 2 (итог 15 и меньше);
  // у встречной — успех существа категории 2+; если сначала нужна ещё проверка («…или будет сожрана») — решает Мастер
  function exDefault(r, x, e){ if(!x.affected || e.viaCheck) return false;
    if(e.when==='rollGt' || e.when==='sizeLe' || e.when==='srcBigger'){ const t = GT().getToken(x.id); if(!t) return false;
      if(e.when==='srcBigger'){ const sr = r.srcId && GT().getToken(r.srcId); return !!sr && sizeOf(sr) - sizeOf(t) >= e.n; }
      return e.when==='sizeLe' ? sizeOf(t) <= e.n : r.mode==='creature' && x.roll > statValue(t, e.stat); }
    if(r.mode==='target') return x.roll > 0 && failCat(x.roll)===2;
    if(r.mode==='creature') return e.when==='cat2' && (x.cat || 0) >= 2;
    return false; }
  function render(){
    if(!cur){ if(panel){ panel.remove(); panel = null; } return; }
    if(!panel){ panel = document.createElement('div'); panel.className = 'tr-panel'; document.body.appendChild(panel); panel.addEventListener('click', onPanel); panel.addEventListener('change', onPanel); }
    const r = cur, done = r.rows.filter(x=>x.status==='done'), failed = done.filter(x=>x.affected), auto = r.mode==='auto';
    const W = auto ? ['получит', 'получит'] : r.mode==='creature' ? ['поражён', 'устоял'] : ['провал', 'успех'];
    const rowHtml = (x)=>{
      if(x.status==='done' && !x.ex) x.ex = (r.extras || []).map(e=>exDefault(r, x, e));
      const ex = x.status==='done' && x.affected ? (r.extras || []).map((e, i)=>`<label class="tr-ex" title="${esc(exText(e))}"><input type="checkbox" data-ex="${i}" ${x.ex[i] ? 'checked' : ''}> ${exName(e, r)}</label>`).join('') : '';
      const res = x.status==='done' ? (auto ? '' : `<span class="tr-res ${x.affected ? 'bad' : 'ok'}">${x.affected ? W[0] : W[1]}${x.affected && r.mode==='creature' && x.cat ? ', кат. ' + x.cat : !x.affected && r.mode!=='creature' && x.cat ? ', КУ' + x.cat : x.affected && r.mode==='target' && x.roll ? ', кат. ' + failCat(x.roll) : ''}</span><span class="gs-muted">${x.impossible ? `Макс.${x.max} < 0 — бросок невозможен` : x.roll ? `к20=${x.roll} / Макс.${x.max}` : 'без броска'}${r.mode==='creature' && r.vs ? ` (${r.max} − ${x.stat})` : ''}${x.byGm ? ' · бросил Мастер' : ''}${x.rerolled ? ' · ' + esc(x.rerolled.trim()) : ''}${x.pnote ? ' · ' + esc(x.pnote) : ''}${x.mode && x.mode!=='plain' ? ' · ' + (x.mode==='advantage' ? 'Упрощено' : 'Осложнено') + ' [' + (x.rolls || []).join(', ') + ']' : ''}</span>`)
        : x.status==='wait' ? '<span class="gs-muted">ждём бросок игрока…</span>' : '<span class="gs-muted">игрок не на связи</span>';
      return `<div class="tr-r" data-r="${esc(x.key || x.id)}"><label><input type="checkbox" data-ap ${x.apply ? 'checked' : ''} ${x.status==='done' ? '' : 'disabled'}> <b>${esc(x.name)}</b></label>${res}${ex}
        ${x.status!=='done' && x.kind==='player' && r.mode==='target' ? `<button type="button" class="gs-btn small" data-rf="${esc(x.id)}" title="Бросить за игрока по копии его листа">🎲 за игрока</button>` : ''}${rerollBtns(r, x)}</div>`;
    };
    const nApply = r.rows.filter(x=>x.apply).length, hasAlways = r.always && !consEmpty(r.always);
    panel.innerHTML = `<div class="tr-head"><b>🎯 ${esc(r.src)} — ${esc(r.title)}</b><button type="button" class="tr-x" data-trx="close" title="Закрыть">✕</button></div>
      <div class="gs-muted">${esc(checkLabel(r))}</div>
      ${hasAlways ? `<div class="gs-muted">Всем (при любом исходе): ${esc(consText(r.always))}</div>` : ''}
      <div class="gs-muted">${auto ? 'Последствия' : r.mode==='creature' ? 'Поражённым' : 'Провал'}: ${esc(consText(r.cons) || (hasAlways ? '—' : 'на усмотрение Мастера'))}</div>
      ${(r.extras || []).map(e=>`<div class="gs-muted">${exName(e, r)}: ${esc(exText(e))}</div>`).join('')}
      ${r.chain ? '<div class="gs-muted">Затем — следующий бросок для поражённых (после «Применить»)</div>' : ''}
      ${r.ongoing && r.ongoing.length ? '<div class="gs-muted">Каждый круг — напоминание у поражённых</div>' : ''}
      ${(r.notes || []).length ? `<div class="tr-cond">Условия: ${r.notes.map(esc).join(' · ')}</div>` : ''}
      <div class="tr-rows">${r.rows.map(rowHtml).join('')}</div>
      <div class="gs-row"><button type="button" class="gs-btn primary" data-trx="apply" ${nApply || hasAlways ? '' : 'disabled'}>${auto ? 'Применить' : r.mode==='creature' ? 'Применить к поражённым' : 'Применить провалы'} (${nApply}${hasAlways ? ' + всем' : ''})</button>
        <span class="gs-muted">${auto ? r.rows.length + ' целей' : `${done.length}/${r.rows.length} бросили · ${r.mode==='creature' ? 'поражено' : 'провалили'} ${failed.length}`}</span></div>`;
  }
  // Переброс способностью существа: NPC-цель провалила проверку или существо промахнулось встречной проверкой
  function rerollFor(r, x){
    if(x.status!=='done' || !AK() || r.mode==='auto') return [];
    const gt = GT();
    if(r.mode==='creature'){ if(x.affected || !r.srcId) return []; const s = gt.getToken(r.srcId); return s ? AbilityKit.rerollOptions(s, r.vs || r.cstat ? {type:'check', stat:r.cstat || 'mistika'} : {type:'attack-own'}).map(o=>Object.assign(o, {who:r.srcId})) : []; }
    if(x.kind!=='gm' || !x.affected) return [];
    const t = gt.getToken(x.id); return t ? AbilityKit.rerollOptions(t, {type:'check', stat:realKey(r.stat)}).map(o=>Object.assign(o, {who:x.id})) : [];
  }
  const rerollBtns = (r, x)=>rerollFor(r, x).map(o=>`<button type="button" class="gs-btn small" data-rr="${esc(x.id)}" data-rk="${esc(o.key)}" title="${esc(o.text)}">↻ ${esc(o.name)}${o.total ? ` ${o.left}/${o.total}` : ''}</button>`).join('');
  function doReroll(x, key){
    const o = rerollFor(cur, x).find(z=>z.key===key); if(!o) return;
    AbilityKit.bump(o.who, key, 1);
    const r = rollD20(x.max), was = x.roll;
    Object.assign(x, r); if(cur.mode==='creature') x.affected = r.success; else x.affected = !r.success;
    x.apply = x.affected; x.ex = null; x.rerolled = (x.rerolled || '') + `↻ ${o.name}: ${was}→${r.roll} `;
    render(); uiToast(`«${o.name}»: к20 ${was} → ${r.roll}`, {icon:'↻'});
  }
  function onPanel(e){
    const rowOf = (el)=>cur.rows.find(x=>(x.key || x.id)===el.closest('[data-r]').dataset.r);
    const ap = e.target.closest && e.target.closest('[data-ap]');
    if(ap && e.type==='change'){ const row = rowOf(ap); if(row){ row.apply = ap.checked; render(); } return; }
    const exb = e.target.closest && e.target.closest('[data-ex]');
    if(exb && e.type==='change'){ const row = rowOf(exb); if(row && row.ex) row.ex[+exb.dataset.ex] = exb.checked; return; }
    if(e.type!=='click') return;
    const rr = e.target.closest('[data-rr]'); if(rr){ const row = cur.rows.find(x=>x.id===rr.dataset.rr); if(row) doReroll(row, rr.dataset.rk); return; }
    const rf = e.target.closest('[data-rf]'); if(rf){ const row = cur.rows.find(x=>x.id===rf.dataset.rf); if(row) rollFor(row); return; }
    const x = e.target.closest('[data-trx]'); if(!x) return;
    if(x.dataset.trx==='close'){ if(cur.rows.some(r=>r.status==='done' && r.apply) && !cur.applied){ uiConfirm('Закрыть без применения последствий?', {title:'Бросок цели', ok:'Закрыть'}).then(ok=>{ if(ok){ cur = null; render(); } }); return; } cur = null; render(); }
    else if(x.dataset.trx==='apply') applyAll();
  }

  /* ---------- последствия — после подтверждения Мастера ---------- */
  function grantTo(ownerId, g){
    const gt = GT(); if(gt && ownerId && ownerId===gt.ownerIdHere() && typeof character!=='undefined' && character){ const t = applyGrant(character, Object.assign({gid:'local'}, g)); if(t) logEvent(character, t); renderAll(); return; }
    sendGrant(ownerId, g);
  }
  // «раны [размер цели]», «[размер пустоты + 1]» — по жетону (у персонажа размер 0), не меньше 1
  const sizeOf = (t)=>t && t.creature && isFinite(+t.creature.rz) ? +t.creature.rz : 0; // у персонажа — 0
  function sizeWounds(expr, t, srcId){
    const m = /^размер\s+(цели|существа)(?:\+(\d+))?$/i.exec(String(expr || '')); if(!m) return expr;
    const o = /цели/i.test(m[1]) ? t : srcId && GT().getToken(srcId);
    return String(Math.max(1, sizeOf(o) + (+m[2] || 0)));
  }
  // одно «пакетное» последствие одной цели; x — строка панели (категория, к20); возвращает список сделанного
  function applyCons(t, c, x, done){
    const gt = GT(), ak = AK(); if(!c) return;
    const imm = ak && t.kind==='gm' ? ak.immuneStates(t) : new Set(), skipped = [];
    if(c.hits){ const H = c.hits, one = H.pul || H.razryv, n = one && (H.byCat || H.byRoll) ? 1 : H.byCat ? (H.n || 0) + Math.max(1, x.cat || 1) : H.byRoll ? Math.max(1, x.roll || 1) : DICE_N(H) ? gt.rollWoundsExpr(H.nExpr) : H.n;
      const crt = cur && cur.mode==='creature' && x.affected, w = sizeWounds(H.wounds, t, cur && cur.srcId);
      const h = n > 0 ? gt.applyHitsTo(t.id, {n, mu:H.mu, muType:H.muType, wounds:w, travma:H.travma, moshh:!!H.moshh, pul:!!H.pul, razryv:!!H.razryv, cat:crt ? x.cat : 0, roll:crt ? x.roll : 0}) : null;
      if(h) x._w = (x._w || 0) + h.total;
      if(h) done.push(`${DICE_N(H) ? H.nExpr + '=' : ''}${n}×МУ ${H.mu}${H.moshh || H.pul || H.razryv ? ' (' + ['мощь', 'пул', 'разрыв'].filter((k, i)=>H[['moshh', 'pul', 'razryv'][i]]).join(', ') + ')' : ''}${w!==H.wounds ? `, раны ${w}` : ''}: ${h.text}`); }
    if(c.hp){ const v = gt.rollWoundsExpr(c.hp); if(v){ const t2 = gt.getToken(t.id); if(t.kind==='player') grantTo(t.ownerId, {kind:'vitals', which:'hp', mode:'delta', value:-v}); else if(t2 && t2.hp!=null) gt.updateToken(t.id, {hp:t2.hp - v}); x._w = (x._w || 0) + v; x._hp = (x._hp || 0) + v; done.push(`−${v} ОЗ`); } }
    const sh = t.kind==='player' ? gt.sheetOfToken(t) : null, sts = (sh && sh.states) || {};
    if(c.psi){ if(t.kind==='player'){ grantTo(t.ownerId, {kind:'vitals', which:'psi', mode:'delta', value:-c.psi}); x._psi = (x._psi || 0) + c.psi; done.push(`−${c.psi} пси`); } else done.push(`−${c.psi} пси (у существа — вручную)`); }
    (c.states || []).forEach(k=>{ const nm = (SHEET_STATES.find(s=>s[0]===k) || [, k])[1];
      if(imm.has(k)){ skipped.push(nm); return; }
      if(t.kind==='player' && k==='stress' && sts.stress){ grantTo(t.ownerId, {kind:'vitals', which:'psi', mode:'delta', value:-1}); x._psi = (x._psi || 0) + 1; done.push('стресс уже есть → −1 пси'); return; }
      if(t.kind==='player' && k==='istoshenie' && sts.istoshenie){ gt.addMarkTo(t.id, 'limit', 0); done.push('второе истощение → на пределе сил (без сознания)'); return; }
      if(t.kind==='player') grantTo(t.ownerId, {kind:'state', key:k, on:true}); else if(k==='ispug') gt.addMarkTo(t.id, 'fear', 0); done.push(nm + (t.kind!=='player' && k!=='ispug' ? ' (у существа — вручную)' : '')); });
    (c.marks || []).forEach(m=>{ const nm = gt.MARKS[m.k].toLowerCase();
      if(imm.has(m.k)){ skipped.push(nm); return; }
      const n = gt.addMarkTo(t.id, m.k, m.r); done.push(nm + (typeof m.r==='string' && n ? ` (${m.r}=${n} кр.)` : '')); });
    if(c.note) done.push(c.note);
    if(skipped.length) done.push('невосприимчив: ' + skipped.join(', '));
  }
  function applyAll(){
    const gt = GT(), ak = AK(), r = cur; if(!r) return;
    const parts = [], hit = [];
    const hasAlways = r.always && !consEmpty(r.always);
    r.rows.forEach(x=>{
      const t = gt.getToken(x.id); if(!t) return;
      const done = []; x._w = 0; x._hp = 0; x._psi = 0;
      const psi0 = t.kind==='player' ? psiOf(gt.sheetOfToken(t)) : null;
      if(hasAlways) applyCons(t, r.always, x, done);
      const hitNow = x.apply && x.status==='done';
      if(hitNow){
        if(!(r.extras || []).some((e, i)=>e.replace && x.ex && x.ex[i])) applyCons(t, r.cons, x, done);
        (r.extras || []).forEach((e, i)=>{ if(!(x.ex && x.ex[i])) return; const d = []; if(consEmpty(e.cons)) d.push(e.cons.note || e.text); else applyCons(t, e.cons, x, d); done.push(exName(e, r) + ': ' + d.join(', '));
          if(e.mutation && ak) ak.alert({kind:'trig', title:`🧬 Пси-мутация: ${x.name}`, text:'Спасбросок от пси-поля провален с итогом 15−. Выберите часть тела — бросок по таблице пси-мутаций (стр. 32).',
            actions:Object.keys(MUT).map(part=>({label:part, run:()=>rollMutation(x.name, part)})), ms:180000}); });
        // срыв: после провала хладнокровия пси 0 и меньше (или «ещё получая срыв») — по к20 этой проверки
        if(r.sryv && r.mode==='target'){
          const left = psi0==null ? null : psi0 - (x._psi || 0), sr = sryvOf(x.roll);
          if(sr && t.kind==='player' && (r.sryv==='always' || (left!=null && left <= 0))) done.push(`срыв (к20=${x.roll}): ${sr[2]} — ${sr[3]}`);
          else if(sr && t.kind!=='player' && r.sryv==='always') done.push(`срыв (к20=${x.roll}): ${sr[2]} — ${sr[3]}`);
          else if(t.kind==='player' && psi0==null) done.push('срыв — если пси 0 и меньше (лист недоступен)'); }
        hit.push(x);
        if(r.ongoing && r.ongoing.length && ak){ const du = r.duration; const left = du ? (du.base || 0) + (du.plusCat ? Math.max(1, x.cat || 1) : 0) : 0;
          r.ongoing.forEach(text=>ak.addOngoing({tokId:x.id, srcId:r.srcId, title:r.title, text, voidish:r.voidish, left:left || null})); done.push('каждый круг: напоминание' + (left ? ` (${left} кр.)` : '')); }
      }
      if(done.length || hitNow) parts.push(`${x.name} — ${done.join(', ') || 'без последствий'}`);
      if(x._w > 0 && t.creature && ak) setTimeout(()=>{ try{ ak.onWounded(gt.getToken(t.id), x._w); }catch(e){ console.warn('[Способности]', e); } }, 0);
    });
    const ok = r.mode==='auto' ? [] : r.rows.filter(x=>x.status==='done' && !x.affected).map(x=>x.name);
    const drained = r.drain ? r.rows.reduce((a, x)=>a + (x._hp || 0), 0) : 0, sTok = drained && r.srcId ? gt.getToken(r.srcId) : null;
    if(sTok && sTok.hp!=null){ const nh = sTok.hpMax!=null ? Math.min(sTok.hpMax, sTok.hp + drained) : sTok.hp + drained; gt.updateToken(sTok.id, {hp:nh}); r.selfCost = (r.selfCost || []).concat([`+${nh - sTok.hp} ОЗ (исцелилась)`]); }
    const text = `${r.src} — «${r.title}» (${checkLabel(r)}): ${parts.length ? parts.join('; ') : 'никто не пострадал'}${ok.length ? '. Устояли: ' + ok.join(', ') : ''}${r.selfCost ? '. Сама: ' + r.selfCost.join(', ') : ''}`;
    recordAndShareQuickRoll({abilityUse:true, text:text.slice(0, 900)});
    r.applied = true; cur = null; render();
    uiToast('Последствия применены', {icon:'🎯'});
    if(r.also && ak){ const al = Object.assign({}, r.also, {voidish:r.voidish}), n = al.atk.n || 1;
      ak.alert({kind:'trig', title:`⚔ ${r.title} — ещё ${n > 1 ? n + ' атаки' : 'атака'}`, text:`Максимум ${al.atk.max}${consEmpty(al.cons) ? '' : ' → ' + consText(al.cons)} — выберите цели`,
        actions:[{label:'▶ Ещё атака', run:()=>open({src:r.srcId, targets:[], title:r.title + ' — ещё атака', prefill:al})}], ms:120000}); }
    // «затем»: следующий бросок для поражённых
    if(r.chain && hit.length && ak){
      const ids = hit.map(x=>x.id), ch = Object.assign({}, r.chain, {voidish:r.voidish});
      ak.alert({kind:'trig', title:`▶ ${r.title} — дальше`, text:`Следующий бросок для: ${hit.map(x=>x.name).join(', ')} — ${ch.check ? AbilityKit.CHECK_LABEL(ch.check) : ch.opp ? 'Максимум ' + ch.opp.max : ch.atk ? 'атака' : 'последствия'}${consEmpty(ch.cons) ? '' : ' → ' + consText(ch.cons)}`,
        actions:[{label:'▶ Дальше', run:()=>open({src:r.srcId, targets:ids, title:r.title + ' — затем', prefill:ch})}], ms:120000});
    }
  }

  /* ---------- игрок: запрос Мастера ---------- */
  const pending = []; let chip = null, waitRoll = null;
  function syncChip(){
    if(!pending.length){ if(chip){ chip.remove(); chip = null; } return; }
    if(!chip){ chip = document.createElement('button'); chip.type = 'button'; chip.className = 'tr-chip'; chip.onclick = ()=>showReq(pending[0]); document.body.appendChild(chip); }
    chip.textContent = `🎯 Мастер ждёт бросок${pending.length > 1 ? ' (' + pending.length + ')' : ''}`;
  }
  const askLabel = (q)=>(q.stat==='psi_plus' ? `Проверка с Максимумом [${q.n} + пси-сопротивление]` : q.stat==='psi_cur_plus' ? `Проверка с Максимумом [${q.n} + текущие пси]` : `${LABEL[q.stat] || q.stat} (${sgn(q.mod)})`)
    + (q.rmode==='advantage' ? ' — Упрощённо' : q.rmode==='disadvantage' ? ' — Осложнённо' : '');
  async function showReq(q){
    const r = await uiDialog({title:'Бросок по требованию Мастера', icon:'🎯', html:`<div class="tr-ask"><b>${esc(q.src)} — ${esc(q.title)}</b><div class="tr-ask-check">${esc(askLabel(q))}</div><div class="gs-muted">При провале: ${esc(q.cons)}</div></div>`,
      cancelValue:null, buttons:[{label:'Позже', value:null}, {label:'🎲 Бросить', value:'roll', primary:true}]});
    if(r==='roll') rollReq(q);
  }
  function rollReq(q){
    if(typeof character==='undefined' || !character){ uiAlert('Нет персонажа — бросать нечем. Создайте персонажа или загрузите его.'); return; }
    const key = realKey(q.stat);
    if(NPLUS(key)){
      const max = (+q.n || 0) + (key==='psi_plus' ? +character.psiSoprot || 0 : +character.psiCurrent || 0), roll = 1 + Math.floor(Math.random()*20), ev = evaluateD20Check(roll, max);
      recordAndShareQuickRoll({diceType:'d20', mode:'plain', max, rolls:[roll], roll, success:ev.success, category:ev.category});
      answer(q, {roll, max, success:ev.success, cat:ev.category}); return;
    }
    if(!(SAVE_ROLL_DEFS[key] || (character.stats && character.stats[key]!==undefined))){ uiAlert('На листе нет такой проверки — бросьте вручную и скажите Мастеру.'); return; }
    if(typeof toggleMainTab==='function') toggleMainTab('sheet');
    waitRoll = {q, key};
    openRollPicker(key, innerWidth/2, innerHeight/2, Math.max(-21, Math.min(21, +q.mod || 0)));
    uiToast(`Протяните к модификатору ${sgn(+q.mod || 0)} — он подсвечен`, {icon:'🎯', ms:5000});
  }
  function answer(q, res){
    sendMsg({type:'tr-res', reqId:q.id, roll:res.roll, max:res.max, success:!!res.success, cat:res.cat || 0}, session.gmId);
    const i = pending.indexOf(q); if(i >= 0) pending.splice(i, 1); syncChip();
    uiToast(`Результат ушёл Мастеру: ${res.success ? 'успех' : 'провал'}`, {icon:'🎯'});
  }
  // бросок из окна листа по запросу — перехватываем результат
  if(typeof recordAndShareRoll==='function'){
    const orig = recordAndShareRoll;
    window.recordAndShareRoll = function(statKey, mod, roll, max, success, category){
      const out = orig.apply(this, arguments);
      try{ if(waitRoll && statKey===waitRoll.key){ const q = waitRoll.q; waitRoll = null; answer(q, {roll, max, success, cat:category}); } }catch(e){ console.warn('[Бросок цели]', e); }
      return out;
    };
  }
  function handle(msg){
    if(msg.type==='tr-req'){
      if(!(session.role==='player' && msg.from && msg.from===session.gmId) || !msg.req) return true;
      const q = msg.req, s = (v, n)=>String(v==null ? '' : v).slice(0, n);
      const req = {id:s(q.id, 40), title:s(q.title, 80), src:s(q.src, 60), stat:CHECKS.some(c=>c[0]===q.stat) ? q.stat : 'volya', mod:Math.max(-21, Math.min(21, Math.round(+q.mod || 0))), n:Math.round(+q.n || 0), rmode:['advantage', 'disadvantage'].indexOf(q.rmode) >= 0 ? q.rmode : '', cons:s(q.cons, 400)};
      pending.push(req); syncChip(); showReq(req); return true;
    }
    if(msg.type==='tr-res'){
      if(!cur || session.role!=='gm' || msg.reqId!==cur.id) return true;
      const row = cur.rows.find(x=>x.kind==='player' && x.ownerId===msg.from && x.status!=='done'); if(!row) return true;
      Object.assign(row, {roll:Math.max(1, Math.min(20, Math.round(+msg.roll || 0))), max:Math.round(+msg.max || 0), success:!!msg.success, cat:Math.round(+msg.cat || 0), status:'done', affected:!msg.success, ex:null});
      row.apply = row.affected; render(); return true;
    }
    return false;
  }
  return { open, handle, render, consText, npcStat };
})();
