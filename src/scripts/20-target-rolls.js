/* ======================================================================
   БРОСОК ЦЕЛИ: способности существ, где бросает цель («Бросок рефлексов (−6)», «спасбросок от пси-поля (+3)»),
   и встречные проверки существа против характеристики цели («Бросок мистики (19) против воли цели» — из Максимума
   существа вычитается характеристика цели).
   - Мастер: меню жетона → «🎯 Бросок цели…» (у существа) или «🎯 Потребовать бросок…» (у игрока). Форма: проверка
     и модификатор (или Максимум существа и против чего), цели, последствия провала: попадания по профилю (к12 против
     МУ − защиты, как у атаки с карты), потеря ОЗ и пси, состояния листа (испуг, истощение, стресс), отметки на
     жетоне (шок, сбит с ног, схвачен, оглушён, ослеплён) на N кругов.
   - Игрок получает окно «Бросок по требованию Мастера» → «🎲 Бросить» открывает его обычное окно броска с нужной
     характеристикой и модификатором; результат сам уходит Мастеру. За NPC и встречные проверки бросает приложение.
   - Панель результатов у Мастера: кто прошёл и кто провалил; последствия — только после «Применить провалы».
   Сообщения: tr-req (Мастер → игрок), tr-res (игрок → Мастер).
   ====================================================================== */
const TargetRolls = (function(){
  const esc = (s)=>escapeHtml(s==null ? '' : String(s));
  const GT = ()=>typeof GameTable!=='undefined' ? GameTable : null;
  const CHECKS = [['volya', 'Бросок воли'], ['refleksy', 'Бросок рефлексов'], ['vynoslivost', 'Бросок выносливости'], ['sila', 'Бросок силы'],
    ['duh', 'Бросок духа'], ['smekalka', 'Бросок смекалки'], ['legkaya_atletika', 'Бросок лёгкой атлетики'], ['lovkost_ruk', 'Бросок ловкости рук'],
    ['vospriyatie', 'Бросок восприятия'], ['hladnokrovie', 'Проверка хладнокровия (воля)'], ['save_psi_pole', 'Спасбросок от пси-поля'],
    ['save_vrednaya_sreda', 'Спасбросок от вредной среды (химия, радиация, болезни)'], ['save_pryamoy_kontakt', 'Спасбросок: прямой контакт'],
    ['save_kislotnost', 'Спасбросок от кислотности'], ['psi_plus', 'Проверка с Максимумом [N + пси-сопротивление]']];
  const VS = [['', '— (обычная атака, без вычета)'], ['volya', 'воли'], ['refleksy', 'рефлексов'], ['sila', 'силы'], ['smekalka', 'смекалки'], ['duh', 'духа'], ['vynoslivost', 'выносливости'], ['legkaya_atletika', 'лёгкой атлетики']];
  const LABEL = Object.fromEntries(CHECKS);
  const RU = {vynoslivost:'выносливость', legkaya_atletika:'л[её]гкая атлетика', refleksy:'рефлексы', sila:'сила', volya:'воля', duh:'дух', smekalka:'смекалка', lovkost_ruk:'ловкость рук', vospriyatie:'восприятие'};
  const BODY = ['vynoslivost', 'legkaya_atletika', 'refleksy', 'sila', 'lovkost_ruk'];
  const SHEET_STATES = [['ispug', 'испуг'], ['istoshenie', 'истощение'], ['stress', 'стресс']];
  const MU_TYPES = ['удар', 'патрон', 'энергия', 'температура', 'взрыв'];
  const sgn = (n)=>(n >= 0 ? '+' : '−') + Math.abs(n);
  const realKey = (k)=>k==='hladnokrovie' ? 'volya' : k;

  /* ---------- значения характеристик целей ---------- */
  function npcStat(t, key){
    const cr = t.creature || {}, txt = [cr.body, cr.mind, cr.skills, cr.know].filter(Boolean).join(' ; ');
    if(key==='psi'){ const m = /пси-сопротивлени\S*\s*\+?\s*(\d+)/i.exec((cr.abil || []).map(a=>a[1]).join(' ')); return m ? +m[1] : 0; }
    if(RU[key]){ const m = new RegExp(RU[key] + '\\s+([−-]?\\d+)', 'i').exec(txt); if(m) return +m[1].replace('−', '-'); }
    if(key==='refleksy' && t.reflexes!=null && !cr.body) return +t.reflexes;
    const m = /^\s*([−-]?\d+)/.exec(BODY.indexOf(key) >= 0 ? (cr.body || '') : (cr.mind || ''));
    return m ? +m[1].replace('−', '-') : (key==='refleksy' && t.reflexes!=null ? +t.reflexes : 2);
  }
  function sheetStat(c, key){ return c && c.stats && isFinite(+c.stats[key]) ? +c.stats[key] : 2; }
  // Максимум проверки цели: Бросок = значение + 10; спасбросок пси-поля = пси-сопротивление; вредная среда = 10 + выносливость
  function baseFor(t, key, n){
    const gt = GT(), c = t.kind==='player' && gt ? gt.sheetOfToken(t) : null, k = realKey(key);
    const st = (s)=>t.kind==='player' ? sheetStat(c, s) : npcStat(t, s), psi = t.kind==='player' ? (c ? +c.psiSoprot || 0 : 0) : npcStat(t, 'psi');
    if(k==='psi_plus') return (+n || 0) + psi;
    if(k==='save_psi_pole') return psi;
    if(k.indexOf('save_')===0) return 10 + st('vynoslivost') + (c ? +c.siz || 0 : 0);
    return 10 + st(k);
  }
  const statValue = (t, key)=>{ if(!key) return 0; const gt = GT(), c = t.kind==='player' && gt ? gt.sheetOfToken(t) : null; return t.kind==='player' ? sheetStat(c, key) : npcStat(t, key); };
  const tokName = (t)=>{ const gt = GT(), v = gt && gt.vitalsOf(t); return (v && v.name) || t.name || (t.kind==='player' ? 'Игрок' : 'Жетон'); };

  /* ---------- текст последствий ---------- */
  function consText(c, cat){
    const out = [];
    if(c.hits && c.hits.n) out.push(`${c.hits.byCat ? '[категория успеха]' : c.hits.n} ${c.hits.byCat ? 'попаданий' : c.hits.n===1 ? 'попадание' : c.hits.n < 5 ? 'попадания' : 'попаданий'} с МУ ${c.hits.mu} ${c.hits.muType}, раны ${c.hits.wounds}${c.hits.travma ? ', травма' : ''}`);
    if(c.hp) out.push(`−${c.hp} ОЗ`);
    if(c.psi) out.push(`−${c.psi} пси`);
    (c.states || []).forEach(k=>out.push((SHEET_STATES.find(s=>s[0]===k) || [, k])[1]));
    (c.marks || []).forEach(m=>out.push((GT() ? GT().MARKS[m.k] : m.k).toLowerCase() + (m.r ? ` (${m.r} кр.)` : '')));
    if(c.note) out.push(c.note);
    return out.join(' · ') || 'на усмотрение Мастера';
  }

  /* ---------- форма Мастера ---------- */
  let formEl = null;
  function closeForm(){ if(formEl){ formEl.remove(); formEl = null; } }
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
      <div class="rx-seg tr-mode"><button type="button" data-mode="target" class="on">Бросает цель</button><button type="button" data-mode="creature">Бросает существо против цели</button></div>
      <div class="tr-sec" data-sec="target"><div class="tr-row"><select data-f="stat">${CHECKS.map(([k, l])=>`<option value="${k}">${l}</option>`).join('')}</select>
        <label>модификатор <input data-f="mod" type="number" min="-21" max="21" step="1" value="0"></label><label class="tr-n" style="display:none">N <input data-f="n" type="number" min="0" max="40" value="12"></label></div></div>
      <div class="tr-sec" data-sec="creature" style="display:none"><div class="tr-row"><label>Максимум существа <input data-f="max" type="number" min="-10" max="60" value="16"></label>
        <label>против <select data-f="vs">${VS.map(([k, l])=>`<option value="${k}">${l}</option>`).join('')}</select> цели</label></div>
        <div class="gs-muted">Из Максимума вычитается характеристика каждой цели. Успех существа — цель поражена.</div></div>
      <div class="gs-sub">Цели</div>
      <div class="tr-row tr-area"><button type="button" class="gs-btn small" data-ar="pick" title="Шаблон области на столе: размеры из текста способности (или задайте ниже); задетые жетоны станут целями">📐 Область на столе</button>
        <select data-f="ashape"><option value="circle">круг</option><option value="line">полоса / луч</option><option value="cone">конус</option><option value="rect">квадрат</option></select>
        <label><input data-f="asize" type="number" min="0" max="999" step="0.5" style="width:60px" placeholder="м" title="Радиус круга, длина полосы/конуса или сторона квадрата, м; пусто — протянуть на столе"> м</label>
        <label class="tr-aw"><input data-f="aw" type="number" min="0" max="99" step="0.5" style="width:52px" value="1"> ширина, м</label>
        <select data-f="aat"><option value="self">от существа</option><option value="point">в точке</option></select>
        <button type="button" class="gs-btn small" data-ar="all" title="Все жетоны на поле, кроме существа">Все на поле</button><button type="button" class="gs-btn small" data-ar="none">Снять все</button></div>
      <div class="tr-targets">${toks.filter(t=>t.id!==opts.src).map(tRow).join('') || '<span class="gs-muted">На столе нет жетонов</span>'}</div>
      <div class="gs-sub">При провале цели</div>
      <div class="tr-row"><label>попаданий <input data-f="hn" type="number" min="0" max="30" value="0"></label><label class="tr-bycat" style="display:none"><input type="checkbox" data-f="bycat"> = категория успеха</label>
        <label>МУ <input data-f="mu" type="number" min="0" max="40" value="12"></label><select data-f="mut">${MU_TYPES.map(m=>`<option>${m}</option>`).join('')}</select>
        <label>раны <input data-f="wounds" type="text" value="2" size="4" title="число или кубы: 3, к6, 1к6+3"></label><label><input type="checkbox" data-f="travma"> травма</label></div>
      <div class="tr-row"><label>−ОЗ <input data-f="hp" type="text" size="5" placeholder="2к6" title="число или кубы"></label><label>−пси <input data-f="psi" type="number" min="0" max="20" value="0"></label>
        ${SHEET_STATES.map(([k, l])=>`<label><input type="checkbox" data-st="${k}"> ${l}</label>`).join('')}</div>
      <div class="tr-row">${Object.keys(gt.MARKS).filter(k=>k!=='fear').map(k=>`<label><input type="checkbox" data-mk="${k}"> ${gt.MARKS[k].toLowerCase()}</label>`).join('')}
        <label>на <input data-f="mr" type="number" min="0" max="20" value="1" title="0 — пока не снимут"> кр.</label></div>
      <label class="ui-dlg-field"><span>Ещё при провале (текстом — игрок увидит)</span><input data-f="note" type="text" maxlength="200" placeholder="например, отброшена на к6 м"></label>
      <div class="ui-dlg-btns"><button type="button" class="ui-dlg-btn" data-x="cancel">Отмена</button><button type="button" class="ui-dlg-btn primary" data-x="go">Бросок</button></div></div>`;
    document.body.appendChild(formEl);
    let mode = 'target';
    const q = (s)=>formEl.querySelector(s);
    formEl.querySelector('.tr-mode').onclick = (e)=>{ const b = e.target.closest('[data-mode]'); if(!b) return; mode = b.dataset.mode;
      formEl.querySelectorAll('.tr-mode button').forEach(x=>x.classList.toggle('on', x===b));
      formEl.querySelectorAll('.tr-sec').forEach(s=>{ s.style.display = s.dataset.sec===mode ? '' : 'none'; }); q('.tr-bycat').style.display = mode==='creature' ? '' : 'none'; };
    q('[data-f="stat"]').onchange = (e)=>{ q('.tr-n').style.display = e.target.value==='psi_plus' ? '' : 'none'; };
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
      const marks = [...formEl.querySelectorAll('[data-mk]:checked')].map(c=>({k:c.dataset.mk, r:Math.max(0, num('mr'))}));
      const cons = {hits:num('hn') > 0 || q('[data-f="bycat"]').checked ? {n:num('hn'), byCat:mode==='creature' && q('[data-f="bycat"]').checked, mu:num('mu'), muType:val('mut'), wounds:val('wounds').trim() || '1', travma:q('[data-f="travma"]').checked} : null,
        hp:val('hp').trim(), psi:Math.max(0, num('psi')), states:[...formEl.querySelectorAll('[data-st]:checked')].map(c=>c.dataset.st), marks, note:val('note').trim()};
      const req = {id:'tr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title:val('title').trim() || 'Способность', src:src ? tokName(src) : 'Мастер', mode,
        stat:val('stat'), mod:Math.max(-21, Math.min(21, num('mod'))), n:num('n'), max:num('max'), vs:val('vs'), cons, rows:[]};
      const fired = formEl._onFired; closeForm(); start(req, targets); if(fired) try{ fired(); }catch(err){}
    });
    formEl.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ e.stopPropagation(); closeForm(); } });
    if(opts.prefill) prefill(opts.prefill, q, (m)=>{ formEl.querySelector(`.tr-mode [data-mode="${m}"]`).click(); });
    formEl._onFired = opts.onFired || null;
    setTimeout(()=>{ const i = q('[data-f="title"]'); if(i) i.focus(); }, 30);
  }
  // Заполнить форму из разобранной способности (AbilityKit.parse)
  function prefill(s, q, setMode){
    const set = (f, v)=>{ const el = q(`[data-f="${f}"]`); if(el && v!=null){ el.value = v; el.dispatchEvent(new Event('change', {bubbles:true})); } };
    if(s.opp || s.atk){ setMode('creature'); set('max', (s.opp || s.atk).max); set('vs', s.opp ? s.opp.vs : ''); }
    else if(s.check){ set('stat', s.check.stat); set('mod', s.check.mod || 0); if(s.check.n) set('n', s.check.n); }
    const c = s.cons || {};
    if(c.hits){ set('hn', c.hits.n || 1); const bc = q('[data-f="bycat"]'); if(bc) bc.checked = !!c.hits.byCat && !!(s.opp || s.atk); set('mu', c.hits.mu); set('mut', c.hits.muType); set('wounds', c.hits.wounds); q('[data-f="travma"]').checked = !!c.hits.travma; }
    if(c.hp) set('hp', c.hp);
    if(c.psi) set('psi', c.psi);
    (c.states || []).forEach(k=>{ const el = formEl.querySelector(`[data-st="${k}"]`); if(el) el.checked = true; });
    (c.marks || []).forEach(m=>{ const el = formEl.querySelector(`[data-mk="${m.k}"]`); if(el){ el.checked = true; set('mr', m.r); } });
    const a = s.areaSpec;
    if(a && a.shape==='all') formEl.querySelectorAll('[data-t]').forEach(cb=>{ cb.checked = true; });
    else if(a){ set('ashape', a.shape); set('asize', a.shape==='circle' ? a.r : a.shape==='rect' ? a.side : a.len); if(a.w) set('aw', a.w); const at = q('[data-f="aat"]'); if(!at.disabled) at.value = a.at || 'self';
      q('[data-f="ashape"]').dispatchEvent(new Event('change')); q('.tr-area').classList.add('hl'); }
    const notes = [c.hits && c.hits.nExpr ? `попаданий ${c.hits.nExpr}` : '', s.area && !a ? 'область: ' + s.area : '', c.note || ''].filter(Boolean).join('; ');
    if(notes) set('note', notes.slice(0, 200));
  }

  /* ---------- запуск: запросы игрокам, автоброски ---------- */
  let cur = null; // текущий запрос Мастера
  function rollD20(max){ const r = 1 + Math.floor(Math.random()*20), ev = evaluateD20Check(r, max); return {roll:r, max, success:ev.success, cat:ev.category}; }
  const checkLabel = (r)=>r.mode==='creature' ? (r.vs ? `${r.src}: Максимум ${r.max} против ${(VS.find(v=>v[0]===r.vs) || [, r.vs])[1]} цели` : `${r.src}: атака, Максимум ${r.max}`) :
    (r.stat==='psi_plus' ? `Проверка с Максимумом [${r.n} + пси-сопротивление]` : `${LABEL[r.stat]} (${sgn(r.mod)})`);
  function start(req, ids){
    const gt = GT(); cur = req;
    ids.forEach(id=>{ const t = gt.getToken(id); if(!t) return;
      const row = {id, name:tokName(t), kind:t.kind, ownerId:t.ownerId || '', status:'wait', apply:false};
      req.rows.push(row);
      if(req.mode==='creature'){ const sv = statValue(t, req.vs), r = rollD20(req.max - sv); Object.assign(row, r, {status:'done', stat:sv, affected:r.success}); row.apply = row.affected; return; }
      if(t.kind==='player'){
        const online = typeof session!=='undefined' && session.role==='gm' && session.players[t.ownerId];
        if(online){ sendMsg({type:'tr-req', req:{id:req.id, title:req.title, src:req.src, stat:req.stat, mod:req.mod, n:req.n, cons:consText(req.cons)}}, t.ownerId); return; }
        row.status = 'offline'; return; // не на связи (или свой жетон на столе без сессии) — «🎲 за игрока»
      }
      const r = rollD20(baseFor(t, req.stat, req.n) + (req.stat==='psi_plus' ? 0 : req.mod));
      Object.assign(row, r, {status:'done', affected:!r.success}); row.apply = row.affected;
    });
    render();
  }
  // за игрока (не на связи или не отвечает): по копии его листа у Мастера
  function rollFor(row){
    const gt = GT(), t = gt.getToken(row.id); if(!t || !cur) return;
    const base = baseFor(t, cur.stat, cur.n), r = rollD20(base + (cur.stat==='psi_plus' ? 0 : cur.mod));
    Object.assign(row, r, {status:'done', affected:!r.success, byGm:true}); row.apply = row.affected; render();
  }

  /* ---------- панель результатов ---------- */
  let panel = null;
  function render(){
    if(!cur){ if(panel){ panel.remove(); panel = null; } return; }
    if(!panel){ panel = document.createElement('div'); panel.className = 'tr-panel'; document.body.appendChild(panel); panel.addEventListener('click', onPanel); panel.addEventListener('change', onPanel); }
    const r = cur, done = r.rows.filter(x=>x.status==='done'), failed = done.filter(x=>x.affected);
    const rowHtml = (x)=>{
      const res = x.status==='done' ? `<span class="tr-res ${x.affected ? 'bad' : 'ok'}">${x.affected ? (r.mode==='creature' ? 'поражён' : 'провал') : (r.mode==='creature' ? 'устоял' : 'успех')}${x.affected && r.mode==='creature' && x.cat ? ', кат. ' + x.cat : !x.affected && r.mode!=='creature' ? ', КУ' + x.cat : ''}</span><span class="gs-muted">к20=${x.roll} / Макс.${x.max}${r.mode==='creature' && r.vs ? ` (${r.max} − ${x.stat})` : ''}${x.byGm ? ' · бросил Мастер' : ''}</span>`
        : x.status==='wait' ? '<span class="gs-muted">ждём бросок игрока…</span>' : '<span class="gs-muted">игрок не на связи</span>';
      return `<div class="tr-r" data-r="${esc(x.id)}"><label><input type="checkbox" data-ap ${x.apply ? 'checked' : ''} ${x.status==='done' ? '' : 'disabled'}> <b>${esc(x.name)}</b></label>${res}
        ${x.status!=='done' && x.kind==='player' && r.mode!=='creature' ? `<button type="button" class="gs-btn small" data-rf="${esc(x.id)}" title="Бросить за игрока по копии его листа">🎲 за игрока</button>` : ''}</div>`;
    };
    panel.innerHTML = `<div class="tr-head"><b>🎯 ${esc(r.src)} — ${esc(r.title)}</b><button type="button" class="tr-x" data-trx="close" title="Закрыть">✕</button></div>
      <div class="gs-muted">${esc(checkLabel(r))}</div><div class="gs-muted">Провал: ${esc(consText(r.cons))}</div>
      <div class="tr-rows">${r.rows.map(rowHtml).join('')}</div>
      <div class="gs-row"><button type="button" class="gs-btn primary" data-trx="apply" ${r.rows.some(x=>x.apply) ? '' : 'disabled'}>Применить провалы (${r.rows.filter(x=>x.apply).length})</button>
        <span class="gs-muted">${done.length}/${r.rows.length} бросили · провалили ${failed.length}</span></div>`;
  }
  function onPanel(e){
    const ap = e.target.closest && e.target.closest('[data-ap]');
    if(ap && e.type==='change'){ const row = cur.rows.find(x=>x.id===ap.closest('[data-r]').dataset.r); if(row){ row.apply = ap.checked; render(); } return; }
    if(e.type!=='click') return;
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
  function applyAll(){
    const gt = GT(), r = cur; if(!r) return;
    const parts = [];
    r.rows.filter(x=>x.apply && x.status==='done').forEach(x=>{
      const t = gt.getToken(x.id); if(!t) return;
      const c = r.cons, done = [];
      if(c.hits){ const n = c.hits.byCat ? (x.cat || 1) : c.hits.n; const h = gt.applyHitsTo(x.id, {n, mu:c.hits.mu, muType:c.hits.muType, wounds:c.hits.wounds, travma:c.hits.travma}); if(h) done.push(`${n}×МУ ${c.hits.mu}: ${h.text}`); }
      if(c.hp){ const v = gt.rollWoundsExpr(c.hp); if(v){ if(t.kind==='player') grantTo(t.ownerId, {kind:'vitals', which:'hp', mode:'delta', value:-v}); else if(t.hp!=null) gt.updateToken(x.id, {hp:t.hp - v}); done.push(`−${v} ОЗ`); } }
      if(c.psi){ if(t.kind==='player'){ grantTo(t.ownerId, {kind:'vitals', which:'psi', mode:'delta', value:-c.psi}); done.push(`−${c.psi} пси`); } }
      (c.states || []).forEach(k=>{ if(t.kind==='player') grantTo(t.ownerId, {kind:'state', key:k, on:true}); else if(k==='ispug') gt.addMarkTo(x.id, 'fear', 0); done.push((SHEET_STATES.find(s=>s[0]===k) || [, k])[1]); });
      (c.marks || []).forEach(m=>{ gt.addMarkTo(x.id, m.k, m.r); done.push(gt.MARKS[m.k].toLowerCase()); });
      if(c.note) done.push(c.note);
      parts.push(`${x.name} — ${done.join(', ') || 'без последствий'}`);
    });
    const ok = r.rows.filter(x=>x.status==='done' && !x.affected).map(x=>x.name);
    const text = `${r.src} — «${r.title}» (${checkLabel(r)}): ${parts.length ? 'провал: ' + parts.join('; ') : 'никто не пострадал'}${ok.length ? '. Устояли: ' + ok.join(', ') : ''}`;
    recordAndShareQuickRoll({abilityUse:true, text:text.slice(0, 900)});
    r.applied = true; cur = null; render();
    uiToast('Последствия применены', {icon:'🎯'});
  }

  /* ---------- игрок: запрос Мастера ---------- */
  const pending = []; let chip = null, waitRoll = null;
  function syncChip(){
    if(!pending.length){ if(chip){ chip.remove(); chip = null; } return; }
    if(!chip){ chip = document.createElement('button'); chip.type = 'button'; chip.className = 'tr-chip'; chip.onclick = ()=>showReq(pending[0]); document.body.appendChild(chip); }
    chip.textContent = `🎯 Мастер ждёт бросок${pending.length > 1 ? ' (' + pending.length + ')' : ''}`;
  }
  async function showReq(q){
    const r = await uiDialog({title:'Бросок по требованию Мастера', icon:'🎯', html:`<div class="tr-ask"><b>${esc(q.src)} — ${esc(q.title)}</b><div class="tr-ask-check">${esc(q.stat==='psi_plus' ? `Проверка с Максимумом [${q.n} + пси-сопротивление]` : `${LABEL[q.stat] || q.stat} (${sgn(q.mod)})`)}</div><div class="gs-muted">При провале: ${esc(q.cons)}</div></div>`,
      cancelValue:null, buttons:[{label:'Позже', value:null}, {label:'🎲 Бросить', value:'roll', primary:true}]});
    if(r==='roll') rollReq(q);
  }
  function rollReq(q){
    if(typeof character==='undefined' || !character){ uiAlert('Нет персонажа — бросать нечем. Создайте персонажа или загрузите его.'); return; }
    const key = realKey(q.stat);
    if(key==='psi_plus'){
      const max = (+q.n || 0) + (+character.psiSoprot || 0), roll = 1 + Math.floor(Math.random()*20), ev = evaluateD20Check(roll, max);
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
      const req = {id:s(q.id, 40), title:s(q.title, 80), src:s(q.src, 60), stat:CHECKS.some(c=>c[0]===q.stat) ? q.stat : 'volya', mod:Math.max(-21, Math.min(21, Math.round(+q.mod || 0))), n:Math.round(+q.n || 0), cons:s(q.cons, 300)};
      pending.push(req); syncChip(); showReq(req); return true;
    }
    if(msg.type==='tr-res'){
      if(!cur || session.role!=='gm' || msg.reqId!==cur.id) return true;
      const row = cur.rows.find(x=>x.kind==='player' && x.ownerId===msg.from && x.status!=='done'); if(!row) return true;
      Object.assign(row, {roll:Math.max(1, Math.min(20, Math.round(+msg.roll || 0))), max:Math.round(+msg.max || 0), success:!!msg.success, cat:Math.round(+msg.cat || 0), status:'done', affected:!msg.success});
      row.apply = row.affected; render(); return true;
    }
    return false;
  }
  return { open, handle, render, consText, npcStat };
})();
