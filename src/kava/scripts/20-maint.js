/* ======================================================================
   КАВАЛЕРИЯ — ОБСЛУЖИВАНИЕ КАТАФРАКТА ЗА МАТЕРИАЛЫ КОПЬЯ (части 2 и 6): полевой ремонт (вахта, 1 Мат, +к6 СТК),
   капитальный (к3 дня, 1 Мат, снять одно Критическое повреждение), пополнение расходников (1 Мат за кость).
   Материалы лежат в Копье у Летописца. Игрок за столом шлёт запрос mat-req {rid, n, purpose, who}; у Летописца
   запросы копятся в очереди (полоса над экраном Летописца и окно, если другое не открыто), он разрешает или
   отказывает — mat-ans {rid, ok}; при разрешении Материалы списываются у него, и только тогда действие
   выполняется у игрока. Летописец и игра без стола списывают с Копья этого браузера сами.
   ====================================================================== */
const Maint = (function(){
  const esc = kvEsc, int = (v, d)=>Pilot.int(v, d);
  const waiting = {};     // у игрока: rid → resolve
  let queue = [];         // у Летописца: [{rid, from, n, purpose, who}]

  // ---------- списать n Мат → Promise<boolean> ----------
  function spend(n, purpose){
    const S = Table.S;
    if(S.role==='player'){
      if(!S.gmId){ UI.toast('Летописца нет за столом — Материалы просить не у кого', 'fail'); return Promise.resolve(false); }
      const rid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      Table.send({type:'mat-req', rid, n, purpose, who:(Tandem.pilot && Tandem.pilot.name) || 'Спектр'}, S.gmId);
      UI.toast(`Запрос Летописцу: ${n} Мат — ${purpose}`, 'ok');
      return new Promise(res=>{ waiting[rid] = res; });
    }
    const r = Gm.spendMat(n);
    if(r.ok) return Promise.resolve(true);
    return Promise.resolve(confirm(`В Копье ${r.left} Мат, а нужно ${n}. Провести без списания?`));
  }
  // у игрока: ответ Летописца
  function answer(m){
    const f = waiting[m.rid];
    if(!f){ if(m.ok) UI.toast('Летописец разрешил устаревший запрос Материалов — повторите действие', 'info'); return; }
    delete waiting[m.rid]; if(!m.ok) UI.toast('Летописец отказал в Материалах', 'fail'); f(!!m.ok);
  }
  // у игрока: Летописец ушёл — все ожидающие запросы отменяются
  function gmLeft(){ Object.keys(waiting).forEach(rid=>{ const f = waiting[rid]; delete waiting[rid]; f(false); }); }

  // ---------- действия ----------
  const show = (e)=>{ Fx.play(e); Tandem.render(); Table.rolled(e); Table.pilotChanged(); };
  function field(p){
    const m = p.mech;
    spend(1, 'полевой ремонт').then(ok=>{ if(!ok) return;
      const v = Dice.rnd(6), before = int(m.stk); m.stk = Math.min(int(m.stkMax), before + v); Pilot.save();
      show(Rolls.push({who:p.name, kind:'repair', title:'Полевой ремонт', tone:'ok', big:'+' + (m.stk - before), verdict:`СТК ${before} → ${m.stk} · вахта, 1 Мат`,
        lines:[`к6 = ${v}${before + v > int(m.stkMax) ? ` (сверх максимума ${int(m.stkMax)} не восстанавливается)` : ''}`, 'Делают оружейники с ремонтной техникой.'], dice:[{sides:6, value:v, tint:'good'}]})); });
  }
  function capital(p, critId){
    const m = p.mech, c = m.crits.find(x=>x.id===critId); if(!c) return;
    spend(1, 'капитальный ремонт').then(ok=>{ if(!ok) return;
      const v = Dice.rnd(6), d = Math.ceil(v / 2); m.crits = m.crits.filter(x=>x.id!==critId); Pilot.save();
      show(Rolls.push({who:p.name, kind:'repair', title:'Капитальный ремонт', tone:'ok', big:d + ' дн.', verdict:'Снято: ' + c.text,
        lines:[`к3 = ${d} дн. работы, 1 Мат`, 'Только в Ковчеге, полевой оружейной машине или ремонтном цехе.'], dice:[{sides:6, value:v, label:'к3 = ' + d}]})); });
  }
  function refill(p, ids){
    const list = p.mech.items.filter(it=>ids.includes(it.id)); if(!list.length) return;
    spend(list.length, 'пополнение расходников').then(ok=>{ if(!ok) return;
      list.forEach(it=>{ it.marks = 0; }); Pilot.save();
      show(Rolls.push({who:p.name, kind:'repair', title:'Пополнение расходников', tone:'ok', big:'−' + list.length + ' Мат', verdict:list.map(it=>it.name).join(', '), lines:['1 Мат за каждую кость расходника.']})); });
  }
  function sheet(p){
    const m = p.mech, used = m.items.filter(it=>(it.kind==='consumable' || it.kv) && int(it.marks) > 0), full = int(m.stk) >= int(m.stkMax);
    const player = Table.S.role==='player', left = player ? (Table.S.lance && Table.S.lance.res ? int(Table.S.lance.res.materials) : null) : Gm.spendMat(0).left;
    UI.sheet({help:'repair', title:'Ремонт и обслуживание', sub:`СТК ${int(m.stk)} из ${int(m.stkMax)} · ${left!=null ? `в Копье ${left} Мат` : 'Материалы Копья'}${player ? ' · с разрешения Летописца' : ''}`, html:`
      <div class="kv-act-grid"><button type="button" class="kv-act" data-a="field"${full ? ' disabled' : ''}><b>Полевой ремонт</b><span>${full ? 'СТК и так полный' : 'вахта и 1 Мат: +к6 СТК'}</span></button></div>
      ${m.crits.length ? `<div class="kv-fe kv-wide"><span>Капитальный ремонт — к3 дня и 1 Мат за одно повреждение</span><div class="kv-act-grid">${m.crits.map(c=>`<button type="button" class="kv-act" data-a="capital" data-id="${c.id}"><b>Снять</b><span>${esc(c.text)}</span></button>`).join('')}</div></div>` : '<p class="kv-note">Критических повреждений нет.</p>'}
      ${used.length ? `<div class="kv-fe kv-wide"><span>Пополнить расходники — 1 Мат за кость</span><div class="kv-chips2">${used.map(it=>UI.chip(it.id, `${esc(it.name)} · ${int(it.marks)}/3`, true)).join('')}</div>
        <div class="kv-sheet-btns"><button type="button" class="kv-btn kv-primary kv-grow2" data-a="refill">Пополнить отмеченные</button></div></div>` : '<p class="kv-note">Расходники полны.</p>'}
      <p class="kv-note">Восстановление уничтоженного Катафракта и создание модулей — в справочнике (кнопка «?»): это недели работы, их ведёт Летописец.</p>`,
      onAction(a, b, close, panel){
        if(a==='field'){ close(); field(p); }
        if(a==='capital'){ close(); capital(p, b.dataset.id); }
        if(a==='refill'){ const ids = [...panel.querySelectorAll('[data-chip].on')].map(c=>c.dataset.chip); if(!ids.length){ UI.toast('Отметьте расходники', 'fail'); return; } close(); refill(p, ids); }
      }});
  }

  // ---------- Летописец: очередь запросов ----------
  function request(from, m){
    const n = Math.max(0, Math.min(99, int(m.n))); if(!n || !m.rid) return;
    queue.push({rid:String(m.rid).slice(0, 24), from, n, purpose:String(m.purpose || '').slice(0, 60), who:String(m.who || 'Игрок').slice(0, 40)});
    UI.toast(`${m.who || 'Игрок'} просит ${n} Мат — ${m.purpose}`, 'info');
    Gm.render();
    if(!UI.isOpen) decideSheet(queue[queue.length - 1]);
  }
  function decide(rid, ok){
    const q = queue.find(x=>x.rid===rid); if(!q) return;
    queue = queue.filter(x=>x!==q);
    if(ok) Gm.spendMat(q.n, true);
    Table.send({type:'mat-ans', rid:q.rid, ok}, q.from);
    UI.toast(ok ? `${q.who}: списано ${q.n} Мат` : `${q.who}: отказано`, ok ? 'ok' : 'fail');
    Gm.render();
  }
  function decideSheet(q){
    const left = Gm.spendMat(0).left;
    UI.sheet({help:'repair', title:'Запрос Материалов', sub:`${q.who}: ${q.n} Мат — ${q.purpose}`, html:`<p class="kv-p">В Копье ${left} Мат${left < q.n ? ' — не хватает, разрешение спишет до нуля' : ''}. Закрыть окно — запрос останется в очереди на экране Летописца.</p>
      <div class="kv-sheet-btns"><button type="button" class="kv-btn" data-a="no">Отказать</button><button type="button" class="kv-btn kv-primary kv-grow2" data-a="yes" autofocus>Разрешить: −${q.n} Мат</button></div>`,
      onAction(a, b, close){ close(); decide(q.rid, a==='yes'); }});
  }
  // игрок ушёл — его запросы снимаются
  function peerLeft(id){ const n = queue.length; queue = queue.filter(q=>q.from!==id); if(queue.length!==n) Gm.render(); }
  const queueView = ()=>queue.length ? `<div class="kv-matq">${queue.map(q=>`<div class="kv-matq-i"><span><b>${esc(q.who)}</b> просит ${q.n} Мат — ${esc(q.purpose)}</span>
      <button type="button" class="kv-btn kv-sm" data-g="mat-no" data-id="${esc(q.rid)}">Отказать</button><button type="button" class="kv-btn kv-sm kv-primary" data-g="mat-yes" data-id="${esc(q.rid)}">Разрешить −${q.n}</button></div>`).join('')}</div>` : '';

  return {sheet, refill, spend, answer, gmLeft, request, decide, peerLeft, queueView};
})();
