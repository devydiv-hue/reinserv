/* ======================================================================
   КАВАЛЕРИЯ — ПОГРУЖЕНИЕ В ЯДРО (часть 8). Первое погружение — кС трижды: Узел, его детали, событие; дальше каждый
   новый Узел — кС + Измерение по тем же таблицам. Узел Перехода (и разрывы «Измерение +к4») ведут глубже. Ветка
   «Внутри…» бросается при открытии Узла (кС или к6 — как в книге). События с формулой Даров дают бросок по Таблице
   Даров (к100, итог больше 99 — 99); Дары копятся в Катафракте, повторные складываются. Выход — к20 + ЭМП против
   Отчуждённости + Измерение: провал — выход с Отдачей; любой выход сбрасывает кС до к6. Карта Узлов сохраняется
   (p.mech.dive), к открытым Узлам можно возвращаться.
   ====================================================================== */
const Dive = (function(){
  const esc = kvEsc, int = (v, d)=>Pilot.int(v, d);
  const state = (p)=>{ const m = p.mech; if(!m.dive || typeof m.dive!=='object') m.dive = {active:false, dim:0, cur:'', nodes:[]}; if(!Array.isArray(m.giftList)) m.giftList = []; return m.dive; };
  const ks = (p)=>Dice.rnd(+p.ks || 6);
  function inside(def, p){ if(!def.inside) return null; const v = def.die==='к6' ? Dice.rnd(6) : ks(p); return {v, die:def.die, text:(Dice.pick(def.inside, v) || {}).text || '—'}; }
  // новый Узел на Измерении dim: кС + Измерение по трём таблицам
  function makeNode(p, dim){
    const a = ks(p), b = ks(p), c = ks(p), key = CORE.nodeFor(a + dim), def = CORE.NODES[key];
    const det = CORE.DETAILS[Math.min(CORE.DETAILS.length, b + dim) - 1] || '—', ev = Dice.pick(CORE.EVENTS, c + dim);
    const node = {id:Pilot.uid(), dim, key, name:def.name, rolls:[a, b, c], detail:b + dim > CORE.DETAILS.length ? '— (в книге строка пустая)' : det, detailN:b + dim, event:ev.text, eventN:c + dim,
      gift:ev.gift || '', giftDim:!!ev.dim, choose:!!ev.choose, claimed:false, inside:inside(def, p), fall:/Измерение \+к4/.test(det) || ev.from===8};
    if(def.transit){ const t = node.inside.v; node.depth = t <= 4 ? 1 : t <= 6 ? Dice.rnd(3) : ks(p); }
    if(key==='womb' && node.inside && node.inside.v <= 4) node.fall = true;
    return node;
  }
  function entry(p, title, n, extra){
    const dice = n.rolls.map((v, i)=>({sides:+p.ks || 6, value:v, label:['Узел', 'детали', 'событие'][i]}));
    if(n.inside) dice.push({sides:n.inside.die==='к6' ? 6 : (+p.ks || 6), value:n.inside.v, label:'внутри'});
    return Rolls.push({who:p.name, kind:'dive', title:`${title}: ${n.name}`, tone:'info', big:n.rolls[0] + n.dim, verdict:`Измерение ${n.dim} · ${n.event}`,
      lines:[`кС: Узел ${n.rolls[0]}+${n.dim}, детали ${n.rolls[1]}+${n.dim}, событие ${n.rolls[2]}+${n.dim}`, CORE.NODES[n.key].text, n.inside ? `Внутри (${n.inside.die || 'кС'} = ${n.inside.v}): ${n.inside.text}` : '', 'Детали: ' + n.detail, 'Событие: ' + n.event].filter(Boolean).concat(extra || []), dice});
  }
  const show = (e)=>{ Fx.play(e); Tandem.render(); if(typeof Table!=='undefined'){ Table.rolled(e); Table.pilotChanged(); } };
  function addNode(p, dim, title, extra){ const d = state(p), n = makeNode(p, dim); d.nodes.push(n); d.cur = n.id; d.dim = dim; d.active = true; Pilot.save(); show(entry(p, title, n, extra)); }
  function giftRoll(p, n){
    const d = state(p), spec = n.gift.replace(/\s/g, ''), parts = spec.split('+');
    let total = 0; const dice = [], lines = [];
    parts.forEach(s=>{ const r = Dice.roll(s); if(r){ total += r.total; lines.push(r.text); r.dice.slice(0, 4).forEach(v=>dice.push({sides:r.max || (s.includes('к100') ? 10 : 20), value:v || 10, label:'дар'})); } });
    if(n.giftDim){ total += n.dim; lines.push(`+ Измерение ${n.dim}`); }
    const v = Math.max(1, Math.min(99, total)), g = Dice.pick(CORE.GIFTS, v);
    addGift(p, v, g); n.claimed = true; Pilot.save();
    show(Rolls.push({who:p.name, kind:'gift', title:'Дар Ядра', tone:'ok', big:v, verdict:g.text, lines:[`${n.gift}${n.giftDim ? ' + Измерение' : ''}: ${total}${total > 99 ? ' → 99' : ''}`].concat(lines), dice:dice.slice(0, 6)}));
  }
  function addGift(p, v, g){
    const list = p.mech.giftList, have = list.find(x=>x.text===g.text);
    if(have) have.n = int(have.n, 1) + 1; else list.push({id:Pilot.uid(), v, text:g.text, n:1, stack:g.stack});
  }
  function exit(p){
    const d = state(p), dim = d.dim, e = Rolls.alienation(p, dim, App.useMode()), fail = e.tone==='fail';
    p.ks = 6; p.ksBonus = 0; d.active = false; d.dim = 0; Pilot.save();
    e.lines.push('Погружение окончено, кС сброшен до к6.');
    show(e);
    if(fail) setTimeout(()=>show(Rolls.backlash(p, 0)), 2600);
  }
  // ---------- окно погружения ----------
  function sheet(p){
    const d = state(p), cur = d.nodes.find(n=>n.id===d.cur), alien = Pilot.alien(p);
    const dims = [...new Set(d.nodes.map(n=>n.dim))].sort((a, b)=>a - b);
    const transitHere = d.nodes.filter(n=>n.dim===d.dim && n.depth);
    const card = cur ? `<div class="kv-node"><div class="kv-node-head"><b>${esc(cur.name)}</b><span>Измерение ${cur.dim}</span></div>
        <p class="kv-p">${esc(CORE.NODES[cur.key].text)}</p>
        ${cur.inside ? `<div class="kv-wiz-res"><b>Внутри (${cur.inside.die || 'кС'} = ${cur.inside.v}):</b> ${esc(cur.inside.text)}</div>` : ''}
        <div class="kv-note"><b>Детали (${cur.detailN}):</b> ${esc(cur.detail)}</div><div class="kv-note"><b>Событие (${cur.eventN}):</b> ${esc(cur.event)}</div>
        <div class="kv-row2">${cur.gift && !cur.claimed ? `<button type="button" class="kv-btn kv-primary" data-a="gift">Дар: ${esc(cur.gift)}${cur.giftDim ? ' + Измерение' : ''}</button>` : ''}
          ${cur.choose && !cur.claimed ? '<button type="button" class="kv-btn kv-primary" data-a="pickgift">Выбрать Дар</button>' : ''}
          ${cur.depth ? `<button type="button" class="kv-btn" data-a="descend" data-n="${cur.depth}">Спуститься: Измерение +${cur.depth}</button>` : ''}
          ${cur.fall ? '<button type="button" class="kv-btn" data-a="fall">Провалиться: Измерение +к4</button>' : ''}</div></div>` : '';
    UI.sheet({help:'sync', title:'Погружение в Ядро', cls:'kv-wizard', sub:d.active ? `Измерение ${d.dim} · кС к${p.ks} · выход: к20 + ЭМП против ${alien + d.dim}` : `Отчуждённость Ядра ${alien}${d.nodes.length ? ` · открыто Узлов: ${d.nodes.length}` : ''}`, html:`
      ${d.active ? card : `<p class="kv-p">${d.nodes.length ? 'Повторное погружение: новый Узел — кС + Измерение (начинаете с нулевого). Открытые Узлы остаются на карте.' : 'Первое погружение: кС трижды — Узел, его детали и событие.'} Выход из погружения сбросит кС до к6.</p>`}
      <div class="kv-sheet-btns">${d.active ? `<button type="button" class="kv-btn kv-primary" data-a="node">Новый Узел (кС + ${d.dim})</button>
        ${!cur || !cur.depth ? transitHere.map(n=>`<button type="button" class="kv-btn" data-a="goto" data-id="${n.id}">К Переходу «${esc(n.name)}»</button>`).join('') : ''}
        <button type="button" class="kv-btn" data-a="alien">Испытание Отчуждённости</button><button type="button" class="kv-btn" data-a="exit">Выйти из погружения</button>`
        : '<button type="button" class="kv-btn kv-primary kv-grow2" data-a="start">Начать погружение</button>'}</div>
      ${dims.length ? `<div class="kv-fe kv-wide"><span>Карта Узлов</span>${dims.map(dm=>`<div class="kv-row2"><b class="kv-dim">${dm}</b>${d.nodes.filter(n=>n.dim===dm).map(n=>`<button type="button" class="kv-chip${n.id===d.cur && d.active ? ' on' : ''}" data-a="goto" data-id="${n.id}">${esc(n.name)}</button>`).join('')}</div>`).join('')}</div>` : ''}
      ${p.mech.giftList.length ? `<div class="kv-fe kv-wide"><span>Дары Ядра</span><ul class="kv-list2">${p.mech.giftList.map(g=>`<li>${esc(g.text)}${g.n > 1 ? ` <b>×${g.n}</b>` : ''} <button type="button" class="kv-x" data-a="delgift" data-id="${g.id}" title="Убрать">✕</button></li>`).join('')}</ul></div>` : ''}`,
      onAction(a, b, close){
        const again = ()=>setTimeout(()=>sheet(p), 50);
        if(a==='start'){ addNode(p, 0, d.nodes.length ? 'Погружение: новый Узел' : 'Первое погружение'); again(); return; }
        if(a==='node'){ addNode(p, d.dim, 'Новый Узел'); again(); return; }
        if(a==='descend'){ addNode(p, d.dim + int(b.dataset.n, 1), `Спуск через Переход: Измерение ${d.dim} → ${d.dim + int(b.dataset.n, 1)}`); again(); return; }
        if(a==='fall'){ const x = Dice.rnd(4); addNode(p, d.dim + x, `Провал вглубь: к4 = ${x}`); again(); return; }
        if(a==='goto'){ const n = d.nodes.find(x=>x.id===b.dataset.id); if(n){ d.cur = n.id; d.dim = n.dim; d.active = true; Pilot.save(); } again(); return; }
        if(a==='gift'){ giftRoll(p, cur); again(); return; }
        if(a==='pickgift'){ close(); pickGift(p, cur); return; }
        if(a==='alien'){ show(Rolls.alienation(p, 0, App.useMode())); again(); return; }
        if(a==='exit'){ close(); exit(p); return; }
        if(a==='delgift'){ p.mech.giftList = p.mech.giftList.filter(g=>g.id!==b.dataset.id); Pilot.save(); Tandem.render(); again(); return; }
      }});
  }
  function pickGift(p, n){
    UI.sheet({title:'Манифестация Ядра: выберите Дар', html:`<div class="kv-act-grid">${CORE.GIFTS.map((g, i)=>`<button type="button" class="kv-act" data-a="g" data-i="${i}"><b>${g.from}${g.to!==g.from && g.to < 100 ? '–' + g.to : ''}</b><span>${esc(g.text)}</span></button>`).join('')}</div>`,
      onAction(a, b){ const g = CORE.GIFTS[+b.dataset.i]; addGift(p, g.from, g); n.claimed = true; Pilot.save(); Tandem.render(); show(Rolls.push({who:p.name, kind:'gift', title:'Дар Ядра (выбран)', tone:'ok', big:g.from, verdict:g.text, lines:[]})); setTimeout(()=>sheet(p), 50); }});
  }
  return {sheet, state};
})();
