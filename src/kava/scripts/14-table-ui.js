/* ======================================================================
   КАВАЛЕРИЯ — СТОЛ В ИНТЕРФЕЙСЕ: кнопка в шапке (состояние, код, сколько за столом), окно стола (создать стол
   Летописцем, войти по ссылке, скопировать ссылку, кто за столом, ссылка на Телемост, выйти), кнопка «Телемост»
   у всех, когда Летописец её задал (открывает встречу отдельным окном — встроить Телемост в страницу Яндекс не даёт).
   Летописцу — переключатель «Лист / Летописец» над листом.
   ====================================================================== */
const TableUI = (function(){
  const esc = kvEsc;
  const STATUS = {off:'не за столом', connecting:'подключение…', reconnecting:'связь восстанавливается…', on:'за столом', denied:'стол занят другим Летописцем'};
  function slot(){
    const S = Table.S, el = document.getElementById('kvTableSlot'); if(!el) return;
    const n = Object.keys(S.peers).length + (S.role ? 1 : 0);
    el.innerHTML = `<button type="button" class="kv-btn kv-table-btn ${S.status}" data-t="open" title="Стол: подключение, ссылка для игроков, Телемост">${S.role ? `<span class="kv-dotc"></span>${S.role==='gm' ? 'Летописец' : 'Стол'} «${esc(S.code)}» · ${n}` : 'Стол'}</button>
      ${S.telemost ? `<button type="button" class="kv-btn kv-tm" data-t="tm" title="Открыть встречу в Телемосте отдельным окном">Телемост ↗</button>` : ''}`;
    document.body.classList.toggle('is-gm', S.role==='gm');
    const v = document.getElementById('kvView'); if(v) v.hidden = S.role!=='gm';
    const room = document.getElementById('kvRoom');
    if(room){ const show = S.role && S.status!=='on'; room.hidden = !show; if(show) room.textContent = 'Стол «' + S.code + '»: ' + STATUS[S.status]; }
  }
  function openTelemost(){ const u = Table.S.telemost; if(!/^https:\/\//.test(u)) return; window.open(u, 'kava-telemost', 'width=1100,height=760,noopener'); }
  function sheet(){
    const S = Table.S, peers = Object.entries(S.peers);
    if(!S.role){
      UI.sheet({title:'Стол', sub:'игра вместе: броски видны всем, Летописец видит тандемы', html:`
        <div class="kv-act-grid"><button type="button" class="kv-act on" data-a="create"><b>Я — Летописец</b><span>создать стол и получить ссылку для игроков</span></button></div>
        <div class="kv-sheet-grid"><label class="kv-stepper kv-grow2"><span>Ссылка или код стола от Летописца</span><input name="code" placeholder="https://…/kava/k7m2qx" value="${esc(S.code)}"></label><button type="button" class="kv-btn kv-primary" data-a="join">Сесть за стол</button></div>
        ${S.code && Table.ownsTable(S.code) ? `<button type="button" class="kv-btn" data-a="regm">Вернуться Летописцем за «${esc(S.code)}»</button>` : ''}`,
        onAction(a, btn, close, panel){
          if(a==='create'){ close(); Table.create(); }
          if(a==='join'){ const v = panel.querySelector('[name=code]').value; close(); Table.joinCode(v); }
          if(a==='regm'){ close(); Table.connect('gm'); }
        }});
      return;
    }
    UI.sheet({title:`Стол «${S.code}»`, sub:STATUS[S.status] + (S.role==='gm' ? ' · вы Летописец' : S.gmId ? ' · Летописец: ' + S.gmName : ' · Летописца пока нет'), html:`
      <div class="kv-sheet-grid"><label class="kv-stepper kv-grow2"><span>Ссылка для игроков</span><input readonly value="${esc(Table.link())}"></label><button type="button" class="kv-btn kv-primary" data-a="copy">Копировать</button></div>
      <div class="kv-fe kv-wide"><span>За столом</span>${peers.length ? `<ul class="kv-list2">${peers.map(([id, x])=>`<li>${esc(x.name || 'Игрок')}${x.role==='gm' ? ' — Летописец' : x.pilot && x.pilot.mech && x.pilot.mech.name ? ' · ' + esc(x.pilot.mech.name) : ''}</li>`).join('')}</ul>` : '<div class="kv-empty">Пока никого — отправьте ссылку</div>'}</div>
      ${S.role==='player' && S.lance && S.lance.res ? `<div class="kv-fe kv-wide"><span>Копьё${S.lance.name ? ' «' + esc(S.lance.name) + '»' : ''}</span><div class="kv-p">${[['supplies', 'Запасы'], ['batteries', 'Батареи'], ['materials', 'Материалы'], ['wealth', 'Богатства'], ['people', 'Люди'], ['fame', 'Слава']].map(([k, n])=>`${n} <b>${Pilot.int(S.lance.res[k])}</b>`).join(' · ')}</div>
        ${(S.lance.units || []).length ? `<div class="kv-note">${S.lance.units.map(u=>esc(u.name) + ' (СТК ' + Pilot.int(u.stk) + ')').join(', ')}</div>` : ''}</div>` : ''}
      ${S.role==='gm' ? `<div class="kv-sheet-grid"><label class="kv-stepper kv-grow2"><span>Ваше имя за столом</span><input name="gmname" value="${esc(App.pref('gmName') || 'Летописец')}"></label></div>
        <div class="kv-sheet-grid"><label class="kv-stepper kv-grow2"><span>Ссылка на встречу в Телемосте (у игроков появится кнопка)</span><input name="tm" placeholder="https://telemost.yandex.ru/j/…" value="${esc(S.telemost)}"></label><button type="button" class="kv-btn" data-a="tm">Сохранить</button></div>` : ''}
      <div class="kv-sheet-btns"><button type="button" class="kv-btn" data-a="leave">Выйти из-за стола</button>${S.telemost ? '<button type="button" class="kv-btn kv-grow2" data-a="open-tm">Открыть Телемост ↗</button>' : ''}</div>`,
      onAction(a, btn, close, panel){
        if(a==='copy'){ const t = Table.link(); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(()=>UI.toast('Ссылка скопирована', 'ok'), ()=>{ panel.querySelector('input').select(); document.execCommand('copy'); UI.toast('Ссылка скопирована', 'ok'); }); }
        if(a==='tm'){ const u = panel.querySelector('[name=tm]').value.trim(); if(u && !/^https:\/\/telemost\.(360\.)?yandex\.(ru|com)\//.test(u) && !confirm('Это не похоже на ссылку Телемоста. Сохранить всё равно?')) return; App.pref('gmName', panel.querySelector('[name=gmname]').value.trim() || 'Летописец'); Table.setTelemost(u); UI.toast(u ? 'Ссылка на Телемост у игроков' : 'Ссылка на Телемост убрана', 'ok'); }
        if(a==='open-tm') openTelemost();
        if(a==='leave' && confirm('Выйти из-за стола? Лист останется в этом браузере.')){ close(); Table.leave(); history.replaceState(null, '', '/kava/'); }
      }});
  }
  function joinPrompt(){
    if(Table.S.role) return;
    UI.sheet({title:`Стол «${Table.S.code}»`, sub:'вас пригласили за стол Кавалерии', html:`<p class="kv-p">Выберите или создайте своего Спектра — Летописец увидит ваш тандем, а броски будут видны всем.</p>
      <div class="kv-sheet-btns"><button type="button" class="kv-btn" data-a="close">Позже</button><button type="button" class="kv-btn kv-primary kv-grow2" data-a="join" autofocus>Сесть за стол</button></div>`,
      onAction(a, btn, close){ close(); Table.connect('player'); }});
  }
  function init(){
    document.addEventListener('click', (e)=>{ const b = e.target.closest('[data-t]'); if(!b) return; if(b.dataset.t==='open') sheet(); if(b.dataset.t==='tm') openTelemost(); });
    Table.onChange(slot); slot();
  }
  return {init, sheet, joinPrompt, slot};
})();
