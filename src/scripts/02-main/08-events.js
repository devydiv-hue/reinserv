/* ======================================================================
   EVENTS
   ====================================================================== */
document.getElementById('btnGenerate').onclick = ()=>{
  character = generateCharacter();
  renderAll();
};
/* Ввод с тачпада и касаний. _lastPointerType — тип указателя последнего нажатия (касание / мышь / перо): окна
   с жестом «нажми и тяни» на касаниях работают двумя тапами и показывают кнопки вместо «увести за край».
   IS_TOUCH_UI — основной указатель сенсорный (телефон, планшет): тексты подсказок про пальцы, а не мышь.
   wheelIntent — что делать с прокруткой на столе и в редакторе карт: щипок тачпада (браузер шлёт его как
   Ctrl+колесо) и колесо мыши — масштаб, прокрутка двумя пальцами — сдвиг поля. Мышь от тачпада браузер
   различает не всегда, поэтому есть переключатель «авто / мышь / тачпад» (кнопка у масштаба). */
let _lastPointerType = 'mouse';
document.addEventListener('pointerdown', (e)=>{ _lastPointerType = e.pointerType || 'mouse'; }, true);
const IS_TOUCH_UI = !!(window.matchMedia && matchMedia('(pointer:coarse)').matches);
const WHEEL_MODE_KEY = 'reincarnator_wheel_mode_v1';
const WHEEL_MODES = {auto:{label:'авто', icon:'⇅', title:'Прокрутка: авто — колесо мыши масштабирует, два пальца тачпада двигают поле'},
  mouse:{label:'мышь', icon:'🖱', title:'Прокрутка: мышь — любая прокрутка масштабирует'},
  touchpad:{label:'тачпад', icon:'▭', title:'Прокрутка: тачпад — два пальца двигают поле, щипок масштабирует'}};
function wheelMode(){ try{ const m = localStorage.getItem(WHEEL_MODE_KEY); return WHEEL_MODES[m] ? m : 'auto'; }catch(e){ return 'auto'; } }
let _touchpadTs = 0;
function wheelIntent(e){
  if(e.ctrlKey || e.metaKey) return 'zoom';           // щипок тачпада и Ctrl+колесо — всегда масштаб
  const m = wheelMode();
  if(m==='mouse') return 'zoom';
  if(m==='touchpad') return 'pan';
  if(e.deltaMode!==0) return 'zoom';                  // построчная прокрутка — это колесо мыши
  const now = Date.now();
  if(e.deltaX!==0 || Math.abs(e.deltaY) < 20 || now - _touchpadTs < 350){ _touchpadTs = now; return 'pan'; } // два пальца: мелкие шаги и/или горизонталь
  return 'zoom';
}
// Старые браузеры (Chrome на Windows 7) меняют число в поле, над которым крутят колесо, пока поле в фокусе:
// игрок «листает» лист — а уменьшается Размер, Опыт или Удача. Снимаем фокус — колесо прокручивает страницу.
document.addEventListener('wheel', (e)=>{ const t = e.target; if(t && t.type==='number' && t===document.activeElement) t.blur(); }, {passive:true});
function wheelModeButtonHtml(cls){ const m = WHEEL_MODES[wheelMode()]; return `<button type="button" class="${cls}" data-wheelmode title="${m.title} · нажмите, чтобы сменить">${m.icon}<span class="wm-lbl"> ${m.label}</span></button>`; }
document.addEventListener('click', (e)=>{
  const b = e.target.closest && e.target.closest('[data-wheelmode]'); if(!b) return;
  const ks = Object.keys(WHEEL_MODES), next = ks[(ks.indexOf(wheelMode()) + 1) % ks.length];
  try{ localStorage.setItem(WHEEL_MODE_KEY, next); }catch(err){}
  document.querySelectorAll('[data-wheelmode]').forEach(x=>{ const m = WHEEL_MODES[next]; x.innerHTML = `${m.icon}<span class="wm-lbl"> ${m.label}</span>`; x.title = m.title + ' · нажмите, чтобы сменить'; x.removeAttribute('data-tip'); });
});
// Режим генерации — выбор из меню (раньше был круг из трёх, и до «ручного» из «случайного» нужно было нажать
// дважды), запоминается в браузере, чтобы не сбрасываться в «случайный» при обновлении страницы.
const GEN_MODES = {
  random:   {label:'🎲 Режим: случайный',  title:'Всё случайно, кроме выборов «в зависимости от отыгрыша» — их делает игрок', rm:true,  rr:false},
  random2:  {label:'🎲 Режим: случайный⚡', title:'Всё случайно, включая выборы «в зависимости от отыгрыша»', rm:true,  rr:true},
  manual:   {label:'✋ Режим: ручной',      title:'Все выборы делает игрок — при создании и при повышении уровня', rm:false, rr:false}
};
function currentGenMode(){ return !randomMode ? 'manual' : roleplayRandom ? 'random2' : 'random'; }
function setGenMode(k){
  const m = GEN_MODES[k] || GEN_MODES.random;
  randomMode = m.rm; roleplayRandom = m.rr;
  const b = document.getElementById('btnMode'); b.textContent = m.label + ' ▾'; b.title = m.title + ' · нажмите, чтобы выбрать режим';
  try{ localStorage.setItem(GEN_MODE_KEY, k); }catch(e){}
}
document.getElementById('btnMode').onclick = (e)=>{
  e.stopPropagation();
  let menu = document.getElementById('genModeMenu');
  if(menu){ menu.remove(); return; }
  const b = e.currentTarget, r = b.getBoundingClientRect();
  menu = document.createElement('div'); menu.id = 'genModeMenu'; menu.className = 'gen-mode-menu';
  menu.innerHTML = Object.keys(GEN_MODES).map(k=>`<button type="button" data-k="${k}" class="${k===currentGenMode() ? 'on' : ''}"><b>${GEN_MODES[k].label.replace('Режим: ', '')}</b><span>${GEN_MODES[k].title}</span></button>`).join('');
  document.body.appendChild(menu);
  menu.style.left = Math.max(6, Math.min(r.left, window.innerWidth - menu.offsetWidth - 6)) + 'px';
  menu.style.top = (r.bottom + window.scrollY + 4) + 'px';
  menu.onclick = (ev)=>{ const x = ev.target.closest('[data-k]'); if(!x) return; setGenMode(x.dataset.k); menu.remove(); };
  setTimeout(()=>document.addEventListener('click', function close(ev){ if(!menu.contains(ev.target)){ menu.remove(); document.removeEventListener('click', close); } }), 0);
};
(function(){ let k = 'random'; try{ k = localStorage.getItem(GEN_MODE_KEY) || 'random'; }catch(e){} setGenMode(k); })();
document.getElementById('btnReset').onclick = ()=>{
  character = null; pendingRoleplayChoices=[]; pendingChoices=[]; pendingItemRolls=[];
  document.getElementById('fName').value=''; document.getElementById('fPlayer').value='';
  document.getElementById('fAge').value=AGE_BRACKETS.y20_29.label;
  document.getElementById('fLevel').value='1';
  document.getElementById('fHugeCapacity').value='';
  setFieldKeyValue('fSubtypeSelect', '', '');
  setFieldKeyValue('fCareerSelect', '', ''); refreshOriginOptions();
  document.getElementById('fAlignment').value='';
  ['fLevelLock','fArchetypeLock','fSubtypeLock','fOriginLock','fCareerLock','fAgeLock','fAlignmentLock'].forEach(id=>{
    document.getElementById(id).checked = false;
  });
  renderAll();
};
document.getElementById('btnUndo').onclick = performUndo;

