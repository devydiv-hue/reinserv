/* ======================================================================
   КАВАЛЕРИЯ — ПОКАЗ БРОСКА: 3D-кости летят от кнопки, оседают, поверх — карточка итога (крупное число, вердикт,
   подробности по нажатию). Перегрев кР (итог 7+) — экран краснеет и дрожит, 12+ сильнее, взрыв реактора — вспышка.
   Анимацию можно выключить в меню (reincarnator_kava_app_v1.anim) — тогда сразу карточка. Карточка закрывается
   кликом, Esc или сама через 5 с (наведение мыши держит её открытой).
   ====================================================================== */
const Fx = (function(){
  let origin = null, card = null, timer = 0, token = 0;
  // откуда полетят кости — последняя нажатая кнопка
  document.addEventListener('pointerdown', (e)=>{ const b = e.target.closest && e.target.closest('button, [data-roll]'); if(b){ const r = b.getBoundingClientRect(); origin = {left:r.left + r.width / 2 - 40, top:r.top + r.height / 2 - 40}; } }, true);
  const animOn = ()=>{ try{ return (JSON.parse(localStorage.getItem('reincarnator_kava_app_v1') || '{}').anim)!==false; }catch(e){ return true; } };
  function close(){
    clearTimeout(timer); Dice3D.clear();
    document.body.classList.remove('kv-heat', 'kv-heat2', 'kv-boom');
    if(card){ const c = card; card = null; c.classList.remove('show'); setTimeout(()=>c.remove(), 200); }
  }
  function heat(e){
    const o = e.fx && e.fx.overheat;
    if(!o && !(e.fx && e.fx.boom)) return;
    document.body.classList.remove('kv-heat', 'kv-heat2', 'kv-boom'); void document.body.offsetWidth;
    document.body.classList.add(e.fx.boom ? 'kv-boom' : o >= 10 ? 'kv-heat2' : 'kv-heat');
  }
  function showCard(e){
    const tone = e.tone || 'info';
    card = document.createElement('div');
    card.className = 'kv-result tone-' + tone; card.setAttribute('role', 'status');
    card.innerHTML = `<div class="kv-result-title">${kvEsc(e.title)}${e.who ? `<span>${kvEsc(e.who)}</span>` : ''}</div>
      <div class="kv-result-big">${kvEsc(e.big!=null ? e.big : '')}</div>
      <div class="kv-result-verdict">${kvEsc(e.verdict || '')}</div>
      ${(e.lines || []).length ? `<details class="kv-result-more"><summary>Подробнее</summary>${e.lines.map(l=>`<div>${kvEsc(l)}</div>`).join('')}</details>` : ''}
      <div class="kv-result-hint">нажмите, чтобы закрыть</div>`;
    document.body.appendChild(card);
    requestAnimationFrame(()=>card && card.classList.add('show'));
    let hover = false;
    card.addEventListener('mouseenter', ()=>{ hover = true; clearTimeout(timer); });
    card.addEventListener('mouseleave', ()=>{ hover = false; timer = setTimeout(close, 2500); });
    card.addEventListener('click', (ev)=>{ if(ev.target.closest('summary, details')) { clearTimeout(timer); return; } close(); });
    timer = setTimeout(()=>{ if(!hover) close(); }, e.fx && (e.fx.overheat || e.fx.boom) ? 7000 : 5000);
  }
  // показать бросок; → Promise (когда карточка появилась)
  function play(e){
    if(!e) return Promise.resolve();
    close(); const my = ++token;
    const dice = (e.dice || []).filter(d=>d && d.sides && d.value);
    const epic = ()=>typeof Epic!=='undefined' ? Epic.play(e) : Promise.resolve();
    if(!dice.length || !animOn()){ heat(e); return epic().then(()=>{ if(my===token) showCard(e); }); }
    return Dice3D.roll(dice, {from:origin, lift:60}).then(()=>{ if(my!==token) return; heat(e); return epic().then(()=>{ if(my===token) showCard(e); }); });
  }
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && card) close(); });
  return {play, close};
})();
