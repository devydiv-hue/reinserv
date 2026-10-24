/* ======================================================================
   ЭКРАН МАСТЕРА — капля (по умолчанию справа; кубы — слева) и выезжающая панель в стиле панели бросков; приближение
   курсора открывает, ✥ — перетаскивать к любому краю, булавка — «ползание» капель (общий механизм BlobDock). Вкладки:
   «Игроки» — ОЗ, пси, удача и состояния всех подключённых игроков, 🍀+1, лист, находка, найти на столе;
   «Сцены» — сохранить стол (карта, жетоны NPC, рисунки + по желанию звук) и включить одной кнопкой во время игры;
     собрать сцену заранее можно на черновом столе — игроки его не видят, настоящий стол не трогается;
   «Заметки» — заметки Мастера; «Взлом замка 4(14)» становится броском (нажать и протянуть, как в бестиарии),
     «2к6+1» — бросок костей по нажатию. Броски из заметок видны только Мастеру.
   Сцены и заметки хранятся в этом браузере; «⬇/⬆ Подготовка» — перенос файлом на другое устройство.
   ====================================================================== */
const GmScreen = (function(){
  const NOTES_KEY = 'reincarnator_gm_notes_v1', SCENES_KEY = 'reincarnator_gm_scenes_v1', PREF_KEY = 'reincarnator_gm_screen_v1';
  const load = (k, d)=>{ try{ const v = JSON.parse(localStorage.getItem(k) || 'null'); return v==null ? d : v; }catch(e){ return d; } };
  const store = (k, v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ uiAlert('Не удалось сохранить в хранилище браузера: ' + e.message, {icon:'⚠'}); return false; } };
  let prefs = Object.assign({tab:'players', note:''}, load(PREF_KEY, {}));
  let notes = load(NOTES_KEY, []); if(!Array.isArray(notes)) notes = [];
  let scenes = load(SCENES_KEY, []); if(!Array.isArray(scenes)) scenes = [];
  let fab = null, panel = null, body = null, isOpen = false, editing = false, draftOf = null, refreshTimer = 0, dockCtl = null;
  const MOVE_ICON = '<svg viewBox="0 0 24 24"><path d="M12 3.5 V20.5 M3.5 12 H20.5 M9.2 6.3 L12 3.5 L14.8 6.3 M9.2 17.7 L12 20.5 L14.8 17.7 M6.3 9.2 L3.5 12 L6.3 14.8 M17.7 9.2 L20.5 12 L17.7 14.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const PIN_ICON = '<svg viewBox="0 0 24 24"><path d="M9 3.5h6M10 3.5v6.2L6.8 13h10.4L14 9.7V3.5M12 13v7.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const esc = (x)=>String(x==null ? '' : x).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const uidS = ()=>Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const savePrefs = ()=>store(PREF_KEY, prefs);
  const isGmHere = ()=>typeof session==='undefined' || session.role!=='player';
  const GT = ()=>typeof GameTable!=='undefined' ? GameTable : null;
  const SB = ()=>typeof Soundboard!=='undefined' ? Soundboard : null;
  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2.5 6.5 8 4.5v14l-5.5 2z"/><path d="M8 4.5l8 2v14l-8-2z"/><path d="M16 6.5l5.5-2v14l-5.5 2z"/></g><path d="M11 10.5h2M11 13h2" stroke="currentColor" stroke-width="1.4"/></svg>';

  /* ---------- каркас ---------- */
  function build(){
    if(fab) return;
    fab = document.createElement('button'); fab.type = 'button'; fab.id = 'gmFab'; fab.className = 'gm-fab';
    fab.title = 'Экран Мастера: игроки, сцены, заметки';
    fab.innerHTML = `<span class="blob"><span class="blob-icon">${ICON}</span><span class="blob-sheen"></span></span>`;
    fab.addEventListener('click', ()=>{ if(dockCtl && dockCtl.consumeClick()) return; holdClosed = false; toggle(); });
    document.body.appendChild(fab);
    panel = document.createElement('div'); panel.id = 'gmScreen'; panel.className = 'gm-screen'; panel.setAttribute('role', 'dialog');
    panel.innerHTML = `<button type="button" class="gs-close" title="Закрыть (Esc)">✕</button>
      <button type="button" class="gs-dock-btn gs-move" aria-pressed="false" aria-label="Перемещать экран Мастера по краям экрана">${MOVE_ICON}</button>
      <button type="button" class="gs-dock-btn gs-pin" aria-pressed="true" aria-label="Булавка: капли на месте или медленно ползут по краям экрана">${PIN_ICON}</button>
      <div class="gs-title">Экран Мастера</div>
      <div class="gs-tabs"><button type="button" data-tab="players">Игроки</button><button type="button" data-tab="scenes">Сцены</button><button type="button" data-tab="notes">Заметки</button><button type="button" data-tab="reactions">Реакции</button><button type="button" data-tab="epic" title="Эпичные броски: сцена на весь экран у всех за столом">Эпичные</button><button type="button" data-tab="chron" title="Летопись сессии: броски, бои, «повержен», выдачи, ваши записи">Летопись</button></div>
      <div class="gs-body"></div>`;
    document.body.appendChild(panel);
    body = panel.querySelector('.gs-body');
    panel.querySelector('.gs-close').addEventListener('click', close);
    panel.querySelector('.gs-tabs').addEventListener('click', (e)=>{ const b = e.target.closest('[data-tab]'); if(b) setTab(b.dataset.tab); });
    panel.addEventListener('click', onClick);
    panel.addEventListener('input', onInput);
    document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && isOpen && !document.querySelector('.ui-dlg-back') && !(e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) close(); });
    syncVisible(); setInterval(syncVisible, 1500);
    // Как у кубов: перетаскивание к любому краю (✥), булавка — «ползание» капель (общий механизм BlobDock)
    dockCtl = BlobDock.create({ key:'reincarnator_gm_dock_v1', fab, panel, edge:'right', pos:0.4, unrotVar:'--gm-unrot',
      isOpen:()=>isOpen, dragExclude:'button, input, textarea, select, a, .gs-body',
      moveBtn:panel.querySelector('.gs-move'), pinBtn:panel.querySelector('.gs-pin'),
      moveTitle:(on)=>'Перемещать экран Мастера по краям экрана: ' + (on ? 'включено — тяните панель за заголовок или саму каплю к любому краю' : 'выключено') });
    window.addEventListener('mousemove', onProximity, {passive:true});
  }
  // Открытие приближением мыши (как у кубов): курсор в круге вокруг капли — панель выезжает; ушёл дальше от панели
  // и капли — через короткую паузу уезжает. Не закрывается, пока в панели печатают, открыто окно или бросок, идёт обучение.
  // После закрытия вручную (✕, Esc) — не открывается снова, пока курсор не отойдёт от капли.
  const OPEN_R = 130, CLOSE_MARGIN = 60, CLOSE_DELAY = 400;
  let closeTimer = 0, holdClosed = false;
  const inRect = (x, y, r, m)=>x >= r.left - m && x <= r.right + m && y >= r.top - m && y <= r.bottom + m;
  function keepOpen(){
    const ae = document.activeElement;
    return (panel.contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) || !!document.querySelector('.ui-dlg-back, .roll-overlay') ||
      (typeof Onboarding!=='undefined' && Onboarding.busy());
  }
  function onProximity(e){
    if(!fab || fab.style.display==='none' || (dockCtl && dockCtl.dragging)) return;
    if(e.clientX >= document.documentElement.clientWidth) return; // курсор на полосе прокрутки
    const x = e.clientX, y = e.clientY, r = fab.getBoundingClientRect(), d = Math.hypot(x - (r.left + r.width/2), y - (r.top + r.height/2));
    if(!isOpen){ if(holdClosed){ if(d > OPEN_R*1.6) holdClosed = false; return; } if(d <= OPEN_R) open(); return; }
    const near = inRect(x, y, panel.getBoundingClientRect(), CLOSE_MARGIN) || inRect(x, y, r, CLOSE_MARGIN);
    if(near || keepOpen()){ clearTimeout(closeTimer); closeTimer = 0; }
    else if(!closeTimer) closeTimer = setTimeout(()=>{ closeTimer = 0; if(isOpen && !keepOpen()) close(true); }, CLOSE_DELAY);
  }
  function syncVisible(){ if(!fab) return; const ok = isGmHere(); fab.style.display = ok ? '' : 'none'; if(!ok && isOpen) close(); }
  function open(tab){ build(); if(tab) prefs.tab = tab; isOpen = true; if(dockCtl) dockCtl.place(); panel.classList.add('open'); fab.classList.add('open'); render();
    clearInterval(refreshTimer); refreshTimer = setInterval(()=>{ if(isOpen && prefs.tab==='players') render(); }, 2500); }
  function close(auto){ if(!panel) return; if(auto!==true) holdClosed = true; clearTimeout(closeTimer); closeTimer = 0; isOpen = false; panel.classList.remove('open'); fab.classList.remove('open'); clearInterval(refreshTimer); }
  function toggle(){ isOpen ? close() : open(); }
  function setTab(t){ prefs.tab = t; editing = false; savePrefs(); render(); }
  function refresh(){ if(isOpen && prefs.tab==='players') render(); }
  function render(){
    if(!panel) return;
    panel.querySelectorAll('.gs-tabs [data-tab]').forEach(b=>b.classList.toggle('on', b.dataset.tab===prefs.tab));
    if(prefs.tab==='players') body.innerHTML = playersHtml();
    else if(prefs.tab==='scenes') body.innerHTML = scenesHtml();
    else if(prefs.tab==='reactions'){ body.innerHTML = '<div class="rx-cfg"></div>'; if(typeof Reactions!=='undefined') Reactions.renderConfig(body.firstChild); }
    else if(prefs.tab==='epic'){ body.innerHTML = '<div class="ep-cfg-root"></div>'; if(typeof EpicRolls!=='undefined') EpicRolls.renderConfig(body.firstChild); }
    else if(prefs.tab==='chron'){ body.innerHTML = '<div class="ch-root"></div>'; if(typeof Chronicle!=='undefined') Chronicle.render(body.firstChild); }
    else renderNotes();
    if(typeof NoteMedia!=='undefined') NoteMedia.hydrate(body); // картинки и ролики заметок — из хранилища браузера
  }

  /* ---------- игроки ---------- */
  function bar(cls, cur, max){ const pct = max>0 ? Math.max(0, Math.min(100, cur/max*100)) : 0;
    return `<div class="gs-bar ${cls}${max>0 && cur <= max/3 ? ' low' : ''}"><i style="width:${pct}%"></i><span>${cur}/${max}</span></div>`; }
  function playersHtml(){
    if(typeof session==='undefined' || session.role!=='gm')
      return `<div class="gs-empty">Игроки появятся здесь, когда вы начнёте сессию «Я — Мастер» и они подключатся: ОЗ, пси, удача и состояния всех сразу.
        <div class="gs-row"><button type="button" class="gs-btn" data-a="to-session">К началу сессии</button></div></div>`;
    const ids = Object.keys(session.players || {});
    const lvlRow = `<div class="gs-row gs-newlvl">Новые игроки: персонаж <select data-a="newlvl" title="Какого уровня персонажа предлагать игрокам при входе за стол («Сгенерировать за меня»)">${Array.from({length:20}, (_, i)=>i + 1).map(n=>`<option value="${n}" ${n===(+prefs.newLevel || 1) ? 'selected' : ''}>${n}</option>`).join('')}</select> уровня
      <button type="button" class="gs-btn small" data-a="copies" title="Копии листов игроков, которые хранятся у вас — их можно вернуть игроку">Копии листов</button></div>
      <div class="gs-row gs-logview"><label title="«к20≤14 → 10 — Успех, КУ2 · к12≤7 → [4, 7]→7 пробило · итого 7 ран». Пороги атак (Макс. и МУ − Защита) — секрет: игрокам только по галочке «пороги» у каждого"><input type="checkbox" data-lv="on" ${typeof logView!=='undefined' && logView.on ? 'checked' : ''}> Подробный вид лога: к20≤Макс., к12≤порог</label></div>`;
    const meetRow = typeof SessionExtras!=='undefined' ? SessionExtras.meetingRowHtml() : '';
    if(!ids.length) return meetRow + lvlRow + (typeof SessionExtras!=='undefined' ? SessionExtras.goneHtml() : '') + `<div class="gs-empty">Стол «${esc(typeof currentRoomCode!=='undefined' && currentRoomCode || 'общий')}» открыт, но пока никто не подключился. Отправьте игрокам ссылку на стол.
        <div class="gs-row"><button type="button" class="gs-btn primary" data-a="copy-link">⧉ Ссылка для игроков</button></div></div>`;
    return meetRow + lvlRow + `<div class="gs-sub">В сети: ${ids.length}</div>` + (typeof SessionExtras!=='undefined' ? SessionExtras.goneHtml() : '') + ids.map(id=>{
      const p = session.players[id], c = p.character;
      const pname = esc(p.name || 'игрок'), cname = esc((p.extra && p.extra.name) || '');
      if(!c) return `<div class="gs-pc"><div class="gs-pc-head"><span class="gs-dot"></span><b>${pname}</b><span class="gs-muted">ждём лист…</span></div></div>`;
      let hm = 0, pm = 0; try{ hm = hpMax(c); pm = psiMax(c); }catch(e){}
      const arch = (typeof ARCHETYPES!=='undefined' && ARCHETYPES[c.archetypeKey]) ? ARCHETYPES[c.archetypeKey].name : '';
      const st = c.states || {}, states = [['bodrost', 'бодрость'], ['ispug', 'испуг'], ['istoshenie', 'истощение'], ['stress', 'стресс']].filter(x=>st[x[0]]).map(x=>`<span class="gs-chip on">${x[1]}</span>`).join('');
      const down = c.hpCurrent <= 0 ? '<span class="gs-chip red">⚠ ОЗ ≤ 0</span>' : '';
      return `<div class="gs-pc"><div class="gs-pc-head">${typeof SessionExtras!=='undefined' ? SessionExtras.connDot(id) : '<span class="gs-dot on"></span>'}<b>${cname || pname}</b><span class="gs-muted">${cname ? pname + ' · ' : ''}ур. ${c.level}${arch ? ' · ' + esc(arch) : ''}</span></div>
        <div class="gs-bars"><span class="gs-lbl">ОЗ</span>${bar('hp', c.hpCurrent, hm)}<span class="gs-lbl">Пси</span>${bar('psi', c.psiCurrent, pm)}</div>
        <div class="gs-chips"><span class="gs-chip">🍀 ${c.luck==null ? 1 : c.luck}</span><span class="gs-chip">опыт ${c.xp || 0}</span>${down}${states}</div>
        <div class="gs-row">${typeof EpicRolls!=='undefined' ? EpicRolls.armButtonHtml(id) : ''}<button type="button" class="gs-btn" data-a="luck" data-id="${esc(id)}" title="Выдать 1 удачу">🍀+1</button><button type="button" class="gs-btn" data-a="edit" data-id="${esc(id)}" title="Открыть лист игрока у себя и править">✎ Лист</button><button type="button" class="gs-btn" data-a="loot" data-id="${esc(id)}" title="Находка: бросок по таблицам книги и выдача игроку">⛏ Находка</button><button type="button" class="gs-btn" data-a="find" data-id="${esc(id)}" title="Показать жетон игрока на игровом столе">📍</button>${typeof logView!=='undefined' && logView.on ? `<label class="gs-lvp" title="Этот игрок видит подробный лог с порогами (Макс. и МУ − Защита цели)"><input type="checkbox" data-lv="p" data-id="${esc(id)}" ${logView.allow[id] ? 'checked' : ''}> пороги</label>` : ''}</div></div>`;
    }).join('');
  }

  /* ---------- сцены ---------- */
  function sceneInfo(sc){
    const t = sc.table || {}, n = (t.tokens || []).length, map = t.map && t.map.scene ? '«' + esc(t.map.scene.name || 'карта') + '»' : t.map && t.map.background ? 'фон по ссылке' : 'без карты';
    const snd = sc.sound ? [(sc.sound.ambience || []).length ? 'атмосфера: ' + sc.sound.ambience.length : '', sc.sound.music ? 'музыка' : ''].filter(Boolean).join(', ') : '';
    return `${map} · жетонов: ${n}${(t.drawings || []).length ? ' · рисунки' : ''}${snd ? ' · звук: ' + snd : sc.sound ? ' · тишина' : ''}`;
  }
  function scenesHtml(){
    const gt = GT(), draft = gt && gt.inSandbox && gt.inSandbox()==='draft';
    const head = draft
      ? `<div class="gs-draft"><b>✎ Черновой стол${draftOf ? ' — правка сцены «' + esc((scenes.find(s=>s.id===draftOf) || {}).name || '') + '»' : ''}</b>
          <div class="gs-muted">Соберите сцену на вкладке «Игровой стол»: карта, жетоны из бестиария, рисунки. Игроки черновик не видят. Черновик не сохраняется сам — нажмите «Сохранить».</div>
          <div class="gs-row"><button type="button" class="gs-btn primary" data-s="draft-save">💾 Сохранить${draftOf ? ' сцену' : ' как сцену'}</button><button type="button" class="gs-btn" data-s="draft-table">К столу</button><button type="button" class="gs-btn" data-s="draft-exit">✕ Выйти</button></div></div>`
      : `<div class="gs-row"><button type="button" class="gs-btn primary" data-s="save" title="Запомнить, что сейчас на игровом столе: карта, жетоны NPC, рисунки (и звук, если отметить)">💾 Сохранить стол как сцену</button>
          <button type="button" class="gs-btn" data-s="draft" title="Пустой черновой стол: собрать сцену заранее, пока идёт игра. Игроки его не видят">✎ Черновой стол</button></div>`;
    const list = scenes.length ? scenes.map(sc=>`<div class="gs-scene" data-id="${esc(sc.id)}">
        <div class="gs-scene-head"><b>${esc(sc.name)}</b></div>
        <div class="gs-muted">${sceneInfo(sc)}</div>
        ${sc.note ? `<div class="gs-scene-note" data-who="${esc(sc.name)}">${renderRich(sc.note)}</div>` : ''}
        <div class="gs-row">${draft ? '' : `<button type="button" class="gs-btn primary" data-s="play" title="Включить сцену на игровом столе (жетоны игроков останутся)">▶ Включить</button>`}
          <button type="button" class="gs-btn" data-s="edit" title="Открыть сцену на черновом столе и поправить">✎</button>
          <button type="button" class="gs-btn" data-s="meta" title="Название и заметка">Aa</button>
          <button type="button" class="gs-btn" data-s="up" title="Выше">↑</button>
          <button type="button" class="gs-btn" data-s="del" title="Удалить сцену">🗑</button></div></div>`).join('')
      : '<div class="gs-empty">Сцен пока нет. Расставьте стол и нажмите «Сохранить стол как сцену» — или соберите сцену на черновом столе.</div>';
    return head + `<div class="gs-list">${list}</div>
      <div class="gs-foot"><button type="button" class="gs-btn small" data-s="export" title="Сцены, заметки и предметы к встрече — в файл, чтобы перенести на другое устройство">⬇ Подготовка в файл</button><button type="button" class="gs-btn small" data-s="import" title="Загрузить сцены и заметки из файла">⬆ Из файла</button></div>`;
  }
  async function saveScene(existing){
    const gt = GT(); if(!gt || !gt.captureScene) return;
    const sb = SB(), snd = sb && sb.sceneSound ? sb.sceneSound() : null;
    const sndTxt = snd && (snd.ambience.length || snd.music) ? ' (сейчас: ' + [snd.ambience.length ? 'атмосфера ' + snd.ambience.length : '', snd.music ? 'музыка' : ''].filter(Boolean).join(', ') + ')' : ' (сейчас тихо — при включении сцены звук остановится)';
    const r = await uiForm(existing ? 'Сохранить сцену' : 'Новая сцена', [
      {name:'name', label:'Название', value:existing ? existing.name : 'Сцена ' + (scenes.length + 1)},
      {name:'note', label:'Заметка к сцене (броски: «Взлом 4(14)», «2к6»)', value:existing ? existing.note || '' : '', multiline:true, rows:3},
      {name:'sound', type:'checkbox', label:'Запомнить звук' + sndTxt, value:existing ? !!existing.sound : false}], {ok:'Сохранить'});
    if(!r) return false;
    const sc = existing || {id:'sc' + uidS(), created:Date.now()};
    sc.name = (r.name || '').trim().slice(0, 80) || 'Сцена'; sc.note = (r.note || '').slice(0, 5000); sc.updated = Date.now();
    sc.table = gt.captureScene(); sc.sound = r.sound ? snd : null;
    if(!existing) scenes.push(sc);
    if(!store(SCENES_KEY, scenes)) return false;
    uiToast('Сцена сохранена: ' + sc.name, {icon:'💾'});
    return true;
  }
  async function playScene(sc){
    const gt = GT(); if(!gt || !gt.applyScene) return;
    const r = await uiDialog({title:'Включить сцену', icon:'▶', text:`«${sc.name}»: карта, жетоны NPC и рисунки на столе заменятся сценой${sc.sound ? ', звук — звуком сцены' : ''}. Жетоны игроков останутся на местах.`,
      cancelValue:null, buttons:[{label:'Отмена', value:null}, {label:'Сохранить текущий и включить', value:'save'}, {label:'Включить', value:'go', primary:true}]});
    if(!r) return;
    if(r==='save' && !(await saveScene(null))) return;
    gt.applyScene(sc.table);
    if(sc.sound && SB() && SB().applySceneSound) SB().applySceneSound(sc.sound); // сцена без звука — текущий звук не трогаем
    if(typeof toggleMainTab==='function') toggleMainTab('table');
    uiToast('Сцена на столе: ' + sc.name, {icon:'▶'});
  }
  function startDraft(sc){
    const gt = GT(); if(!gt || !gt.enterSandbox) return;
    if(typeof Onboarding!=='undefined' && Onboarding.busy()) Onboarding.stop();
    if(gt.inSandbox()) gt.exitSandbox();
    gt.enterSandbox('draft', '✎ Черновой стол сцены — игроки его не видят');
    draftOf = sc ? sc.id : null;
    if(sc) gt.applyScene(sc.table);
    if(typeof toggleMainTab==='function') toggleMainTab('table');
    render();
  }
  async function exitDraft(ask){
    const gt = GT(); if(!gt || gt.inSandbox()!=='draft') return;
    if(ask && !(await uiConfirm('Выйти с чернового стола без сохранения? Собранное на нём пропадёт.', {title:'Черновой стол', ok:'Выйти', danger:true}))) return;
    gt.exitSandbox(); draftOf = null; render();
  }

  /* ---------- заметки и разбор бросков ---------- */
  const W = '[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\\-/]*';
  const ROLL_RE = new RegExp('((?:' + W + '\\s+){0,2}' + W + ')\\s*([−-]?\\d+)?\\s*\\((\\d{1,2})\\)', 'g');
  const DICE_RE = /(^|[^0-9A-Za-zА-Яа-яЁё])(\d{0,2})[кКdD](4|6|8|10|12|20|100)(?:\s*([+−-])\s*(\d{1,3}))?(?![0-9A-Za-zА-Яа-яЁё])/g;
  function inline(line){
    const parts = []; let last = 0, m; ROLL_RE.lastIndex = 0;
    while((m = ROLL_RE.exec(line))){
      parts.push(dice(esc(line.slice(last, m.index))));
      const label = m[1].trim(), max = +m[3];
      parts.push(`<span class="bst-roll gs-roll" data-max="${max}" data-label="${esc(label)}" title="Нажмите и протяните — бросок «${esc(label)}», Максимум ${max}">${esc(m[0].trim())}</span>`);
      last = m.index + m[0].length;
    }
    parts.push(dice(esc(line.slice(last))));
    return parts.join('').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }
  function dice(txt){ return txt.replace(DICE_RE, (all, pre, n, sides, sign, mod)=>`${pre}<span class="gs-dice" data-n="${n || 1}" data-s="${sides}" data-m="${mod ? (sign==='+' ? '' : '-') + mod : 0}" title="Нажмите — бросок">${all.slice(pre.length)}</span>`); }
  function renderRich(text){
    const lines = String(text || '').split('\n'); let html = '', inList = false;
    lines.forEach(l=>{
      const media = typeof NoteMedia!=='undefined' ? NoteMedia.lineHtml(l) : null;
      if(media){ if(inList){ html += '</ul>'; inList = false; } html += media; return; }
      const li = l.match(/^\s*[-•*]\s+(.*)$/);
      if(li){ if(!inList){ html += '<ul>'; inList = true; } html += '<li>' + inline(li[1]) + '</li>'; return; }
      if(inList){ html += '</ul>'; inList = false; }
      const h = l.match(/^\s*#{1,3}\s+(.*)$/);
      if(h) html += '<h4>' + inline(h[1]) + '</h4>'; else if(l.trim()) html += '<p>' + inline(l) + '</p>'; else html += '<div class="gs-gap"></div>';
    });
    if(inList) html += '</ul>';
    return html;
  }
  function rollDice(el){
    const n = Math.max(1, Math.min(20, +el.dataset.n || 1)), s = +el.dataset.s, m = +el.dataset.m || 0;
    const rolls = []; for(let i=0;i<n;i++) rolls.push(1 + Math.floor(Math.random()*s));
    const sum = rolls.reduce((a, b)=>a + b, 0) + m;
    uiToast(`🎲 ${el.textContent.trim()}: [${rolls.join(', ')}]${m ? (m>0 ? ' +' : ' −') + Math.abs(m) : ''} = ${sum}`, {icon:'к' + s, ms:6000});
  }
  function curNote(){ return notes.find(n=>n.id===prefs.note) || notes[0] || null; }
  function renderNotes(){
    const sub = `<div class="rx-seg gs-notes-sub"><button type="button" data-nsub="notes" class="${prefs.nsub!=='items' ? 'on' : ''}">Заметки</button><button type="button" data-nsub="items" class="${prefs.nsub==='items' ? 'on' : ''}" title="Предметы к встрече: из каталога, по таблицам Находок, свои — выдать игроку одной кнопкой">Предметы к встрече</button></div>`;
    if(prefs.nsub==='items'){ body.innerHTML = sub + '<div class="pi-root"></div>'; if(typeof PrepItems!=='undefined') PrepItems.render(body.querySelector('.pi-root')); return; }
    const n = curNote();
    const sel = `<select class="gs-note-sel" title="Выбрать заметку">${notes.map(x=>`<option value="${esc(x.id)}" ${n && x.id===n.id ? 'selected' : ''}>${esc(x.title || 'Без названия')}</option>`).join('') || '<option value="">— заметок нет —</option>'}</select>`;
    const head = `<div class="gs-row gs-notes-head">${sel}<button type="button" class="gs-btn" data-n="new" title="Новая заметка">＋</button>${n ? `<button type="button" class="gs-btn${editing ? ' primary' : ''}" data-n="edit" title="${editing ? 'Готово — показать с бросками' : 'Править'}">${editing ? '✓' : '✎'}</button><button type="button" class="gs-btn" data-n="media" title="Картинка, гифка или короткий ролик (MP4/WebM) в заметку — можно и вставить Ctrl+V или перетащить файл в текст">🖼</button><button type="button" class="gs-btn" data-n="del" title="Удалить заметку">🗑</button><button type="button" class="gs-btn" data-n="handout" title="Раздатка: показать игрокам заметку (или выделенный в ней кусок) и картинку">📜 Игрокам</button>` : ''}</div>`;
    let main;
    if(!n) main = '<div class="gs-empty">Заметок пока нет. «＋» — новая: план встречи, описания, NPC, ловушки. «Взлом замка 4(14)» станет броском.</div>';
    else if(editing) main = `<input class="gs-note-title" value="${esc(n.title)}" placeholder="Название" maxlength="80">
      <textarea class="gs-note-text" placeholder="# Заголовок\n- пункт списка\nВзлом замка 4(14) — бросок\nУрон 2к6+1 — кости">${esc(n.text)}</textarea>`;
    else main = `<div class="gs-note-view" data-who="${esc(n.title || 'Заметка')}">${n.text.trim() ? renderRich(n.text) : '<div class="gs-muted">Пустая заметка — «✎», чтобы написать.</div>'}</div>`;
    body.innerHTML = sub + head + main + `<div class="gs-hint">«Навык 3(13)» — нажмите и протяните (бросок как в бестиарии), «2к6+1» — нажмите. Броски видны только вам, пока в бестиарии не включено «броски видны игрокам». <b>**жирный**</b>, «# заголовок», «- список». 🖼 — картинка, гифка, ролик; «📜» у медиа — показать игрокам только его.</div>`;
    if(editing){ const t = body.querySelector('.gs-note-text'); if(t) t.focus(); }
  }
  // Медиа в заметку: в правке — в место курсора, в просмотре — в конец заметки
  async function insertMedia(n, files){
    const refs = await NoteMedia.addFiles(files); if(!refs.length) return;
    const ta = body.querySelector('.gs-note-text'), block = '\n' + refs.join('\n') + '\n';
    if(editing && ta){ const a = ta.selectionStart, b = ta.selectionEnd; ta.value = ta.value.slice(0, a) + block + ta.value.slice(b); n.text = ta.value.slice(0, 20000); }
    else n.text = (n.text.replace(/\s+$/, '') + '\n' + block).slice(0, 20000);
    n.updated = Date.now(); store(NOTES_KEY, notes);
    if(!editing) render(); else { const pos = ta.selectionStart; ta.focus(); }
    uiToast(refs.length===1 ? 'Медиа добавлено в заметку' : `Медиа добавлено: ${refs.length}`, {icon:'🖼'});
  }
  document.addEventListener('paste', (e)=>{ if(!e.target.matches || !e.target.matches('.gs-note-text') || typeof NoteMedia==='undefined') return;
    const files = [...(e.clipboardData && e.clipboardData.files || [])]; if(!files.length) return; e.preventDefault(); const n = curNote(); if(n) insertMedia(n, files); });
  document.addEventListener('dragover', (e)=>{ if(e.target.closest && e.target.closest('.gs-note-text, .gs-note-view')) e.preventDefault(); });
  document.addEventListener('drop', (e)=>{ if(!e.target.closest || !e.target.closest('.gs-note-text, .gs-note-view') || typeof NoteMedia==='undefined') return;
    const files = [...(e.dataTransfer && e.dataTransfer.files || [])]; if(!files.length) return; e.preventDefault(); const n = curNote(); if(n) insertMedia(n, files); });
  let noteSaveTimer = 0;
  function onInput(e){
    const n = curNote(); if(!n) return;
    if(e.target.matches('.gs-note-title')) n.title = e.target.value.slice(0, 80);
    else if(e.target.matches('.gs-note-text')) n.text = e.target.value.slice(0, 20000);
    else return;
    n.updated = Date.now(); clearTimeout(noteSaveTimer); noteSaveTimer = setTimeout(()=>store(NOTES_KEY, notes), 400);
    if(e.target.matches('.gs-note-title')){ const o = body.querySelector(`.gs-note-sel option[value="${CSS.escape(n.id)}"]`); if(o) o.textContent = n.title || 'Без названия'; }
  }

  /* ---------- нажатия ---------- */
  async function onClick(e){
    const d = e.target.closest('.gs-dice'); if(d){ rollDice(d); return; }
    const a = e.target.closest('[data-a]');
    if(a){ const id = a.dataset.id;
      if(a.dataset.a==='luck' && typeof giveLuckToPlayer==='function') giveLuckToPlayer(id);
      else if(a.dataset.a==='edit' && typeof enterGmEditMode==='function'){ close(); if(typeof toggleMainTab==='function') toggleMainTab('sheet'); enterGmEditMode(id); }
      else if(a.dataset.a==='loot' && typeof openLootDig==='function') openLootDig(id);
      else if(a.dataset.a==='epic' && typeof EpicRolls!=='undefined') EpicRolls.toggleArm(id); // следующий к20 игрока — эпичный
      else if(a.dataset.a==='find'){ const gt = GT(); if(gt && gt.focusOwner && !gt.focusOwner(id)) uiToast('Жетона этого игрока на столе нет', {icon:'📍'}); }
      else if(a.dataset.a==='copies'){ showCopies(); return; }
      else if(a.dataset.a==='copy-link'){ const b = document.getElementById('btnCopyRoomLink'); if(b) b.click(); }
      else if(a.dataset.a==='to-session'){ close(); if(typeof toggleMainTab==='function') toggleMainTab('sheet'); const s = document.getElementById('sessionPanel'); if(s) s.scrollIntoView({behavior:'smooth', block:'start'}); }
      setTimeout(render, 50); return; }
    const s = e.target.closest('[data-s]');
    if(s){ const host = s.closest('[data-id]'), sc = host ? scenes.find(x=>x.id===host.dataset.id) : null;
      switch(s.dataset.s){
        case 'save': await saveScene(null); break;
        case 'draft': startDraft(null); break;
        case 'draft-save': { const ex = draftOf ? scenes.find(x=>x.id===draftOf) : null; if(await saveScene(ex)) await exitDraft(false); break; }
        case 'draft-table': if(typeof toggleMainTab==='function') toggleMainTab('table'); break;
        case 'draft-exit': await exitDraft(true); break;
        case 'play': if(sc) await playScene(sc); break;
        case 'edit': if(sc) startDraft(sc); break;
        case 'meta': if(sc){ const r = await uiForm('Сцена', [{name:'name', label:'Название', value:sc.name}, {name:'note', label:'Заметка к сцене', value:sc.note || '', multiline:true, rows:4}], {ok:'Сохранить'});
          if(r){ sc.name = (r.name || '').trim().slice(0, 80) || sc.name; sc.note = (r.note || '').slice(0, 5000); store(SCENES_KEY, scenes); } } break;
        case 'up': if(sc){ const i = scenes.indexOf(sc); if(i>0){ scenes.splice(i, 1); scenes.splice(i - 1, 0, sc); store(SCENES_KEY, scenes); } } break;
        case 'del': if(sc){ const at = scenes.indexOf(sc); scenes = scenes.filter(x=>x!==sc); store(SCENES_KEY, scenes);
          uiToast(`Сцена «${sc.name}» удалена`, {icon:'✕', action:{label:'Отменить', run:()=>{ scenes.splice(Math.min(at, scenes.length), 0, sc); store(SCENES_KEY, scenes); render(); }}}); } break;
        case 'export': exportPrep(); break;
        case 'import': importPrep(); break;
      }
      render(); return; }
    const ns = e.target.closest('[data-nsub]'); if(ns){ prefs.nsub = ns.dataset.nsub; savePrefs(); render(); return; }
    const n = e.target.closest('[data-n]');
    if(n && n.dataset.n==='media'){ const x = curNote(); if(x && typeof NoteMedia!=='undefined'){ const files = await NoteMedia.pickFiles(); if(files.length) insertMedia(x, files); } return; }
    const ns2 = e.target.closest('[data-nm-send]'); if(ns2){ const x = curNote(); if(x && typeof SessionExtras!=='undefined') SessionExtras.sendHandout(x, '', [ns2.dataset.nmSend], true); return; }
    if(n && n.dataset.n==='handout'){ const x = curNote(); if(x && typeof SessionExtras!=='undefined'){ const v = body.querySelector('.gs-note-view'), sel = window.getSelection();
      const part = v && sel && !sel.isCollapsed && v.contains(sel.anchorNode) ? sel.toString() : '';
      const figs = part ? [...v.querySelectorAll('figure.nm[data-mid]')].filter(f=>sel.containsNode(f, true)).map(f=>f.dataset.mid) : null;
      SessionExtras.sendHandout(x, part, figs); } return; }
    if(n){
      if(n.dataset.n==='new'){ const x = {id:'n' + uidS(), title:'Заметка ' + (notes.length + 1), text:'', updated:Date.now()}; notes.unshift(x); prefs.note = x.id; editing = true; store(NOTES_KEY, notes); savePrefs(); }
      else if(n.dataset.n==='edit'){ editing = !editing; store(NOTES_KEY, notes); }
      else if(n.dataset.n==='del'){ const x = curNote(); if(x){ const at = notes.indexOf(x); notes = notes.filter(y=>y!==x); prefs.note = notes[0] ? notes[0].id : ''; editing = false; store(NOTES_KEY, notes); savePrefs();
        uiToast(`Заметка «${x.title || 'Без названия'}» удалена`, {icon:'✕', action:{label:'Отменить', run:()=>{ notes.splice(Math.min(at, notes.length), 0, x); prefs.note = x.id; store(NOTES_KEY, notes); savePrefs(); render(); }}}); } }
      render(); }
  }
  document.addEventListener('change', (e)=>{ const lv = e.target.dataset && e.target.dataset.lv; if(!lv || typeof setLogViewOn!=='function') return;
    if(lv==='on'){ setLogViewOn(e.target.checked); uiToast(e.target.checked ? 'Подробный лог включён — отметьте игроков, которым видны пороги' : 'Стандартный вид лога', {icon:'⚄'}); }
    else setLogViewAllow(e.target.dataset.id, e.target.checked);
    render(); });
  document.addEventListener('change', (e)=>{ if(e.target.matches && e.target.matches('.gs-newlvl select')){ prefs.newLevel = +e.target.value; savePrefs(); uiToast(`Новым игрокам — персонаж ${prefs.newLevel} уровня`, {icon:'☺'}); return; } });
  async function showCopies(){
    const all = typeof GmCopies!=='undefined' ? await GmCopies.list() : [];
    const when = (t)=>new Date(t).toLocaleString('ru-RU', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'});
    uiDialog({title:'Копии листов игроков', icon:'↩', text:all.length ? 'Каждый присланный игроком лист сохраняется здесь (до 60 последних). Игрок может попросить свой лист: «Вернуть у Мастера» на экране входа — вы выберете копию.' : 'Пока копий нет: они появятся, когда игроки подключатся к вашему столу.',
      html:all.length ? `<div class="join-opts">${all.slice(0, 30).map(r=>`<div class="join-opt"><b>${esc(r.charName || 'Без имени')}${r.arch ? ' · ' + esc(r.arch) : ''} · ур. ${r.level}</b><span>игрок «${esc(r.player)}», ${when(r.savedAt)}</span></div>`).join('')}</div>` : '',
      cancelValue:null, buttons:[{label:'Закрыть', value:null, primary:true}]});
  }
  document.addEventListener('change', (e)=>{ if(e.target.matches && e.target.matches('.gs-note-sel')){ prefs.note = e.target.value; editing = false; savePrefs(); render(); } });
  document.addEventListener('click', (e)=>{ const d = e.target.closest && e.target.closest('.gs-dice'); if(d && !panel.contains(d)) rollDice(d); }); // кости в заметке сцены вне панели — на будущее

  /* ---------- перенос подготовки файлом ---------- */
  async function exportPrep(){
    const media = typeof NoteMedia!=='undefined' ? await NoteMedia.exportFor(notes.map(n=>n.text).concat(scenes.map(s=>s.note || ''))) : [];
    const blob = new Blob([JSON.stringify({format:'reincarnator-gm-prep', version:1, scenes, notes, items:typeof PrepItems!=='undefined' ? PrepItems.list : [], media}, null, 1)], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'podgotovka-mastera.json'; document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function importPrep(){
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = ()=>{ const f = inp.files[0]; if(!f) return; f.text().then(t=>{
      const j = JSON.parse(t); if(!j || j.format!=='reincarnator-gm-prep') throw new Error('это не файл подготовки Мастера');
      const ids = new Set(scenes.map(x=>x.id)), nids = new Set(notes.map(x=>x.id)); let sN = 0, nN = 0;
      (Array.isArray(j.scenes) ? j.scenes : []).forEach(x=>{ if(!x || !x.table || typeof x.name!=='string') return; if(ids.has(x.id)) x.id = 'sc' + uidS(); scenes.push(x); sN++; });
      (Array.isArray(j.notes) ? j.notes : []).forEach(x=>{ if(!x || typeof x.text!=='string') return; if(nids.has(x.id)) x.id = 'n' + uidS(); notes.push(x); nN++; });
      const iN = Array.isArray(j.items) ? j.items.length : 0; if(iN && typeof PrepItems!=='undefined') PrepItems.importList(j.items);
      if(Array.isArray(j.media) && j.media.length && typeof NoteMedia!=='undefined') NoteMedia.importList(j.media).then(()=>render());
      store(SCENES_KEY, scenes); store(NOTES_KEY, notes); render(); uiToast(`Загружено: сцен ${sN}, заметок ${nN}${iN ? ', предметов ' + iN : ''}`, {icon:'⬆'});
    }).catch(e=>uiAlert('Не удалось загрузить файл: ' + e.message, {icon:'⚠'})); };
    inp.click();
  }

  function init(){ build(); }
  return { init, open, close, toggle, refresh, render, setTab, renderRich, get isOpen(){ return isOpen; } };
})();
try{ GmScreen.init(); }catch(e){ console.error('[Экран Мастера] не удалось запустить', e); }
