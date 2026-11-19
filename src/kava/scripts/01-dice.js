/* ======================================================================
   КАВАЛЕРИЯ — КОСТИ. Нотация книги: к4…к20, 2к6+1, к3 (к6 пополам вверх), к66 (десятки и единицы на двух к6),
   к100 (два к10, «0 и 0» = 100), Х-з-6 (шанс: успех, если на к6 выпало Х или ниже), (1) — фиксированное значение.
   Проверка — к20 + бонус против сложности; преимущество — 2к20, берётся больший, препятствие — меньший.
   «20» без бонусов — всегда успех, «1» — всегда провал. Каскад — ещё одна кость вреда за каждое максимальное значение.
   ====================================================================== */
const Dice = (function(){
  // равномерно 1..n без перекоса (crypto, отбрасывание хвоста)
  function rnd(n){
    if(typeof crypto!=='undefined' && crypto.getRandomValues){
      const lim = Math.floor(0x100000000 / n) * n, a = new Uint32Array(1);
      do{ crypto.getRandomValues(a); }while(a[0] >= lim);
      return 1 + (a[0] % n);
    }
    return 1 + Math.floor(Math.random() * n);
  }
  const d = (sides)=>sides===3 ? Math.ceil(rnd(6) / 2) : rnd(sides);
  const STEPS = [4, 6, 8, 10, 12];
  // ступень кости: к6 → к8 → к10 → к12
  const stepUp = (sides)=>STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(sides) + 1)] || sides;
  const norm = (s)=>String(s == null ? '' : s).trim().toLowerCase().replace(/[dкk]/g, 'к').replace(/[−–—]/g, '-').replace(/\s+/g, '');
  // разбор нотации → {kind:'sum', n, sides, mod} | {kind:'fixed', value} | {kind:'d66'} | {kind:'d100'} | {kind:'chance', x}
  function parse(s){
    const t = norm(s);
    let m;
    if((m = t.match(/^(\d)-з-6$/))) return {kind:'chance', x:+m[1]};
    if(t==='к66') return {kind:'d66'};
    if(t==='к100' || t==='к%') return {kind:'d100'};
    if((m = t.match(/^\(?(\d+)\)?$/))) return {kind:'fixed', value:+m[1]};
    if((m = t.match(/^(\d+)\+(\d*)к(\d+)$/))){ const r = parse(m[2] + 'к' + m[3]); return r && Object.assign(r, {mod:r.mod + (+m[1])}); } // «6+2к6» — как в книге
    if((m = t.match(/^(\d*)к(\d+)([+-]\d+)?$/))){
      const n = m[1] ? +m[1] : 1, sides = +m[2];
      if(n < 1 || n > 50 || sides < 2 || sides > 1000) return null;
      return {kind:'sum', n, sides, mod:m[3] ? +m[3] : 0};
    }
    return null;
  }
  // бросок по нотации; opts.cascade — Каскад (за каждое максимальное значение — ещё кость, не больше 20 добавочных)
  function roll(spec, opts){
    const p = typeof spec==='string' ? parse(spec) : spec; opts = opts || {};
    if(!p) return null;
    if(p.kind==='fixed') return {total:p.value, dice:[], text:String(p.value)};
    if(p.kind==='chance'){ const v = rnd(6); return {total:v, ok:v <= p.x, dice:[v], text:`к6=${v} ${v <= p.x ? '≤' : '>'} ${p.x}`}; }
    if(p.kind==='d66'){ const a = rnd(6), b = rnd(6); return {total:a * 10 + b, dice:[a, b], text:`${a} и ${b} → ${a}${b}`}; }
    if(p.kind==='d100'){ const a = rnd(10) % 10, b = rnd(10) % 10, v = a===0 && b===0 ? 100 : a * 10 + b; return {total:v, dice:[a, b], text:`${a} и ${b} → ${v}`}; }
    const dice = []; let extra = 0;
    for(let i = 0; i < p.n; i++) dice.push(d(p.sides));
    if(opts.cascade && p.sides > 1){
      for(let i = 0; i < dice.length && extra < 20; i++) if(dice[i]===p.sides){ dice.push(d(p.sides)); extra++; }
    }
    const sum = dice.reduce((a, b)=>a + b, 0), total = sum + p.mod;
    const base = dice.slice(0, p.n), more = dice.slice(p.n);
    const text = `${p.n > 1 ? p.n : ''}к${p.sides}${p.mod ? (p.mod > 0 ? '+' : '') + p.mod : ''}: [${base.join(', ')}]` +
      (more.length ? ` + каскад [${more.join(', ')}]` : '') + (p.mod ? ` ${p.mod > 0 ? '+' : '−'} ${Math.abs(p.mod)}` : '') + ` = ${total}`;
    return {total, dice, cascade:more.length, text, max:p.sides};
  }
  // к20 с режимом: 'norm' | 'adv' (преимущество) | 'dis' (препятствие)
  function d20(mode){
    const a = rnd(20);
    if(mode!=='adv' && mode!=='dis') return {nat:a, rolls:[a]};
    const b = rnd(20);
    return {nat:mode==='adv' ? Math.max(a, b) : Math.min(a, b), rolls:[a, b]};
  }
  // проверка: к20 + бонус против сложности. → {nat, rolls, total, ok, auto:'success'|'fail'|''}
  function check(bonus, dc, mode){
    const r = d20(mode), total = r.nat + (bonus || 0);
    const auto = r.nat===20 ? 'success' : r.nat===1 ? 'fail' : '';
    return Object.assign(r, {total, dc, bonus:bonus || 0, ok:auto ? auto==='success' : total >= dc, auto, mode:mode || 'norm'});
  }
  // строка таблицы по броску: rows — [{from, to, ...}] или массив с индексом от 1
  function pick(rows, v){ return rows.find(r=>v >= r.from && v <= r.to) || null; }
  return {rnd, d, parse, roll, d20, check, pick, stepUp, STEPS, norm};
})();
