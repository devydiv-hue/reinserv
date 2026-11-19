/* ======================================================================
   КАВАЛЕРИЯ — ЭПИЧНЫЕ СЦЕНЫ на весь экран (у всех за столом): натуральная 20 — золотые лучи и вспышка числа,
   натуральная 1 — число трескается и разваливается, взрыв реактора — белая вспышка и ударная волна,
   неконтролируемый коллапс (Отдача 12+) — глитч сознания. Поверх 3D-костей, перед карточкой итога.
   Выключаются в меню («Эпичные сцены», reincarnator_kava_app_v1.epic) и при «уменьшении движения» в системе.
   ====================================================================== */
const Epic = (function(){
  const esc = kvEsc;
  const reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const on = ()=>!reduce && App.pref('epic')!==false;
  const kindOf = (e)=>{ const f = e && e.fx; if(!f) return ''; return f.boom ? 'boom' : f.collapse ? 'collapse' : f.nat20 ? 'nat20' : f.nat1 ? 'nat1' : ''; };
  const CAP = {nat20:'Критический успех', nat1:'Провал', boom:'Взрыв реактора', collapse:'Неконтролируемый коллапс'};
  const NUM = {nat20:'20', nat1:'1', boom:'', collapse:'КОЛЛАПС'};
  const MS = {nat20:2300, nat1:2100, boom:2600, collapse:2600};
  function play(e){
    const k = kindOf(e);
    if(!k || !on()) return Promise.resolve(false);
    document.querySelectorAll('.kv-epic').forEach(x=>x.remove());
    const el = document.createElement('div');
    el.className = 'kv-epic ep-' + k; el.setAttribute('aria-hidden', 'true');
    let sparks = ''; if(k==='nat20' || k==='boom') for(let i = 0; i < 18; i++){ const a = Math.random() * 360, d = 30 + Math.random() * 45; sparks += `<i style="--a:${a.toFixed(0)}deg;--d:${d.toFixed(0)}vmin;--t:${(0.6 + Math.random() * 0.8).toFixed(2)}s;--s:${(0.1 + Math.random() * 0.3).toFixed(2)}s"></i>`; }
    el.innerHTML = `<div class="ep-bg"></div>${k==='nat20' ? '<div class="ep-rays"></div>' : ''}${k==='boom' ? '<div class="ep-flash"></div><div class="ep-ring"></div><div class="ep-ring r2"></div><div class="ep-fire"></div>' : ''}
      ${k==='collapse' ? '<div class="ep-scan"></div>' : ''}${sparks ? `<div class="ep-sparks">${sparks}</div>` : ''}
      ${NUM[k] ? `<div class="ep-num" data-t="${esc(NUM[k])}">${k==='nat1' ? '<span class="h1">1</span><span class="h2">1</span>' : esc(NUM[k])}</div>` : ''}
      <div class="ep-cap"><b>${CAP[k]}</b><span>${esc((e.who ? e.who + ' · ' : '') + (e.title || ''))}</span></div>`;
    document.body.appendChild(el);
    if(k==='nat1' || k==='boom' || k==='collapse'){ document.body.classList.remove('ep-shake'); void document.body.offsetWidth; document.body.classList.add('ep-shake'); }
    return new Promise(res=>{
      const done = ()=>{ el.classList.add('out'); setTimeout(()=>{ el.remove(); document.body.classList.remove('ep-shake'); res(true); }, 300); };
      const t = setTimeout(done, MS[k]); el.addEventListener('click', ()=>{ clearTimeout(t); done(); }, {once:true});
    });
  }
  return {play, kindOf};
})();
