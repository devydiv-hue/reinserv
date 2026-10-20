/* ======================================================================
   СПОСОБНОСТИ СУЩЕСТВ: разбор текста в готовые действия (этап 2).
   - AbilityKit.parse(название, текст) → схема: бросок цели (проверка и модификатор) или встречная проверка
     (Максимум существа против характеристики цели) или атака с Максимумом; попадания (МУ, тип, раны, травма);
     потеря ОЗ и пси; состояния (испуг, истощение, стресс) и отметки (шок, сбит с ног, схвачен, оглушён, ослеплён);
     область (текстом — для этапа 3); переброс; срабатывание на провал «15−»; ограничение по использованию
     (2 раза в день, раз в сцену…); действие / реакция / свободное действие.
   - Карточка существа (бестиарий, карточка жетона): под каждой способностью и ходом пустоты — плашки разобранного
     и «▶» — форма «Бросок цели» уже заполнена; у жетона — счётчик использований («1/2 в день», ↺ — сбросить).
   - Конструктор существа: под полем «Способности» по ходу набора — что распознано в каждом абзаце.
   Опирается на формулировки книги («Бросок рефлексов (−6)», «спасбросок от пси-поля (+3)», «2 попадания с МУ 12
   удар, раны 3, травма»); всё нераспознанное остаётся текстом, а форму перед броском можно поправить.
   ====================================================================== */
const AbilityKit = (function(){
  const esc = (s)=>escapeHtml(s==null ? '' : String(s));
  const NUM = (s)=>+String(s).replace('−', '-').replace('+', '');
  const STAT_RE = {volya:'вол', refleksy:'рефлекс', vynoslivost:'вынослив', sila:'сил', duh:'дух', smekalka:'смекалк', legkaya_atletika:'л[её]гк\\S* атлетик', lovkost_ruk:'ловкост\\S* рук', vospriyatie:'восприяти', mistika:'мистик'};
  const STAT_NAME = {volya:'воли', refleksy:'рефлексов', vynoslivost:'выносливости', sila:'силы', duh:'духа', smekalka:'смекалки', legkaya_atletika:'лёгкой атлетики', lovkost_ruk:'ловкости рук', vospriyatie:'восприятия', mistika:'мистики'};
  const statOf = (w)=>{ const s = String(w || '').toLowerCase(); return Object.keys(STAT_RE).find(k=>new RegExp('^' + STAT_RE[k]).test(s)) || null; };
  const MOD = '\\s*\\(?\\s*([−+-]\\s*\\d+)\\s*\\)?';
  const MU_T = '(удар|патрон|энергия|температура|взрыв)';
  const MARK_RE = [['shock', /шок/i], ['prone', /сбит\S* с ног|падает на землю|пада\S* на землю/i], ['grabbed', /схвачен|захват\S* состоял|связан\S* с херувим/i], ['stunned', /оглуш[её]н|ошеломл/i], ['blind', /слепнет|ослеп/i]];
  const STATE_RE = [['ispug', /испуг|испуган/i], ['istoshenie', /истощени/i], ['stress', /стресс/i]];

  const CHECK_LABEL = (c)=>c.stat==='psi_plus' ? `Максимум [${c.n} + пси-сопр.]` : c.stat==='hladnokrovie' ? `хладнокровие${c.mod ? ' (' + (c.mod>0 ? '+' : '−') + Math.abs(c.mod) + ')' : ''}` :
    c.stat.indexOf('save_')===0 ? `спасбросок ${({save_psi_pole:'пси-поле', save_vrednaya_sreda:'вредная среда', save_kislotnost:'кислотность', save_pryamoy_kontakt:'контакт'})[c.stat]}${c.mod ? ' (' + (c.mod>0 ? '+' : '−') + Math.abs(c.mod) + ')' : ''}` :
    `Бросок ${STAT_NAME[c.stat] || c.stat}${c.mod ? ' (' + (c.mod>0 ? '+' : '−') + Math.abs(c.mod) + ')' : ''}`;
  // Область способности в метрах: форма, размеры и откуда (от существа или в точке) — для шаблона на столе
  function areaSpec(t){
    let m; const L = (x)=>+String(x).replace(',', '.');
    if((m = /луч\S*\s+шириной\s+(?:в\s+)?([\d,]+)\s*м\S*\s+и\s+длиной\s+(?:до\s+)?(\d+)/i.exec(t))) return {shape:'line', w:L(m[1]), len:+m[2], at:'self'};
    if((m = /(?:пото\S*|полос\S*)[^.]{0,40}?шириной\s+(?:в\s+)?(\d+)\s*м\S*\s+и\s+длиной\s+(?:до\s+)?(\d+)/i.exec(t))) return {shape:'line', w:+m[1], len:+m[2], at:'self'};
    if((m = /полос\S*\s+длиной\s+(?:до\s+)?(\d+)\s*м\S*\s+и\s+шириной\s+(?:в\s+)?(\d+)/i.exec(t))) return {shape:'line', len:+m[1], w:+m[2], at:'self'};
    if((m = /шириной\s+в\s+(\d+)\s+и\s+длиной\s+в?\s*(\d+)\s*м/i.exec(t))) return {shape:'line', w:+m[1], len:+m[2], at:'self'};
    if((m = /полос\S*\s+шириной\s+(?:в\s+)?(\d+)\s*м/i.exec(t))){ const l = /до\s+(\d+)\s*м/i.exec(t); return {shape:'line', w:+m[1], len:l ? +l[1] : 12, at:'self'}; }
    if((m = /кривой\s+длиной\s+до\s+(\d+)\s*м/i.exec(t))) return {shape:'line', w:3, len:+m[1], at:'self'};
    if((m = /квадратной области со стороной в\s+(\d+)/i.exec(t)) || (m = /област\S*\s+(?:в\s+)?(\d+)\s*[×x]\s*\d+/i.exec(t))) return {shape:'rect', side:+m[1], at:'point'};
    if((m = /в радиусе\s+(\d+)\s*(?:м|метр)/i.exec(t))) return {shape:'circle', r:+m[1], at:/точк/i.test(t.slice(m.index, m.index + 50)) ? 'point' : 'self'};
    if((m = /цель и все[^.]{0,30}в пределах\s+(\d+)\s*м/i.exec(t))) return {shape:'circle', r:+m[1], at:'point'};
    if((m = /(?:все|кажд\S*)[^.]{0,50}?в пределах\s+(\d+)\s*(?:м|метр)/i.exec(t)) || (m = /в пределах\s+(\d+)\s*(?:м|метр\S*)\s+от\s+(?:неё|него|себя|пустоты|херувима)/i.exec(t))) return {shape:'circle', r:+m[1], at:'self'};
    if(/все видящ|все слышащ|кажд\S* слышащ|кажд\S*,? (?:видящ|слышащ)|все существа(?! в)|все персонажи|к6 видимых|в пределах прямого обзора/i.test(t)) return {shape:'all'};
    return null;
  }
  function parse(name, text){
    const t = String(text || ''), full = `${name || ''} ${t}`, s = {chips:[], cons:{states:[], marks:[]}};
    // ограничение по использованию: «(2 раза в день)», «раз в день», «до 3 раз в день», «раз в сцену», «2 раза в круг»
    const um = /\(?(?:до\s+)?(\d+)?\s*раз[а]?\s+в\s+(день|сутки|сцену|круг|ход|игровую встречу|встречу|3 круга)\)?/i.exec(full);
    if(um){ const per = /сутки|день/.test(um[2]) ? 'день' : /встреч/.test(um[2]) ? 'встречу' : um[2]==='3 круга' ? '3 круга' : um[2]; s.uses = {n:+um[1] || 1, per}; }
    s.act = /свободным действием/i.test(t) ? 'свободное' : /реакцией/i.test(t) ? 'реакция' : /действием|тратит действие|затратив действие/i.test(t) ? 'действие' : null;
    // встречная проверка: «Бросок мистики (19) против воли цели», «Максимумом 19 против рефлексов», «проверку к20 с Максимумом 19 против рефлексов цели»
    let m = /Брос\S*\s+(\S+(?:\s+рук)?)\s*(?:\([−+-]?\d+\)\s*)?\((\d+)\)\s+против\s+(\S+)/i.exec(t) || null;
    if(m && statOf(m[3])) s.opp = {max:+m[2], vs:statOf(m[3])};
    if(!s.opp){ m = /Максимум\S*\s+(\d+)\s+против\s+(\S+)/i.exec(t); if(m && statOf(m[2])) s.opp = {max:+m[1], vs:statOf(m[2])}; }
    // бросок цели
    if(!s.opp){
      const sm = new RegExp('Брос\\S*\\s+(воли|рефлексов|выносливости|силы|духа|смекалки|л[её]гкой атлетики|ловкости рук|восприятия)(?:' + MOD + ')?(?:\\s+против\\s+\\S+\\s+(\\d+))?', 'i').exec(t);
      const sv = /спасброс\S*\s+(?:от|против)\s+(пси-пол\S*|хими\S*|радиаци\S*|болезн\S*|вредн\S*\s+сред\S*|кислотност\S*)(?:\s*\(?\s*([−+-]\s*\d+)\s*\)?)?/i.exec(t);
      const ss = new RegExp('спасброс\\S*\\s+(воли|духа|выносливости|смекалки)(?:' + MOD + ')?', 'i').exec(t);
      const hk = new RegExp('проверк\\S*\\s+хладнокровия(?:' + MOD + ')?', 'i').exec(t);
      const pp = /Максимум\S*\s+\[(\d+)\s*\+\s*пси-сопротивлени\S*\]/i.exec(t);
      const cands = [];
      if(sm) cands.push({at:sm.index, stat:statOf(sm[1]), mod:sm[2] ? NUM(sm[2].replace(/\s/g, '')) : sm[3] ? -(+sm[3]) : 0});
      if(sv) cands.push({at:sv.index, stat:/пси/i.test(sv[1]) ? 'save_psi_pole' : /кислот/i.test(sv[1]) ? 'save_kislotnost' : 'save_vrednaya_sreda', mod:sv[2] ? NUM(sv[2].replace(/\s/g, '')) : 0});
      if(ss) cands.push({at:ss.index, stat:statOf(ss[1]), mod:ss[2] ? NUM(ss[2].replace(/\s/g, '')) : 0});
      if(hk) cands.push({at:hk.index, stat:'hladnokrovie', mod:hk[1] ? NUM(hk[1].replace(/\s/g, '')) : 0});
      if(pp) cands.push({at:pp.index, stat:'psi_plus', mod:0, n:+pp[1]});
      cands.sort((a, b)=>a.at - b.at);
      // чья проверка: в той же фразе перед броском — цель («цель», «противник», «каждый», «все», «видящие»…)
      // или само существо («персонаж … пока не преуспеет в Броске воли», «пустота должна преуспеть»)
      if(cands.length){
        const c0 = cands[0], before = t.slice(0, c0.at).split(/[.;]\s/).pop();
        // ближайшее к броску подлежащее решает («группа противника действует первой, то персонаж совершает» — сам);
        // \b в JS не работает с кириллицей — границы слова свои
        const W = (src)=>new RegExp('(?:^|[^а-яё])(?:' + src + ')(?=[^а-яё]|$)', 'gi'), lastAt = (re)=>{ let i = -1, mm; while((mm = re.exec(before))) i = mm.index; return i; };
        const ti = lastAt(W('цел[а-яё]*|противник[а-яё]*|жертв[а-яё]*|кажд[а-яё]*|все|всех|видящ[а-яё]*|слышащ[а-яё]*|те|тот|он|она|существа|персонажи|игрок[а-яё]*|схваченн[а-яё]*|пойманн[а-яё]*|атакуем[а-яё]*'));
        const si = lastAt(W('персонаж|пустота|жрец|культист|херувим|щитоносец|разведчик|офицер|киновит|жнец|охотник|гигант|робот|аява|ассасин|боец|реакцией|сам'));
        const tgt = ti > si, self = si > ti;
        const passiveSave = /спасброски/i.test(t.slice(c0.at, c0.at + 12)) || (!tgt && /^\s*спасброс/i.test(t)) || (!tgt && !self && !/цел|противник|существ|кажд|все|видящ|слышащ/i.test(t));
        if(passiveSave) s.bonus = c0; else if(self) s.selfCheck = c0; else s.check = c0;
      }
    }
    // атака с Максимумом (без «против») — обычная атака существа; проверка после неё — «при попадании»
    if(!s.opp){ m = /(?:атак\S*|атакует)[^.]{0,70}?с Максимумом\s+\(?(\d+)\)?|с Максимумом\s+\(?(\d+)\)?|Максимум\S*\s+\(?(\d+)\)?[^.]{0,30}(?:попадани|атак)/i.exec(t);
      if(m && (!s.check || m.index < s.check.at)){ s.atk = {max:+(m[1] || m[2] || m[3])}; if(s.check){ s.afterHit = s.check; delete s.check; }
        else if(s.selfCheck && m.index < s.selfCheck.at){ s.afterHit = s.selfCheck; delete s.selfCheck; } } }
    // попадания: «2 попадания с МУ 13 удар, раны 3, травма», «[категория успеха] попаданий с МУ 13 энергия, раны 2», «(попадание: МУ 14 удар, пул, травма)»
    m = new RegExp('(\\d+|к6|1к6|\\[[^\\]]*категори[^\\]]*\\]|\\[значение[^\\]]*\\])?\\s*(?:попадани\\S*|оружие\\S*)\\s*(?:с\\s*|:\\s*)?МУ\\s*(\\d+)\\s*' + MU_T + '?([^.;)]*)', 'i').exec(t);
    if(m){ const tail = m[4] || '', w = /раны\s+(\d+к\d+(?:\s*\+\s*\d+)?|к\d+(?:\s*\+\s*\d+)?|\d+|\[[^\]]+\])/i.exec(tail);
      const byCat = !!(m[1] && /категори/i.test(m[1])), n = byCat ? 1 : m[1] ? (/к6/.test(m[1]) ? 'к6' : /^\[/.test(m[1]) ? 'по выпавшему к20' : +m[1]) : 1;
      s.cons.hits = {n:typeof n==='number' ? n : 1, nExpr:typeof n==='string' ? n : null, byCat, mu:+m[2], muType:(m[3] || 'удар').toLowerCase(), wounds:w ? w[1].replace(/\s/g, '').replace(/^\[.*\]$/, '1') : '1', travma:/травма/i.test(tail)}; }
    // потеря ОЗ и пси
    m = /(?:теря\S*|потеря\S*|получ\S*\s+по|получит|отбирает у цели|отнимая у неё)\s+(\d*к\d+(?:\s*\+\s*\d+)?|\d+)\s+(ОЗ|ран)/i.exec(t);
    if(m && !(s.cons.hits && /попадани/.test(t.slice(Math.max(0, m.index - 40), m.index)))) s.cons.hp = m[1].replace(/\s/g, '');
    m = /(?:теря\S*|потеря\S*|отнимая у неё|снимает|теряя)\s+(?:по\s+)?(\d+)\s+пси|ОЗ\s+и\s+(\d+)\s+пси/i.exec(t); if(m) s.cons.psi = +(m[1] || m[2]);
    const tc = t.split(/(?<=[.!])\s+/).filter(x=>!/^(например|связь пропадает)/i.test(x.trim())).join(' ');
    STATE_RE.forEach(([k, re])=>{ if(k==='stress' ? /(получ\S*|станов\S*|испыт\S*)\s+(\S+\s+)?стресс/i.test(tc) : re.test(tc)) s.cons.states.push(k); });
    MARK_RE.forEach(([k, re])=>{ if(re.test(tc)){ const r = new RegExp(re.source + '[^.]{0,20}?на\\s+(\\d+|к6)\\s+(круг|ход)', 'i').exec(t); s.cons.marks.push({k, r:r ? (/к6/.test(r[1]) ? 1 + Math.floor(Math.random()*6) : +r[1]) : 1}); } });
    if(s.cons.states.indexOf('ispug') >= 0 && /пугающ|чудовищн|неописуем/i.test(t) && t.length < 40) s.cons.states = []; // «Внешний вид: пугающий» — не последствие
    // что ещё — текстом: «при провале с категорией 2…», «с итогом 15−…»
    const extra = t.split(/(?<=[.!])\s+/).filter(x=>/категори\S* 2|итогом 15|категорией 2/i.test(x) && !/^(раз в круг|если)/i.test(x)).join(' ');
    if(extra) s.cons.note = extra.slice(0, 200);
    // область (для этапа 3 — пока текстом)
    m = /(в радиусе\s+\d+\s*м|в пределах\s+\d+\s*(?:м|метр\S*)\s+от\s+(?:неё|него|себя|пустоты|херувима)|полос\S*[^.]{0,30}шириной[^.]{0,20}\d+\s*м|луч\S* шириной[^.]{0,40}|област\S*[^.]{0,30}\d+\s*[×x]\s*\d+|квадратной области[^.]{0,40}|все (?:цели|существа|живые|видящие|персонажи|находящ\S*|враждебн\S*)[^.]{0,40}|кажд\S+ (?:цель|существо|такая цель|слышащ\S*)[^.]{0,30}|к6 видимых)/i.exec(t);
    s.areaSpec = areaSpec(t);
    if(s.atk && s.areaSpec && s.areaSpec.shape==='circle') s.areaSpec = null; // у атаки «в пределах N м» — дальность по одной цели, не область
    if(m) s.area = m[1].trim().replace(/\s+(должн|ощущают|проходят|совершают|получ)\S*.*$/i, '').slice(0, 48);
    s.reroll = /перебро/i.test(t);
    s.trig = /провалил\S* с итогом 15|промахнул\S* с итогом 15|провалива\S* свою проверку|проваливающ/i.test(t);
    if(s.afterHit) s.cons.note = ('при попадании: ' + CHECK_LABEL(s.afterHit) + (s.cons.note ? '; ' + s.cons.note : '')).slice(0, 200);
    s.passive = !!s.bonus || !s.check && !s.opp && !s.atk && !s.reroll && /(\+\d+ к (атаке|проверкам|проверке|Максимуму)|проверк\S* инициативы|спасброски от \S+ [+−]\d+|защита\s*\S*\s*\+\d|штраф|модификатор\s*−\d+|на \d ран\S* меньше|Упрощ|Осложн|невосприимчив)/i.test(t);
    s.kind = s.check ? 'save' : s.opp ? 'opposed' : s.atk ? 'attack' : s.reroll ? 'reroll' : s.trig ? 'trigger' : s.passive ? 'passive' : 'text';
    s.chips = chips(s);
    return s;
  }
  function areaLabel(a){ if(!a) return ''; if(a.shape==='all') return 'все на поле';
    return a.shape==='circle' ? `круг ${a.r} м ${a.at==='self' ? 'вокруг себя' : 'в точке'}` : a.shape==='rect' ? `квадрат ${a.side} м в точке` : a.shape==='line' ? `полоса ${a.len}×${a.w} м` : `конус ${a.len} м`; }
  function chips(s){
    const out = [], c = s.cons;
    if(s.act) out.push(['act', s.act]);
    if(s.uses) out.push(['uses', `${s.uses.n} в ${s.uses.per}`]);
    if(s.check) out.push(['save', '🎯 цель: ' + CHECK_LABEL(s.check)]);
    if(s.opp) out.push(['save', `🎯 Макс. ${s.opp.max} против ${STAT_NAME[s.opp.vs]} цели`]);
    if(s.atk) out.push(['save', `⚔ атака, Макс. ${s.atk.max}`]);
    if(s.selfCheck) out.push(['self', 'бросок существа: ' + CHECK_LABEL(s.selfCheck)]);
    if(s.afterHit) out.push(['save', 'при попадании: ' + CHECK_LABEL(s.afterHit)]);
    if(s.bonus) out.push(['pas', 'своё: ' + CHECK_LABEL(s.bonus).replace('спасбросок', 'спасброски')]);
    if(c.hits) out.push(['bad', `${c.hits.byCat ? '[кат.]' : c.hits.nExpr || c.hits.n}× МУ ${c.hits.mu} ${c.hits.muType}, раны ${c.hits.wounds}${c.hits.travma ? ', травма' : ''}`]);
    if(c.hp) out.push(['bad', `−${c.hp} ОЗ`]);
    if(c.psi) out.push(['bad', `−${c.psi} пси`]);
    const effects = s.kind!=='passive' && s.kind!=='reroll'; // у постоянных и перебросов «испуг», «шок» в тексте — условия, а не последствия
    if(effects) c.states.forEach(k=>out.push(['bad', ({ispug:'испуг', istoshenie:'истощение', stress:'стресс'})[k]]));
    if(effects) c.marks.forEach(mk=>out.push(['bad', ({shock:'шок', prone:'сбит с ног', grabbed:'схвачен', stunned:'оглушён', blind:'ослеплён'})[mk.k]]));
    if(s.areaSpec) out.push(['area', '📐 ' + areaLabel(s.areaSpec)]); else if(s.area) out.push(['area', '📐 ' + s.area]);
    if(s.reroll) out.push(['re', '↻ переброс']);
    if(s.trig) out.push(['re', '⚡ на провал 15−']);
    if(s.kind==='passive') out.push(['pas', 'постоянно']);
    return out;
  }
  const chipsHtml = (s)=>s.chips.length ? `<span class="ak-chips">${s.chips.map(([k, l])=>`<span class="ak-chip ak-${k}">${esc(l)}</span>`).join('')}</span>` : '';

  /* ---------- счётчики использований (у Мастера, по жетону) ---------- */
  const USES_KEY = 'reincarnator_ability_uses_v1';
  let uses = {}; try{ uses = JSON.parse(localStorage.getItem(USES_KEY) || '{}') || {}; }catch(e){}
  const saveUses = ()=>{ try{ localStorage.setItem(USES_KEY, JSON.stringify(uses)); }catch(e){} };
  const usedOf = (tokId, key)=>((uses[tokId] || {})[key] || 0);
  function bump(tokId, key, d){ const u = uses[tokId] || (uses[tokId] = {}); u[key] = Math.max(0, (u[key] || 0) + d); saveUses(); }

  /* ---------- в карточке существа ---------- */
  // key — 'a<i>' способность или 'm<таблица>-<строка>' ход пустоты
  function rowHtml(tok, key, name, text){
    const s = parse(name, text), canFire = s.kind==='save' || s.kind==='opposed' || s.kind==='attack';
    if(!s.chips.length) return '';
    let usesHtml = '';
    if(tok && s.uses){ const u = usedOf(tok.id, key), left = s.uses.n - u;
      usesHtml = `<span class="ak-count${left <= 0 ? ' out' : ''}" title="Использовано ${u} из ${s.uses.n} (${s.uses.per}). ↺ — сбросить">◷ ${Math.max(0, left)}/${s.uses.n}<button type="button" class="ak-mini" data-ak-reset="${esc(key)}" data-tok="${esc(tok.id)}">↺</button></span>`; }
    const btn = canFire ? `<button type="button" class="bst-mini ak-go" data-ak-go="${esc(key)}" ${tok ? `data-tok="${esc(tok.id)}"` : ''} title="Применить: форма «Бросок цели» уже заполнена — выберите цели">▶</button>` : '';
    const shown = usesHtml ? Object.assign({}, s, {chips:s.chips.filter(c=>c[0]!=='uses')}) : s; // у жетона — счётчик вместо плашки «2 в день»
    return `<span class="ak-row">${chipsHtml(shown)}${usesHtml}${btn}</span>`;
  }
  // клик по «▶»: найти способность по ключу в шаблоне существа жетона
  function abilityByKey(tpl, key){
    if(key[0]==='a'){ const a = tpl.abil[+key.slice(1)]; return a ? {name:a[0], text:a[1]} : null; }
    const mm = /^m(\d+)-(\d+)$/.exec(key); if(!mm) return null; const tb = tpl.tables[+mm[1]], r = tb && tb.rows[+mm[2]];
    return r ? {name:`Ход ${r[0]}`, text:r[1]} : null;
  }
  async function fire(tokId, tpl, key){
    const ab = abilityByKey(tpl, key); if(!ab || typeof TargetRolls==='undefined') return;
    const s = parse(ab.name, ab.text);
    if(tokId && s.uses){ const left = s.uses.n - usedOf(tokId, key);
      if(left <= 0 && !(await uiConfirm(`«${ab.name}» уже использована ${s.uses.n} раз (${s.uses.per}). Применить всё равно?`, {title:'Способность', ok:'Применить'}))) return; }
    const gt = typeof GameTable!=='undefined' ? GameTable : null, sel = gt && gt.selectedIds ? gt.selectedIds().filter(id=>id!==tokId) : [];
    TargetRolls.open({src:tokId || null, targets:sel, title:ab.name.replace(/\s*\([^)]*раз[^)]*\)\s*$/, ''), prefill:s, onFired:()=>{ if(tokId && s.uses){ bump(tokId, key, 1); refreshCard(); } }});
  }
  function refreshCard(){ if(typeof Bestiary!=='undefined' && Bestiary.refreshFloat) Bestiary.refreshFloat(); }
  document.addEventListener('click', (e)=>{
    const go = e.target.closest && e.target.closest('[data-ak-go]');
    if(go){ e.preventDefault(); e.stopPropagation();
      const tokId = go.dataset.tok || null, gt = typeof GameTable!=='undefined' ? GameTable : null, t = tokId && gt ? gt.getToken(tokId) : null, card = go.closest('.bst-card');
      const tpl = t && t.creature ? t.creature : (typeof Bestiary!=='undefined' ? Bestiary.byId((card && card.dataset.tpl) || Bestiary.selId()) : null);
      if(tpl) fire(t ? tokId : null, tpl, go.dataset.akGo); return; }
    const rs = e.target.closest && e.target.closest('[data-ak-reset]');
    if(rs){ e.preventDefault(); e.stopPropagation(); const u = uses[rs.dataset.tok]; if(u){ delete u[rs.dataset.akReset]; saveUses(); } refreshCard(); }
  }, true);

  /* ---------- конструктор: что распознано по ходу набора ---------- */
  function editorPreview(ta){
    let box = ta.parentNode.querySelector('.ak-preview');
    if(!box){ box = document.createElement('div'); box.className = 'ak-preview'; ta.parentNode.appendChild(box); }
    const paras = String(ta.value || '').split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);
    box.innerHTML = paras.map(p=>{ const i = p.indexOf(':'), name = i>0 && i<80 ? p.slice(0, i).trim() : '', text = i>0 && i<80 ? p.slice(i + 1) : p, s = parse(name, text);
      return `<div class="ak-pv"><b>${esc(name || 'без названия')}</b> ${s.chips.length ? chipsHtml(s) : '<span class="gs-muted">только текст — механика не распознана</span>'}</div>`; }).join('') ||
      '<span class="gs-muted">Пишите как в книге: «Бросок рефлексов (−6)», «спасбросок от пси-поля (+3)», «2 попадания с МУ 12 удар, раны 3, травма», «(2 раза в день)» — здесь появится, что распознано.</span>';
  }
  document.addEventListener('input', (e)=>{ if(e.target.matches && e.target.matches('.bst-modal textarea[name="abil"]')) editorPreview(e.target); });
  document.addEventListener('focusin', (e)=>{ if(e.target.matches && e.target.matches('.bst-modal textarea[name="abil"]')) editorPreview(e.target); });


  /* ===================== ЭТАП 4: ПЕРЕБРОСЫ И СРАБАТЫВАНИЯ НА ПРОВАЛ ===================== */
  // Что перебрасывает способность: свой к20 / свою атаку / свой или чужой к20 при атаке по нему или с его рефлексами /
  // проверку конкретной характеристики / таблицу травм (только отметка)
  function rerollScope(t){
    if(!/перебро/i.test(t)) return null;
    if(/свой или чужой к20/i.test(t)) return {scope:'vs_me'};
    if(/перебросить\s+свой\s+к20/i.test(t)) return {scope:'own_d20', cond:/против другой народности/i.test(t) ? 'против другой народности' : ''};
    if(/перебросить\s+(?:результат\s+своей\s+)?проверк\S*\s+атак/i.test(t)) return {scope:'own_attack', cond:/уже ранил/i.test(t) ? 'по цели, которую уже ранил' : /итогом 15/i.test(t) ? 'при провале 15− расходуется' : ''};
    const m = /перебросить\s+проверку\s+(воли|рефлексов|выносливости|силы|духа|смекалки|инициативы|скрытности)/i.exec(t);
    if(m) return {scope:'stat', stat:statOf(m[1]) || (/инициатив/i.test(m[1]) ? 'init' : m[1])};
    if(/таблице травм/i.test(t)) return {scope:'trauma'};
    return {scope:'other'};
  }
  // Способности жетона существа с перебросом, подходящие к броску: ctx.type — 'attack-own' | 'attack-vs' | 'check'; ctx.stat
  function rerollOptions(tok, ctx){
    const tpl = tok && tok.creature; if(!tpl) return [];
    const out = [];
    (tpl.abil || []).forEach((a, i)=>{
      const sc = rerollScope(a[1]); if(!sc) return;
      const ok = sc.scope==='own_d20' ? ctx.type!=='attack-vs'
        : sc.scope==='own_attack' ? ctx.type==='attack-own'
        : sc.scope==='vs_me' ? ctx.type==='attack-vs' || (ctx.type==='check' && ctx.stat==='refleksy')
        : sc.scope==='stat' ? ctx.type==='check' && ctx.stat===sc.stat : false;
      if(!ok) return;
      const s = parse(a[0], a[1]), key = 'a' + i, left = s.uses ? s.uses.n - usedOf(tok.id, key) : Infinity;
      if(left <= 0) return;
      out.push({key, name:a[0].replace(/\s*\([^)]*\)\s*$/, ''), left, total:s.uses ? s.uses.n : null, cond:sc.cond || '', scope:sc.scope, text:a[1]});
    });
    return out;
  }
  const leftTxt = (o)=>o.total ? ` (осталось ${o.left}/${o.total})` : '';

  /* ---------- панель подсказок Мастеру ---------- */
  let alertsEl = null; const alerts = [];
  function alert(a){
    if(typeof session!=='undefined' && session.role==='player') return;
    a.id = 'al' + Math.random().toString(36).slice(2, 8); a.t = Date.now(); alerts.unshift(a); if(alerts.length > 5) alerts.pop();
    renderAlerts(); setTimeout(()=>{ const i = alerts.indexOf(a); if(i >= 0){ alerts.splice(i, 1); renderAlerts(); } }, 30000);
  }
  function renderAlerts(){
    if(!alerts.length){ if(alertsEl){ alertsEl.remove(); alertsEl = null; } return; }
    if(!alertsEl){ alertsEl = document.createElement('div'); alertsEl.className = 'ak-alerts'; document.body.appendChild(alertsEl);
      alertsEl.addEventListener('click', (e)=>{ const b = e.target.closest('[data-al]'); if(!b) return; const a = alerts.find(x=>x.id===b.dataset.al); if(!a) return;
        const i = +b.dataset.i; alerts.splice(alerts.indexOf(a), 1); renderAlerts(); if(i >= 0 && a.actions[i]) try{ a.actions[i].run(); }catch(err){ console.warn('[Способности]', err); } }); }
    alertsEl.innerHTML = alerts.map(a=>`<div class="ak-alert ${a.kind || ''}"><div><b>${esc(a.title)}</b></div><div class="ak-al-text">${esc(a.text)}</div>
      <div class="ak-al-btns">${(a.actions || []).map((x, i)=>`<button type="button" class="small${i===0 ? ' primary' : ''}" data-al="${a.id}" data-i="${i}">${esc(x.label)}</button>`).join('')}<button type="button" class="small" data-al="${a.id}" data-i="-1">✕</button></div></div>`).join('');
  }

  /* ---------- перебросы: атаки с карты ---------- */
  const GTk = ()=>typeof GameTable!=='undefined' ? GameTable : null;
  const nameOfTok = (t)=>{ const gt = GTk(), v = gt && gt.vitalsOf(t); return (v && v.name) || t.name || 'Жетон'; };
  function onAttack(a){
    const gt = GTk(); if(!gt || (typeof session!=='undefined' && session.role==='player')) return;
    const att = gt.getToken(a.attackerId), tgt = gt.getToken(a.targetId); if(!att || !tgt) return;
    // существо атаковали и попали — «Малая цель»: перебросить чужой к20
    if(a.success && !a.jammed && tgt.creature){
      rerollOptions(tgt, {type:'attack-vs'}).forEach(o=>alert({kind:'re', title:`↻ ${nameOfTok(tgt)}: «${o.name}»`, text:`${nameOfTok(att)} попал(а) (к20=${a.roll}). Перебросить эту атаку?${o.scope==='vs_me' ? ' Если попадания всё же будут — на 1 рану больше (отметьте сами).' : ''}${leftTxt(o)}`,
        actions:[{label:'↻ Перебросить атаку', run:()=>{ bump(tgt.id, o.key, 1); const r = gt.rerollAttack(a.attackId); uiToast(r && r.ok ? `«${o.name}»: атака переброшена` : 'Не удалось перебросить: ' + (r && r.reason || ''), {icon:'↻'}); refreshCard(); }}]}));
    }
    // существо атаковало и промахнулось — «Уход техника СДК», «Мастерская атака»…
    if(!a.success && att.creature){
      rerollOptions(att, {type:'attack-own'}).forEach(o=>alert({kind:'re', title:`↻ ${nameOfTok(att)}: «${o.name}»`, text:`Промах (к20=${a.roll}) по ${nameOfTok(tgt)}. Перебросить к20?${o.cond ? ' Условие: ' + o.cond + '.' : ''}${leftTxt(o)}`,
        actions:[{label:'↻ Перебросить', run:()=>{ bump(att.id, o.key, 1); const r = gt.rerollAttack(a.attackId); uiToast(r && r.ok ? `«${o.name}»: атака переброшена` : 'Не удалось: ' + (r && r.reason || ''), {icon:'↻'}); refreshCard(); }}]}));
    }
    // игрок промахнулся с итогом 15− — срабатывания («Хватай и беги», «Тварь изнанки»…)
    if(!a.success && a.roll <= 15 && att.kind==='player') failTriggers(nameOfTok(att), a.roll, att, 'промах атаки');
  }

  /* ---------- перебросы: броски с карточки существа ---------- */
  function statFromLabel(l){ const s = String(l || '').toLowerCase(); if(/атак/.test(s)) return 'attack'; const m = /брос\S*\s+(\S+)/.exec(s) || /проверк\S*\s+(\S+)/.exec(s); return m ? statOf(m[1]) : null; }
  if(typeof recordAndShareRoll==='function'){
    const orig = recordAndShareRoll;
    window.recordAndShareRoll = function(statKey, mod, roll, max, success, category, mode, rolls){
      const out = orig.apply(this, arguments);
      try{
        const ctx = typeof _creatureRollCtx!=='undefined' ? _creatureRollCtx : null, gt = GTk();
        if(statKey==='creature_roll' && !success && ctx && ctx.tokId && gt && !(typeof session!=='undefined' && session.role==='player')){
          const tok = gt.getToken(ctx.tokId), st = statFromLabel(ctx.label);
          const opts = tok ? rerollOptions(tok, st==='attack' ? {type:'attack-own'} : {type:'check', stat:st}) : [];
          opts.forEach(o=>alert({kind:'re', title:`↻ ${nameOfTok(tok)}: «${o.name}»`, text:`${ctx.label}: провал (к20=${roll} / Макс.${max}). Перебросить?${o.cond ? ' Условие: ' + o.cond + '.' : ''}${leftTxt(o)}`,
            actions:[{label:'↻ Перебросить', run:()=>{ bump(tok.id, o.key, 1); setCreatureRollCtx(ctx); const r = 1 + Math.floor(Math.random()*20), ev = evaluateD20Check(r, max);
              window.recordAndShareRoll('creature_roll', mod, r, max, ev.success, ev.category, 'plain', [r]); uiToast(`«${o.name}»: к20=${r} — ${ev.success ? 'успех, КУ' + ev.category : 'провал'}`, {icon:'↻'}); refreshCard(); }}]}));
        }
      }catch(e){ console.warn('[Способности]', e); }
      return out;
    };
  }

  /* ---------- срабатывания на провал игрока «с итогом 15−» ---------- */
  function failTriggers(who, roll, attTok, what){
    const gt = GTk(); if(!gt) return;
    Object.values(gt.state.tokens || {}).forEach(t=>{
      if(t.kind!=='gm' || !t.creature) return;
      const tpl = t.creature, list = (tpl.abil || []).map((a, i)=>({a, key:'a' + i}));
      list.forEach(({a, key})=>{
        const txt = a[1], s = parse(a[0], txt);
        if(!s.trig) return;
        const miss = /промахнул/i.test(txt); if(miss && what!=='промах атаки') return;
        // «рядом с персонажем» — только если существо рядом с промахнувшимся (до 1,5 клетки)
        if(/рядом с персонажем/i.test(txt) && attTok){ const p1 = gt.tokenWorld(t.id), p2 = gt.tokenWorld(attTok.id); if(!p1 || !p2 || Math.hypot(p1.x - p2.x, p1.y - p2.y)/gt.cellPx > 1.6) return; }
        const left = s.uses ? s.uses.n - usedOf(t.id, key) : Infinity; if(left <= 0) return;
        const fireable = s.kind==='save' || s.kind==='opposed' || s.kind==='attack';
        const acts = [];
        if(fireable) acts.push({label:'▶ Применить', run:()=>fire(t.id, tpl, key)});
        acts.push({label:s.uses ? 'Использовано' : 'Понятно', run:()=>{ if(s.uses){ bump(t.id, key, 1); refreshCard(); } }});
        acts.push({label:'📖 Карточка', run:()=>{ if(typeof Bestiary!=='undefined') Bestiary.openFloat(t.id); }});
        alert({kind:'trig', title:`⚡ ${nameOfTok(t)}: «${a[0].replace(/\s*\([^)]*\)\s*$/, '')}»`, text:`${who}: ${what} с итогом ${roll} (15−). ${txt.slice(0, 160)}${txt.length > 160 ? '…' : ''}${s.uses ? ` (осталось ${left}/${s.uses.n} — ${s.uses.per})` : ''}`, actions:acts});
      });
    });
  }
  // броски игроков в общем логе: провал к20 с итогом 15− (атаки с карты — в onAttack)
  if(typeof addRollLogEntry==='function'){
    const origAdd = addRollLogEntry;
    window.addRollLogEntry = function(entry, silent){
      const isNew = origAdd.apply(this, arguments);
      try{
        if(isNew && !silent && typeof session!=='undefined' && session.role==='gm' && entry && !entry.mapAttack && !entry.mapGrenade && !entry.secretStub && !entry.chat
          && typeof entry.id==='string' && entry.id.indexOf(getDeviceId() + ':')!==0){
          const d20 = entry.kind!=='quick' || entry.diceType==='d20';
          if(d20 && entry.success===false && +entry.roll > 0 && +entry.roll <= 15){
            const gt = GTk(), own = gt && Object.values(gt.state.tokens || {}).find(t=>t.kind==='player' && session.players[t.ownerId] && ((session.players[t.ownerId].name===entry.player) || (session.players[t.ownerId].extra && session.players[t.ownerId].extra.name===entry.player)));
            failTriggers(entry.player || 'Игрок', +entry.roll, own || null, `провал «${entry.statLabel || 'к20'}»`);
          }
        }
      }catch(e){ console.warn('[Способности]', e); }
      return isNew;
    };
  }

  /* ---------- «раз в круг» / «раз в ход» — сброс с новым кругом боя ---------- */
  let lastRound = null;
  setInterval(()=>{
    const gt = GTk(); const c = gt && gt.state && gt.state.combat; const r = c ? c.round : null;
    if(r!=null && lastRound!=null && r!==lastRound){
      Object.values(gt.state.tokens || {}).forEach(t=>{ if(!t.creature || !uses[t.id]) return;
        (t.creature.abil || []).forEach((a, i)=>{ const s = parse(a[0], a[1]); if(s.uses && /круг|ход/.test(s.uses.per)) delete uses[t.id]['a' + i]; }); });
      saveUses(); refreshCard();
    }
    lastRound = r;
  }, 1500);


  /* ===================== ЭТАП 5: ПОСТОЯННЫЕ МОДИФИКАТОРЫ ===================== */
  const abilOf = (t)=>(t && t.creature && t.creature.abil || []).map(a=>({n:String(a[0] || '').replace(/\s*\([^)]*\)\s*$/, ''), x:String(a[1] || '')}));
  // предложения; «см. стр. 134)», «т. д.», «т. е.» — не конец фразы
  const sentences = (x)=>String(x).replace(/(стр|см|т\.\s?[деп]|т\.\s?к|др|пр)\.\s/gi, '$1. ').split(/(?<=[.!?])[ \t\n]+/); // \s в JS ловит и неразрывный пробел
  function distM(a, b){ const gt = GTk(), p1 = gt && gt.tokenWorld(a.id), p2 = gt && gt.tokenWorld(b.id); if(!p1 || !p2) return Infinity;
    const mpc = typeof AreaTemplates!=='undefined' ? AreaTemplates.metersPerCell() : 3, c = gt.cellPx;
    return Math.max(0, Math.hypot(p1.x - p2.x, p1.y - p2.y)/c - (p1.d + p2.d)/c/2 + 0.5)*mpc; } // между краями жетонов, клетка = mpc м
  const allyNear = (t, m)=>{ const gt = GTk(); return gt ? Object.values(gt.state.tokens || {}).some(o=>o.id!==t.id && o.kind===t.kind && distM(t, o) <= m) : false; };
  const fullHp = (t)=>{ const gt = GTk(); if(t.kind==='gm') return t.hp==null || t.hpMax==null || t.hp >= t.hpMax; const v = gt && gt.vitalsOf(t); return !v || +v.hp >= +v.hpMax; };
  // Атака att по tgt оружием w: поправка к Максимуму, к ранам каждого пробившего попадания (по типу), Инерционный щит
  function attackPassives(att, tgt, w){
    const out = {mod:0, tags:[], adj:{}, adjAll:0, shield:false};
    const ranged = !!(w && (w.dl || w.range || /Дл\s*\d/.test(w.statText || '')));
    abilOf(tgt).forEach(a=>{ // защитные свойства существа-цели
      sentences(a.x).forEach(sn=>{
        if(/не повреждающ\S* пси-плоскость/i.test(sn) || /атак\S*[^.]{0,60}по\s+(нему|ней|пустот\S*|персонаж\S*)/i.test(sn)){
          const m = /(?:штраф|модификатор)\s*([−-]\s*\d+)/i.exec(sn);
          if(m && !/может|раз в круг|если персонаж хочет|выбирает/i.test(sn)){ const v = +m[1].replace(/[−\s]/g, '').replace('-', '') ; out.mod -= v; out.tags.push(`${a.n} −${v}`); }
        }
        const typed = /типом\s*«([^»]+)»(?:\s*и\s*«([^»]+)»)?\s*наносят\s+на\s+(\d+)\s+ран\S*\s+меньше/i.exec(sn);
        if(typed){ [typed[1], typed[2]].filter(Boolean).forEach(tp=>{ out.adj[tp.toLowerCase()] = (out.adj[tp.toLowerCase()] || 0) - +typed[3]; });
          const more = /с типом\s*«([^»]+)»\s*наносят\s+на\s+(\d+)\s+ран\S*\s+больше/i.exec(sn); if(more) out.adj[more[1].toLowerCase()] = (out.adj[more[1].toLowerCase()] || 0) + +more[2];
          out.tags.push(`${a.n}: раны по типу`); return; }
        const less = /наносят\s+(?:пустоте\s+|ему\s+|ей\s+)?на\s+(\d+)\s+ран\S*\s+меньше/i.exec(sn);
        if(less){ out.adjAll -= +less[1]; out.tags.push(`${a.n}: −${less[1]} к ранам`); }
        if(/более одного попадания[^.]*отменяет\s+1к12/i.test(sn) && ranged){ out.shield = true; out.tags.push(`${a.n}: отменяет 1к12 попаданий из нескольких`); }
      });
    });
    abilOf(att).forEach(a=>{ // атакующие свойства существа
      sentences(a.x).forEach(sn=>{
        const m = /\+\s*(\d+)\s+к\s+(?:атаке|проверкам\s+атак)/i.exec(sn); if(!m) return;
        if(/энергетическ/i.test(sn) && !(w && /энерг/i.test(w.muType || ''))) return;
        if(/стрелков/i.test(sn) && !ranged) return;
        const near = /в пределах\s+(\d+(?:,\d+)?)\s*(?:м|метр)\S*\s+от\s+него[^.]*союзник|союзник[^.]*в пределах\s+(\d+)/i.exec(sn) || /если в пределах\s+(\d+)\s*(?:м|метр)\S*[^.]*союзник/i.exec(sn);
        if(near){ const r = +(String(near[1] || near[2]).replace(',', '.')); if(!allyNear(att, r)) return; }
        else if(/если|когда|в бою с|неистов|раз в/i.test(sn)) return; // прочие условия решает Мастер
        out.mod += +m[1]; out.tags.push(`${a.n} +${m[1]}`);
      });
      const muka = /\+\s*(\d+)\s+к\s+ранам[^.]*если у цели не полное ОЗ/i.exec(a.x);
      if(muka && !fullHp(tgt)){ out.adjAll += +muka[1]; out.tags.push(`${a.n}: +${muka[1]} рана`); }
    });
    return out;
  }
  // Инициатива: «Надзор» — союзники в радиусе получают +N
  function initAura(t){
    const gt = GTk(), out = {mod:0, notes:[]}; if(!gt) return out;
    Object.values(gt.state.tokens || {}).forEach(o=>{ if(o.id===t.id || o.kind!==t.kind) return;
      abilOf(o).forEach(a=>{ const m = /в радиусе\s+(\d+)\s*м\S*\s+проверк\S*\s+инициативы\s+союзников\s+\+\s*(\d+)/i.exec(a.x); if(m && distM(t, o) <= +m[1]){ out.mod += +m[2]; out.notes.push(`${a.n} (${nameOfTok(o)}) +${m[2]}`); } }); });
    return out;
  }
  // Спасброски и проверки NPC: бонусы, Упрощено/Осложнено, невосприимчивость
  function savePassives(t, key){
    const out = {mod:0, mode:'plain', immune:false, notes:[]}; let adv = 0, dis = 0;
    const isEnv = key==='save_vrednaya_sreda', statWord = {refleksy:'рефлекс', legkaya_atletika:'атлетик', volya:'вол', sila:'сил', vynoslivost:'вынослив', duh:'дух', smekalka:'смекалк'}[key];
    abilOf(t).forEach(a=>sentences(a.x).forEach(sn=>{
      if(isEnv){
        if(/невосприимчив\S*\s+к\s+[^.]*(яд|болезн|хими|радиац)/i.test(sn)){ out.immune = true; out.notes.push(`${a.n}: невосприимчив`); return; }
        const m = /спасброс\S*\s+от\s+(хими\S*|вредн\S*\s+сред\S*|болезн\S*|радиаци\S*)[^.]*?\+\s*(\d+)/i.exec(sn); if(m){ out.mod += +m[2]; out.notes.push(`${a.n} +${m[2]} (${m[1]})`); return; }
        if(/спасброс\S*\s+от\s+(болезн|хими|радиац)\S*[^.]*Упрощ/i.test(sn)){ adv++; out.notes.push(`${a.n}: Упрощено`); }
      }
      if(statWord && new RegExp('проверк\\S*[^.]*' + statWord + '[^.]*Осложн', 'i').test(sn)){ dis++; out.notes.push(`${a.n}: Осложнено`); }
      if(statWord && new RegExp('проверк\\S*[^.]*' + statWord + '[^.]*Упрощ', 'i').test(sn) && !/если|может/i.test(sn)){ adv++; out.notes.push(`${a.n}: Упрощено`); }
    }));
    out.mode = adv > dis ? 'advantage' : dis > adv ? 'disadvantage' : 'plain';
    return out;
  }

  return { attackPassives, initAura, savePassives, onAttack, rerollOptions, alert, parse, areaLabel, rowHtml, chipsHtml, usedOf, bump, resetToken:(id)=>{ delete uses[id]; saveUses(); refreshCard(); } };
})();
