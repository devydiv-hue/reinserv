/* ======================================================================
   КАВАЛЕРИЯ — СТРАНИЦА: шапка (тандем, «Новый Спектр», меню), панель над листом (Игра/Правка, «В Утробе»,
   сложность и режим к20, броски), вкладки на телефоне (Спектр / Катафракт / Журнал), настройки браузера
   (reincarnator_kava_app_v1: анимация, свёрнутые блоки, последний МОБ цели, распределение экипировки).
   Сложность по умолчанию равна Испытанию Удачи текущего Спектра; режим к20 действует на один бросок.
   ====================================================================== */
const App = (function(){
  const PREF = 'reincarnator_kava_app_v1';
  let prefs = {anim:true, folds:{}, mode:'play', tab:'p'};
  try{ prefs = Object.assign(prefs, JSON.parse(localStorage.getItem(PREF) || '{}')); }catch(e){}
  const savePrefs = ()=>{ try{ localStorage.setItem(PREF, JSON.stringify(prefs)); }catch(e){} };
  const $ = (s)=>document.querySelector(s);
  let rollMode = 'norm', dcOverride = null;

  const pref = (k, v)=>{ if(v===undefined) return prefs[k]; prefs[k] = v; savePrefs(); return v; };
  const folded = (k)=>!!(prefs.folds || {})[k];
  const fold = (k, closed)=>{ prefs.folds = prefs.folds || {}; prefs.folds[k] = closed; savePrefs(); };
  const p = ()=>Tandem.pilot;
  const dc = ()=>dcOverride!=null ? dcOverride : Pilot.luck(p());
  const mode = ()=>rollMode;
  function setMode(m){ rollMode = m; document.querySelectorAll('[data-rm]').forEach(b=>b.classList.toggle('on', b.dataset.rm===m)); }
  const useMode = ()=>{ const m = rollMode; setMode('norm'); return m; };

  function names(){
    const sel = $('#kvPilotSel'), cur = p();
    sel.innerHTML = Pilot.all().map(x=>`<option value="${x.id}"${cur && x.id===cur.id ? ' selected' : ''}>${kvEsc(x.name || 'Безымянный Спектр')}${x.mech && x.mech.name ? ' · ' + kvEsc(x.mech.name) : ''}</option>`).join('');
    document.title = (cur && cur.name ? cur.name + ' — ' : '') + 'Кавалерия';
  }
  // обновить панель над листом (после перерисовки листа)
  function refresh(){
    const x = p(); if(!x) return;
    const dcEl = $('#kvDc'); if(dcEl && document.activeElement!==dcEl) dcEl.value = dc();
    $('#kvDcReset').hidden = dcOverride==null;
    const w = $('#kvWomb'); w.classList.toggle('on', !!x.inWomb); w.setAttribute('aria-pressed', x.inWomb ? 'true' : 'false');
    document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('on', b.dataset.mode===Tandem.mode));
  }
  function show(x){ Tandem.render(x); names(); refresh(); if(typeof Table!=='undefined') Table.pilotChanged(); }
  // Летописцу — «Лист» или «Летописец»
  function setView(v){ document.body.classList.toggle('gm-view', v==='gm'); document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('on', b.dataset.view===v)); if(v==='gm') Gm.render(); }
  // бой у игрока: «Лист / Бой» над листом, вкладка «Бой» на телефоне
  function battleChanged(){
    const on = typeof Battle!=='undefined' && Battle.active, gm = typeof Table!=='undefined' && Table.S.role==='gm';
    const bv = $('#kvBView'); if(bv) bv.hidden = !on || gm;
    document.querySelectorAll('.kv-tab-battle').forEach(b=>{ b.hidden = !on || gm; });
    if(!on && document.body.classList.contains('battle-view')) setBView('sheet');
    if(!on && prefs.tab==='battle') setTab('p');
  }
  function setBView(v){ document.body.classList.toggle('battle-view', v==='battle'); document.querySelectorAll('[data-bview]').forEach(b=>b.classList.toggle('on', b.dataset.bview===v)); }
  function setTab(t){ prefs.tab = t; savePrefs(); document.body.dataset.tab = t; document.querySelectorAll('[data-tab-btn]').forEach(b=>b.classList.toggle('on', b.dataset.tabBtn===t)); }

  function exportPilot(){
    const x = p(); if(!x) return;
    const blob = new Blob([JSON.stringify({format:'kavaleria-pilot', version:2, pilot:x}, null, 2)], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (x.name || 'spectr').replace(/[\\/:*?"<>|]+/g, '_') + '.kavaleria.json';
    document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function importPilot(file){
    const r = new FileReader();
    r.onload = ()=>{ try{
      const j = JSON.parse(r.result), src = j && j.format==='kavaleria-pilot' ? j.pilot : j;
      if(!src || typeof src!=='object' || !src.stats) throw new Error('это не файл пилота Кавалерии');
      const x = Pilot.fix(Object.assign({}, src, {id:Pilot.uid(), created:new Date().toISOString()})); Pilot.add(x); show(x); UI.toast('Загружен: ' + (x.name || 'Спектр'), 'ok');
    }catch(e){ UI.toast('Не удалось загрузить: ' + e.message, 'fail'); } };
    r.readAsText(file);
  }
  function menu(){
    UI.sheet({title:'Тандем и настройки', html:`<div class="kv-act-grid">
      <button type="button" class="kv-act" data-a="blank"><b>Пустой лист</b><span>новый тандем без бросков</span></button>
      <button type="button" class="kv-act" data-a="export"><b>Сохранить в файл</b><span>.kavaleria.json</span></button>
      <button type="button" class="kv-act" data-a="import"><b>Загрузить из файла</b><span>новым тандемом</span></button>
      <button type="button" class="kv-act" data-a="anim"><b>Анимация костей: ${prefs.anim!==false ? 'вкл' : 'выкл'}</b><span>3D-кости и перегрев</span></button>
      <button type="button" class="kv-act" data-a="epic"><b>Эпичные сцены: ${prefs.epic!==false ? 'вкл' : 'выкл'}</b><span>20, 1, взрыв реактора, коллапс</span></button>
      <button type="button" class="kv-act kv-danger" data-a="delete"><b>Удалить тандем</b><span>из этого браузера</span></button></div>`,
      onAction(a, btn, close){
        if(a==='blank'){ close(); show(Pilot.add(Pilot.starter())); }
        if(a==='export'){ close(); exportPilot(); }
        if(a==='import'){ close(); $('#kvImport').click(); }
        if(a==='epic'){ prefs.epic = prefs.epic===false; savePrefs(); close(); UI.toast('Эпичные сцены ' + (prefs.epic ? 'включены' : 'выключены')); }
        if(a==='anim'){ prefs.anim = prefs.anim===false; savePrefs(); close(); UI.toast('Анимация ' + (prefs.anim ? 'включена' : 'выключена')); }
        if(a==='delete'){ const x = p(); if(x && confirm(`Удалить «${x.name || 'Безымянный Спектр'}» и его Катафракт из этого браузера? Файл экспорта это не затронет.`)){ close(); show(Pilot.remove(x.id)); } }
      }});
  }
  function newTandem(){
    UI.sheet({title:'Новый Спектр', html:`<div class="kv-act-grid">
      <button type="button" class="kv-act on" data-a="wizard"><b>По шагам книги</b><span>характеристики, происхождение, становление, экипировка, личность — броски с анимацией</span></button>
      <button type="button" class="kv-act" data-a="blank"><b>Пустой лист</b><span>заполнить вручную в «Правке»</span></button></div>`,
      onAction(a, btn, close){ close(); if(a==='wizard') Wizard.pilot(p(), {fresh:true}); else { show(Pilot.add(Pilot.starter())); Tandem.setMode('edit'); } }});
  }
  function init(){
    Tandem.mount($('#kvTandem'));
    Log.mount($('#kvLog'));
    if(prefs.mode==='edit') Tandem.setMode('edit');
    show(Pilot.current());
    setTab(prefs.tab || 'p');
    $('#kvPilotSel').addEventListener('change', (e)=>show(Pilot.setCurrent(e.target.value)));
    $('#kvNew').addEventListener('click', newTandem);
    $('#kvMenu').addEventListener('click', menu);
    $('#kvImport').addEventListener('change', (e)=>{ const f = e.target.files && e.target.files[0]; if(f) importPilot(f); e.target.value = ''; });
    document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click', ()=>{ prefs.mode = b.dataset.mode; savePrefs(); Tandem.setMode(b.dataset.mode); }));
    document.querySelectorAll('[data-rm]').forEach(b=>b.addEventListener('click', ()=>setMode(b.dataset.rm===rollMode && b.dataset.rm!=='norm' ? 'norm' : b.dataset.rm)));
    document.querySelectorAll('[data-tab-btn]').forEach(b=>b.addEventListener('click', ()=>setTab(b.dataset.tabBtn)));
    $('#kvWomb').addEventListener('click', ()=>{ const x = p(); x.inWomb = !x.inWomb; Pilot.save(); Tandem.render(); UI.toast(x.inWomb ? 'Спектр в Утробе: бой — Катафрактом' : 'Спектр вне Утробы'); if(typeof Table!=='undefined') Table.pilotChanged(); });
    $('#kvDc').addEventListener('input', (e)=>{ dcOverride = e.target.value==='' ? null : Pilot.int(e.target.value, 13); refresh(); });
    $('#kvDcReset').addEventListener('click', ()=>{ dcOverride = null; refresh(); });
    $('#kvTables').addEventListener('click', ()=>Actions.tablesSheet(p()));
    try{ localStorage.setItem('reincarnator_last_system_v1', 'kava'); }catch(e){}
    if('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) window.addEventListener('load', ()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
    // стол и экран Летописца
    TableUI.init(); Gm.mount($('#kvGm')); Battle.mount($('#kvBattle'));
    document.querySelectorAll('[data-bview]').forEach(b=>b.addEventListener('click', ()=>setBView(b.dataset.bview)));
    document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click', ()=>setView(b.dataset.view)));
    Table.onChange((S)=>{ if(S.role!=='gm' && document.body.classList.contains('gm-view')) setView('sheet'); battleChanged(); });
    Table.init(); Battle.init(); battleChanged();
  }
  return {init, names, refresh, show, pref, folded, fold, dc, mode, setMode, useMode, battleChanged};
})();
document.addEventListener('DOMContentLoaded', App.init);
