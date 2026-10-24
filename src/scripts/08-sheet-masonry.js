/* Кладка разделов листа (3 колонки, 2 на средних экранах, 1 на узких), в три яруса:
   1) сверху — Тело+Личность, оба «Навыка», все три «Знания» (по колонкам, Тело и Личность — слева);
   2) под ними — Самочувствие и Броня;
   3) дальше — остальные разделы (Спасброски, Отдых, Атака, Способности, Достоинства, Религия) по объёму.
   Колонки для ярусов 2–3 подбираются совместно, чтобы самая длинная колонка была как можно короче. Внутри колонки порядок ярусов сохраняется.
   Пересчёт — при смене персонажа и крупных изменениях; от мелких правок разделы не прыгают, а пока курсор стоит
   в поле ввода — не двигаются вовсе. */
(function(){
  const flow = document.getElementById('sheetFlow'); if(!flow) return;
  const panels = Array.from(flow.querySelectorAll(':scope > .panel'));
  const title = (p)=>{ const h = p.querySelector('h2'); return h ? h.textContent.trim() : ''; };
  const grp = (names)=>names.map(t=>panels.find(p=>title(p)===t)).filter(Boolean);
  const TOP = [grp(['Тело', 'Личность']), grp(['Навыки авантюриста', 'Навыки боя']), grp(['Знания культуры', 'Знания нового мира', 'Знания старого мира'])].filter(g=>g.length);
  const MID = [grp(['Самочувствие']), grp(['Броня'])].filter(g=>g.length);
  const used = new Set(TOP.concat(MID).flat());
  const REST = ['Спасброски', 'Отдых', 'Атака', 'Способности', 'Достоинства и недостатки', 'Религия'].map(t=>grp([t])).filter(g=>g.length);
  REST.flat().forEach(p=>used.add(p)); panels.forEach(p=>{ if(!used.has(p)) REST.push([p]); });
  let cols = [], n = 0, raf = 0, last = '', lastSum = 0;
  const want = ()=>{ const w = flow.clientWidth || window.innerWidth; return w >= 1000 ? 3 : w >= 640 ? 2 : 1; };
  function build(k){ cols.forEach(c=>c.remove()); cols = []; last = ''; for(let i=0;i<k;i++){ const c = document.createElement('div'); c.className = 'sheet-col'; flow.appendChild(c); cols.push(c); } n = k; }
  const H = (g)=>g.reduce((a, p)=>a + p.offsetHeight + 26, 0);
  // лучший способ разложить группы gs по k колонкам с начальными высотами h0 (минимум самой длинной; при
  // равенстве — ближе к исходному порядку); fix0 — первая группа обязательно в колонке 0
  function bestAssign(gs, h0, k, fix0, ok){ const gh = gs.map(H), G = gs.length; let best = null, bestMax = Infinity, bestPen = Infinity; const asg = new Array(G);
    for(let code=0, total=Math.pow(k, G); code<total; code++){ let c = code; const h = h0.slice(); let pen = 0;
      for(let i=0;i<G;i++){ const col = c % k; c = (c - col)/k; asg[i] = col; h[col] += gh[i]; pen += Math.abs(col - Math.floor(i*k/G)); }
      if(fix0 && asg[0] !== 0 || ok && !ok(asg)) continue;
      const mx = Math.max.apply(null, h); if(mx < bestMax - 2 || Math.abs(mx - bestMax) <= 2 && pen < bestPen){ bestMax = mx; bestPen = pen; best = {asg:asg.slice(), h}; } }
    return best || {asg:gs.map(()=>0), h:h0.slice()}; }
  function plan(k){
    const out = [], t = bestAssign(TOP, new Array(k).fill(0), k, true); TOP.forEach((g, i)=>out.push([g, t.asg[i]]));
    // Самочувствие и Броня идут первыми под верхним ярусом, остальное — следом; колонки подбираются совместно
    const tail = MID.concat(REST), r = bestAssign(tail, t.h, k, false, (a)=>k < 2 || MID.length < 2 || a[0] !== a[1]); // в разных колонках — оба сразу под верхним ярусом
    tail.forEach((g, i)=>out.push([g, r.asg[i]]));
    return {out, max:Math.max.apply(null, r.h)}; }
  function layout(){
    raf = 0; if(!flow.offsetParent) return; // вкладка листа скрыта — разложим, когда покажут
    const active = document.activeElement; if(active && flow.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName)) return;
    const k = want(); if(k !== n) build(k);
    const p = plan(k), key = p.out.map(x=>x[1]).join(','); if(key === last) return;
    const sum = panels.reduce((a, q)=>a + q.offsetHeight, 0), bigChange = Math.abs(sum - lastSum) > 250; // другой персонаж / крупная правка
    if(last && !bigChange){ const cur = last.split(',').map(Number), ch = new Array(k).fill(0); p.out.forEach(([g], i)=>{ ch[cur[i]] += H(g); }); if(Math.max.apply(null, ch) - p.max < 140) return; }
    last = key; lastSum = sum;
    p.out.forEach(([g, c])=>g.forEach(q=>cols[c].appendChild(q)));
  }
  const schedule = ()=>{ if(!raf) raf = requestAnimationFrame(layout); };
  build(want()); panels.forEach(p=>cols[0].appendChild(p)); layout();
  if(window.ResizeObserver){ const ro = new ResizeObserver(schedule); panels.forEach(p=>ro.observe(p)); ro.observe(flow); }
  window.addEventListener('resize', schedule);
  document.addEventListener('focusout', ()=>setTimeout(schedule, 0));
  window.SheetMasonry = {layout:()=>{ last = ''; schedule(); }};
})();
