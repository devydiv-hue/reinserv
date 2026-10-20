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

  return { parse, areaLabel, rowHtml, chipsHtml, usedOf, bump, resetToken:(id)=>{ delete uses[id]; saveUses(); refreshCard(); } };
})();
