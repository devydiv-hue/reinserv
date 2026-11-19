/* ======================================================================
   КАВАЛЕРИЯ — ЖУРНАЛ БРОСКОВ: справа на широком экране, вкладкой на телефоне. Запись — заголовок, крупное число,
   вердикт; подробности раскрываются по нажатию. Чужие броски за столом приходят сюда же (см. стол).
   ====================================================================== */
const Log = (function(){
  let root = null, filter = 'all';
  const esc = kvEsc;
  const time = (t)=>new Date(t).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'});
  function entry(e){
    return `<details class="kv-entry tone-${e.tone || 'info'}${e.secret ? ' secret' : ''}"><summary><span class="kv-entry-big">${esc(e.big!=null && e.big!=='' ? e.big : '•')}</span>
      <span class="kv-entry-main"><b>${esc(e.title)}</b><span>${esc(e.verdict || '')}</span></span><span class="kv-entry-meta">${e.who ? esc(e.who) + '<br>' : ''}${time(e.t)}</span></summary>
      ${(e.lines || []).map(l=>`<div class="kv-entry-l">${esc(l)}</div>`).join('')}</details>`;
  }
  function render(){
    if(!root) return;
    const list = Rolls.log.slice(-120).reverse().filter(e=>filter==='all' || (filter==='me' ? !e.remote : e.remote));
    root.querySelector('.kv-log-list').innerHTML = list.map(entry).join('') || '<div class="kv-empty">Бросков пока не было</div>';
  }
  function mount(el){
    root = el;
    root.innerHTML = `<div class="kv-log-head"><b>Журнал</b><span class="kv-chips2" data-logf="1"><button type="button" class="kv-chip on" data-lf="all">все</button><button type="button" class="kv-chip" data-lf="me">мои</button><button type="button" class="kv-chip" data-lf="them">стол</button></span>
      <button type="button" class="kv-btn kv-sm" data-a="tables" title="Таблицы книги и свободный бросок">⚄ Броски</button><button type="button" class="kv-x" data-a="clear" title="Очистить журнал">🗑</button></div>
      <div class="kv-log-list" aria-live="polite"></div>`;
    root.addEventListener('click', (e)=>{
      const f = e.target.closest('[data-lf]'); if(f){ filter = f.dataset.lf; root.querySelectorAll('[data-lf]').forEach(x=>x.classList.toggle('on', x===f)); render(); return; }
      const b = e.target.closest('[data-a]'); if(!b) return;
      if(b.dataset.a==='clear' && confirm('Очистить журнал бросков в этом браузере?')) Rolls.clear();
      if(b.dataset.a==='tables') Actions.tablesSheet(Tandem.pilot);
    });
    Rolls.onLog(()=>render());
    render();
  }
  return {mount, render};
})();
