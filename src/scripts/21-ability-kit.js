/* ======================================================================
   СПОСОБНОСТИ СУЩЕСТВ: разбор текста книги в действия и автоматику.
   Разбор по фразам — у каждой своя роль:
   - главный бросок: бросает цель («Бросок рефлексов (−6)», «спасбросок от пси-поля (+3)», «проверка хладнокровия»,
     «Максимум [12 + пси-сопротивление]») / встречная проверка существа («Бросок мистики (19) против воли цели» — из
     Максимума вычитается характеристика цели) / атака с Максимумом / бросок самого существа («Бросок воли (−3) (13)»);
   - «всем» — урон до броска или без броска («совершает по нему попадание…», «наносит всем … по 2к6 ран»);
   - «при провале» — последствия провала цели (успеха существа во встречной);
   - «кат. 2» / «15−» — дополнительные последствия только при провале с категорией 2 / с итогом 15−;
   - «каждый круг» — продолжающийся эффект («В начале каждого круга цель…») — напоминание Мастеру каждый новый круг;
   - «затем» — следующий бросок для проваливших («…или будут проходить спасбросок от пси-поля (+3)»);
   - «сама» — расход существа («Пустота …, теряя 6 ОЗ»); условия («если размер цели 5 и меньше…») — заметкой.
   Постоянные способности — с указанием, что приложение делает само («⚙ …»): штрафы к атакам по существу, снижение
   ран, Инерционный щит, бонусы атаки (Владение, Муштра, Мука), инициатива, бонусы спасбросков, невосприимчивость к
   состояниям, отмена ран (подсказка при уроне), временные усиления (▶ включить), перебросы, срабатывания на провал
   «15−», «Изворотливость», «Нечеловеческая изворотливость», «Тактик», «Смерть, друг мой», «Щит веры», «Якорь».
   Чего приложение не делает — плашка «📖 справка — решает Мастер».
   ====================================================================== */
const AbilityKit = (function(){
  const esc = (s)=>escapeHtml(s==null ? '' : String(s));
  const NUM = (s)=>+String(s).replace(/\s/g, '').replace('−', '-').replace('+', '');
  const STAT_RE = {volya:'вол', refleksy:'рефлекс', vynoslivost:'вынослив', sila:'сил', duh:'дух', smekalka:'смекалк', legkaya_atletika:'л[её]гк\\S* атлетик', lovkost_ruk:'ловкост\\S* рук', vospriyatie:'восприяти', mistika:'мистик', tehnika:'техник', ubezhdenie:'убеждени'};
  const STAT_NAME = {volya:'воли', refleksy:'рефлексов', vynoslivost:'выносливости', sila:'силы', duh:'духа', smekalka:'смекалки', legkaya_atletika:'лёгкой атлетики', lovkost_ruk:'ловкости рук', vospriyatie:'восприятия', mistika:'мистики', tehnika:'техники', ubezhdenie:'убеждения'};
  const statOf = (w)=>{ const s = String(w || '').toLowerCase(); return Object.keys(STAT_RE).find(k=>new RegExp('^' + STAT_RE[k]).test(s)) || null; };
  const MU_T = '(удар|патрон|энергия|температура|взрыв)';
  const MARK_NAMES = {shock:'шок', prone:'сбит с ног', grabbed:'схвачен', stunned:'оглушён', blind:'ослеплён', skipturn:'пропускает ход', vanished:'исчез', limit:'на пределе сил'};
  const STATE_NAMES = {ispug:'испуг', istoshenie:'истощение', stress:'стресс'};
  const sgnTxt = (m)=>m ? ` (${m > 0 ? '+' : '−'}${Math.abs(m)})` : '';
  const CHECK_LABEL = (c)=>!c ? '' : c.stat==='psi_plus' ? `Максимум [${c.n} + пси-сопр.]` : c.stat==='psi_cur_plus' ? `Максимум [${c.n} + текущие пси]` :
    c.stat==='hladnokrovie' ? 'хладнокровие' + sgnTxt(c.mod) :
    String(c.stat).indexOf('save_')===0 ? `спасбросок ${({save_psi_pole:'пси-поле', save_vrednaya_sreda:'вредная среда', save_kislotnost:'кислотность', save_pryamoy_kontakt:'контакт'})[c.stat]}${sgnTxt(c.mod)}` :
    `Бросок ${STAT_NAME[c.stat] || c.stat}${sgnTxt(c.mod)}${c.max ? ` (${c.max})` : ''}`;

  /* ---------- текст: фразы, подлежащее ---------- */
  // «см. стр. 134)», «т. д.» — не конец фразы; \s в JS ловит и неразрывный пробел — делим только по обычным
  const sentences = (x)=>String(x || '').replace(/(стр|см|т\.\s?[деп]|т\.\s?к|др|пр)\.\s/gi, '$1.\u00a0').split(/(?<=[.!?])[ \t\n]+/).filter(s=>s.trim());
  const TGT_W = 'цел[а-яё]*|противник[а-яё]*|жертв[а-яё]*|кажд[а-яё]*|все|всех|всем|видящ[а-яё]*|слышащ[а-яё]*|те|тот|та|он|она|они|существа|персонажи|игрок[а-яё]*|схваченн[а-яё]*|пойманн[а-яё]*|атакуем[а-яё]*|сожранн[а-яё]*|значим[а-яё]*';
  const SELF_W = 'персонаж|пустота|пустотник|жрец|культист|херувим|щитоносец|разведчик|офицер|киновит|жнец|охотник|гигант|робот|аява|ассасин|боец|иерей|рыцарь|паладин|одержимый|шаман|наводчик|колония|удильщик|харукан|собиратель|идол';
  const W = (src)=>new RegExp('(?:^|[^а-яё])(?:' + src + ')(?=[^а-яё]|$)', 'gi');
  function lastAt(re, s){ let i = -1, m; re.lastIndex = 0; while((m = re.exec(s))) i = m.index; return i; }
  // «в каждом круге», «каждый свой ход» — время, а не цель
  const deTime = (s)=>String(s || '').replace(/кажд\S*\s+(?:свой\s+)?(?:круг|ход|раз|попадани|атак|бо[йяю]|минут|час|день|дня|сцен|проверк)\S*/gi, ' ');
  // чей бросок: ближайшее к нему подлежащее; у пустот «персонаж» — это герой игрока
  function ownerOf(before, voidish){
    before = deTime(before);
    const ti = lastAt(W(TGT_W + (voidish ? '|персонаж[а-яё]*' : '')), before), si = lastAt(W(voidish ? SELF_W.replace('персонаж|', '') : SELF_W), before);
    return ti > si ? 'target' : si > ti ? 'self' : null;
  }
  // Способности персонажей (ctx.pc): бросок без цели-подлежащего — свой («псионик совершает Бросок мистики (−6)»).
  // Цель — только в именительном и не после предлога («о цели», «к существу» — не подлежащее); местоимения («он
  // совершает…») — сам персонаж; условия («когда цель атакует персонажа, …») не в счёт.
  const PC_TGT_W = 'цель|цели|противник|противники|жертва|жертвы|существо|существа|враг|враги|союзник|союзники|видящие|слышащие|каждый|каждое|каждая|все|значим[а-яё]+|подопечн[а-яё]+|атакуем[а-яё]+';
  const PC_SELF_W = ['персонаж', 'псионик', 'псинетик', 'телепат', 'шаман', 'культист', 'жрец', 'монах', 'инквизитор', 'некромастер', 'дипломат', 'экзорцист', 'лидер', 'охотник', 'теург']
    .map(w=>w + '(?:а|у|ом|ем|е)?').concat(['рыцар(?:ь|я|ю|ем|е)', 'куртизанк(?:а|и|е|у|ой)', 'он', 'она']).join('|');
  const PC_TGT_RE = new RegExp('(?<![а-яё])(?<!(?:^|[^а-яё])(?:о|об|в|во|на|к|ко|по|с|со|у|от|для|из|за|над|под|при|против|до|перед|про)\\s+)(?:' + PC_TGT_W + ')(?![а-яё])', 'gi');
  function ownerOfPc(before, vsNote){
    if(vsNote){ if(/цел|противник|жертв|существ|враг|лидер|кажд/i.test(vsNote)) return 'self'; if(W(PC_SELF_W).test(vsNote)) return 'target'; } // «против воли цели» / «против мистики шамана»
    if(/(?:^|[^а-яё])долж(?:но|на|ны)\s+(?:\S+\s+){0,2}$/i.test(before)) return 'target';
    if(/(?:^|[^а-яё])должен\s+(?:\S+\s+){0,2}$/i.test(before)) return 'self';
    before = deTime(before).replace(/(?:^|[\s,;(])(?:если|когда|пока)\s[^,]*,/gi, ' ');
    return lastAt(PC_TGT_RE, before) > lastAt(W(PC_SELF_W), before) ? 'target' : 'self';
  }
  const hasTargetWords = (s, voidish)=>lastAt(W(TGT_W + (voidish ? '|персонаж[а-яё]*' : '') + '|нему|ней|им'), deTime(s)) >= 0;
  const ONGOING_RE = /(?:в|в самом)\s+(?:начале|конце)\s+(?:каждого\s+|следующего\s+|нового\s+|этого\s+)?круга|каждый\s+(?:свой\s+)?ход|тратит каждый свой ход|каждый раз,\s+пока|пока\s+[^.]*связь\s+существует/i;
  const SUCCESS_IF = /если\s+[^,]{0,50}(?:попада|успе|захват\s+состоял)/i;
  const isConditional = (cl)=>/(?:^|[\s(,])(?:а\s+)?если\s/i.test(cl) && !SUCCESS_IF.test(cl);
  // как избавиться от эффекта — пояснение, а не следующий бросок
  const ESCAPE_RE = /(?:может|могут|можно|чтобы)\s+(?:реакцией\s+|действием\s+)?(?:избавиться|освободиться|вырваться|выбраться|снять|избежать)|избавиться от (?:этого\s+)?эффекта можно|пока\s+(?:\S+\s+){0,3}не\s+преуспеет/i;
  const UNTIL_RE = /пока\s+(?:\S+\s+){0,3}не\s+преуспеет/i;
  const CAT2_RE = /(?:провал\S*|успех\S*)\s+(?:с\s+)?категори\S*\s+2|категори\S*\s+(?:провала|успеха)\s+2|при\s+категории\s+(?:провала\s+)?2/i;
  const LE15_RE = /итогом\s+15/i;
  // следующая фраза продолжает исход главного броска («При провале … проходит спасбросок», «Успешная атака вынуждает…»)
  const CHAIN_LEAD = /^\s*(?:при\s+провале|в\s+случае\s+провала|при\s+успехе|в\s+случае\s+успех\S*|затем|после\s+этого|успешн\S*\s+атак\S*|кроме\s+того,?\s+при\s+(?:попадани|успех|провал))/i;
  const KEEP_NOTE = /[+−-]\s*\d|модификатор|Упрощ|Осложн|\d+\s*(?:ОЗ|пси|ран)|на\s+\d+\s|выбор/i;
  // урон «всем» — только с глаголом действия по цели
  const ALWAYS_VERB = /соверша\S*\s+(?:по\s+\S+\s+)?(?:по\s+)?(?:\d+\s+)?попадани|совершая\s+по|нанос\S*|нанося|получа\S*|получ[иа]т|теря\S*|бьются|сбит\S*\s+с\s+ног|сбива\S*|отбрасыва\S*|вдавливает|пронизыва\S*/i;
  // «раз в круг, если пустота видит противника, который провалился …, она …» — условие срабатывания, не последствие
  const stripTrigger = (sn)=>String(sn).replace(/^\s*(?:(?:\d+\s+раз\S*|раз)\s+в\s+\S+,\s*)?если\s+[^,]+(?:,\s*который[^,]+)?,\s*(?:то\s+)?/i, '');
  const cleanLead = (x)=>String(x || '').replace(/^[\s,.:;—–-]+/, '');
  // действие существа (не цели: «цель может реакцией избежать», «пока действием не преуспеет»)
  function actOf(t, voidish){
    const re = /свободным действием|реакцией|затратив действие|тратит действие|действием/gi; let m;
    while((m = re.exec(t))){ const pre = t.slice(Math.max(0, m.index - 40), m.index);
      if(/пока\s+(?:\S+\s+){0,2}$|затратив одно из\s*$/i.test(pre) || ownerOf(pre.split(/[.;]/).pop(), voidish)==='target') continue;
      const w = m[0].toLowerCase(); return w==='свободным действием' ? 'свободное' : w==='реакцией' ? 'реакция' : 'действие'; }
    return null;
  }

  /* ---------- проверки во фразе ---------- */
  function findChecks(sn, nextSn, voidish, whole, pc){
    const out = []; let m;
    // «при провале спасброска от пси-поля» — ссылка на уже сделанный бросок
    const isRef = (at)=>/(?:(?:при|в\s+случае)\s+(?:провал\S*|успех\S*)|результат\S*)\s+$/i.test(sn.slice(Math.max(0, at - 30), at));
    const push = (o)=>{ if(isRef(o.at) || out.some(x=>o.at < x.end && x.at < o.end)) return;
      // «или Броске силы (−24) (на свой выбор)» — вариант той же проверки
      const alt = /^\s*\)?\s*(?:или|либо)\s+((?:Брос\S*\s+)?(?:л[её]гкой\s+атлетики|ловкости\s+рук|воли|рефлексов|выносливости|силы|духа|смекалки)(?:\s*\(?\s*[−+-]\s*\d+\s*\)?)?)(?:\s*\((?:на свой выбор|в зависимости[^)]*)\)|\s+на свой выбор)?/i.exec(sn.slice(o.end));
      if(alt && o.type==='check'){ o.alt = alt[1].trim().replace(/^Брос\S*/i, 'Бросок'); o.end += alt[0].length; }
      const md = /(Осложн\S*|Упрощ\S*)\s+(?:\S+\s+)?$/i.exec(sn.slice(Math.max(0, o.at - 22), o.at)); if(md) o.rmode = /Осложн/i.test(md[1]) ? 'disadvantage' : 'advantage';
      out.push(o); };
    // встречная: существо бросает против характеристики цели
    const reOpp = /Брос\S*\s+(\S+(?:\s+рук)?)\s*(?:\(([−+-]\s*\d+)\)\s*)?\((\d+)\)\s+против\s+(\S+)(?:\s+(\S+))?/gi;
    while((m = reOpp.exec(sn))){ const vs = statOf(m[4]); if(vs) push({at:m.index, end:m.index + m[0].length, type:/атакующ/i.test(m[5] || '') ? 'selfopp' : 'opp', max:+m[3], vs, stat:statOf(m[1])}); }
    const reOpp2 = /Максимум\S*\s+(\d+)\s+против\s+(\S+)/gi;
    while((m = reOpp2.exec(sn))){ const vs = statOf(m[2]); if(vs) push({at:Math.max(0, sn.lastIndexOf('провер', m.index) >= m.index - 30 ? sn.lastIndexOf('провер', m.index) : m.index), end:m.index + m[0].length, type:'opp', max:+m[1], vs}); }
    // проверки цели или самого существа
    const reSm = /Брос\S*\s+(воли|рефлексов|выносливости|силы|духа|смекалки|л[её]гкой\s+атлетики|ловкости\s+рук|восприятия|мистики|техники|убеждения)(?:\s*\(?\s*([−+-]\s*\d+)\s*\)?)?(?:\s*\((\d+)\))?(?:\s+против\s+(\S+)(?:\s+(\d+))?)?/gi;
    while((m = reSm.exec(sn))){ const o = {at:m.index, end:m.index + m[0].length, type:'check', stat:statOf(m[1]), mod:m[2] ? NUM(m[2]) : 0};
      if(m[3]) o.max = +m[3];
      if(m[4]){ if(m[5]) o.mod -= +m[5]; else { const vn = /против\s+((?:(?!\s+или\s)[^,.;()])+)/i.exec(sn.slice(m.index)); o.vsNote = vn ? 'против ' + vn[1].trim() : ''; if(vn) o.end = Math.max(o.end, m.index + vn.index + vn[0].length); }
        if(/атакующ/i.test(sn.slice(m.index, m.index + m[0].length + 20))) o.type = 'selfopp'; }
      push(o); }
    const reSv = /спасброс(\S*)\s+(?:от|против)\s+(пси-пол\S*|хими\S*|радиаци\S*|болезн\S*|вредн\S*\s+сред\S*|кислотност\S*)(?:\s*\(?\s*([−+-]\s*\d+)\s*\)?)?/gi;
    while((m = reSv.exec(sn))) push({at:m.index, end:m.index + m[0].length, type:'check', plural:/^к(?:и|ах|ам)$/i.test(m[1]), stat:/пси/i.test(m[2]) ? 'save_psi_pole' : /кислот/i.test(m[2]) ? 'save_kislotnost' : 'save_vrednaya_sreda', mod:m[3] ? NUM(m[3]) : 0, env:m[2]});
    const reSs = /спасброс\S*\s+(воли|духа|выносливости|смекалки)(?:\s*\(?\s*([−+-]\s*\d+)\s*\)?)?/gi;
    while((m = reSs.exec(sn))) push({at:m.index, end:m.index + m[0].length, type:'check', stat:statOf(m[1]), mod:m[2] ? NUM(m[2]) : 0});
    const reHk = /проверк\S*\s+хладнокровия(?:\s*\(?\s*([−+-]\s*\d+)\s*\)?)?/gi;
    while((m = reHk.exec(sn))) push({at:m.index, end:m.index + m[0].length, type:'check', stat:'hladnokrovie', mod:m[1] ? NUM(m[1]) : -3});
    const rePp = /проверк\S*(?:\s+к20)?\s+с\s+Максимум\S*\s+\[(\d+)\s*\+\s*(пси-сопротивлени\S*|количество текущих очков пси)\]/gi;
    while((m = rePp.exec(sn))) push({at:m.index, end:m.index + m[0].length, type:'check', stat:/текущих/i.test(m[2]) ? 'psi_cur_plus' : 'psi_plus', mod:0, n:+m[1]});
    // атака с Максимумом (не «против», не щит)
    const reAtk = /(?:атак\S*|атакует)[^.]{0,70}?с\s+Максимумом\s+\(?(\d+)\)?|с\s+Максимумом\s+\(?(\d+)\)?/gi;
    while((m = reAtk.exec(sn))){
      if(/против/i.test(sn.slice(m.index + m[0].length, m.index + m[0].length + 10))) continue;
      const near = sn + ' ' + (nextSn || '');
      if(!/атак/i.test(m[0]) && !/попадани|в случае успеха|при успехе|успешн/i.test(near)) continue;
      if(/щит/i.test(sn)) continue;
      push({at:m.index, end:m.index + m[0].length, type:'atk', max:+(m[1] || m[2])});
    }
    // чей бросок и не постоянный ли это бонус
    out.forEach(c=>{
      if(c.type!=='check') return;
      const before = sn.slice(0, c.at).split(/;\s/).pop();
      if(c.plural) { c.role = 'bonus'; return; }
      if(c.max && c.type==='check'){ c.role = 'self'; return; } // «Бросок воли (−3) (13)» — свой Максимум существа
      if(pc){ c.role = ownerOfPc(before, c.vsNote);
        // «Бросок мистики против воли цели» — своя встречная проверка персонажа: из его Максимума вычитается характеристика цели
        const v = c.role==='self' && c.vsNote && /^против\s+(л[её]гк\S*\s+атлетик\S*|ловкост\S*\s+рук|\S+)/i.exec(c.vsNote), vs = v && statOf(v[1]);
        if(vs){ c.type = 'opp'; c.vs = vs; c.pc = true; c.role = null; }
        return; }
      const own = ownerOf(before, voidish);
      if(own) { c.role = own; return; }
      if(/^\s*спасброс/i.test(sn.slice(c.at)) && /\+\s*\d+/.test(sn.slice(c.end, c.end + 25)) && !hasTargetWords(whole, voidish)) { c.role = 'bonus'; return; }
      c.role = voidish || hasTargetWords(whole, voidish) ? 'target' : 'self';
    });
    out.forEach(c=>{ if(c.type==='selfopp') c.role = 'self'; });
    return out.sort((a, b)=>a.at - b.at);
  }

  /* ---------- последствия из куска текста ---------- */
  const C = ()=>({hits:null, hp:'', psi:0, states:[], marks:[], note:''});
  const consEmpty = (c)=>!c || (!c.hits && !c.hp && !c.psi && !c.states.length && !c.marks.length);
  const MARK_R0 = {grabbed:1, prone:1, blind:1, vanished:1}; // держатся, пока не снимут
  function consFrom(x){
    const c = C(); x = String(x || ''); if(!x.trim() || /^\s*например/i.test(x)) return c; let m;
    m = /(?:(\d+|к6|1к6|\[[^\]]*\])\s+)?(?:по\s+(\d+)\s+)?(?:попадани\S*|оружие\S*)\s*(?:с\s+|:\s*)?МУ\s*(\d+)\s*(удар|патрон|энергия|температура|взрыв)?([^.;)]*)/i.exec(x)
      || /()()с\s+МУ\s*(\d+)\s*(удар|патрон|энергия|температура|взрыв)?([^.;)]*)/i.exec(x);
    if(m){ const cnt = m[1] || m[2] || '', tail = m[5] || '', w = /раны\s+(\d+к\d+(?:\s*\+\s*\d+)?|к\d+(?:\s*\+\s*\d+)?|\d+|\[[^\]]+\])/i.exec(tail);
      const byCat = /категори/i.test(cnt), byRoll = /значени|выпавш/i.test(cnt), cp = /\[\s*(\d+)\s*\+\s*категори/i.exec(cnt);
      const pre = x.slice(Math.max(0, m.index - 16), m.index), prof = !cnt && (/^(?:оружие|попадани\S*\s*:|попаданием)/i.test(m[0]) || /\(\s*$|соверша\S*\s+$/i.test(pre));
      const tr = (tail.match(/мощь|пул|разрыв/gi) || []).map(x=>x.toLowerCase()), sz = w && /^\[\s*размер\s+(цели|пустоты|существа)[^\]+]*(?:\+\s*(\d+))?/i.exec(w[1]);
      const wc = w && /^\[\s*(?:(\d+)\s*\+\s*)?категори\S*\s+успеха\s*\]$/i.exec(w[1]); // «раны [1 + категория успеха]» → «1+кат»
      c.hits = {n:/^\d+$/.test(cnt) ? +cnt : byCat ? (cp ? +cp[1] : 0) : 1, nExpr:/к6/.test(cnt) ? 'к6' : byRoll ? 'по выпавшему к20' : /\[/.test(cnt) && !byCat ? cnt : null, byCat, byRoll, mu:+m[3], muType:(m[4] || 'удар').toLowerCase(),
        wounds:sz ? (/цели/i.test(sz[1]) ? 'размер цели' : 'размер существа') + (sz[2] ? '+' + sz[2] : '') : wc ? (wc[1] ? wc[1] + '+' : '') + 'кат' : w ? (/^\[/.test(w[1]) ? '1' : w[1].replace(/\s/g, '')) : '1',
        woundsNote:w && /^\[/.test(w[1]) && !sz && !wc ? 'раны ' + w[1] : '', travma:/травма/i.test(tail), traits:tr.join(', '),
        moshh:tr.indexOf('мощь') >= 0 && !w, pul:tr.indexOf('пул') >= 0, razryv:tr.indexOf('разрыв') >= 0, prof}; }
    const hpRe = /(\d*к\d+(?:\s*\+\s*\d+)?|\d+)\s+(ОЗ|ран[а-яё]*)(?![а-яё])/gi;
    // «теряет [6 ОЗ за категорию успеха]», «нанося по [2 за категорию успеха] ран» — столько за каждую категорию успеха
    const hk = /(?:теря\S*|получа\S*|получ[иа]т|нанос\S*|нанося\S*)\s+(?:им\s+|цели\s+)?(?:по\s+)?\[\s*(\d+)\s*(?:ОЗ\s+|ран\S*\s+)?за\s+(?:кажд\S*\s+)?категори\S*\s+успеха\s*\]/i.exec(x);
    if(hk) c.hp = hk[1] + '×кат';
    while(!hk && (m = hpRe.exec(x))){
      const pre = x.slice(Math.max(0, m.index - 95), m.index), post = x.slice(m.index + m[0].length, m.index + m[0].length + 14);
      if(/меньше|больше/i.test(post) || /(?:отмен|игнорир)\S*\s+(?:получение\s+)?(?:до\s+|по\s+)?$/i.test(pre) || /раны\s*$|\+\s*$/i.test(pre)) continue;
      if(/(теря|получ|наносит|нанося|отбира|отнима|потеря|лишает)/i.test(pre) && !/исцеля|лечит|восстанавлива/i.test(pre.slice(-30))){ c.hp = m[1].replace(/\s/g, ''); break; }
    }
    m = /(?:теря\S*|потеря\S*|отнимая у (?:неё|него)|снимает|отбирает)\s+(?:по\s+)?(\d+)\s+пси|ОЗ\s+и\s+(\d+)\s+пси/i.exec(x); if(m) c.psi = +(m[1] || m[2]);
    if(/испуг|испуган/i.test(x) && !/не может быть испуган|избавля\S* от испуга|прекращая эффект[^.]*испуга/i.test(x)) c.states.push('ispug');
    if(/истощени/i.test(x) && !/не может быть[^.]*истощ|снимает все травмы, истощение/i.test(x)) c.states.push('istoshenie');
    if(/(получ\S*|станов\S*|испыт\S*)\s+(\S+\s+)?стресс/i.test(x)) c.states.push('stress');
    const MK = [['shock', /шок(?!ир)|шокирован/i], ['prone', /сбит\S*\s+с\s+ног(?!\S*\s+(?:цел|существ|противник|персонаж))|сбива\S*\s+с\s+ног|пада\S*\s+на\s+землю/i],
      ['grabbed', /(?:будет|будут|станет|станут|становится|считается|оказывается|она|он|они|цель)\s+(?:\S+\s+)?(?:схвачен|сожран)|связан\S*\s+с\s+херувим|захватыва\S*\s+(?:её|его|ту|цель)|затягивая/i],
      ['stunned', /оглуш[её]н|ошеломл|разум цели отключается/i], ['blind', /слепнет|ослепл/i], ['skipturn', /пропуст\S*\s+(?:этот|следующий|свой)?\s*ход|пропускает следующий ход/i],
      ['vanished', /исчезн\S*\s+из\s+(?:текущей\s+)?реальност|затян\S*\s+в\s+карманн\S*\s+измерени|затягива\S*\s+(?:всех|цел)/i]];
    MK.forEach(([k, re])=>{ const mm = re.exec(x); if(!mm) return; if(k==='shock' && /не может[^.]*шок/i.test(x)) return;
      const r = (k==='vanished' ? /(?:на|через)\s+(\d+|к6)\s+(?:круг|ход)/i : /на\s+(\d+|к6)\s+(?:круг|ход)/i).exec(x.slice(mm.index, mm.index + 50)); c.marks.push(r ? {k, r:/к6/.test(r[1]) ? 'к6' : +r[1]} : {k, r:MARK_R0[k] ? 0 : 1, d:true}); });
    if(/погибнуть|погибает|немедленной гибели|автоматически убивая/i.test(x)) c.note = 'гибель';
    return c;
  }
  function mergeCons(a, b){ if(!b) return a; if(b.hits && !a.hits) a.hits = b.hits; if(b.hp && !a.hp) a.hp = b.hp; if(b.psi && !a.psi) a.psi = b.psi; if(b.note && !a.note) a.note = b.note;
    b.states.forEach(k=>{ if(a.states.indexOf(k) < 0) a.states.push(k); }); b.marks.forEach(mk=>{ if(!a.marks.some(x=>x.k===mk.k)) a.marks.push(mk); }); return a; }
  function consLabel(c){
    if(!c) return ''; const out = [];
    if(c.hits) out.push(`${(c.hits.pul || c.hits.razryv) && c.hits.byCat ? 1 : c.hits.byCat ? `[${c.hits.n ? c.hits.n + ' + ' : ''}кат.]` : c.hits.nExpr || c.hits.n}× МУ ${c.hits.mu} ${c.hits.muType}, раны ${c.hits.moshh ? 'к12' : c.hits.wounds}${c.hits.travma ? ', травма' : ''}${c.hits.traits ? ', ' + c.hits.traits.replace(/пул/, 'пул (кат.×к12)') : ''}`);
    if(c.hp) out.push(`−${c.hp} ОЗ`); if(c.psi) out.push(`−${c.psi} пси`);
    c.states.forEach(k=>out.push(STATE_NAMES[k])); c.marks.forEach(mk=>out.push(MARK_NAMES[mk.k] + (mk.r && mk.r!==1 ? ` (${mk.r} кр.)` : '')));
    if(c.note) out.push(c.note.length > 60 ? c.note.slice(0, 58) + '…' : c.note);
    return out.join(', ');
  }

  /* ---------- ограничения по использованию ---------- */
  const PER = {'день':'в день', 'встречу':'за встречу', 'сцену':'за сцену', 'круг':'в круг', 'ход':'в ход', '3 круга':'за 3 круга', 'бой':'за бой'};
  const usesLabel = (u)=>`${u.n}× ${PER[u.per] || 'в ' + u.per}`;
  function parseUses(name, text){
    const norm = (n, per)=>({n:+n || 1, per:/сутки|день/.test(per) ? 'день' : /встреч/.test(per) ? 'встречу' : per==='3 круга' ? '3 круга' : per});
    const inName = /\((?:до\s+)?(\d+)\s*раз[а]?\s+в\s+(день|сутки|сцену|встречу|игровую встречу)\)/i.exec(name || '');
    if(inName) return norm(inName[1], inName[2]);
    const re = /(?:^|[^а-яё])(?:(?:до\s+)?(\d+)\s*раз[а]?|раз)\s+в\s+(?:свой\s+)?(день|сутки|сцену|круг|ход|игровую встречу|встречу|3 круга|бой)/gi, found = new Map(); let m;
    while((m = re.exec(text || ''))){ if(/перв\S*\s*$/i.test(text.slice(Math.max(0, m.index - 10), m.index + 1))) continue; const u = norm(m[1], m[2]); found.set(u.n + '|' + u.per, u); }
    return found.size===1 ? [...found.values()][0] : null; // несколько разных («3 раза в день …, 2 раза в день …») — счётчик не ставим
  }

  /* ---------- область (метры) ---------- */
  function areaSpec(t){
    let m; const L = (x)=>+String(x).replace(',', '.');
    if((m = /луч\S*\s+шириной\s+(?:в\s+)?([\d,]+)\s*м\S*\s+и\s+длиной\s+(?:до\s+)?(\d+)/i.exec(t))) return {shape:'line', w:L(m[1]), len:+m[2], at:'self'};
    if((m = /(?:пото\S*|полос\S*)[^.]{0,40}?шириной\s+(?:в\s+)?(\d+)\s*м\S*\s+и\s+длиной\s+(?:до\s+)?(\d+)/i.exec(t))) return {shape:'line', w:+m[1], len:+m[2], at:'self'};
    if((m = /полос\S*\s+длиной\s+(?:до\s+)?(\d+)\s*м\S*\s+и\s+шириной\s+(?:в\s+)?(\d+)/i.exec(t))) return {shape:'line', len:+m[1], w:+m[2], at:'self'};
    if((m = /шириной\s+в\s+(\d+)\s+и\s+длиной\s+в?\s*(\d+)\s*м/i.exec(t))) return {shape:'line', w:+m[1], len:+m[2], at:'self'};
    if((m = /полос\S*\s+шириной\s+(?:в\s+)?(\d+)\s*м/i.exec(t))){ const l = /до\s+(\d+)\s*м/i.exec(t); return {shape:'line', w:+m[1], len:l ? +l[1] : 12, at:'self'}; }
    if((m = /кривой\s+длиной\s+до\s+(\d+)\s*м/i.exec(t))) return {shape:'line', w:3, len:+m[1], at:'self'};
    if((m = /квадратн\S*\s+област\S*\s+(?:со\s+стороной|с\s+гранью)\s+в\s+(\d+)/i.exec(t)) || (m = /област\S*\s+(?:в\s+)?(\d+)\s*[×x]\s*\d+/i.exec(t))) return {shape:'rect', side:+m[1], at:'point'};
    if((m = /в радиусе\s+(\d+)\s*(?:м|метр)/i.exec(t))) return {shape:'circle', r:+m[1], at:/точк/i.test(t.slice(m.index, m.index + 50)) ? 'point' : 'self'};
    if((m = /цель и все[^.]{0,30}в пределах\s+(\d+)\s*м/i.exec(t))) return {shape:'circle', r:+m[1], at:'point'};
    if((m = /(?:все|кажд\S*)[^.]{0,90}?в пределах\s+(\d+)\s*(?:м|метр)/i.exec(t)) || (m = /в пределах\s+(\d+)\s*(?:м|метр\S*)\s+от\s+(?:неё|него|себя|пустоты|херувима)/i.exec(t))) return {shape:'circle', r:+m[1], at:'self'};
    if(/к6 видимых/i.test(t)) return {shape:'all', n:'к6'};
    if(/все видящ|все слышащ|кажд\S* слышащ|кажд\S*,? (?:видящ|слышащ)|все существа(?! в)|все персонажи|в пределах прямого обзора/i.test(t)) return {shape:'all'};
    return null;
  }
  function areaLabel(a){ if(!a) return ''; if(a.shape==='all') return a.n ? `${a.n} целей на поле` : 'все на поле';
    return a.shape==='circle' ? `круг ${a.r} м ${a.at==='self' ? 'вокруг себя' : 'в точке'}` : a.shape==='rect' ? `квадрат ${a.side} м в точке` : a.shape==='line' ? `полоса ${a.len}×${a.w} м` : `конус ${a.len} м`; }

  /* ---------- главный разбор ---------- */
  // Пси-дисциплина листа — несколько техник в одном тексте («Пирокинез: … Бытовой пирокинез: …»): по части на технику;
  // вступление до первой техники — описание. Без заголовков — способность целиком (i = 0).
  function pcParts(name, text){
    const t = String(text || ''), re = /(?:^|[.!?]\s+)([А-ЯЁ][а-яё]+(?:[ -][а-яё]+){0,3}):\s/g, heads = []; let m;
    while((m = re.exec(t))){ if(/^(?:Важно|Примечание|Например|Пример)$/i.test(m[1])) continue; heads.push({name:m[1], at:m.index + m[0].indexOf(m[1]), body:m.index + m[0].length}); }
    if(!heads.length) return [{name:name || '', text:t, i:0}];
    return heads.map((h, i)=>({name:`${name}: ${h.name}`, text:t.slice(h.body, i + 1 < heads.length ? heads[i + 1].at : t.length).trim(), i:i + 1})).filter(x=>x.text.length > 30);
  }
  const memo = new Map();
  function parse(name, text, ctx){
    ctx = ctx || {}; const key = (ctx.voidish ? 'v' : 'h') + (ctx.pc ? (ctx.pcFeats ? 'pf' : 'p') : '') + (ctx.now ? 'n|' : '|') + (name || '') + '|' + (text || '');
    if(memo.has(key)) return memo.get(key);
    const s = parseRaw(name, text, ctx); memo.set(key, s); if(memo.size > 3000) memo.clear(); return s;
  }
  // ctx.now — текст «каждого круга» разбирается как действие сейчас (напоминание в начале круга)
  function parseRaw(name, text, ctx){
    const voidish = !!ctx.voidish, ONG = ctx.now ? /$^/ : ONGOING_RE, t = String(text || ''), S = sentences(t);
    const s = {name:name || '', text:t, voidish, pc:!!ctx.pc, cons:C(), always:C(), extras:[], ongoing:[], notes:[], selfCost:[], chain:null};
    const cands = [], escapes = [];
    s.uses = ctx.chained ? null : parseUses(name, t);
    s.act = ctx.chained ? null : actOf(t, voidish);
    let m = /как\s+([а-яё][а-яё\s-]{2,40}?)\s*\(см\./i.exec(t) || /совершает\s+(обычн\S*\s+атак\S*)\s*\(см\.\s*выше\)/i.exec(t);
    if(m && !ctx.chained) s.ref = m[1].trim();
    // главный бросок; по очереди: обычные фразы → «каждый круг» → «пока не преуспеет / может избежать»
    let P = -1, main = null, pass = 0;
    const scan = (allowOng, allowEsc)=>{ pass++; let escCand = null; for(let j = 0; j < S.length; j++){
      if(/^\s*например/i.test(S[j]) || (!allowOng && ONG.test(S[j]))) continue;
      const em = ESCAPE_RE.exec(S[j]);
      let cs = findChecks(S[j], S[j + 1], voidish, t, ctx.pc);
      if(em){ // проверки после «пока не преуспеет / может избежать» — способ избавиться
        const late = cs.filter(c=>c.at > em.index && (c.role==='target' || c.type==='opp')); cs = cs.filter(c=>c.at < em.index || !(c.role==='target' || c.type==='opp'));
        if(late.length && !escCand && !UNTIL_RE.test(S[j])) escCand = {j, c:late[0]};
        if(allowEsc && !cs.length && !UNTIL_RE.test(S[j]) && late.length){ P = j; main = late[0]; return; }
      }
      cs.forEach(c=>{ if(c.role==='self' && !s.selfCheck){ s.selfCheck = c; s.selfAt = j; } if(c.role==='bonus' && !s.bonus) s.bonus = c; });
      // «Бросок смекалки (−3) (13). При успехе … цель …» — бросает существо, цель поражена при успехе (Трюк)
      const sc = cs.find(c=>c.role==='self' && c.max);
      if(sc && S[j + 1] && /^\s*(?:при успехе|в случае успеха)/i.test(S[j + 1]) && /(?:^|[^а-яё])(?:цел[а-яё]*|противник[а-яё]*)(?=[^а-яё]|$)/i.test(S[j + 1])){ main = {type:'opp', max:sc.max, vs:'', stat:sc.stat, at:sc.at, end:sc.end, fromSelf:true}; P = j; return; }
      const a = cs.find(c=>c.role==='target' || c.type==='opp' || c.type==='atk');
      if(a){ if(escCand && escCand.j < j && a.type==='check'){ P = escCand.j; main = escCand.c; } else { P = j; main = a; } return; } } };
    const alwaysIn = (sn)=>{ const b = stripTrigger(sn); return !ONG.test(sn) && !ESCAPE_RE.test(sn) && hasTargetWords(b, voidish) && ALWAYS_VERB.test(b) && !/должн|если|иначе|при провале|в случае|может\s+получить|получает\s+\+|\+\s*\d+\s+к\s/i.test(b) && !consEmpty(consFrom(b)); };
    const alwaysBefore = ()=>S.slice(0, P < 0 ? S.length : P).some(alwaysIn);
    scan(false, false);
    if(!main && !alwaysBefore()) scan(true, false);
    if(!main && !alwaysBefore()) scan(true, true);
    if(main){
      if(main.type==='opp') s.opp = main.pc ? {pc:true, max:null, vs:main.vs, stat:main.stat, mod:main.mod || 0} : {max:main.max, vs:main.vs || '', stat:main.stat || null};
      else if(main.type==='atk'){ s.atk = {max:main.max}; const an = /(\d+|две|два|три)\s+(?:\S+\s+){0,2}?атак/i.exec(S[P].slice(0, main.end)); if(an) s.atk.n = ({две:2, два:2, три:3})[an[1].toLowerCase()] || +an[1]; }
      else s.check = {stat:main.stat, mod:main.mod || 0, n:main.n, vsNote:main.vsNote, rmode:main.rmode || '', alt:main.alt || '', env:main.env || ''};
      if(main.alt) s.notes.push(`или ${main.alt} — на выбор цели`);
      if(s.check && /проваливш\S*\s*$/i.test(S[P].slice(0, main.at))){ mergeCons(s.cons, consFrom(S[P])); s.cons.note = S[P].trim().slice(0, 200); }
      const tf = /(?:персонаж\S*|цел\S*|существ\S*)\s+с\s+(\S+)\s+(\d+)\s+и\s+(ниже|меньше|выше|больше)/i.exec(S[P].slice(0, main.at));
      if(tf && statOf(tf[1])) s.tgtFilter = {stat:statOf(tf[1]), n:+tf[2], le:/ниже|меньше/i.test(tf[3]), text:tf[0]};
    }
    const addOngoing = (sn)=>{ s.ongoing.push(sn.trim().replace(/^\s*(?:при провале|в случае провала|иначе)\s*,?\s*/i, '')); };
    // фразы до главного: «всем» (урон до броска), расход существа, «каждый круг»
    const pre = (sn)=>{
      if(/^\s*например/i.test(sn)) return;
      if(ESCAPE_RE.test(sn)){ escapes.push(sn); return; }
      if(ONG.test(sn)){ if(hasTargetWords(sn, voidish)) addOngoing(sn); return; }
      const sc = /(?:теряя|потеряв|за)\s+(\d+)\s+ОЗ/i.exec(sn);
      if(sc && ownerOf(sn.slice(0, sc.index), voidish)==='self'){ s.selfCost.push(`−${sc[1]} ОЗ`); sn = sn.replace(sc[0], ''); }
      if(alwaysIn(sn)) mergeCons(s.always, consFrom(stripTrigger(sn)));
      else if(isConditional(sn) && KEEP_NOTE.test(sn)) s.notes.push(sn.trim());
    };
    // фраза (или хвост главной) после главного броска
    const failWord = /^(?:при|в\s+случае)\s+провал|^(?:или|иначе|в\s+противном\s+случае)/i, winWord = /^(?:при|в\s+случае)\s+успех/i;
    const after = (part, j)=>{
      const inP = j==='P';
      if(!cleanLead(part).trim() || /^\s*например/i.test(part)) return;
      if(!inP && ESCAPE_RE.test(part)){ escapes.push(part.trim()); return; }
      if(!inP && ONG.test(part)){ addOngoing(part); return; }
      const clauses = part.split(/,\s*а\s+(?=при\s|если\s|в\s+случае)|;\s+/);
      for(let ci = 0; ci < clauses.length; ci++){
        const cl = cleanLead(clauses[ci]); if(cl.length < 4) continue;
        const isCat2 = CAT2_RE.test(cl);
        if(isCat2 || (LE15_RE.test(cl) && !/провалил|промахнул/i.test(cl))){
          const e = {when:isCat2 ? 'cat2' : 'le15', text:cl.trim()}, cc = findChecks(cl, '', voidish, t, ctx.pc).find(c=>c.role==='target');
          e.cons = consFrom(cc ? cl.slice(cc.end) : cl); if(cc) e.viaCheck = CHECK_LABEL(cc); if(/вместо\s+этого/i.test(cl)) e.replace = true;
          s.extras.push(e); continue; }
        const rg = /если\s+\[\s*значени\S*[^\]]*к20\s*\]\s+выше\s+(\S+(?:\s+\S+)?)\s+цели,?\s*(?:то\s+)?(.*)$/i.exec(cl), sz = /если\s+размер\s+цели\s+(\d+)\s+и\s+меньше,?\s*(?:то\s+)?(.*)$/i.exec(cl);
        if(rg && statOf(rg[1]) && !consEmpty(consFrom(rg[2]))){ s.extras.push({when:'rollGt', stat:statOf(rg[1]), text:cl.trim(), cons:consFrom(rg[2])}); continue; }
        if(sz && !consEmpty(consFrom(sz[2]))){ s.extras.push({when:'sizeLe', n:+sz[1], text:cl.trim(), cons:consFrom(sz[2])}); continue; }
        const bg = /если\s+(?:пустота|существо)\s+больше\s+цели\s+на\s+(\d+)\s+и\s+более\s+размер\S*,?\s*(?:то\s+)?(.*)$/i.exec(cl);
        if(bg && !consEmpty(consFrom(bg[2]))){ s.extras.push({when:'srcBigger', n:+bg[1], text:cl.trim(), cons:consFrom(bg[2])}); continue; }
        if(isConditional(cl)){ s.notes.push(cl.trim()); continue; }
        if(!inP && !ctx.chained && !s.also && findChecks(cl, '', voidish, t, ctx.pc).some(c=>c.type==='atk' && c.max)){
          const al = parseRaw(name, cl, Object.assign({}, ctx, {chained:true})); if(al.atk){ s.also = al; continue; } }
        const cc = findChecks(cl, '', voidish, t, ctx.pc).find(c=>c.role==='target' || c.type==='opp');
        if(cc && !(inP && cc.at===0) && (inP || ci > 0 || CHAIN_LEAD.test(cl))){
          // следующий бросок для поражённых: то, что до него, — ещё последствия этого броска
          mergeCons(s.cons, consFrom(cl.slice(0, cc.at)));
          const rest = [cl.slice(cc.at)].concat(clauses.slice(ci + 1)).join(', ') + ' ' + (typeof j==='number' ? S.slice(j + 1) : S.slice(P + 1)).join(' ');
          s.chain = parseRaw(name, rest, Object.assign({}, ctx, {chained:true})); s.chain.chained = true; return 'stop';
        }
        if(cc){ s.notes.push(cl.trim()); continue; } // проверка в посторонней фразе («после воскрешения проходит проверку хладнокровия»)
        const c = consFrom(cl);
        if(consEmpty(c) && !c.note){
          if(s.check ? failWord.test(cl) : winWord.test(cl)) cands.push(cl.replace(/^(?:при|в\s+случае)\s+(?:провал|успех)\S*(?:\s+спасброска[^,:]*)?[,:]?\s*|^(?:или|иначе|в\s+противном\s+случае)[,:]?\s*/i, ''));
          else if(KEEP_NOTE.test(cl) && !inP) s.notes.push(cl.trim());
        } else { mergeCons(s.cons, c); if(/выбор/i.test(cl)) s.notes.push(cl.trim()); if(/провал\S*\s+1\s+категори|категори\S*\s+провала\s+1/i.test(cl)) s.cat1Only = true;
          if(c.marks.some(mk=>mk.k==='vanished') && !s.cons.note) s.cons.note = cl.replace(/^(?:при|в\s+случае)\s+(?:провал|успех)\S*[,:]?\s*|^(?:или|иначе|в\s+противном\s+случае)[,:]?\s*/i, '').trim().slice(0, 200); } // куда исчез — текстом
      }
    };
    if(main){
      for(let j = 0; j < P; j++) pre(S[j]);
      const sn = S[P];
      if(!main.fromSelf){ const h0 = stripTrigger(sn.slice(0, main.at)).split(/\s(?:и\s+)?должн/)[0];
        if(hasTargetWords(h0, voidish) && ALWAYS_VERB.test(h0) && !/если|иначе|при провале/i.test(h0)) mergeCons(s.always, consFrom(h0)); }
      // «… проходит спасбросок … и получает попадание» — попадание при любом исходе
      const tail = sn.slice(main.end).replace(/^\s*против\s+(?:(?!\s+или\s)[^,.;(])+(?=\s+или\s)/i, '');
      if(/^\s*,?\s*и\s+(получает|получат)/i.test(tail)) mergeCons(s.always, consFrom(tail));
      else after(tail, 'P');
      if(!s.chain) for(let j = P + 1; j < S.length; j++){ if(after(S[j], j)==='stop') break; }
    } else S.forEach(pre);
    // «пока не преуспеет …» без главного броска — эффект на цель без броска, освобождение — Мастер
    if(!main){ const u = S.find(sn=>UNTIL_RE.test(sn) && hasTargetWords(sn, voidish)); if(u && consEmpty(s.always)) s.always.note = u.trim().slice(0, 200); }
    // как избавиться: держится, пока не снимут; «в начале круга … может снять» — напоминание
    escapes.forEach(x=>{
      [s.cons, s.always].concat(s.extras.map(e=>e.cons)).forEach(c=>c.marks.forEach(mk=>{ if(new RegExp(({stunned:'ошеломл|оглуш', shock:'шок', grabbed:'схвач|связ|сожр|захват|освобод|выбрат', prone:'встать|подня', blind:'зрени'})[mk.k] || '$^', 'i').test(x)) mk.r = 0; }));
      if(s.ongoing.length) s.ongoing[s.ongoing.length - 1] += ' ' + x.trim();
      else if(ONG.test(x)) addOngoing(x);
      else s.notes.push(x.trim());
    });
    if(s.ongoing.some(x=>/прекраща\S*\s+эффект|снять|избав/i.test(x))) [s.cons].concat(s.extras.map(e=>e.cons)).forEach(c=>c.marks.forEach(mk=>{ if(mk.d) mk.r = 0; }));
    if(consEmpty(s.cons) && !s.cons.note && cands.length) s.cons.note = cands.join(' ').slice(0, 200);
    // у персонажа: «значимые … могут … преуспеть в спасброске …, чтобы избежать ран» — урон получают провалившие, а не все
    if(ctx.pc && s.check && main && /избега|избежа/i.test(S[P]) && consEmpty(s.cons) && !consEmpty(s.always)){
      s.cons = s.always; s.always = C(); if(/значим/i.test(S[P])) s.notes.push('избежать могут только значимые для истории — остальным отметьте «применить» сами'); }
    // общие правила книги. Хладнокровие: при провале −2 пси (при модификаторе ±0 — −1) и испуг до конца сцены; пси 0 и меньше —
    // срыв по к20 этой проверки (20-target-rolls, SRYV). Пси-поле: пси-облучение + 1 истощение, итог 15− — пси-мутация.
    // Вредная среда: заражение по среде + 1 истощение (и +1 в конце каждого дня, пока не снято).
    if(s.check && s.check.stat==='hladnokrovie'){
      mergeCons(s.cons, Object.assign(C(), {psi:s.check.mod===0 ? 1 : 2, states:['ispug']}));
      s.sryv = /срыв/i.test(t) ? 'always' : 'auto'; if(/срыв/i.test(s.cons.note)) s.cons.note = '';
    }
    else if(s.check && consEmpty(s.cons) && !s.cons.note && !s.extras.length && !s.ongoing.length && !s.chain &&
      (/^save_(?:psi_pole|vrednaya_sreda)$/.test(s.check.stat) || (consEmpty(s.always) && !s.always.note))){ // спасбросок среды — и при уроне «всем» (Идол 1–2, В чреве)
      const st = s.check.stat, env = String(s.check.env || '');
      if(st==='save_psi_pole'){ s.cons.states.push('istoshenie'); s.cons.note = 'пси-облучение: шёпот Равнины, провал отдыха — макс. ОЗ −1; +1 истощение в конце каждого дня';
        s.extras.push({when:'le15', mutation:true, text:'пси-мутация (таблица пси-мутаций, стр. 32)', cons:Object.assign(C(), {note:'пси-мутация'})}); }
      else if(st==='save_vrednaya_sreda'){ s.cons.states.push('istoshenie');
        s.cons.note = `${/хими/i.test(env) ? 'химическое отравление' : /радиац/i.test(env) ? 'радиоактивное облучение' : /болезн/i.test(env) ? 'болезнь' : 'заражение'}: +1 истощение в конце каждого дня, пока не снято`; }
      else s.cons.note = st==='save_kislotnost' ? 'броня — по правилам кислотности' : 'последствия провала — по тексту способности (решает Мастер)';
    }
    // длительность («на [1 + категория успеха] кругов», «на 3 круга»)
    m = /\[\s*(\d+)\s*\+\s*категори\S*\s+успеха\s*\]\s+круг/i.exec(t); if(m) s.duration = {base:+m[1], plusCat:true};
    else if((m = /на\s+\[\s*категори\S*\s+успеха\s*\]\s+круг/i.exec(t))) s.duration = {base:0, plusCat:true};
    else if((m = /на\s+(\d+)\s+круг/i.exec(t))) s.duration = {base:+m[1]};
    s.areaSpec = areaSpec(t);
    if(s.atk && s.areaSpec && s.areaSpec.shape==='circle') s.areaSpec = null; // у атаки «в пределах N м» — дальность по одной цели
    s.feats = ctx.chained || (ctx.pc && !ctx.pcFeats) ? [] : features(name, t, !!ctx.pcFeats); // свойства персонажа считает лист; у существа из листа (pcFeats) — автоматика существ
    if(s.selfCheck && ((!s.selfCheck.max && !ctx.pc) || s.feats.some(f=>(f.id==='cancelWounds' && f.roll) || f.id==='deathRise'))) s.selfCheck = null; // бросок уже в подсказке
    s.kind = s.check ? 'save' : s.opp ? 'opposed' : s.atk ? 'attack' : (!consEmpty(s.always) || s.always.note) ? 'auto' : s.selfCheck ? 'self' : s.feats.length ? 'passive' : 'text';
    if(s.cat1Only) s.extras.forEach(e=>{ if(e.when==='cat2' || e.when==='le15') e.replace = true; });
    // «отбирает 2к6 ОЗ и исцеляет равноценное количество ОЗ себе», «ОЗ, которые исцеляются пустоте»
    if(/исцеля\S*\s+(?:равноценное|столько же|такое же)\s+(?:количество\s+)?(?:ОЗ\s+)?себе|которые\s+исцеляются\s+(?:пустоте|ей|ему|существу)/i.test(t)) s.drain = true;
    // «Бросок воли против воли пустоты» (+ «Воля пустоты +3») — модификатор из характеристики существа
    // у персонажа: «Бросок рефлексов против мистики персонажа (псионика, шамана)» — из характеристики персонажа
    const vs = s.check && (ctx.pc ? /^против\s+(л[её]гк\S*\s+атлетик\S*|ловкост\S*\s+рук|\S+)(?![^]*(?:цел|противник|жертв|существ|атакующ|враг|кажд))/i : /^против\s+(\S+)\s+(?:пустот\S*|существ\S*)$/i).exec(s.check.vsNote || ''), vst = vs && statOf(vs[1]);
    if(vst && ctx.pc) s.check.vsSrc = {stat:vst, bonus:0};
    else if(vst){ const bm = new RegExp('(\\S+)\\s+пустот\\S*\\s+\\+\\s*(\\d+)', 'i').exec(t); s.check.vsSrc = {stat:vst, bonus:bm && statOf(bm[1])===vst ? +bm[2] : 0}; }
    // «если при проверке … на к20 выпадет нечётное значение, то …» — подсказка в строке броска
    m = /[^.]*на\s+к20\s+выпад\S*\s+нечётн[^.]*\./i.exec(t); if(m) s.oddNote = m[0].trim();
    if(s.always.note) s.notes = s.notes.filter(n=>n.trim().slice(0, 150)!==s.always.note.trim().slice(0, 150));
    const H = s.cons.hits; if(H && H.prof && !H.byCat && !H.byRoll && (s.atk || (s.opp && /атак/i.test(S[P] || '')))){ H.byCat = true; H.n = 0; } // успешная атака — [КУ] попаданий
    if(ctx.pc && !ctx.chained){
      // цена в пси («затратив действие и 2 пси», «за 1 пси», «тратит действие, 3 пси») и «при провале расходуется до конца дня»
      m = /(?:за|по)?тра[тч]\S*\s+(?:действие\s*(?:и|,)\s*)?(\d+)\s+пси(?![а-яё-])|(?:расход\S*|за)\s+(\d+)\s+пси(?![а-яё-])/i.exec(t); if(m) s.psiCost = +(m[1] || m[2]);
      s.spendOnFail = /(?:в\s+случае\s+провала|при\s+провале)[^.]*(?:расход|утрачива|не\s+может\s+(?:больше\s+)?(?:использовать|применять))/i.test(t);
    }
    s.chips = chips(s);
    return s;
  }

  /* ---------- постоянные свойства и автоматика (что приложение делает само) ---------- */
  function features(name, t, pc){
    const out = [], S = sentences(t); let m;
    S.forEach(sn=>{
      if((/не повреждающ\S* пси-плоскость/i.test(sn) || /атак\S*[^.]{0,60}по\s+(нему|ней|пустот\S*)/i.test(sn)) && (m = /(?:штраф|модификатор)\s*([−-]\s*\d+)/i.exec(sn)) && !/может|раз в круг|если персонаж хочет|выбирает/i.test(sn))
        out.push({id:'atkVsMe', v:Math.abs(NUM(m[1])), psi:/пси-плоскость/i.test(sn), label:`−${Math.abs(NUM(m[1]))} к атакам по нему${/пси-плоскость/i.test(sn) ? ' (оружие не по пси-плоскости)' : ''}`});
      const typed = /типом\s*«([^»]+)»(?:\s*и\s*«([^»]+)»)?\s*наносят\s+на\s+(\d+)\s+ран\S*\s+меньше/i.exec(sn);
      if(typed){ const adj = {}; [typed[1], typed[2]].filter(Boolean).forEach(tp=>{ adj[tp.toLowerCase()] = -(+typed[3]); });
        const more = /с типом\s*«([^»]+)»\s*наносят\s+на\s+(\d+)\s+ран\S*\s+больше/i.exec(sn); if(more) adj[more[1].toLowerCase()] = +more[2];
        out.push({id:'woundsTyped', adj, label:'раны по нему: ' + Object.keys(adj).map(k=>`${k} ${adj[k] > 0 ? '+' : '−'}${Math.abs(adj[k])}`).join(', ')}); }
      else if((m = /наносят\s+(?:пустоте\s+|ему\s+|ей\s+)?на\s+(\d+)\s+ран\S*\s+меньше/i.exec(sn))) out.push({id:'woundsTaken', v:+m[1], label:`−${m[1]} к ранам по нему`});
      if(/более одного попадания[^.]*отменяет\s+1к12/i.test(sn)) out.push({id:'inertial', label:'щит: отменяет 1к12 из нескольких попаданий стрелковой атаки'});
      if((m = /\+\s*(\d+)\s+к\s+(?:атаке|проверкам\s+атак)/i.exec(sn)) && !/на\s+(\d+|\[[^\]]+\])\s+круг|неистов/i.test(t)){
        const ally = /в пределах\s+(\d+(?:,\d+)?)\s*(?:м|метр)\S*[^.]*союзник|союзник[^.]*в пределах\s+(\d+)/i.exec(sn);
        const energy = /энергетическ/i.test(sn), ranged = /стрелков/i.test(sn), other = !ally && /если|когда|в бою с|раз в/i.test(sn);
        if(!other && !(pc && /по\s+(?:ней|нему|цели|жертв)|за\s+\d+\s+пси|на\s+\d+\s+круг|ярост|в\s+первом\s+круге/i.test(sn))) out.push({id:'atkBonus', v:+m[1], energy, ranged, allyM:ally ? +(String(ally[1] || ally[2]).replace(',', '.')) : 0,
          label:`+${m[1]} к атаке${energy ? ' энергетическим' : ''}${ranged && !energy ? ' стрелковым' : ''}${ally ? ', если союзник в ' + (ally[1] || ally[2]) + ' м' : ''}`}); }
      if((m = /\+\s*(\d+)\s+к\s+ранам[^.]*если у цели не полное ОЗ/i.exec(sn))) out.push({id:'muka', v:+m[1], label:`+${m[1]} к ранам, если у цели не полное ОЗ`});
      if(/инициатив/i.test(sn) && !/союзник|может|если|когда|вместо|перебро/i.test(sn)){
        if((m = /инициатив[^.]*?\+\s*(\d+)/i.exec(sn))) out.push({id:'initBonus', label:`инициатива +${m[1]}`});
        else if(/Упрощ/i.test(sn)) out.push({id:'initBonus', label:'инициатива Упрощена'}); }
      if((m = /в радиусе\s+(\d+)\s*м\S*\s+проверк\S*\s+инициативы\s+союзников\s+\+\s*(\d+)/i.exec(sn))) out.push({id:'initAura', label:`+${m[2]} к инициативе союзникам в ${m[1]} м`});
      if(/невосприимчив\S*\s+к\s+[^.]*(яд|болезн|хими|радиац)/i.test(sn)) out.push({id:'immuneEnv', label:'спасброски от вредной среды — успех без броска'});
      if((m = /спасброс\S*\s+от\s+(хими\S*|вредн\S*\s+сред\S*|болезн\S*|радиаци\S*)[^.]*?\+\s*(\d+)/i.exec(sn))) out.push({id:'saveEnv', v:+m[2], label:`спасброски от вредной среды +${m[2]} (${m[1]})`});
      if(/спасброс\S*\s+от\s+(болезн|хими|радиац)\S*[^.]*Упрощ/i.test(sn)) out.push({id:'saveEnvAdv', label:'спасброски от болезней Упрощены'});
      if(/проверк\S*[^.]*(рефлекс|атлетик|вол|сил|вынослив|дух|смекалк)[^.]*Осложн/i.test(sn) && !/знани/i.test(sn) && !(pc && /в\s+случае|если|когда|до\s+конца|на\s+ближайш|может|ярост|на\s+\d+\s+круг/i.test(sn))) out.push({id:'statDis', label:'проверки ' + (sn.match(/л[её]гк\S* атлетик\S*|рефлекс\S*|вол\S*|сил\S*|вынослив\S*|дух\S*|смекалк\S*/gi) || []).join(', ') + ' Осложнены'});
      if(/не может (?:быть|получить)/i.test(sn) && /испуг|истощ|шок/i.test(sn)){ const list = []; if(/испуг/i.test(sn)) list.push('ispug'); if(/истощ/i.test(sn)) list.push('istoshenie'); if(/шок/i.test(sn)) list.push('shock');
        if(!/неистов/i.test(t)) out.push({id:'immuneStates', list, label:'не бывает: ' + list.map(k=>({ispug:'испуга', istoshenie:'истощения', shock:'шока'})[k]).join(', ')}); }
      if((m = /отмен\S*\s+(?:получение\s+)?(?:до\s+)?(\d+)\s+ран/i.exec(sn))){ const daily = /не более\s+(\d+)\s+ран/i.exec(t), roll = /Брос\S*\s+(\S+)\s*\(([−+-]\s*\d+)\)\s*\((\d+)\)/i.exec(sn);
        out.push({id:'cancelWounds', per:+m[1], daily:daily ? +daily[1] : 0, roll:roll ? {stat:statOf(roll[1]), mod:NUM(roll[2]), max:+roll[3]} : null,
          label:`отмена до ${m[1]} ран — подсказка, когда существо ранено${daily ? ` (за день не более ${daily[1]})` : ''}`}); }
      if(/реакцией\s+совершает\s+Бросок\s+рефлексов\s+против\s+смекалки\s+атакующ/i.test(sn)) out.push({id:'evasion', label:'подсказка при попадании по нему: Бросок рефлексов против смекалки атакующего — промах'});
      if((m = /раз в круг[^.]*наложить на проверку этой атаки штраф\s*([−-]\s*\d+)/i.exec(sn))) out.push({id:'dodgeMinus', v:Math.abs(NUM(m[1])), label:`подсказка при попадании: −${Math.abs(NUM(m[1]))} к этой атаке (раз в круг)`});
      if(/выпал успех и чётное значение/i.test(sn)) out.push({id:'tactic', label:'подсказка при успехе с чётным к20: цель теряет реакцию'});
      if((m = /упал в обморок или погиб[^.]*\.?[^.]*?Брос\S*\s+(\S+)\s*\(([−+-]\s*\d+)\)\s*\((\d+)\)/i.exec(t)) && /упал в обморок/i.test(sn)) out.push({id:'deathRise', stat:statOf(m[1]), max:+m[3], label:`подсказка при ОЗ ≤ 0: Бросок ${STAT_NAME[statOf(m[1])] || m[1]} (${m[3]}) — встать`});
      if((m = /в проверках воли может использовать вместо целевой характеристики мистику\s*(?:\d+\s*)?\((\d+)\)/i.exec(sn))) out.push({id:'willShield', max:+m[1], label:`Бросок воли по мистике (${m[1]}), если так лучше`});
      if((m = /в радиусе\s+(\d+)\s*м\s+существа могут перебрасывать броски костей только/i.exec(sn))) out.push({id:'anchor', r:+m[1], label:`в ${m[1]} м перебросы только прекогницией — подсказки перебросов отключены`});
      if(/Упрощ\S*\s+атакует\s+испуганн/i.test(sn)) out.push({id:'hintTorment', label:'подсказка атаке: Упрощённо по испуганным и сбитым с ног'});
      if(/если персонаж скрыт[^.]*атакующ[^.]*Упрощ/i.test(sn)) out.push({id:'hintStealth', label:'подсказка атаке: Упрощённо, если существо скрыто'});
      if(/(провалил\S*|промахнул\S*)\s+с\s+итогом\s+15/i.test(sn)) out.push({id:'trigger', label:'подсказка: игрок провалил с итогом 15−' + (/промахнул/i.test(sn) ? ' (промах атаки рядом)' : '')});
    });
    const rs = pc ? rerollScopePc(t) : rerollScope(t);
    if(rs && rs.scope!=='other' && rs.scope!=='trauma' && rs.scope!=='hits_all' && rs.scope!=='hits_note') out.push({id:'reroll', scope:rs.scope, label:'↻ переброс: ' + ({own_d20:'свой к20', own_attack:'своя атака', vs_me:'атака по нему и его рефлексы' + (/на 1 рану больше/i.test(t) ? ' (если всё же попали — +1 рана)' : ''), stat:'проверка ' + (rs.stats || [rs.stat]).map(k=>STAT_NAME[k] || k).join(' или ')})[rs.scope] + (rs.cond ? ', ' + rs.cond : '')});
    if(pc) out.push(...featuresPc(t, rs));
    const buff = buffSpec(t, pc);
    if(buff) out.push({id:'buff', spec:buff, label:'▶ включить: ' + buffLabel(buff)});
    return out;
  }
  // Временное усиление: «на 3 круга +3 к проверкам атаки», неистовство (по броску), Мясник (на одну атаку)…
  function buffSpec(t, pc){
    const dur = /на\s+\[\s*категори\S*\s+успеха\s*\]\s+круг/i.test(t) ? {cat:true} : (/на\s+(\d+)\s+круг/i.exec(t) ? {n:+/на\s+(\d+)\s+круг/i.exec(t)[1]} : null);
    const mods = {}; let m;
    if((m = (pc ? /\+\s*(\d+)\s+к\s+(?:проверкам\s+)?атак[еаи]?(?![а-яё])(?!\s+по\s)/i : /\+\s*(\d+)\s+к\s+проверкам\s+атак/i).exec(t)) && dur) mods.attack = +m[1];
    if((m = /защиту\s+\+\s*(\d+)/i.exec(t)) && dur) mods.def = +m[1];
    if(/(?:отменять|игнорировать)\s+по\s+1\s+ране\s+из\s+каждого\s+попадания/i.test(t) && dur) mods.woundsTaken = -1;
    if((m = /первый его урон в каждом круге наносит\s+\+\s*(\d+)\s+ран/i.exec(t))) mods.firstDmg = +m[1];
    if(/избавляется от испуга и шока и не может получить их/i.test(t)) mods.immune = ['ispug', 'shock'];
    let oneShot = false;
    if((m = /добавляет\s+\+\s*(\d*к\d+)\s+к\s+атаке/i.exec(t))){ mods.attackDice = m[1]; oneShot = true; if((m = /\+\s*(\d+)\s+к\s+МУ/i.exec(t))) mods.mu = +m[1]; }
    if((m = /повысив своё пси-сопротивление на\s+\+?\s*(\d+)/i.exec(t))){ mods.psiSave = +m[1]; oneShot = true; }
    if(pc){ // «Ярость»: +3 временных ОЗ, игнорирует истощение, Осложнённо проходит проверки смекалки…; «Дикий напор»: можно Упрощённо пройти проверку силы или воли
      if((m = /\+\s*(\d+)\s+временн\S*\s+ОЗ/i.exec(t)) && (dur || Object.keys(mods).length)) mods.tempHp = +m[1];
      if(/игнорирует\s+истощени/i.test(t) && (dur || Object.keys(mods).length)) mods.immune = (mods.immune || []).concat(['istoshenie']);
      if((m = /Осложн\S*\s+проходит\s+проверк\S*\s+([^.;]+)/i.exec(t)) && (dur || Object.keys(mods).length)){ const ks = statsIn(m[1]); if(ks.length) mods.dis = ks; }
      if(!Object.keys(mods).length && (m = /(?:можно|может)\s+(?:\S+\s+){0,2}?(?:Упрощ\S*\s+пройти|пройти\s+Упрощ\S*|Упростить)\s+проверк\S*\s+([^.;]+)/i.exec(t)) && !/если/i.test(m[1])){
        const ks = statsIn(m[1].split(/\s+и\s+(?:исцел|получ)/i)[0]).filter(k=>k!=='hladnokrovie'); if(ks.length){ mods.adv = ks; oneShot = true; } }
      if(Object.keys(mods).length && (m = /исцелиться\s+на\s+(\d+)\s+ОЗ/i.exec(t))) mods.heal = +m[1];
    }
    if(!Object.keys(mods).length) return null;
    const roll = /Брос\S*\s+(\S+)\s*(?:\(([−+-]\s*\d+)\)\s*)?\((\d+)\)[^.]*(?:в случае успеха|в успехе)/i.exec(t) || (oneShot && mods.psiSave ? /Брос\S*\s+(\S+)\s*(?:\(([−+-]\s*\d+)\)\s*)?\((\d+)\)/i.exec(t) : null)
      || (pc ? /Брос\S*\s+(\S+(?:\s+(?:атлетики|рук))?)\s*(?:\(([−+-]\s*\d+)\))?[^]{0,80}?(?:в случае успеха|при успехе)/i.exec(t) : null); // у персонажа Максимум — по характеристике
    return {mods, rounds:dur, oneShot, viaRoll:roll ? {stat:statOf(roll[1]), mod:roll[2] ? NUM(roll[2]) : 0, max:roll[3] ? +roll[3] : null} : null};
  }
  function buffLabel(b){ const m = b.mods, p = [];
    if(m.attack) p.push(`+${m.attack} к атаке`); if(m.attackDice) p.push(`+${m.attackDice} к атаке`); if(m.mu) p.push(`МУ +${m.mu}`); if(m.def) p.push(`защита +${m.def}`);
    if(m.woundsTaken) p.push('−1 рана от каждого попадания'); if(m.firstDmg) p.push(`первый урон за круг +${m.firstDmg} раны`); if(m.psiSave) p.push(`+${m.psiSave} к пси-сопротивлению`);
    if(m.immune) p.push('без ' + m.immune.map(k=>({ispug:'испуга', shock:'шока', istoshenie:'истощения'})[k] || k).join(' и '));
    if(m.tempHp) p.push(`+${m.tempHp} временных ОЗ`); if(m.heal) p.push(`+${m.heal} ОЗ сразу`); if(m.dis) p.push('Осложнены: ' + m.dis.map(k=>STAT_NAME[k] || k).join(', ')); if(m.adv) p.push('Упрощена проверка ' + m.adv.map(k=>STAT_NAME[k] || k).join(' или '));
    return p.join(', ') + (b.oneShot ? (m.adv ? ' — одна проверка' : ' — на одну атаку/проверку') : b.rounds ? (b.rounds.cat ? ' на [кат.] кругов' : ` на ${b.rounds.n} кр.`) : '') + (b.viaRoll ? ` — после броска${b.viaRoll.max ? ` (${b.viaRoll.max})` : ''}` : ''); }
  /* ---------- существо из листа персонажа: формулировки способностей персонажа ----------
     Перебросы: «перебросить результат/итог проверки атаки» — своя атака (подсказка после промаха); «перебросить проверку
     техники / восприятия / выносливости или …» и «(своей или чужой), если участвуют его рефлексы» — эта проверка; «все
     свои кости к12» / «каждую кость к12» — к12 своей атаки (та же атака с тем же к20); по ситуации («связана с торгом»,
     «с животными», союзнику…) и частично к12 — плашкой с условием. Спасброски «+4 на спасброски от вредной среды»,
     «Спасброски против химии +2», «+3 к проверкам к20 от химии, радиации…»; «Проверки мистики Упрощены»; нат. 12 при
     атаке («Вот это бой», «Проворство»); «Если в ярости преуспел в атаке…» — подсказка. */
  const anyStat = (w)=>statOf(w) || (/артистизм/i.test(w) ? 'artistizm' : /понимани/i.test(w) ? 'ponimanie_lyudey' : null);
  const statsIn = (x)=>{ const out = []; String(x || '').split(/\s*(?:,|\s+или\s+|\s+и\s+)\s*/).forEach(w=>{ const k = statOf(w.trim().replace(/^(?:на|своей|своего|своих)\s+/i, '')) || (/хладнокров/i.test(w) ? 'hladnokrovie' : null); if(k && out.indexOf(k) < 0) out.push(k); }); return out; };
  const PC_SITUATION = /торг|животн|расследован|ловушк|охот|отдых|ориентирован|переговор|вымогател|лж[иеё]|религиоз|мистическ\S*\s+способн|пси-способн|культов\S*\s+символ|аугментац|ксенотрансплант|высокотехнолог|взрывчат|криминал|реликви|медицин|союзник|сопартийц|гумоид|заставить|заставля|противник\S*\s+перебро|вихр|послушани|катарсис|миссия|ситуаци|мастер\s+согласен/i;
  const condOf = (sn)=>{ const m = /^(.*?)\s*,?\s*(?:то\s+)?(?:персонаж|он|боец|вор|убийца|рыцарь|жрец|техник|учёный|пилигрим|мошенник)?\s*(?:может|можно)\s/i.exec(sn); const c = m ? m[1].replace(/^(?:раз|один раз|\d+\s+раз\S*)\s+в\s+\S+\s*,?\s*/i, '').trim() : ''; if(/если|когда|используя|в\s+бою|против|при\s|пока/i.test(c) && c.length < 90) return c.toLowerCase();
    const tail = /,\s*(если\s+[^.,;]{3,80})/i.exec(sn); return tail ? tail[1].toLowerCase() : ''; };
  function rerollScopePc(t){
    const sn = sentences(t).find(x=>/перебр[ао]с/i.test(x) && !/не\s+может\s+быть\s+переброш/i.test(x)); if(!sn) return null;
    if(/перебр[ао]с\S*\s+(?:все\s+свои|каждую|все)\s+(?:свои\s+)?кост\S*\s+к12/i.test(sn) && !/цел[ьи]|союзник|атакован|попада\S*\s+атак/i.test(sn.split(/перебр[ао]с/i)[0])) return {scope:'hits_all'};
    if(/к12/i.test(sn)) return {scope:'hits_note', cond:sn.trim()};
    if(/таблиц\S*\s+травм/i.test(sn)) return {scope:'trauma'};
    if(/перебр[ао]с\S*\s+(?:результат\S*\s+|итог\S*\s+)?(?:кажд\S*\s+)?(?:своей\s+)?(?:проверк\S*\s+)?атак/i.test(sn) && !PC_SITUATION.test(sn)) return {scope:'own_attack', cond:/невыгодной\s+позиции/i.test(sn) ? 'против цели в невыгодной позиции' : condOf(sn)};
    if(PC_SITUATION.test(sn)) return {scope:'other', cond:sn.trim()};
    let m = /(?:сво\S*\s+или\s+чуж\S*)[^.]*участву\S*\s+(?:его\s+)?(л[её]гк\S*\s+атлетик\S*|\S+)/i.exec(sn);
    if(m && statOf(m[1])) return {scope:'stat', stat:statOf(m[1]), stats:[statOf(m[1])], cond:'своя или чужая'};
    m = /перебр[ао]с\S*\s+(?:результат\S*\s+|итог\S*\s+)?(?:кажд\S*\s+)?(?:любую\s+)?(?:проверк\S*|бросок)\s+(?:на\s+)?([^.;,(]+)/i.exec(sn);
    const ks = m ? statsIn(m[1].replace(/\s+(?:если|до|при|раз|используя)\s.*$/i, '')).filter(k=>k!=='hladnokrovie') : [];
    if(ks.length) return {scope:'stat', stat:ks[0], stats:ks, cond:condOf(sn)};
    if(m && /[а-яё]{3}/i.test(m[1]) && !/^\s*(?:к20|кост)/i.test(m[1])) return {scope:'other', cond:sn.trim()}; // «проверку на понимание людей», «проверки инициативы»
    if(/перебр[ао]с\S*\s+(?:свой\s+|любую\s+брошенную\s+им\s+|любой\s+)?(?:к20|кост|проверк)/i.test(sn)) return {scope:'own_d20', cond:condOf(sn)};
    return {scope:'other', cond:sn.trim()};
  }
  function featuresPc(t, rs){
    const out = [], S = sentences(t); let m;
    if(rs && rs.scope==='hits_all') out.push({id:'rerollHits', label:'↻ переброс: все к12 своей атаки (после попадания)'});
    if(rs && (rs.scope==='hits_note' || rs.scope==='other')) out.push({id:'rerollNote', label:'↻ переброс по условию — решает Мастер', cond:rs.cond});
    const UNCOND = /(?:^|[^а-яё])(?:если|когда|может|можно|раз\s+в|за\s+\d+\s+(?:пси|удач)|в\s+ярости|до\s+конца|в\s+случае|при\s+успехе|при\s+провале|пока)(?![а-яё])/i;
    S.forEach(sn=>{
      const env = /хими|радиац|болезн|вредн\S*\s+сред|кислот|температур/i;
      if((m = /\+\s*(\d+)\s+(?:на|к)\s+(?:спасброск\S*|проверк\S*\s+к20)\s+(?:от|против)\s+([^.]+)/i.exec(sn) || /спасброск\S*\s+(?:от|против)\s+([^.]+?)\s*\+\s*(\d+)/i.exec(sn)) && !UNCOND.test(sn)){
        const v = /^\d+$/.test(m[1]) ? +m[1] : +m[2], what = /^\d+$/.test(m[1]) ? m[2] : m[1];
        if(env.test(what) && /хими|радиац|болезн|вредн/i.test(what)) out.push({id:'saveEnv', v, label:`спасброски от вредной среды +${v}`});
        if(/кислот/i.test(what)) out.push({id:'saveAcid', v, label:`спасброски от кислотности +${v}`}); }
      if(/Упрощ/i.test(sn) && /проверк/i.test(sn) && !UNCOND.test(sn) && !/инициатив/i.test(sn)){
        const ks = statsIn((/проверк\S*\s+([^.]+?)\s+(?:\S+\s+)?Упрощ/i.exec(sn) || /Упрощ\S*\s+проходит\s+проверк\S*\s+([^.]+)/i.exec(sn) || /проверк\S*\s+([^.]+?)\s+Упрощ/i.exec(sn) || [])[1]).filter(k=>k!=='hladnokrovie');
        if(ks.length) out.push({id:'statAdv', stats:ks, label:'проверки ' + ks.map(k=>STAT_NAME[k] || k).join(', ') + ' Упрощены'}); }
      if((m = /(?:выкинув|выбрасывает|выпал\S*|выпадает)\s+12\s+на\s+к20[^.]*атак/i.exec(sn))) out.push({id:'nat12', renew:/возобновля\S*\s+(\S+)/i.exec(sn) ? /возобновля\S*\s+(\S+)/i.exec(sn)[1] : '', label:'подсказка: нат. 12 при атаке', text:sn.trim()});
      // «Мастерство боя»: атаки по бойцу −3
      if((m = /атак\S*[^.]{0,60}по\s+(?:бойцу|персонажу|вору|рыцарю|убийце|стрелку|снайперу)[^.]*(?:модификатор|штраф)\S*\s*([−-]\s*\d+)/i.exec(sn)) && !/может|если|раз\s+в/i.test(sn)) out.push({id:'atkVsMe', v:Math.abs(NUM(m[1])), label:`−${Math.abs(NUM(m[1]))} к атакам по нему`});
      // «Изворотливость», «Сложная цель»: −[свои рефлексы] к атаке по нему — подсказка при попадании
      if(/(?:наложить|да[её]т)[^.]{0,50}модификатор\s*(?:±|[−-])\s*\[\s*сво\S*\s+рефлекс/i.test(sn)) out.push({id:'dodgeMinus', vStat:'refleksy', label:'подсказка при попадании: −[рефлексы] к этой атаке'});
      // «Обманное движение»: реакцией Бросок артистизма против смекалки атакующего — промах
      if((m = /реакцией\s+(?:совершает\s+)?Брос\S*\s+(\S+(?:\s+людей)?)\s+против\s+(\S+(?:\s+людей)?)\s+атакующ[^.]*(?:промаз|промах|избега)/i.exec(sn))){ const a1 = anyStat(m[1]), a2 = anyStat(m[2]);
        if(a1 && a2 && !(a1==='refleksy' && a2==='smekalka')) out.push({id:'evasion', stat:a1, vs:a2, label:`подсказка при попадании по нему: Бросок ${STAT_NAME[a1] || m[1]} против ${STAT_NAME[a2] || m[2]} атакующего — промах`}); }
      // «Берсерк», «Мгновенная контратака»: внеочередная атака в ответ
      if(/(?:получая\s+попадание|атаковал\S*\s+(?:цель|его|вора|персонажа)|если\s+\S+\s+атаковал\S*)[^.]*внеочередн\S*\s+атак/i.test(sn)) out.push({id:'counterHint', onHit:/получая\s+попадание/i.test(sn), label:'подсказка: внеочередная атака в ответ', text:sn.trim()});
      // «Точность»: при стрельбе +1 к МУ
      if((m = /при\s+стрельбе[^.]*\+\s*(\d+)\s+к\s+МУ/i.exec(sn))) out.push({id:'muBonus', v:+m[1], ranged:true, label:`+${m[1]} МУ при стрельбе`});
      // «Умелая атака», «Вонзаться»: нанося урон, добавить +1к6 / +1 рану — кнопка после попадания
      if((m = /нанося\s+урон[^.]*?(?:добавить|нанести)\s+(?:ей\s+|ещё\s+)?\+\s*(\d*к\d+|\d+)\s+ран/i.exec(sn))) out.push({id:'bonusWound', expr:m[1], label:`после урона: +${m[1]} ${m[1]==='1' ? 'рана' : 'ран'} (кнопка)`});
      if(/инициатив/i.test(sn) && /может[^.]*Упрощ/i.test(sn) && !/союзник/i.test(sn)) out.push({id:'initPc', label:'инициатива Упрощена' + (/(\d+)\s+пси/i.exec(sn) ? ` (за ${/(\d+)\s+пси/i.exec(sn)[1]} пси)` : '')});
      if(/смекалк\S*\s+вместо\s+рефлекс\S*[^.]*инициатив|инициатив[^.]*смекалк\S*\s+вместо\s+рефлекс/i.test(sn)) out.push({id:'initPc', label:'инициатива по смекалке, если она выше рефлексов'});
      if(/если\s+в\s+(\S+)\s+преуспел[^.]*атак/i.test(sn)) out.push({id:'onHitHint', when:/если\s+в\s+(\S+)/i.exec(sn)[1], label:'подсказка после успешной атаки', text:sn.trim()});
    });
    return out;
  }
  // Что перебрасывает способность
  function rerollScope(t){
    if(!/перебро/i.test(t)) return null;
    if(/свой или чужой к20/i.test(t)) return {scope:'vs_me'};
    if(/перебросить\s+свой\s+к20/i.test(t)) return {scope:'own_d20', cond:/против другой народности/i.test(t) ? 'против другой народности' : ''};
    if(/перебросить\s+(?:результат\s+своей\s+)?проверк\S*\s+атак/i.test(t)) return {scope:'own_attack', cond:/уже ранил/i.test(t) ? 'по цели, которую уже ранил' : /итогом 15/i.test(t) ? 'при провале 15− расходуется' : ''};
    const m = /перебросить\s+проверку\s+(воли|рефлексов|выносливости|силы|духа|смекалки)/i.exec(t);
    if(m) return {scope:'stat', stat:statOf(m[1])};
    return {scope:/таблице травм/i.test(t) ? 'trauma' : 'other'};
  }

  /* ---------- плашки ---------- */
  // «кат. 2» у броска цели — провал с итогом 15 и меньше (категория провала 2), то же, что «итог 15−»; у существа — его успех кат. 2+
  const extraName = (e, targetRolls)=>e.when==='srcBigger' ? `больше цели на ${e.n}+ размера` : e.when==='rollGt' ? `к20 выше ${STAT_NAME[e.stat] || e.stat} цели` : e.when==='sizeLe' ? `размер цели ≤ ${e.n}` : targetRolls ? 'провал 15− (кат. 2)' : e.when==='cat2' ? 'успех кат. 2+' : 'итог 15−';
  const extraText = (e)=>e.text.replace(/^если\s+[^,]*,\s*(?:то\s+)?/i, '').replace(/^.*?(?:итогом\s+15\S*|категори\S*\s+(?:провала\s+|успеха\s+)?2\+?|категорией\s+2)\s*[,:]?\s*(?:дополнительно\s+)?/i, '');
  function chips(s){
    const out = [], c = s.cons, act = s.kind==='save' || s.kind==='opposed' || s.kind==='attack' || s.kind==='auto';
    if(s.act) out.push(['act', s.act]);
    if(s.uses) out.push(['uses', usesLabel(s.uses)]);
    if(s.check) out.push(['save', '🎯 цель: ' + (s.check.rmode ? (s.check.rmode==='disadvantage' ? 'Осложнённо, ' : 'Упрощённо, ') : '') + CHECK_LABEL(s.check) + (s.check.alt ? ' или ' + s.check.alt : '') + (s.check.vsNote ? ' ' + s.check.vsNote : '')]);
    if(s.psiCost) out.push(['act', `${s.psiCost} пси`]);
    if(s.opp && s.opp.pc) out.push(['save', `🎲 ${CHECK_LABEL({stat:s.opp.stat, mod:s.opp.mod})} против ${STAT_NAME[s.opp.vs]} цели`]);
    else if(s.opp) out.push(['save', s.opp.vs ? `🎯 Макс. ${s.opp.max} против ${STAT_NAME[s.opp.vs]} цели` : `🎯 бросок существа (${s.opp.max}), при успехе — цель`]);
    if(s.atk) out.push(['save', `⚔ ${s.atk.n > 1 ? s.atk.n + ' атаки' : 'атака'}, Макс. ${s.atk.max}`]);
    if(s.kind==='auto') out.push(['save', '💥 без броска']);
    if(act){
      if(!consEmpty(s.always) || s.always.note) out.push(['bad', (s.kind==='auto' ? 'цели: ' : 'всем: ') + consLabel(s.always)]);
      if(!consEmpty(c) || c.note) out.push(['bad', (s.kind==='opposed' || s.kind==='attack' ? 'при успехе: ' : s.cat1Only ? 'провал кат. 1: ' : 'провал: ') + consLabel(c)]);
      s.extras.forEach(e=>out.push(['cond', extraName(e, !!s.check) + (e.replace ? ' вместо' : '') + ': ' + (e.viaCheck ? e.viaCheck + ' → ' : '') + (consEmpty(e.cons) && !e.cons.note ? extraText(e).slice(0, 50) : consLabel(e.cons))]));
      if(s.ongoing.length) out.push(['cond', '↻ каждый круг: ' + s.ongoing[0].replace(/^(?:если\s+)?(?:в начале|в конце)\s+(?:каждого\s+|следующего\s+)?круга,?\s*/i, '').slice(0, 60) + (s.ongoing[0].length > 60 ? '…' : '')]);
      if(s.sryv) out.push(['cond', s.sryv==='always' ? 'ещё срыв (таблица срывов по к20)' : 'пси 0 и меньше → срыв по к20']);
      if(s.also) out.push(['save', `⚔ ещё ${s.also.atk.n > 1 ? s.also.atk.n + ' атаки' : 'атака'}, Макс. ${s.also.atk.max}: ${consLabel(s.also.cons)}`]);
      if(s.chain) out.push(['save', 'затем: ' + (s.chain.check ? CHECK_LABEL(s.chain.check) : s.chain.opp ? `Макс. ${s.chain.opp.max}` : '…')]);
      if(s.selfCost.length) out.push(['act', 'сама: ' + s.selfCost.join(', ')]);
      if(s.drain) out.push(['act', 'сама: +столько же ОЗ, сколько отняла']);
      if(s.areaSpec) out.push(['area', '📐 ' + areaLabel(s.areaSpec)]);
      if(s.tgtFilter) out.push(['cond', `только цели с ${STAT_NAME[s.tgtFilter.stat] ? s.tgtFilter.text.replace(/^\S+\s+с\s+/i, '') : s.tgtFilter.text}`]);
      const nt = s.notes.filter(n=>!/^или .* — на выбор цели$/.test(n));
      if(nt.length) out.push(['help', `✎ ${nt.length > 1 ? nt.length + ' условия' : 'условие'} — решает Мастер`, nt.join('\n')]);
    }
    if(s.selfCheck && !s.opp) out.push(['self', (s.pc ? '🎲 свой бросок: ' : '🎲 бросок существа: ') + CHECK_LABEL(s.selfCheck) + (s.pc && act ? ', при успехе — цели' : '')]);
    (s.feats || []).forEach(f=>out.push([f.id==='reroll' || f.id==='trigger' || f.id==='rerollNote' || f.id==='rerollHits' ? 're' : f.id==='buff' ? 'save' : 'pas', (f.id==='reroll' || f.id==='buff' || f.id==='rerollNote' || f.id==='rerollHits' ? '' : f.id==='trigger' ? '⚡ ' : '⚙ авто: ') + f.label].concat(f.cond ? [f.cond] : [])));
    if(!act && !(s.feats || []).length && !(s.selfCheck && s.selfCheck.max) && (/[+−]\s*\d|Упрощ|Осложн|раз в|перебро|защит|(?:^|[^а-яё])ран(?:ы|у|а|ами)?(?![а-яё])|Брос|провер|реакци|действи|удач/i.test(s.text) || /(?:^|[^А-Яа-яЁё])ОЗ(?![А-Яа-яЁё])/.test(s.text))) out.push(['help', '📖 справка — решает Мастер']);
    return out;
  }
  const chipsHtml = (s)=>s.chips.length ? `<span class="ak-chips">${s.chips.map(([k, l, ti])=>`<span class="ak-chip ak-${k}" title="${esc(ti || l)}">${esc(l)}</span>`).join('')}</span>` : '';

  /* ---------- отсылки («как морок Нара», «обычную атаку (см. выше)») ---------- */
  const voidishOf = (tpl)=>!!tpl && (/Пустот/i.test(tpl.group || '') || /пустот/i.test(tpl.name || ''));
  function resolved(name, text, tpl){
    const ctx = {voidish:voidishOf(tpl), pc:!!(tpl && tpl.pc), pcFeats:!!(tpl && tpl.pc)}, s = parse(name, text, ctx);
    if(!s.ref) return s;
    const stem = (x)=>String(x || '').toLowerCase().replace(/ё/g, 'е').replace(/\s*\(.*$/, '').trim().split(/\s+/).map(w=>w.length > 4 ? w.slice(0, -2) : w).join(' ');
    const want = stem(s.ref), match = (a)=>stem(a[0]);
    let src = tpl && (tpl.abil || []).find(a=>a[1]!==text && (match(a)===want || match(a).indexOf(want)===0));
    if(!src && typeof Bestiary!=='undefined') Bestiary.list().some(t=>{ src = (t.abil || []).find(a=>match(a)===want); return !!src; });
    if(!src || src[1]===text) return s;
    const base = parse(src[0], src[1], ctx), r = Object.assign({}, base, {name, text, uses:s.uses || base.uses, refName:src[0]});
    const extraN = /(?:сразу\s+)?на\s+(\d+)\s+цел/i.exec(text); r.chips = [['act', `как «${src[0]}»${extraN ? `, на ${extraN[1]} цели` : ''}`]].concat(base.chips.filter(c=>c[0]!=='uses')).concat(s.uses ? [['uses', usesLabel(s.uses)]] : []);
    return r;
  }

  /* ---------- счётчики, усиления, продолжающиеся эффекты (у Мастера) ---------- */
  const USES_KEY = 'reincarnator_ability_uses_v1', BUFF_KEY = 'reincarnator_ability_buffs_v1', ONG_KEY = 'reincarnator_ability_ongoing_v1';
  const loadJ = (k)=>{ try{ return JSON.parse(localStorage.getItem(k) || 'null') || null; }catch(e){ return null; } };
  const saveJ = (k, v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
  let uses = loadJ(USES_KEY) || {}, buffs = loadJ(BUFF_KEY) || {}, ongoing = loadJ(ONG_KEY) || [];
  const saveUses = ()=>saveJ(USES_KEY, uses);
  const usedOf = (tokId, key)=>((uses[tokId] || {})[key] || 0);
  function bump(tokId, key, d){ const u = uses[tokId] || (uses[tokId] = {}); u[key] = Math.max(0, (u[key] || 0) + d); saveUses(); }
  const buffsOf = (tokId)=>(buffs[tokId] || []);
  function addBuff(tokId, key, name, spec, cat){
    const rounds = spec.oneShot ? null : spec.rounds ? (spec.rounds.cat ? Math.max(1, cat || 1) : spec.rounds.n) : null;
    // временные ОЗ: жетон не держит ОЗ выше максимума (стол поднимает максимум) — прежний максимум помним в усилении
    const gt0 = GTk(), t0 = spec.mods.tempHp && gt0 && gt0.getToken(tokId), prev = buffsOf(tokId).find(b=>b.key===key);
    const baseMax = prev && prev.baseMax!=null ? prev.baseMax : t0 && t0.hpMax!=null ? t0.hpMax : null;
    buffs[tokId] = buffsOf(tokId).filter(b=>b.key!==key).concat([Object.assign({key, name, mods:spec.mods, left:rounds, oneShot:spec.oneShot}, baseMax!=null ? {baseMax} : {})]); saveJ(BUFF_KEY, buffs); refreshCard();
    if(t0 && t0.hp!=null && !(prev && prev.baseMax!=null)) gt0.updateToken(tokId, {hp:t0.hp + spec.mods.tempHp}); // повторное включение того же — без вторых временных ОЗ
    if(spec.mods.heal){ const gt = GTk(), t = gt && gt.getToken(tokId); if(t && t.hp!=null) gt.updateToken(tokId, {hp:t.hpMax!=null ? Math.min(t.hpMax, t.hp + spec.mods.heal) : t.hp + spec.mods.heal}); }
    if(spec.mods.immune){ const gt = GTk(), t = gt && gt.getToken(tokId); if(t && (t.marks || []).some(m=>m.k==='fear' || m.k==='shock')) gt.updateToken(tokId, {marks:t.marks.filter(m=>m.k!=='fear' && m.k!=='shock')}); }
  }
  // временные ОЗ усиления пропадают с ним: ОЗ не выше максимума
  // (урон сначала «съедает» временные: ОЗ не выше прежнего максимума — то же самое)
  function endTempHp(tokId, b){ if(!b || !b.mods.tempHp || b.baseMax==null) return; const gt = GTk(), t = gt && gt.getToken(tokId); if(t && t.hp!=null) gt.updateToken(tokId, {hp:Math.min(t.hp, b.baseMax), hpMax:b.baseMax}); }
  function dropBuff(tokId, key){ endTempHp(tokId, buffsOf(tokId).find(b=>b.key===key)); buffs[tokId] = buffsOf(tokId).filter(b=>b.key!==key); saveJ(BUFF_KEY, buffs); refreshCard(); }
  function addOngoing(o){ o = Object.assign({id:'og' + Math.random().toString(36).slice(2, 8)}, o); if(!o.left && /следующего\s+круга/i.test(o.text)) o.left = 1;
    ongoing.push(o); saveJ(ONG_KEY, ongoing); }
  // невосприимчивость к состояниям: свойство («Робот») или усиление («Неистовство»)
  function immuneStates(t){
    const set = new Set(); if(!t) return set;
    (t.creature && t.creature.abil || []).forEach(a=>features(a[0], a[1]).forEach(f=>{ if(f.id==='immuneStates') f.list.forEach(k=>set.add(k)); }));
    buffsOf(t.id).forEach(b=>(b.mods.immune || []).forEach(k=>set.add(k)));
    return set;
  }

  // Свой бросок существа: Максимум из книги («(13)») или — у существа из листа персонажа — 10 + характеристика + модификатор
  function selfMax(tok, s){
    const c = s.selfCheck; if(!c) return null; if(c.max) return c.max;
    if(!s.pc || !tok || typeof TargetRolls==='undefined') return null;
    return 10 + TargetRolls.npcStat(tok, c.stat==='hladnokrovie' ? 'volya' : c.stat) + (c.mod || 0);
  }
  /* ---------- карточка существа: плашки, кнопки ---------- */
  // key — 'a<i>' способность или 'm<таблица>-<строка>' ход пустоты; tpl — шаблон (для отсылок и «персонажа» у пустот)
  function rowHtml(tok, key, name, text, tpl){
    const s = resolved(name, text, tpl || (tok && tok.creature));
    if(!s.chips.length) return '';
    const canFire = s.kind==='save' || s.kind==='opposed' || s.kind==='attack' || s.kind==='auto';
    let usesHtml = '';
    if(tok && s.uses){ const u = usedOf(tok.id, key), left = s.uses.n - u;
      usesHtml = `<span class="ak-count${left <= 0 ? ' out' : ''}" title="Использовано ${u} из ${s.uses.n} (${s.uses.per}). ↺ — сбросить">◷ ${Math.max(0, left)}/${s.uses.n}<button type="button" class="ak-mini" data-ak-reset="${esc(key)}" data-tok="${esc(tok.id)}">↺</button></span>`; }
    const btns = [];
    if(canFire && tok) btns.push(`<button type="button" class="bst-mini ak-atk" data-ak-atk="${esc(key)}" data-tok="${esc(tok.id)}" title="Атака: ${s.areaSpec && s.areaSpec.shape!=='all' ? 'область на карте — видно, кого задевает' : s.areaSpec ? 'все на поле' : 'цель — кликом по жетону на карте'}; параметры — как в карточке">⚔</button>`);
    if(canFire) btns.push(`<button type="button" class="bst-mini ak-go" data-ak-go="${esc(key)}" ${tok ? `data-tok="${esc(tok.id)}"` : ''} title="Креативное использование способности">★</button>`);
    const buff = (s.feats || []).find(f=>f.id==='buff');
    const sm = selfMax(tok, s); // у существа из листа свой бросок перед целями делает ⚔ — отдельная 🎲 только без целей
    if(tok && sm!=null && !s.opp && !(s.pc && canFire)) btns.push(`<button type="button" class="bst-mini" data-ak-self="${esc(key)}" data-tok="${esc(tok.id)}" title="Бросок существа к20 против Максимума ${sm}${buff && buff.spec.viaRoll ? ' — при успехе включится усиление' : ''}">🎲 ${sm}</button>`);
    if(tok && buff && !buff.spec.viaRoll) btns.push(`<button type="button" class="bst-mini" data-ak-buff="${esc(key)}" data-tok="${esc(tok.id)}" title="Включить: ${esc(buffLabel(buff.spec))}">▶ включить</button>`);
    const active = tok ? buffsOf(tok.id).find(b=>b.key===key) : null;
    const activeHtml = active ? `<span class="ak-chip ak-on">✦ активно${active.oneShot ? ' (на одну)' : active.left ? `: ещё ${active.left} кр.` : ''}<button type="button" class="ak-mini" data-ak-unbuff="${esc(key)}" data-tok="${esc(tok.id)}" title="Снять">✕</button></span>` : '';
    const shown = usesHtml ? Object.assign({}, s, {chips:s.chips.filter(c=>c[0]!=='uses')}) : s;
    return `<span class="ak-row">${chipsHtml(shown)}${activeHtml}${usesHtml}${btns.join('')}</span>`;
  }
  function abilityByKey(tpl, key){
    if(key[0]==='a'){ const a = tpl.abil[+key.slice(1)]; return a ? {name:a[0], text:a[1]} : null; }
    const mm = /^m(\d+)-(\d+)$/.exec(key); if(!mm) return null; const tb = tpl.tables[+mm[1]], r = tb && tb.rows[+mm[2]];
    return r ? {name:`Ход ${r[0]}`, text:r[1]} : null;
  }
  async function checkUses(tokId, key, s, ab){
    if(!tokId || !s.uses) return true; const left = s.uses.n - usedOf(tokId, key);
    return left > 0 || await uiConfirm(`«${ab.name}» уже использована ${s.uses.n} раз (${s.uses.per}). Применить всё равно?`, {title:'Способность', ok:'Применить'});
  }
  async function fire(tokId, tpl, key){
    const ab = abilityByKey(tpl, key); if(!ab || typeof TargetRolls==='undefined') return;
    const s = resolved(ab.name, ab.text, tpl);
    if(!(await checkUses(tokId, key, s, ab))) return;
    const gt = GTk(), sel = gt && gt.selectedIds ? gt.selectedIds().filter(id=>id!==tokId) : [];
    TargetRolls.open({src:tokId || null, targets:sel, title:ab.name.replace(/\s*\([^)]*\)\s*$/, ''), prefill:s, onFired:()=>{ if(tokId && s.uses){ bump(tokId, key, 1); refreshCard(); } }});
  }
  // ⚔ — сразу на стол: цель кликом по жетону (область — шаблоном с задетыми жетонами), параметры — как в форме по умолчанию
  const WORD_N = {два:2, две:2, три:3, четыре:4};
  function targetsWanted(s){
    const m = /(?:сразу\s+)?на\s+(\d+)\s+цел/i.exec(s.text) || /(\d+|два|две|три|четыре)\s+(?:ближайш\S+\s+)?(?:противник|цел)/i.exec(s.text);
    const n = m ? WORD_N[m[1].toLowerCase()] || +m[1] : 1;
    return Math.max(n, s.atk && s.atk.n || 1);
  }
  const rangeOf = (x)=>{ const m = /в\s+пределах\s+(\d+)\s*(?:м(?![а-яё])|метр)/i.exec(x || ''); return m ? +m[1] : 0; };
  async function quickFire(tokId, tpl, key){
    const gt = GTk(), ab = abilityByKey(tpl, key); if(!gt || !ab || !tokId || typeof TargetRolls==='undefined') return;
    const s = resolved(ab.name, ab.text, tpl), title = ab.name.replace(/\s*\([^)]*\)\s*$/, '');
    if(!(await checkUses(tokId, key, s, ab))) return;
    const hidden = [...document.querySelectorAll('.bst-float, .tr-panel, #gmScreen.open')].filter(el=>el.style.visibility!=='hidden'); // не закрывают стол
    hidden.forEach(el=>{ el.style.visibility = 'hidden'; });
    if(typeof toggleMainTab==='function') toggleMainTab('table');
    const go = (ids)=>{ hidden.forEach(el=>{ el.style.visibility = ''; }); if(!ids) return;
      if(!ids.length && !(s.areaSpec && s.areaSpec.shape==='all')){ uiToast('В области нет целей', {icon:'⚔'}); return; }
      // существо из листа: сначала свой бросок («совершает Бросок мистики (−6), в случае успеха…»), провал — без эффекта
      let pcRoll = null; const sm = s.pc && !s.opp ? selfMax(gt.getToken(tokId), s) : null;
      if(sm!=null){ const r = rollCreature(gt.getToken(tokId), title, sm, 'plain');
        if(!r.success){ if(s.uses){ bump(tokId, key, 1); refreshCard(); } uiToast(`«${title}»: к20=${r.roll} / Макс.${sm} — провал, способность не сработала`, {icon:'⚔'}); return; }
        pcRoll = {label:CHECK_LABEL(s.selfCheck), opp:false, rolls:[r.roll], mode:'plain', base:sm, roll:r.roll, success:true, cat:r.cat}; }
      TargetRolls.open({src:tokId, targets:ids, title, prefill:s, auto:true, pcRoll, onFired:()=>{ if(s.uses){ bump(tokId, key, 1); refreshCard(); } }}); };
    const a = s.areaSpec;
    if(a && a.shape==='all'){ go([]); return; }
    setTimeout(()=>{ if(a && typeof AreaTemplates!=='undefined') AreaTemplates.pick(a, tokId, title, go);
      else gt.pickTargets({srcId:tokId, n:targetsWanted(s), title, rangeM:rangeOf(s.text), done:go}); }, 120);
  }
  function rollCreature(tok, label, max, mode){
    const r1 = 1 + Math.floor(Math.random()*20), r2 = 1 + Math.floor(Math.random()*20), m = mode || 'plain';
    const roll = m==='plain' ? r1 : pickD20ForMode(r1, r2, max, m), ev = evaluateD20Check(roll, max);
    if(typeof setCreatureRollCtx==='function') setCreatureRollCtx({label:`${nameOfTok(tok)} · ${label}`, base:max, pub:false, tokId:tok.id});
    if(typeof recordAndShareRoll==='function') recordAndShareRoll('creature_roll', 0, roll, max, ev.success, ev.category, m, m==='plain' ? [r1] : [r1, r2]);
    return {roll, max, success:ev.success, cat:ev.category};
  }
  async function selfRoll(tokId, tpl, key){
    const gt = GTk(), tok = gt && gt.getToken(tokId), ab = abilityByKey(tpl, key); if(!tok || !ab) return;
    const s = resolved(ab.name, ab.text, tpl); if(!(await checkUses(tokId, key, s, ab))) return;
    const mode = /Упрощ\S*\s+Брос/i.test(ab.text) ? 'advantage' : /Осложн\S*\s+Брос/i.test(ab.text) ? 'disadvantage' : 'plain';
    const r = rollCreature(tok, ab.name.replace(/\s*\([^)]*\)\s*$/, '') + (s.pc && s.selfCheck ? ': ' + CHECK_LABEL(s.selfCheck) : ''), selfMax(tok, s), mode);
    if(s.uses) bump(tokId, key, 1);
    const buff = (s.feats || []).find(f=>f.id==='buff' && f.spec.viaRoll);
    if(buff && r.success){ addBuff(tokId, key, ab.name.replace(/\s*\([^)]*\)\s*$/, ''), buff.spec, r.cat); uiToast(`«${ab.name}»: успех, КУ${r.cat} — ${buffLabel(buff.spec)}`, {icon:'✦'}); }
    else uiToast(`«${ab.name}»: к20=${r.roll} / Макс.${r.max} — ${r.success ? 'успех, КУ' + r.cat : 'провал'}`, {icon:'🎲'});
    refreshCard();
  }
  function refreshCard(){ if(typeof Bestiary!=='undefined' && Bestiary.refreshFloat) Bestiary.refreshFloat(); }
  document.addEventListener('click', (e)=>{
    const b = e.target.closest && e.target.closest('[data-ak-go],[data-ak-atk],[data-ak-self],[data-ak-buff],[data-ak-unbuff],[data-ak-reset]'); if(!b) return;
    e.preventDefault(); e.stopPropagation();
    const tokId = b.dataset.tok || null, gt = GTk(), t = tokId && gt ? gt.getToken(tokId) : null, card = b.closest('.bst-card');
    const tpl = t && t.creature ? t.creature : (typeof Bestiary!=='undefined' ? Bestiary.byId((card && card.dataset.tpl) || Bestiary.selId()) : null);
    if(b.dataset.akReset){ const u = uses[tokId]; if(u){ delete u[b.dataset.akReset]; saveUses(); } refreshCard(); return; }
    if(b.dataset.akUnbuff){ dropBuff(tokId, b.dataset.akUnbuff); return; }
    if(!tpl) return;
    if(b.dataset.akGo) fire(t ? tokId : null, tpl, b.dataset.akGo);
    else if(b.dataset.akAtk){ if(t) quickFire(tokId, tpl, b.dataset.akAtk); else uiToast('Существа нет на столе', {icon:'⚔'}); }
    else if(b.dataset.akSelf) selfRoll(tokId, tpl, b.dataset.akSelf);
    else if(b.dataset.akBuff){ const ab = abilityByKey(tpl, b.dataset.akBuff), s = ab && resolved(ab.name, ab.text, tpl), f = s && (s.feats || []).find(x=>x.id==='buff'); if(!f) return;
      checkUses(tokId, b.dataset.akBuff, s, ab).then(ok=>{ if(!ok) return; if(s.uses) bump(tokId, b.dataset.akBuff, 1); addBuff(tokId, b.dataset.akBuff, ab.name.replace(/\s*\([^)]*\)\s*$/, ''), f.spec, 1); uiToast(`«${ab.name}» включено: ${buffLabel(f.spec)}`, {icon:'✦'}); }); }
  }, true);

  /* ---------- конструктор: что распознано по ходу набора ---------- */
  function editorPreview(ta){
    let box = ta.parentNode.querySelector('.ak-preview');
    if(!box){ box = document.createElement('div'); box.className = 'ak-preview'; ta.parentNode.appendChild(box); }
    const paras = String(ta.value || '').split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);
    box.innerHTML = paras.map(p=>{ const i = p.indexOf(':'), name = i>0 && i<80 ? p.slice(0, i).trim() : '', text = i>0 && i<80 ? p.slice(i + 1) : p, s = parse(name, text);
      return `<div class="ak-pv"><b>${esc(name || 'без названия')}</b> ${s.chips.length ? chipsHtml(s) : '<span class="gs-muted">описание — механики нет</span>'}</div>`; }).join('') ||
      '<span class="gs-muted">Пишите как в книге: «Бросок рефлексов (−6)», «спасбросок от пси-поля (+3)», «2 попадания с МУ 12 удар, раны 3, травма», «(2 раза в день)» — здесь появится, что распознано.</span>';
  }
  document.addEventListener('input', (e)=>{ if(e.target.matches && e.target.matches('.bst-modal textarea[name="abil"]')) editorPreview(e.target); });
  document.addEventListener('focusin', (e)=>{ if(e.target.matches && e.target.matches('.bst-modal textarea[name="abil"]')) editorPreview(e.target); });

  /* ---------- подсказки Мастеру ---------- */
  let alertsEl = null; const alerts = [];
  function alert(a){
    if(typeof session!=='undefined' && session.role==='player') return;
    a.id = 'al' + Math.random().toString(36).slice(2, 8); alerts.unshift(a); if(alerts.length > 6) alerts.pop();
    renderAlerts(); setTimeout(()=>{ const i = alerts.indexOf(a); if(i >= 0){ alerts.splice(i, 1); renderAlerts(); } }, a.ms || 40000);
  }
  function renderAlerts(){
    if(!alerts.length){ if(alertsEl){ alertsEl.remove(); alertsEl = null; } return; }
    if(!alertsEl){ alertsEl = document.createElement('div'); alertsEl.className = 'ak-alerts'; document.body.appendChild(alertsEl);
      alertsEl.addEventListener('click', (e)=>{ const b = e.target.closest('[data-al]'); if(!b) return; const a = alerts.find(x=>x.id===b.dataset.al); if(!a) return;
        const i = +b.dataset.i; alerts.splice(alerts.indexOf(a), 1); renderAlerts(); if(i >= 0 && a.actions[i]) try{ a.actions[i].run(); }catch(err){ console.warn('[Способности]', err); } }); }
    alertsEl.innerHTML = alerts.map(a=>`<div class="ak-alert ${a.kind || ''}"><div><b>${esc(a.title)}</b></div><div class="ak-al-text">${esc(a.text)}</div>
      <div class="ak-al-btns">${(a.actions || []).map((x, i)=>`<button type="button" class="small${i===0 ? ' primary' : ''}" data-al="${a.id}" data-i="${i}">${esc(x.label)}</button>`).join('')}<button type="button" class="small" data-al="${a.id}" data-i="-1">✕</button></div></div>`).join('');
  }

  /* ---------- общее для автоматики ---------- */
  const GTk = ()=>typeof GameTable!=='undefined' ? GameTable : null;
  const nameOfTok = (t)=>{ const gt = GTk(), v = gt && gt.vitalsOf(t); return (v && v.name) || t.name || 'Жетон'; };
  const abilOf = (t)=>(t && t.creature && t.creature.abil || []).map((a, i)=>({i, key:'a' + i, n:String(a[0] || '').replace(/\s*\([^)]*\)\s*$/, ''), name:a[0], x:String(a[1] || ''), feats:features(a[0], a[1], !!t.creature.pc)}));
  const featOf = (t, id)=>{ const out = []; abilOf(t).forEach(a=>a.feats.forEach(f=>{ if(f.id===id) out.push(Object.assign({abil:a}, f)); })); return out; };
  function distM(a, b){ const gt = GTk(), p1 = gt && gt.tokenWorld(a.id), p2 = gt && gt.tokenWorld(b.id); if(!p1 || !p2) return Infinity;
    const mpc = typeof AreaTemplates!=='undefined' ? AreaTemplates.metersPerCell() : 3, c = gt.cellPx;
    return Math.max(0, Math.hypot(p1.x - p2.x, p1.y - p2.y)/c - (p1.d + p2.d)/c/2 + 0.5)*mpc; }
  const allyNear = (t, m)=>{ const gt = GTk(); return gt ? Object.values(gt.state.tokens || {}).some(o=>o.id!==t.id && o.kind===t.kind && distM(t, o) <= m) : false; };
  const fullHp = (t)=>{ const gt = GTk(); if(t.kind==='gm') return t.hp==null || t.hpMax==null || t.hp >= t.hpMax; const v = gt && gt.vitalsOf(t); return !v || +v.hp >= +v.hpMax; };
  const curRound = ()=>{ const gt = GTk(), c = gt && gt.state && gt.state.combat; return c ? c.round : 0; };
  // «Якорь» харукана: перебросы рядом с ним запрещены
  function anchorNear(t){ const gt = GTk(); if(!gt || !t) return null; let hit = null;
    Object.values(gt.state.tokens || {}).forEach(o=>{ featOf(o, 'anchor').forEach(f=>{ if(!hit && distM(t, o) <= f.r) hit = nameOfTok(o); }); }); return hit; }

  /* ---------- атака с карты: поправки (Мастеру — в Максимуме, в ранах; игрокам не видно) ---------- */
  function attackPassives(att, tgt, w, opts){
    opts = opts || {}; const out = {mod:0, tags:[], adj:{}, adjAll:0, shield:false, defMod:0, muMod:0, firstDmg:0};
    const ranged = !!(w && (w.dl || w.range || /Дл\s*\d/.test(w.statText || '')));
    featOf(tgt, 'atkVsMe').forEach(f=>{ out.mod -= f.v; out.tags.push(`${f.abil.n} −${f.v}`); });
    woundsSide(tgt, out);
    if(ranged) featOf(tgt, 'inertial').forEach(f=>{ out.shield = true; out.tags.push(`${f.abil.n}: щит`); });
    featOf(att, 'atkBonus').forEach(f=>{
      if(f.energy && !(w && /энерг/i.test(w.muType || ''))) return; if(f.ranged && !ranged) return; if(f.allyM && !allyNear(att, f.allyM)) return;
      out.mod += f.v; out.tags.push(`${f.abil.n} +${f.v}`); });
    featOf(att, 'muBonus').forEach(f=>{ if(f.ranged && !ranged) return; out.muMod += f.v; out.tags.push(`${f.abil.n}: МУ +${f.v}`); });
    featOf(att, 'muka').forEach(f=>{ if(!fullHp(tgt)){ out.adjAll += f.v; out.tags.push(`${f.abil.n}: +${f.v} рана`); } });
    if(featOf(att, 'hintTorment').length && ((tgt.marks || []).some(m=>m.k==='fear' || m.k==='prone') || (tgt.kind==='player' && (()=>{ const gt = GTk(), c = gt && gt.sheetOfToken(tgt); return c && c.states && c.states.ispug; })()))) out.tags.push('Мучить: атакуйте Упрощённо');
    if(featOf(att, 'hintStealth').length && att.hidden) out.tags.push('Скрытая атака: Упрощённо');
    // усиления: атакующего и цели
    const r = curRound();
    buffsOf(att.id).forEach(b=>{ const m = b.mods;
      if(m.attack){ out.mod += m.attack; out.tags.push(`${b.name} +${m.attack}`); }
      if(m.attackDice){ if(opts.commit){ const v = GTk().rollWoundsExpr(m.attackDice); out.mod += v; out.tags.push(`${b.name} +${m.attackDice}=${v}`); } else out.tags.push(`${b.name} +${m.attackDice}`); }
      if(m.mu){ out.muMod += m.mu; out.tags.push(`${b.name}: МУ +${m.mu}`); }
      if(m.firstDmg && b.firstRound!==r){ out.firstDmg += m.firstDmg; out.tags.push(`${b.name}: +${m.firstDmg} раны к первому урону`); if(opts.commit) b.firstRound = r; } });
    if(opts.commit){ const before = (buffs[att.id] || []).length; buffs[att.id] = buffsOf(att.id).filter(b=>!(b.oneShot && (b.mods.attackDice || b.mods.mu))); if((buffs[att.id] || []).length!==before) refreshCard(); saveJ(BUFF_KEY, buffs); }
    return out;
  }
  // что цель делает с попаданиями по себе: меньше/больше ран (в т. ч. по типу МУ), усиления защиты
  function woundsSide(tgt, out){
    featOf(tgt, 'woundsTaken').forEach(f=>{ out.adjAll -= f.v; out.tags.push(`${f.abil.n}: −${f.v} к ранам`); });
    featOf(tgt, 'woundsTyped').forEach(f=>{ Object.keys(f.adj).forEach(k=>{ out.adj[k] = (out.adj[k] || 0) + f.adj[k]; }); out.tags.push(`${f.abil.n}: раны по типу`); });
    buffsOf(tgt.id).forEach(b=>{ const m = b.mods; if(m.def){ out.defMod += m.def; out.tags.push(`${b.name}: защита +${m.def}`); } if(m.woundsTaken){ out.adjAll += m.woundsTaken; out.tags.push(`${b.name}: ${m.woundsTaken} рана`); } });
    return out;
  }
  // попадания из текста способности (не оружием): действует только сторона цели
  const hitPassives = (tgt)=>woundsSide(tgt, {adj:{}, adjAll:0, defMod:0, tags:[]});
  // атака-способность существа («рукопашная атака с Максимумом 22»): штрафы по цели и бонусы атакующего к Максимуму
  function abilityAtkMod(att, tgt){
    const out = {mod:0, tags:[]};
    featOf(tgt, 'atkVsMe').forEach(f=>{ if(f.psi && att && att.creature && voidishOf(att.creature)) return; out.mod -= f.v; out.tags.push(`${f.abil.n} −${f.v}`); });
    if(att){ featOf(att, 'atkBonus').forEach(f=>{ if(f.energy || f.ranged || (f.allyM && !allyNear(att, f.allyM))) return; out.mod += f.v; out.tags.push(`${f.abil.n} +${f.v}`); });
      buffsOf(att.id).forEach(b=>{ if(b.mods.attack){ out.mod += b.mods.attack; out.tags.push(`${b.name} +${b.mods.attack}`); } }); }
    // реакции цели на попадание (Изворотливость, Малая цель…) — решает Мастер до «Применить»
    const re = featOf(tgt, 'evasion').concat(featOf(tgt, 'dodgeMinus')).map(f=>f.abil.n).concat(tgt.creature ? rerollOptions(tgt, {type:'attack-vs'}).map(o=>o.name) : []);
    if(re.length) out.tags.push(`реакция цели: «${[...new Set(re)].join('», «')}» — если сработает, снимите галочку`);
    return out;
  }
  function initAura(t){
    const gt = GTk(), out = {mod:0, notes:[]}; if(!gt) return out;
    Object.values(gt.state.tokens || {}).forEach(o=>{ if(o.id===t.id || o.kind!==t.kind) return;
      abilOf(o).forEach(a=>{ const m = /в радиусе\s+(\d+)\s*м\S*\s+проверк\S*\s+инициативы\s+союзников\s+\+\s*(\d+)/i.exec(a.x); if(m && distM(t, o) <= +m[1]){ out.mod += +m[2]; out.notes.push(`${a.n} (${nameOfTok(o)}) +${m[2]}`); } }); });
    return out;
  }
  // спасброски и проверки NPC (бросок цели): бонусы, Упрощено/Осложнено, невосприимчивость, «Щит веры», «Молитвы боли»
  function savePassives(t, key){
    const out = {mod:0, mode:'plain', immune:false, notes:[], altMax:null}; let adv = 0, dis = 0;
    const isEnv = key==='save_vrednaya_sreda', statWord = {refleksy:'рефлекс', legkaya_atletika:'атлетик', volya:'вол', sila:'сил', vynoslivost:'вынослив', duh:'дух', smekalka:'смекалк'}[key];
    abilOf(t).forEach(a=>a.feats.forEach(f=>{
      if(isEnv && f.id==='immuneEnv'){ out.immune = true; out.notes.push(`${a.n}: невосприимчив`); }
      if(isEnv && f.id==='saveEnv'){ out.mod += f.v; out.notes.push(`${a.n} +${f.v}`); }
      if(isEnv && f.id==='saveEnvAdv'){ adv++; out.notes.push(`${a.n}: Упрощено`); }
      if(key==='save_kislotnost' && f.id==='saveAcid'){ out.mod += f.v; out.notes.push(`${a.n} +${f.v}`); }
      if(f.id==='statAdv' && f.stats.indexOf(key) >= 0){ adv++; out.notes.push(`${a.n}: Упрощено`); }
      if(f.id==='statDis' && statWord && new RegExp(statWord, 'i').test(f.label)){ dis++; out.notes.push(`${a.n}: Осложнено`); }
      if(f.id==='willShield' && key==='volya'){ const s = parse(a.name, a.x); if(!s.uses || usedOf(t.id, a.key) < s.uses.n) out.altMax = {max:f.max, key:a.key, name:a.n}; }
    }));
    if(key==='save_psi_pole'){ const b = buffsOf(t.id).find(x=>x.mods.psiSave); if(b){ out.mod += b.mods.psiSave; out.notes.push(`${b.name} +${b.mods.psiSave}`); out.consume = b.key; } }
    buffsOf(t.id).forEach(b=>{ // усиления существа из листа: «Ярость» — Осложнены смекалка…, «Дикий напор» — одна проверка силы или воли Упрощена
      if((b.mods.dis || []).indexOf(key) >= 0){ dis++; out.notes.push(`${b.name}: Осложнено`); }
      if((b.mods.adv || []).indexOf(key) >= 0){ adv++; out.notes.push(`${b.name}: Упрощено`); if(b.oneShot && !out.consume) out.consume = b.key; } });
    out.mode = adv > dis ? 'advantage' : dis > adv ? 'disadvantage' : 'plain';
    return out;
  }
  function consumeBuff(tokId, key){ dropBuff(tokId, key); }

  /* ---------- перебросы ---------- */
  function rerollOptions(tok, ctx){
    const tpl = tok && tok.creature; if(!tpl || anchorNear(tok)) return [];
    const out = [];
    (tpl.abil || []).forEach((a, i)=>{
      const sc = tpl.pc ? rerollScopePc(a[1]) : rerollScope(a[1]); if(!sc) return;
      const ok = sc.scope==='own_d20' ? ctx.type!=='attack-vs'
        : sc.scope==='own_attack' ? ctx.type==='attack-own'
        : sc.scope==='vs_me' ? ctx.type==='attack-vs' || (ctx.type==='check' && ctx.stat==='refleksy')
        : sc.scope==='stat' ? ctx.type==='check' && (sc.stats || [sc.stat]).indexOf(ctx.stat) >= 0 : false;
      if(!ok) return;
      const s = parse(a[0], a[1]), key = 'a' + i, left = s.uses ? s.uses.n - usedOf(tok.id, key) : Infinity;
      if(left <= 0) return;
      out.push({key, name:a[0].replace(/\s*\([^)]*\)\s*$/, ''), left, total:s.uses ? s.uses.n : null, cond:sc.cond || '', scope:sc.scope, text:a[1], extraWound:/на 1 рану больше/i.test(a[1])});
    });
    return out;
  }
  const leftTxt = (o)=>o.total ? ` (осталось ${o.left}/${o.total})` : '';

  /* ---------- после атаки с карты ---------- */
  function hpChange(t, d){ const gt = GTk(); if(!gt || !t) return; if(t.kind==='gm'){ if(t.hp!=null) gt.updateToken(t.id, {hp:Math.min(t.hpMax!=null ? t.hpMax : Infinity, t.hp + d)}); } else if(typeof sendGrant==='function') sendGrant(t.ownerId, {kind:'vitals', which:'hp', mode:'delta', value:d}); }
  const logAbility = (text)=>{ if(typeof recordAndShareQuickRoll==='function') recordAndShareQuickRoll({abilityUse:true, text:String(text).slice(0, 900)}); };
  // существо ранено (атакой или способностью) — отмена ран (Крупное тело, Боль безвинного, Живучесть)
  function onWounded(tgt, total){
    const gt = GTk(); if(!gt || !tgt || !tgt.creature || !(total > 0) || (typeof session!=='undefined' && session.role==='player')) return;
    const a = {total};
    featOf(tgt, 'cancelWounds').forEach(f=>{
      const s = parse(f.abil.name, f.abil.x), left = s.uses ? s.uses.n - usedOf(tgt.id, f.abil.key) : Infinity;
      const pool = f.daily ? f.daily - usedOf(tgt.id, f.abil.key + '_w') : Infinity; if(left <= 0 || pool <= 0) return;
      const n = Math.min(f.per, a.total, pool);
      alert({kind:'re', title:`⚙ ${nameOfTok(tgt)}: «${f.abil.n}»`, text:`Получено ${a.total} ран. Отменить ${n}?${f.roll ? ` Нужен Бросок ${STAT_NAME[f.roll.stat] || ''} (${f.roll.max}) — при провале способность до конца встречи.` : ''}${s.uses ? ` Осталось ${left}/${s.uses.n}.` : ''}${f.daily ? ` За день ещё ${pool} ран.` : ''} ${/таблице травм/i.test(f.abil.x) ? 'Бросок по таблице травм — Упрощённо; противник получает внеочередную атаку (на выбор Мастера).' : ''}`,
        actions:[{label:`Отменить ${n}`, run:()=>{ const t2 = gt.getToken(tgt.id);
          if(f.roll){ const r = rollCreature(t2, f.abil.n, f.roll.max); if(!r.success) bump(tgt.id, f.abil.key, 99); }
          hpChange(t2, n); if(s.uses && !f.roll) bump(tgt.id, f.abil.key, 1); if(f.daily) bump(tgt.id, f.abil.key + '_w', n);
          logAbility(`${nameOfTok(tgt)} — «${f.abil.n}»: отменено ${n} ран`); refreshCard(); }}]}); });
  }
  const hintRound = {}; // подсказка «в ярости преуспел в атаке» — раз в круг
  function onAttack(a){
    const gt = GTk(); if(!gt || (typeof session!=='undefined' && session.role==='player')) return;
    const att = gt.getToken(a.attackerId), tgt = gt.getToken(a.targetId); if(!att || !tgt) return;
    if(a.success && !a.jammed && tgt.creature){
      // «Малая цель»: перебросить чужой к20 (если всё же попали — +1 рана)
      rerollOptions(tgt, {type:'attack-vs'}).forEach(o=>alert({kind:'re', title:`↻ ${nameOfTok(tgt)}: «${o.name}»`, text:`${nameOfTok(att)} попал(а) (к20=${a.roll}). Перебросить эту атаку?${o.extraWound ? ' Если попадания всё же будут — на 1 рану больше.' : ''}${leftTxt(o)}`,
        actions:[{label:'↻ Перебросить атаку', run:()=>{ bump(tgt.id, o.key, 1); const r = gt.rerollAttack(a.attackId);
          if(r && r.ok && r.success && o.extraWound){ const t2 = gt.getToken(tgt.id); hpChange(t2, -1); logAbility(`${nameOfTok(tgt)} — «${o.name}»: переброс не помог, +1 рана`); }
          uiToast(r && r.ok ? `«${o.name}»: атака переброшена${r.success ? ' — снова попадание' : ' — промах'}` : 'Не удалось перебросить: ' + (r && r.reason || ''), {icon:'↻'}); refreshCard(); }}]}));
      // «Нечеловеческая изворотливость»: −3 к этой атаке (раз в круг)
      featOf(tgt, 'dodgeMinus').forEach(f=>{ const s = parse(f.abil.name, f.abil.x); if(s.uses && usedOf(tgt.id, f.abil.key) >= s.uses.n) return;
        if(!f.v && f.vStat){ f.v = typeof TargetRolls!=='undefined' ? TargetRolls.npcStat(tgt, f.vStat) : 0; if(!(f.v > 0)) return; } // «−[свои рефлексы]»
        alert({kind:'re', title:`⚙ ${nameOfTok(tgt)}: «${f.abil.n}»`, text:`${nameOfTok(att)} попал(а) (к20=${a.roll}). Наложить −${f.v} на эту атаку? Атака пересчитается с тем же к20.`,
          actions:[{label:`−${f.v} к атаке`, run:()=>{ bump(tgt.id, f.abil.key, 1); const r = gt.redoAttack(a.attackId, -f.v); uiToast(r && r.ok ? `«${f.abil.n}»: ${r.success ? 'всё равно попадание' : 'промах'}` : 'Не удалось: ' + (r && r.reason || ''), {icon:'⚙'}); refreshCard(); }}]}); });
      // «Изворотливость»: Бросок рефлексов против смекалки атакующего — при успехе промах
      featOf(tgt, 'evasion').forEach(f=>{
        const st1 = f.stat || 'refleksy', st2 = f.vs || 'smekalka';
        alert({kind:'re', title:`⚙ ${nameOfTok(tgt)}: «${f.abil.n}»`, text:`Реакцией — Бросок ${STAT_NAME[st1] || st1} против ${STAT_NAME[st2] || st2} ${nameOfTok(att)}. При успехе атака промахнётся, при провале — способность против этого противника до конца дня не действует.`,
          actions:[{label:'🎲 Бросок', run:()=>{ const refl = typeof TargetRolls!=='undefined' ? TargetRolls.npcStat(tgt, st1) : 3, sh = att.kind==='player' ? (()=>{ const c = gt.sheetOfToken(att); return c && c.stats ? +c.stats[st2] || 0 : 2; })() : (typeof TargetRolls!=='undefined' ? TargetRolls.npcStat(att, st2) : 2);
            const r = rollCreature(tgt, `${f.abil.n} (${STAT_NAME[st1] || st1} против ${STAT_NAME[st2] || st2})`, 10 + refl - sh);
            if(r.success){ gt.undoAttack(a.attackId); logAbility(`${nameOfTok(tgt)} — «${f.abil.n}»: к20=${r.roll} / Макс.${r.max} — увернулся, атака ${nameOfTok(att)} отменена`); uiToast('Увернулся — атака отменена', {icon:'⚙'}); }
            else uiToast(`Не вышло (к20=${r.roll} / Макс.${r.max})`, {icon:'⚙'}); }}]}); });
    }
    // существо из листа под атакой: «Берсерк» (получая попадание), «Мгновенная контратака» (если атаковали)
    if(tgt.creature && tgt.creature.pc) featOf(tgt, 'counterHint').forEach(f=>{ if(f.onHit && !(a.success && a.total > 0)) return;
      const s = parse(f.abil.name, f.abil.x), left = s.uses ? s.uses.n - usedOf(tgt.id, f.abil.key) : Infinity; if(left <= 0) return;
      alert({kind:'trig', title:`⚡ ${nameOfTok(tgt)}: «${f.abil.n}»`, text:`${nameOfTok(att)} ${a.success ? 'попал(а)' : 'атаковал(а)'}. ${f.text}${s.uses ? ` (осталось ${left}/${s.uses.n})` : ''}`,
        actions:[{label:'Использовано', run:()=>{ if(s.uses){ bump(tgt.id, f.abil.key, 1); refreshCard(); } }}, {label:'Не сейчас', run:()=>{}}]}); });
    if(a.total > 0) onWounded(tgt, a.total);
    // существо атаковало и промахнулось — «Уход техника СДК», «Мастерская атака»…
    if(!a.success && att.creature){
      rerollOptions(att, {type:'attack-own'}).forEach(o=>alert({kind:'re', title:`↻ ${nameOfTok(att)}: «${o.name}»`, text:`Промах (к20=${a.roll}) по ${nameOfTok(tgt)}. Перебросить к20?${o.cond ? ' Условие: ' + o.cond + '.' : ''}${leftTxt(o)}`,
        actions:[{label:'↻ Перебросить', run:()=>{ bump(att.id, o.key, 1); const r = gt.rerollAttack(a.attackId); uiToast(r && r.ok ? `«${o.name}»: атака переброшена` : 'Не удалось: ' + (r && r.reason || ''), {icon:'↻'}); refreshCard(); }}]}));
    }
    // существо из листа: «Мощная атака» — перебросить все к12 этой атаки (тот же к20); нат. 12 — «Вот это бой», «Проворство»;
    // «Если в ярости преуспел в атаке…» — подсказка, пока включено такое усиление
    if(a.success && !a.jammed && att.creature && att.creature.pc){
      if(!anchorNear(att)) featOf(att, 'rerollHits').forEach(f=>{ const s = parse(f.abil.name, f.abil.x), left = s.uses ? s.uses.n - usedOf(att.id, f.abil.key) : Infinity; if(left <= 0) return; // «Якорь» рядом — без перебросов
        alert({kind:'re', title:`↻ ${nameOfTok(att)}: «${f.abil.n}»`, text:`Попадание по ${nameOfTok(tgt)} (к20=${a.roll}). Перебросить все к12 этой атаки? Тот же к20, новые к12.${left!==Infinity ? ` Осталось ${left}/${s.uses.n}.` : ''}`,
          actions:[{label:'↻ Перебросить к12', run:()=>{ bump(att.id, f.abil.key, 1); const r = gt.redoAttack(a.attackId, 0); uiToast(r && r.ok ? `«${f.abil.n}»: к12 переброшены` : 'Не удалось: ' + (r && r.reason || ''), {icon:'↻'}); refreshCard(); }}]}); });
      if(a.roll===12) featOf(att, 'nat12').forEach(f=>{ const ref = f.renew ? abilOf(att).find(x=>new RegExp('^' + f.renew.slice(0, 5), 'i').test(x.n)) : null;
        alert({kind:'trig', title:`⚡ ${nameOfTok(att)}: «${f.abil.n}»`, text:`Нат. 12 при атаке. ${f.text}`,
          actions:ref ? [{label:`↺ «${ref.n}» снова доступна`, run:()=>{ bump(att.id, ref.key, -usedOf(att.id, ref.key)); refreshCard(); uiToast(`«${ref.n}» снова доступна`, {icon:'⚡'}); }}] : [{label:'Понятно', run:()=>{}}]}); });
      if(a.total > 0) featOf(att, 'bonusWound').forEach(f=>{ const s = parse(f.abil.name, f.abil.x), left = s.uses ? s.uses.n - usedOf(att.id, f.abil.key) : Infinity; if(left <= 0) return;
        alert({kind:'trig', title:`⚡ ${nameOfTok(att)}: «${f.abil.n}»`, text:`Урон по ${nameOfTok(tgt)}: ${a.total}. ${f.abil.x.slice(0, 160)}${s.uses ? ` (осталось ${left}/${s.uses.n})` : ''}`,
          actions:[{label:`+${f.expr} ран`, run:()=>{ const v = gt.rollWoundsExpr(f.expr); hpChange(gt.getToken(tgt.id), -v); if(s.uses) bump(att.id, f.abil.key, 1); logAbility(`${nameOfTok(att)} — «${f.abil.n}»: ещё ${v} ${v===1 ? 'рана' : v < 5 ? 'раны' : 'ран'} по ${nameOfTok(tgt)}`); refreshCard(); }}, {label:'Не сейчас', run:()=>{}}]}); });
      featOf(att, 'onHitHint').forEach(f=>{ const on = buffsOf(att.id).some(b=>new RegExp('^' + f.when.slice(0, 5), 'i').test(b.name)); if(!on || hintRound[att.id + f.abil.key]===curRound()) return;
        hintRound[att.id + f.abil.key] = curRound(); alert({kind:'trig', title:`⚡ ${nameOfTok(att)}: «${f.abil.n}»`, text:f.text, actions:[{label:'Понятно', run:()=>{}}]}); });
    }
    // «Тактик»: успех и чётное значение — цель прижата огнём
    if(a.success && att.creature && a.roll % 2===0) featOf(att, 'tactic').forEach(f=>alert({kind:'trig', title:`⚡ ${nameOfTok(att)}: «${f.abil.n}»`, text:`Успех с чётным к20 (${a.roll}): ${nameOfTok(tgt)} теряет реакцию; если реакции нет или цель не хочет её терять — ${nameOfTok(att)} реакцией проводит внеочередную атаку. (Только стрельба из двуручного оружия.)`, actions:[{label:'Понятно', run:()=>{}}]}));
    if(!a.success && a.roll <= 15 && att.kind==='player') failTriggers(nameOfTok(att), a.roll, att, 'промах атаки');
  }

  /* ---------- броски с карточки существа: перебросы ---------- */
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
      featOf(t, 'trigger').forEach(f=>{
        const txt = f.abil.x, s = resolved(f.abil.name, txt, t.creature);
        if(/промахнул/i.test(txt) && what!=='промах атаки') return;
        if(/рядом с персонажем/i.test(txt) && attTok){ const p1 = gt.tokenWorld(t.id), p2 = gt.tokenWorld(attTok.id); if(!p1 || !p2 || Math.hypot(p1.x - p2.x, p1.y - p2.y)/gt.cellPx > 1.6) return; }
        const left = s.uses ? s.uses.n - usedOf(t.id, f.abil.key) : Infinity; if(left <= 0) return;
        const fireable = s.kind==='save' || s.kind==='opposed' || s.kind==='attack' || s.kind==='auto', acts = [];
        if(fireable) acts.push({label:'▶ Применить', run:()=>fire(t.id, t.creature, f.abil.key)});
        acts.push({label:s.uses ? 'Использовано' : 'Понятно', run:()=>{ if(s.uses){ bump(t.id, f.abil.key, 1); refreshCard(); } }});
        acts.push({label:'📖 Карточка', run:()=>{ if(typeof Bestiary!=='undefined') Bestiary.openFloat(t.id); }});
        alert({kind:'trig', title:`⚡ ${nameOfTok(t)}: «${f.abil.n}»`, text:`${who}: ${what} с итогом ${roll} (15−). ${txt.slice(0, 160)}${txt.length > 160 ? '…' : ''}${s.uses ? ` (осталось ${left}/${s.uses.n} — ${s.uses.per})` : ''}`, actions:acts});
      });
    });
  }
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

  /* ---------- новый круг: счётчики, усиления, продолжающиеся эффекты, «Смерть, друг мой» ---------- */
  let lastRound = null;
  setInterval(()=>{
    const gt = GTk(); const c = gt && gt.state && gt.state.combat; const r = c ? c.round : null;
    if(r!=null && lastRound!=null && r!==lastRound && !(typeof session!=='undefined' && session.role==='player')){
      Object.values(gt.state.tokens || {}).forEach(t=>{
        if(t.creature && uses[t.id]) (t.creature.abil || []).forEach((a, i)=>{ const s = parse(a[0], a[1]); if(s.uses && /круг|ход/.test(s.uses.per)) delete uses[t.id]['a' + i]; });
        // «Смерть, друг мой»: в начале круга, если существо без сознания
        if(t.creature && t.hp!=null && t.hp <= 0) featOf(t, 'deathRise').forEach(f=>{ const s = parse(f.abil.name, f.abil.x); if(usedOf(t.id, f.abil.key) >= 1) return;
          alert({kind:'trig', title:`⚡ ${nameOfTok(t)}: «${f.abil.n}»`, text:`ОЗ ${t.hp}. Если культовый символ цел — Бросок ${STAT_NAME[f.stat] || ''} (${f.max}): успех с итогом 1–5 — +6 ОЗ, 6+ — полное исцеление; провал — до конца дня больше нельзя.`,
            actions:[{label:'🎲 Бросок', run:()=>{ const t2 = gt.getToken(t.id), rr = rollCreature(t2, f.abil.n, f.max);
              if(!rr.success){ bump(t.id, f.abil.key, 1); logAbility(`${nameOfTok(t2)} — «${f.abil.n}»: провал`); return; }
              const hp = rr.roll <= 5 ? Math.min(t2.hpMax || Infinity, t2.hp + 6) : (t2.hpMax!=null ? t2.hpMax : t2.hp + 6);
              gt.updateToken(t.id, rr.roll <= 5 ? {hp} : {hp, trauma:0, traumaRed:0, marks:[]}); logAbility(`${nameOfTok(t2)} — «${f.abil.n}»: к20=${rr.roll} — ${rr.roll <= 5 ? '+6 ОЗ' : 'полностью исцелён'}`); }}]}); });
      });
      saveUses();
      Object.keys(buffs).forEach(id=>{ buffs[id] = buffs[id].map(b=>b.left ? Object.assign({}, b, {left:b.left - 1}) : b).filter(b=>{ if(b.left===0){ endTempHp(id, b); return false; } return true; }); });
      saveJ(BUFF_KEY, buffs);
      ongoing = ongoing.filter(o=>gt.getToken(o.tokId));
      ongoing.forEach(o=>{
        const act = sentences(o.text).filter(x=>!ESCAPE_RE.test(x)).join(' ') || o.text;
        const t = gt.getToken(o.tokId), s = parse(o.title, act, {voidish:o.voidish, now:true}), acts = [];
        if(s.kind==='save' || s.kind==='opposed' || s.kind==='attack' || s.kind==='auto') acts.push({label:'▶ Применить', run:()=>TargetRolls.open({src:o.srcId || null, targets:[o.tokId], title:`${o.title} — каждый круг`, prefill:s})});
        acts.push({label:'Снять', run:()=>{ ongoing = ongoing.filter(x=>x.id!==o.id); saveJ(ONG_KEY, ongoing); }});
        alert({kind:'trig', title:`↻ ${nameOfTok(t)}: «${o.title}»${o.left ? ` (ещё ${o.left} кр.)` : ''}`, text:o.text.slice(0, 220), actions:acts});
        if(o.left) o.left--;
      });
      ongoing = ongoing.filter(o=>o.left!==0); saveJ(ONG_KEY, ongoing);
      refreshCard();
    }
    lastRound = r;
  }, 1500);

  return { parse, resolved, areaLabel, consLabel, rowHtml, chipsHtml, usedOf, bump, resetToken:(id)=>{ delete uses[id]; saveUses(); refreshCard(); },
    attackPassives, initAura, savePassives, consumeBuff, immuneStates, addOngoing, buffsOf, onAttack, rerollOptions, alert, features, CHECK_LABEL, extraName, extraText, hitPassives, abilityAtkMod, onWounded,
    pcParts, targetsWanted, rangeOf, STAT_NAME };
})();
