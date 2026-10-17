/* ======================================================================
   РЕЖИМ «ИГРА» — переключатель-d20 в строке вкладок. Включён: лист компактный, для игры за столом — без генерации,
   сохранений, замков 🔒, специализаций, прогрессии и журнала; сверху закреплена полоска персонажа: ОЗ, пси, удача
   (−/+) и состояния. Выключен — полный лист. Состояние запоминается в этом браузере.
   ====================================================================== */
const PlayMode = (function(){
  const KEY = 'reincarnator_play_mode_v1';
  let on = false; try{ on = localStorage.getItem(KEY)==='1'; }catch(e){}
  const D20 = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">' +
    '<path d="M12 1.8 20.8 6.9v10.2L12 22.2 3.2 17.1V6.9z"/><path d="M12 7.2 17.3 16.2H6.7z"/>' +
    '<path d="M12 1.8v5.4M3.2 6.9 12 7.2l8.8-.3M3.2 6.9l3.5 9.3M20.8 6.9l-3.5 9.3M3.2 17.1l3.5-.9M20.8 17.1l-3.5-.9M6.7 16.2 12 22.2l5.3-6"/></g>' +
    '<text x="12" y="14.9" text-anchor="middle" font-size="5.4" font-weight="700" fill="currentColor" font-family="Arial, sans-serif">20</text></svg>';
  let btn = null, bar = null, raf = 0;
  const TITLE_OFF = 'Режим «Игра»: компактный лист для игры за столом — без генерации, сохранений, прогрессии и журнала; сверху — ОЗ, пси, удача и состояния';
  const TITLE_ON = 'Режим «Игра» включён — нажмите, чтобы вернуть полный лист (генерация, сохранения, прогрессия)';
  function ensure(){
    const host = document.getElementById('mainTabBar');
    if(host && !btn){
      btn = document.createElement('button'); btn.type = 'button'; btn.id = 'btnPlayMode'; btn.className = 'play-toggle'; btn.innerHTML = D20;
      btn.addEventListener('click', ()=>set(!on));
      let tail = host.querySelector('.tab-tail');
      if(!tail){ tail = document.createElement('span'); tail.className = 'tab-tail'; host.appendChild(tail); }
      const chzh = host.querySelector('.chzh-btn'); tail.insertBefore(btn, tail.firstChild); if(chzh) tail.appendChild(chzh);
      // Телефон: группа (тема, d20, ЧЗХ) — в шапку справа от названия, вкладки остаются лентой (styles/11-phone-header.css)
      const phone = window.matchMedia ? window.matchMedia('(max-width:600px)') : null;
      const place = ()=>{ const top = document.querySelector('.topbar'); const dest = phone && phone.matches && top ? top : host; if(tail.parentElement!==dest) dest.appendChild(tail); };
      place(); if(phone){ if(phone.addEventListener) phone.addEventListener('change', place); else if(phone.addListener) phone.addListener(place); }
    }
    const view = document.getElementById('sheetTabView');
    if(view && !bar){
      bar = document.createElement('div'); bar.id = 'playBar'; bar.className = 'play-bar'; view.insertBefore(bar, view.firstChild);
      bar.addEventListener('click', onBar);
    }
  }
  function paint(){
    if(!btn) return;
    btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', on ? 'true' : 'false'); btn.title = on ? TITLE_ON : TITLE_OFF;
    document.body.classList.toggle('play-mode', on);
  }
  function set(v, quiet){
    v = !!v; if(v===on && btn) { paint(); return; }
    on = v; try{ localStorage.setItem(KEY, on ? '1' : '0'); }catch(e){}
    ensure(); paint(); render();
    if(btn){ btn.classList.remove('spin'); void btn.offsetWidth; btn.classList.add('spin'); setTimeout(()=>btn && btn.classList.remove('spin'), 650); }
    if(on && typeof MAIN_TABS!=='undefined' && document.getElementById('sheetTabView').style.display==='none' && typeof toggleMainTab==='function') toggleMainTab('sheet');
    if(!quiet && typeof uiToast==='function') uiToast(on ? 'Режим «Игра»: компактный лист' : 'Полный лист: генерация, сохранения, прогрессия', {icon:on ? '⚄' : '☰'});
  }
  const esc = (x)=>String(x==null ? '' : x).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const STATES = [['stBodrost', 'bodrost', 'бодрость'], ['stIspug', 'ispug', 'испуг'], ['stIstoshenie', 'istoshenie', 'истощение'], ['stStress', 'stress', 'стресс']];
  function render(){
    raf = 0; ensure(); if(!bar) return;
    const c = typeof character!=='undefined' ? character : null;
    bar.classList.toggle('has-char', !!c);
    if(!on || !c){ bar.innerHTML = ''; return; }
    let hm = 0, pm = 0; try{ hm = hpMax(c); pm = psiMax(c); }catch(e){}
    const name = (document.getElementById('fName').value || '').trim() || 'Персонаж';
    const metric = (k, lbl, val, max, title)=>`<div class="pb-metric" data-k="${k}" title="${title}"><span class="pb-lbl">${lbl}</span><button type="button" data-d="-1" title="${lbl} −1">−</button><b class="${max && val <= Math.floor(max/3) ? 'low' : ''}">${val}${max ? '/' + max : ''}</b><button type="button" data-d="1" title="${lbl} +1">+</button></div>`;
    bar.innerHTML = `<div class="pb-name">${esc(name)}<small>ур. ${c.level}</small></div>` +
      metric('hp', 'ОЗ', c.hpCurrent, hm, 'Здоровье: −/+ по одному, точное число — в поле «Самочувствие»') +
      metric('psi', 'Пси', c.psiCurrent, pm, 'Пси-запас') +
      metric('luck', 'Удача', c.luck, 0, 'Удача: тратится на переброс') +
      `<div class="pb-states">${STATES.map(([id, k, lbl])=>`<button type="button" class="${c.states && c.states[k] ? 'on' : ''}" data-st="${id}" title="Состояние «${lbl}» — включить/выключить">${lbl}</button>`).join('')}</div>`;
  }
  function onBar(e){
    const c = typeof character!=='undefined' ? character : null; if(!c) return;
    const st = e.target.closest('[data-st]');
    if(st){ const cb = document.getElementById(st.dataset.st); if(cb && !cb.disabled){ cb.checked = !cb.checked; cb.dispatchEvent(new Event('change', {bubbles:true})); } return; }
    const b = e.target.closest('[data-d]'); if(!b) return;
    const k = b.closest('[data-k]').dataset.k, d = +b.dataset.d;
    if(k==='hp'){ const before = c.hpCurrent, after = clampLower(before + d, hpMax(c)); if(after!==before){ c.hpCurrent = after; logEvent(c, `Здоровье: ${before} → ${after}.`); } }
    else if(k==='psi'){ const before = c.psiCurrent, after = clampLower(before + d, psiMax(c)); if(after!==before){ c.psiCurrent = after; logEvent(c, `Пси-запас: ${before} → ${after}.`); } }
    else if(k==='luck'){ const before = c.luck, after = Math.max(0, before + d); if(after!==before){ c.luck = after; logEvent(c, `Удача изменена: ${before} → ${after}.`); } }
    renderAll();
  }
  function schedule(){ if(!raf) raf = requestAnimationFrame(render); }
  function init(){ ensure(); paint(); render(); }
  return { init, set, schedule, render, get on(){ return on; } };
})();
try{ PlayMode.init(); }catch(e){ console.error('[Режим «Игра»] не удалось запустить', e); }
