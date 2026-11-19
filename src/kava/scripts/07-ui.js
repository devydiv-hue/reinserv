/* ======================================================================
   КАВАЛЕРИЯ — ОБЩИЕ ЭЛЕМЕНТЫ ИНТЕРФЕЙСА: экранирование, всплывающая панель действия (на телефоне — снизу,
   на компьютере — по центру), степпер числа (− 13 +), переключатели-чипы, уведомление.
   UI.sheet({title, html, onAction(act, el, close), onInput}) — панель с кнопками data-a="…"; Esc, клик мимо — закрыть.
   ====================================================================== */
const kvEsc = (s)=>String(s == null ? '' : s).replace(/[&<>"']/g, m=>({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[m]));
const UI = (function(){
  let open = null;
  function sheet(o){
    close();
    const back = document.createElement('div'); back.className = 'kv-sheet-back';
    back.innerHTML = `<div class="kv-sheet ${o.cls || ''}" role="dialog" aria-modal="true" aria-label="${kvEsc(o.title || '')}">
      <div class="kv-sheet-head"><div class="kv-sheet-title">${o.title ? kvEsc(o.title) : ''}${o.sub ? `<small>${kvEsc(o.sub)}</small>` : ''}</div>${o.help ? `<button type="button" class="kv-help" data-ref-open="${o.help}" title="Правило в справочнике" aria-label="Правило в справочнике">?</button>` : ''}<button type="button" class="kv-x" data-a="close" aria-label="Закрыть">✕</button></div>
      <div class="kv-sheet-body">${o.html || ''}</div></div>`;
    document.body.appendChild(back);
    const panel = back.querySelector('.kv-sheet');
    const done = ()=>close();
    back.addEventListener('click', (e)=>{
      if(e.target===back){ done(); return; }
      const st = e.target.closest('[data-step]');
      if(st){ const inp = st.parentNode.querySelector('input'); const v = Pilot.int(inp.value) + (+st.dataset.step), mn = inp.min!=='' ? +inp.min : -999, mx = inp.max!=='' ? +inp.max : 999;
        inp.value = Math.max(mn, Math.min(mx, v)); inp.dispatchEvent(new Event('input', {bubbles:true})); return; }
      const ch = e.target.closest('[data-chip]');
      if(ch){ const grp = ch.closest('[data-chips]'); if(grp && grp.dataset.chips==='one') grp.querySelectorAll('[data-chip]').forEach(x=>x.classList.toggle('on', x===ch)); else ch.classList.toggle('on'); if(o.onInput) o.onInput(panel); return; }
      const b = e.target.closest('[data-a]'); if(!b) return;
      if(b.dataset.a==='close'){ done(); return; }
      if(o.onAction) o.onAction(b.dataset.a, b, done, panel);
    });
    back.addEventListener('input', ()=>{ if(o.onInput) o.onInput(panel); });
    back.addEventListener('change', ()=>{ if(o.onInput) o.onInput(panel); });
    requestAnimationFrame(()=>back.classList.add('show'));
    open = {back, onClose:o.onClose};
    const f = panel.querySelector('[autofocus]'); if(f) setTimeout(()=>f.focus(), 60);
    if(o.onInput) o.onInput(panel);
    return panel;
  }
  function close(){ if(!open) return; const {back, onClose} = open; open = null; back.classList.remove('show'); setTimeout(()=>back.remove(), 180); if(onClose) onClose(); }
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && open) close(); });
  const stepper = (name, value, min, max, label)=>`<label class="kv-stepper">${label ? `<span>${kvEsc(label)}</span>` : ''}<span class="kv-step"><button type="button" data-step="-1" aria-label="меньше">−</button><input type="number" inputmode="numeric" name="${name}" value="${kvEsc(value)}"${min!=null ? ` min="${min}"` : ''}${max!=null ? ` max="${max}"` : ''}><button type="button" data-step="1" aria-label="больше">+</button></span></label>`;
  const chip = (key, label, on, title)=>`<button type="button" class="kv-chip${on ? ' on' : ''}" data-chip="${key}"${title ? ` title="${kvEsc(title)}"` : ''}>${label}</button>`;
  const chipOn = (root, key)=>{ const c = root.querySelector(`[data-chip="${key}"]`); return !!(c && c.classList.contains('on')); };
  const num = (root, name, d)=>{ const i = root.querySelector(`[name="${name}"]`); return i ? Pilot.int(i.value, d) : d; };
  let toastTimer = 0;
  function toast(text, tone){
    let t = document.getElementById('kvToast');
    if(!t){ t = document.createElement('div'); t.id = 'kvToast'; document.body.appendChild(t); }
    t.className = 'kv-toast show tone-' + (tone || 'info'); t.textContent = text;
    clearTimeout(toastTimer); toastTimer = setTimeout(()=>t.classList.remove('show'), 3200);
  }
  const plus = (n)=>(n >= 0 ? '+' : '−') + Math.abs(n);
  const dots = (n, cap, act, id, extra)=>{ let h = ''; for(let i = 0; i < cap; i++) h += `<button type="button" class="kv-dot${i < n ? ' on' : ''}${i && i % 3===0 ? ' gap' : ''}" data-a="${act}" data-id="${id}" data-i="${i}"${extra || ''} aria-label="метка ${i + 1}"></button>`; return `<span class="kv-dots">${h}</span>`; };
  return {sheet, close, stepper, chip, chipOn, num, toast, plus, dots, get isOpen(){ return !!open; }};
})();
