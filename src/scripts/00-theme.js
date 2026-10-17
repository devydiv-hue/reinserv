/* ======================================================================
   ТЕМА ОФОРМЛЕНИЯ — «светлая» (пергамент), «тёмная» (обсидиан) или «как в системе». Ставится атрибутом
   data-theme на <html> ещё в <head>, до отрисовки страницы — без вспышки светлой темы. Стили тёмной темы —
   styles/10-theme-dark.css. Переключатели: круглая кнопка с луной рядом с d20 (светлая ⇄ тёмная) и пункт
   «🌗 Тема» в меню «ЧЗХ❓❓❓» (по кругу: светлая → тёмная → как в системе). Выбор запоминается в браузере.
   Намеренно старый синтаксис (как у аварийной плашки выше): блок выполняется раньше основного скрипта.
   ====================================================================== */
var Theme = (function(){
  var KEY = 'reincarnator_theme_v1', mode = 'light';
  try{ mode = localStorage.getItem(KEY) || 'light'; }catch(e){}
  if(mode!=='light' && mode!=='dark' && mode!=='auto') mode = 'light';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var LABELS = {light:'светлая', dark:'тёмная', auto:'как в системе'};
  var MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  function effective(){ return mode==='auto' ? (mq && mq.matches ? 'dark' : 'light') : mode; }
  function apply(){
    var t = effective();
    document.documentElement.setAttribute('data-theme', t);
    var b = document.getElementById('btnTheme');
    if(b){
      b.className = 'theme-toggle' + (t==='dark' ? ' on' : '');
      b.setAttribute('aria-pressed', t==='dark' ? 'true' : 'false');
      b.title = (t==='dark' ? 'Тёмная тема включена — нажмите, чтобы вернуть светлую (пергамент)' : 'Тёмная тема: тёмные разделы листа и светлый текст — для вечерней игры') +
        (mode==='auto' ? ' · сейчас «как в системе»' : '') + '. «Как в системе» — в меню «ЧЗХ❓❓❓»';
    }
  }
  function set(m){ mode = LABELS[m] ? m : 'light'; try{ localStorage.setItem(KEY, mode); }catch(e){} apply(); return mode; }
  function cycle(){ return set(mode==='light' ? 'dark' : mode==='dark' ? 'auto' : 'light'); }
  function toggle(){ return set(effective()==='dark' ? 'light' : 'dark'); }
  if(mq){ var onSys = function(){ if(mode==='auto') apply(); }; if(mq.addEventListener) mq.addEventListener('change', onSys); else if(mq.addListener) mq.addListener(onSys); }
  apply();
  // Кнопка — в группе справа от вкладок (её создаёт модуль режима «Игра»); основные скрипты к этому моменту уже выполнены
  function mount(){
    if(document.getElementById('btnTheme')) return;
    var tail = document.querySelector('.tab-tail'); if(!tail) return;
    var b = document.createElement('button'); b.type = 'button'; b.id = 'btnTheme'; b.innerHTML = MOON;
    b.addEventListener('click', function(){ var t = toggle(); if(window.uiToast) window.uiToast(t==='dark' ? 'Тёмная тема' : 'Светлая тема', {icon:t==='dark' ? '☾' : '☀'}); });
    tail.insertBefore(b, tail.firstChild); apply();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', mount); else setTimeout(mount, 0);
  return { set: set, cycle: cycle, toggle: toggle, mount: mount, label: function(){ return LABELS[mode]; }, get mode(){ return mode; }, get dark(){ return effective()==='dark'; } };
})();
