/* ======================================================================
   ГРУППОВАЯ ПРОВЕРКА — одна проверка на несколько персонажей, сцена на весь экран у всех за столом.
   Мастер: экран Мастера → «Групповая» — название, кому какая характеристика (любая из листа: тело, личность, навыки боя и
   авантюриста, знания культуры, старого и нового мира; «не участвует» — игрок только смотрит), модификатор, сколько
   категорий успеха нужно набрать всем вместе, сцена и подача, звук. «Запустить» — у всех открывается сцена; участник видит
   свою характеристику и жмёт «Готов». Пока не бросили, Мастер меняет характеристики — у игрока она обновляется, отметка
   «Готов» снимается (новую характеристику надо подтвердить). Все готовы (или Мастер нажал «Бросить сейчас») — Мастер
   бросает к20 за каждого по копии его листа: Максимум = ЗХ + 10 + модификатор, категории успеха складываются; набрали
   нужное — успех, иначе провал. Итог — сценой у всех и одной записью в логе бросков.
   Состояние ведёт Мастер (grp-state всем), игрок шлёт только grp-ready. Настройки Мастера — в этом браузере.
   ====================================================================== */
const GroupCheck = (function(){
  const KEY = 'reincarnator_group_v1';
  const GROUPS = [['Тело', BODY], ['Личность', PERSONALITY], ['Навыки боя', COMBAT_SKILLS], ['Навыки авантюриста', ADV_SKILLS],
    ['Знания культуры', CULTURE], ['Знания старого мира', OLDWORLD], ['Знания нового мира', NEWWORLD]];
  const STAT_OK = new Set(ALL_STATS);
  const SCENES = {
    oath:  {name:'Круг клятвы', desc:'Ритуальный круг на полу с печатями по числу нужных категорий, рунные кольца над ним. Бросок — столб света из круга.'},
    link:  {name:'Связь разумов', desc:'Живые нити тянутся к глазу изнанки, вокруг — синапсы. Бросок — разряд по сети, глаз открывается; каждая категория зажигает синапс.'},
    frozen:{name:'Остановленное мгновение', desc:'Серый мир, кинокадр, циферблат за суммой: стрелки застыли, стекло времени трескается, кости падают в замедлении — щелчок, и время идёт.'},
    stars: {name:'Созвездие', desc:'Ночное небо: нужное число категорий — пустые звёзды созвездия. Звездопад к участникам, каждая категория зажигает звезду.'},
    bridge:{name:'Мост над пропастью', desc:'Пропасть с туманом и искрами снизу: каждая категория успеха укладывает доску. Не хватило досок — мост рушится.'}
  };
  const ACCENTS = {gold:'#e2b24c', psi:'#9a8cff', blood:'#d0553a', teal:'#4fd1a5'};
  const DEFAULT = {scene:'oath', intensity:100, tempo:1.2, shake:true, dim:true, accent:'auto', custom:'#4fd1a5', sound:true, volume:60, title:'', mod:-3, need:3};
  const esc = (x)=>String(x==null ? '' : x).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const rnd = (a, b)=>a + Math.random()*(b - a);
  const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const signed = (v)=>v > 0 ? '+' + v : v < 0 ? '−' + Math.abs(v) : '0';

  function sanitizeCfg(c){
    const o = c && typeof c==='object' ? c : {}, d = DEFAULT;
    const num = (v, a, b, def)=>{ v = +v; return isFinite(v) ? Math.max(a, Math.min(b, v)) : def; }, bool = (v, def)=>typeof v==='boolean' ? v : def;
    return { scene:SCENES[o.scene] ? o.scene : d.scene, intensity:Math.round(num(o.intensity, 10, 100, d.intensity)), tempo:Math.round(num(o.tempo, .6, 1.6, d.tempo)*10)/10,
      shake:bool(o.shake, d.shake), dim:bool(o.dim, d.dim), accent:['auto','gold','psi','blood','teal','custom'].indexOf(o.accent)>=0 ? o.accent : d.accent,
      custom:/^#[0-9a-f]{6}$/i.test(o.custom || '') ? o.custom : d.custom, sound:bool(o.sound, d.sound), volume:Math.round(num(o.volume, 0, 100, d.volume)),
      title:String(o.title || '').slice(0, 60), mod:Math.round(num(o.mod, -21, 21, d.mod)), need:Math.round(num(o.need, 1, 99, d.need)) };
  }
  let cfg = (function(){ try{ return sanitizeCfg(JSON.parse(localStorage.getItem(KEY) || 'null') || DEFAULT); }catch(e){ return sanitizeCfg(DEFAULT); } })();
  const saveCfg = ()=>{ try{ localStorage.setItem(KEY, JSON.stringify(cfg)); }catch(e){} };
  const role = ()=>typeof session!=='undefined' ? session.role : null;
  const isGm = ()=>role()==='gm';
  const assign = {}; // у Мастера: id игрока → ключ характеристики (до запуска и во время)

  /* ---------- Мастер: состояние проверки ---------- */
  let run = null; // {id, title, mod, need, cfg, phase:'gather'|'reveal', parts:{pid:{name, stat, label, max, ready, online, res}}, total, ok, preview}
  const playerName = (pid)=>{ const p = session.players && session.players[pid]; return p ? ((p.extra && p.extra.name) || (p.character && p.character.name) || p.name || 'игрок') : 'игрок'; };
  const sheetOf = (pid)=>{ const p = session.players && session.players[pid]; return p && p.character; };
  function statMax(pid, stat, mod){ const c = sheetOf(pid), v = c && c.stats ? +c.stats[stat] : NaN; return isFinite(v) ? v + 10 + mod : null; }
  function partFor(pid, stat, mod, prev){ const max = statMax(pid, stat, mod);
    return {name:playerName(pid), stat, label:STAT_LABELS[stat] || stat, max, ready:!!(prev && prev.ready && prev.stat===stat), online:!!(session.players && session.players[pid]), res:null}; }
  function publicRun(r){ if(!r) return null;
    return {id:r.id, title:r.title, mod:r.mod, need:r.need, cfg:r.cfg, phase:r.phase, total:r.total, ok:r.ok,
      parts:Object.keys(r.parts).map(pid=>{ const p = r.parts[pid]; return {id:pid, name:p.name, stat:p.stat, label:p.label, max:p.max, ready:p.ready, online:p.online, res:r.phase==='reveal' ? p.res : null}; })}; }
  function broadcast(to){ if(!run || run.preview || !isGm() || typeof sendMsg!=='function') return; sendMsg({type:'grp-state', run:publicRun(run)}, to); }
  function changed(){ broadcast(); show(publicRun(run)); refreshGm(); }
  function launch(){
    if(!isGm()) return uiAlert('Групповую проверку запускает Мастер — начните сессию «Я — Мастер».', {icon:'⚠'});
    const ids = Object.keys(assign).filter(pid=>assign[pid] && session.players[pid]);
    if(!ids.length) return uiAlert('Выберите характеристику хотя бы одному игроку — иначе бросать некому.', {icon:'⚠'});
    const noSheet = ids.filter(pid=>!sheetOf(pid)); if(noSheet.length) return uiAlert('Ещё не пришёл лист: ' + noSheet.map(playerName).join(', ') + '. Подождите пару секунд или уберите их из проверки.', {icon:'⚠'});
    run = {id:Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title:cfg.title.trim() || 'Групповая проверка', mod:cfg.mod, need:cfg.need, cfg:sceneCfg(cfg), phase:'gather', parts:{}, total:0, ok:false};
    ids.forEach(pid=>{ run.parts[pid] = partFor(pid, assign[pid], run.mod); });
    changed();
  }
  const sceneCfg = (c)=>({scene:c.scene, intensity:c.intensity, tempo:c.tempo, shake:c.shake, dim:c.dim, accent:c.accent, custom:c.custom, sound:c.sound, volume:c.volume});
  // смена характеристики (и до запуска, и во время сбора): «Готов» у этого игрока снимается
  function setAssign(pid, stat){
    if(stat && !STAT_OK.has(stat)) stat = '';
    assign[pid] = stat;
    if(!run || run.preview || run.phase!=='gather') return refreshGm();
    if(!stat) delete run.parts[pid]; else run.parts[pid] = partFor(pid, stat, run.mod, run.parts[pid]);
    if(!Object.keys(run.parts).length){ cancel(); return; }
    changed(); maybeRoll();
  }
  function maybeRoll(){ if(run && run.phase==='gather' && Object.values(run.parts).every(p=>p.ready)) setTimeout(()=>{ if(run && run.phase==='gather' && Object.values(run.parts).every(p=>p.ready)) rollAll(); }, 700); }
  // бросок за всех — у Мастера, по копиям листов
  function rollAll(){
    if(!run || run.phase!=='gather') return;
    let total = 0;
    Object.keys(run.parts).forEach(pid=>{ const p = run.parts[pid];
      if(!run.preview){ const m = statMax(pid, p.stat, run.mod); if(m!=null) p.max = m; }
      if(p.max==null){ p.res = {roll:0, success:false, category:0, missing:true}; return; }
      const roll = 1 + Math.floor(Math.random()*20), ev = evaluateD20Check(roll, p.max), cat = ev.success ? (ev.category || 1) : 0;
      p.res = {roll, success:ev.success, category:cat}; total += cat; });
    run.total = total; run.ok = total >= run.need; run.phase = 'reveal';
    if(!run.preview) logResult();
    changed();
  }
  function logResult(){
    if(typeof recordAndShareQuickRoll!=='function') return;
    try{ recordAndShareQuickRoll({groupCheck:true, title:run.title, need:run.need, total:run.total, ok:run.ok, mod:run.mod,
      list:Object.values(run.parts).map(p=>({name:p.name, stat:p.label, roll:p.res ? p.res.roll : 0, max:p.max==null ? 0 : p.max, success:!!(p.res && p.res.success), category:p.res ? p.res.category : 0}))}); }catch(e){ console.warn('[Групповая проверка] лог', e); }
  }
  function cancel(){ const was = run; run = null; if(was && !was.preview && isGm() && typeof sendMsg==='function') sendMsg({type:'grp-end', id:was.id}); hideStage(); refreshGm(); }
  function onReady(pid, id){ if(!run || run.preview || run.id!==id || run.phase!=='gather') return; const p = run.parts[pid]; if(!p || p.ready) return; p.ready = true; changed(); maybeRoll(); }
  function onPlayerHello(pid){ if(run && !run.preview){ if(run.parts[pid]){ run.parts[pid].online = true; run.parts[pid].name = playerName(pid); changed(); } else broadcast(pid); } }
  function onPeerLeft(pid){ if(run && !run.preview && run.parts[pid]){ run.parts[pid].online = false; changed(); } else refreshGm(); }
  let gmBox = null, gmTimer = 0;
  function refreshGm(){ if(!gmBox || !gmBox.isConnected) return; const ae = document.activeElement;
    if(ae && gmBox.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)){ clearTimeout(gmTimer); gmTimer = setTimeout(refreshGm, 700); return; } renderConfig(gmBox); }

  /* ---------- сообщения ---------- */
  function sanitizeRun(r){
    if(!r || typeof r!=='object' || typeof r.id!=='string') return null;
    const int = (v, a, b, d)=>{ v = Math.round(+v); return isFinite(v) ? Math.max(a, Math.min(b, v)) : d; }, str = (v, n)=>String(v==null ? '' : v).slice(0, n);
    return {id:str(r.id, 40), title:str(r.title, 60) || 'Групповая проверка', mod:int(r.mod, -21, 21, 0), need:int(r.need, 1, 99, 1), cfg:sanitizeCfg(Object.assign({}, DEFAULT, r.cfg)),
      phase:r.phase==='reveal' ? 'reveal' : 'gather', total:int(r.total, 0, 999, 0), ok:!!r.ok,
      parts:(Array.isArray(r.parts) ? r.parts : []).slice(0, 12).map(p=>({id:str(p && p.id, 40), name:str(p && p.name, 40), stat:STAT_OK.has(p && p.stat) ? p.stat : '',
        label:str(p && p.label, 40), max:p && p.max!=null && isFinite(+p.max) ? Math.round(+p.max) : null, ready:!!(p && p.ready), online:!(p && p.online===false),
        res:p && p.res && typeof p.res==='object' ? {roll:int(p.res.roll, 0, 20, 0), success:!!p.res.success, category:int(p.res.category, 0, 3, 0), missing:!!p.res.missing} : null})).filter(p=>p.id && p.stat)};
  }
  function handle(msg){
    if(!msg || typeof msg.type!=='string' || msg.type.indexOf('grp-')!==0) return false;
    const fromGm = role()==='player' && !!msg.from && msg.from===session.gmId;
    if(msg.type==='grp-state'){ if(fromGm){ const r = sanitizeRun(msg.run); if(r) show(r); } return true; }
    if(msg.type==='grp-end'){ if(fromGm && view && view.id===msg.id) hideStage(); return true; }
    if(msg.type==='grp-ready'){ if(isGm() && msg.from) onReady(msg.from, String(msg.id || '')); return true; }
    return true;
  }

  /* ---------- звук: синтез WebAudio, без файлов ---------- */
  let C = sanitizeCfg(DEFAULT); // подача сцены, которая сейчас на экране
  const SFX = {
    ctx:null, master:null, bus:null, verb:null, noiseBuf:null, amb:[],
    init(){
      if(this.ctx){ if(this.ctx.state==='suspended') this.ctx.resume(); return true; }
      const AC = window.AudioContext || window.webkitAudioContext; if(!AC) return false;
      const c = this.ctx = new AC(); this.master = c.createGain(); this.master.gain.value = .5; this.master.connect(c.destination);
      const len = Math.floor(c.sampleRate*3), imp = c.createBuffer(2, len, c.sampleRate);
      for(let ch=0; ch<2; ch++){ const d = imp.getChannelData(ch); for(let i=0;i<len;i++) d[i] = (Math.random()*2 - 1)*Math.pow(1 - i/len, 2.4); }
      this.verb = c.createConvolver(); this.verb.buffer = imp; const vg = c.createGain(); vg.gain.value = .35; this.verb.connect(vg); vg.connect(this.master);
      const nb = this.noiseBuf = c.createBuffer(1, c.sampleRate*2, c.sampleRate), nd = nb.getChannelData(0); for(let i=0;i<nd.length;i++) nd[i] = Math.random()*2 - 1;
      return true; },
    newBus(){ if(!this.ctx) return; const old = this.bus, c = this.ctx; this.stopAmb();
      if(old){ old.gain.setTargetAtTime(0, c.currentTime, .05); setTimeout(()=>{ try{ old.disconnect(); }catch(e){} }, 500); }
      this.master.gain.setTargetAtTime((C.volume/100)*.9, c.currentTime, .02); this.bus = c.createGain(); this.bus.connect(this.master); this.bus.connect(this.verb); },
    get on(){ return !!(C.sound && this.ctx && this.bus && this.ctx.state==='running'); },
    t(d){ return this.ctx.currentTime + Math.max(0, d)*C.tempo; },
    env(gn, t, a, peak, dec){ gn.gain.setValueAtTime(.0001, t); gn.gain.exponentialRampToValueAtTime(Math.max(.0002, peak), t + a); gn.gain.exponentialRampToValueAtTime(.0001, t + a + dec); },
    tone(type, f, d, a, peak, dec, f2){ if(!this.on) return; const c = this.ctx, t = this.t(d), o = c.createOscillator(), gn = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t); if(f2) o.frequency.exponentialRampToValueAtTime(f2, t + dec); this.env(gn, t, a, peak, dec); o.connect(gn); gn.connect(this.bus); o.start(t); o.stop(t + a + dec + .05); },
    noise(d, dur, type, f, q, peak, a, f2){ if(!this.on) return; const c = this.ctx, t = this.t(d), s = c.createBufferSource(), fl = c.createBiquadFilter(), gn = c.createGain();
      s.buffer = this.noiseBuf; s.loop = true; fl.type = type; fl.frequency.setValueAtTime(f, t); if(f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur); fl.Q.value = q;
      this.env(gn, t, a || .005, peak, Math.max(.01, dur - (a || .005))); s.connect(fl); fl.connect(gn); gn.connect(this.bus); s.start(t); s.stop(t + dur + .05); },
    // фон, пока собираются: тихий гул на всё время сбора (останавливается заменой шины)
    ambient(kind){ if(!this.on) return; const c = this.ctx, t = c.currentTime, fl = c.createBiquadFilter(), gn = c.createGain();
      if(kind==='bridge'){ // ветер в пропасти: шум сквозь полосовой фильтр, частота гуляет
        const s = c.createBufferSource(), lfo = c.createOscillator(), lg = c.createGain(); s.buffer = this.noiseBuf; s.loop = true; fl.type = 'bandpass'; fl.frequency.value = 380; fl.Q.value = .9;
        lfo.frequency.value = .13; lg.gain.value = 240; lfo.connect(lg); lg.connect(fl.frequency); gn.gain.setValueAtTime(.0001, t); gn.gain.exponentialRampToValueAtTime(.12, t + 2);
        s.connect(fl); fl.connect(gn); gn.connect(this.bus); s.start(); lfo.start(); this.amb.push(s, lfo, {stop(){ try{ gn.gain.setTargetAtTime(.0001, c.currentTime, .3); }catch(e){} }}); return; }
      if(kind==='stars'){ // высокая тихая гармония с дрожанием
        [523.25, 783.99, 1046.5, 1318.5].forEach((f, i)=>{ const o = c.createOscillator(), g2 = c.createGain(), lfo = c.createOscillator(), lg = c.createGain(); o.type = 'sine'; o.frequency.value = f;
          lfo.frequency.value = .2 + i*.07; lg.gain.value = .006; g2.gain.value = .008; lfo.connect(lg); lg.connect(g2.gain); o.connect(g2); g2.connect(gn); o.start(); lfo.start(); this.amb.push(o, lfo); });
        gn.gain.setValueAtTime(.0001, t); gn.gain.exponentialRampToValueAtTime(1, t + 2.5); gn.connect(this.bus); this.amb.push({stop(){ try{ gn.gain.setTargetAtTime(.0001, c.currentTime, .3); }catch(e){} }}); return; }
      fl.type = 'lowpass'; fl.frequency.value = kind==='frozen' ? 380 : 620; gn.gain.setValueAtTime(.0001, t); gn.gain.exponentialRampToValueAtTime(kind==='frozen' ? .05 : .07, t + 1.6);
      const fs = kind==='link' ? [73.4, 73.9, 110, 146.8] : kind==='frozen' ? [49, 49.3, 73.4] : [55, 55.5, 82.4, 164.8];
      fs.forEach(f=>{ const o = c.createOscillator(); o.type = kind==='link' ? 'triangle' : 'sawtooth'; o.frequency.value = f; const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = rnd(.05, .2); lg.gain.value = f*.006; lfo.connect(lg); lg.connect(o.frequency); o.connect(fl); o.start(); lfo.start(); this.amb.push(o, lfo); });
      fl.connect(gn); gn.connect(this.bus); this.amb.push({stop(){ try{ gn.gain.setTargetAtTime(.0001, c.currentTime, .25); }catch(e){} }}); },
    stopAmb(){ const c = this.ctx; this.amb.forEach(o=>{ try{ o.stop(c ? c.currentTime + .8 : 0); }catch(e){} }); this.amb = []; },
    chime(d, base, peak){ const b = base || 523.25; [0, 4, 7, 12].forEach((s, i)=>this.tone('triangle', b*Math.pow(2, s/12), d + i*.06, .01, peak || .12, 2)); },
    bell(d, f){ this.tone('sine', f, d, .004, .2, 2.6); this.tone('sine', f*2.76, d, .004, .06, 1.2); this.tone('sine', f*5.4, d, .002, .03, .5); },
    thud(d, f0, g){ this.tone('sine', f0 || 130, d, .004, g || .9, .7, 34); this.noise(d, .2, 'lowpass', 600, .7, (g || .9)*.45); },
    heartbeat(d){ this.tone('sine', 62, d, .01, .6, .16, 44); this.tone('sine', 58, d + .2, .01, .4, .16, 42); },
    tick(d, f){ this.tone('square', f || 1900, d, .001, .05, .03); },
    whoosh(d, dur, f0, f1, peak){ this.noise(d, dur, 'bandpass', f0, 1.2, peak || .3, dur*.7, f1); },
    riser(d, dur, peak){ if(!this.on) return; const c = this.ctx, t = this.t(d), fl = c.createBiquadFilter(), gn = c.createGain(), end = t + dur*C.tempo;
      fl.type = 'lowpass'; fl.frequency.setValueAtTime(200, t); fl.frequency.exponentialRampToValueAtTime(3600, end); fl.Q.value = 5;
      gn.gain.setValueAtTime(.0001, t); gn.gain.exponentialRampToValueAtTime(peak || .16, end); gn.gain.exponentialRampToValueAtTime(.0001, end + .1);
      [110, 110.7, 165, 220.4].forEach(f=>{ const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f*2, end); o.connect(fl); o.start(t); o.stop(end + .12); });
      fl.connect(gn); gn.connect(this.bus); },
    glitch(d, n){ for(let i=0;i<(n || 5);i++) this.tone('square', rnd(260, 2400), d + i*.04, .001, .06, .04); },
    snap(d){ this.noise(d, .26, 'bandpass', 3400, 1.5, .35, .2, 300); this.tone('square', 2400, d + .26, .001, .07, .03); },
    zap(d){ this.noise(d, .45, 'highpass', 2600, .7, .22, .25, 9000); this.tone('sawtooth', 880, d, .002, .1, .3, 110); },
    win(d){ [0, 4, 7, 12, 16, 19].forEach((s, i)=>this.tone('triangle', 392*Math.pow(2, s/12), d + i*.08, .01, .15, 2.8)); this.tone('sine', 98, d, .02, .4, 2.4); },
    lose(d){ this.tone('sine', 392, d, .03, .2, 1.4, 130); this.tone('sine', 466, d + .08, .03, .14, 1.3, 155); this.tone('sine', 73, d, .05, .35, 2); }
  };
  ['pointerdown', 'keydown'].forEach(ev=>document.addEventListener(ev, ()=>{ if(!SFX.ctx || SFX.ctx.state!=='running') SFX.init(); }, {capture:true, passive:true}));

  /* ---------- сцена ----------
     Общее: затемнение, ядро с суммой в центре, карточки участников вокруг, частицы на холсте. У каждой сцены — своя фигура
     (слой .gc-deco) и своя мера успеха: нужное число категорий видно сразу пустыми местами (знаки на круге, синапсы вокруг
     глаза, метки на циферблате, звёзды созвездия, доски моста), каждая выпавшая категория заполняет одно место. */
  let root = null, $ = null, canvas = null, g = null, W = 0, H = 0, view = null, playedId = '', closedId = '', minimized = false, ambTimer = 0, sceneId = 0;
  let units = [], litUnits = 0, endState = '', handTimer = 0; // места меры успеха: координаты; сколько заполнено; итог сцены ('win'|'lose')
  const D20 = (n)=>`<svg viewBox="-110 -110 220 220" aria-hidden="true"><polygon class="gc-df a" points="0,-100 86.6,-50 86.6,50 0,100 -86.6,50 -86.6,-50"/>
    <polygon class="gc-df b" points="0,-56 48.5,28 -48.5,28"/><polyline class="gc-de" points="0,-100 0,-56 86.6,-50 48.5,28 86.6,50 0,100 48.5,28 -48.5,28 0,100 -86.6,50 -48.5,28 -86.6,-50 0,-56 -48.5,28"/>
    <polygon class="gc-de" points="0,-100 86.6,-50 86.6,50 0,100 -86.6,50 -86.6,-50"/><text class="gc-dn" x="0" y="8">${n}</text></svg>`;
  function build(){
    if(root) return;
    root = document.createElement('div'); root.className = 'gc-stage'; root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Групповая проверка');
    root.innerHTML = `<div class="gc-shake">
        <div class="gc-world"><div class="gc-dim"></div><div class="gc-tint"></div></div>
        <svg class="gc-deco" aria-hidden="true"></svg>
        <div class="gc-bar top"></div><div class="gc-bar bot"></div>
        <svg class="gc-threads" aria-hidden="true"></svg>
        <div class="gc-beam"></div>
        <div class="gc-core"><svg viewBox="-260 -260 520 520" aria-hidden="true"><defs>
            <path id="gcRingA" d="M -228 0 a 228 228 0 1 1 456 0 a 228 228 0 1 1 -456 0"/><path id="gcRingB" d="M -170 0 a 170 170 0 1 0 340 0 a 170 170 0 1 0 -340 0"/></defs>
          <g class="gc-ring r1"><circle r="244" fill="none" stroke="var(--gcfx)" stroke-width="1.6" opacity=".7"/><circle r="212" fill="none" stroke="var(--gcfx)" stroke-width="1" opacity=".45" stroke-dasharray="3 9"/>
            <text font-family="Cinzel, serif" font-size="19" letter-spacing="6" fill="var(--gcfx)"><textPath href="#gcRingA">ОДНА СУДЬБА НА ВСЕХ ✦ ОБЩАЯ КЛЯТВА ✦ ПЛЕЧОМ К ПЛЕЧУ ✦ ОДНА СУДЬБА НА ВСЕХ ✦ ОБЩАЯ КЛЯТВА ✦</textPath></text></g>
          <g class="gc-ring r2"><circle r="186" fill="none" stroke="var(--gcfx)" stroke-width="1" opacity=".5"/>
            <text font-family="Cinzel, serif" font-size="14" letter-spacing="5" fill="var(--gcfx)" opacity=".85"><textPath href="#gcRingB">СЛОВО ✧ КРОВЬ ✧ ПЕЧАТЬ ✧ СЛОВО ✧ КРОВЬ ✧ ПЕЧАТЬ ✧ СЛОВО ✧ КРОВЬ ✧</textPath></text></g>
          <g class="gc-ring r3"><polygon points="0,-140 121,70 -121,70" fill="none" stroke="var(--gcfx)" stroke-width="1.4" opacity=".55"/><polygon points="0,140 121,-70 -121,-70" fill="none" stroke="var(--gcfx)" stroke-width="1.4" opacity=".55"/></g></svg>
          <div class="gc-sum"><b class="gc-sum-n">0</b><span class="gc-sum-need">из 3</span><i>категорий успеха</i></div></div>
        <canvas class="gc-fx"></canvas>
        <div class="gc-cards"></div>
        <svg class="gc-crack" aria-hidden="true"></svg>
        <div class="gc-head"><div class="gc-title"></div><div class="gc-sub"></div></div>
        <div class="gc-me"></div>
        <div class="gc-verdict"><div class="gc-v-main"></div><div class="gc-v-sub"></div></div>
        <div class="gc-vignette"></div><div class="gc-flash"></div>
      </div>
      <div class="gc-ctl"></div>`;
    document.body.appendChild(root);
    const q = (s)=>root.querySelector(s);
    $ = {shake:q('.gc-shake'), world:q('.gc-world'), dim:q('.gc-dim'), tint:q('.gc-tint'), deco:q('.gc-deco'), threads:q('.gc-threads'), beam:q('.gc-beam'), core:q('.gc-core'),
      r1:q('.gc-ring.r1'), r2:q('.gc-ring.r2'), r3:q('.gc-ring.r3'), sum:q('.gc-sum'), sumN:q('.gc-sum-n'), sumNeed:q('.gc-sum-need'), cards:q('.gc-cards'), crack:q('.gc-crack'),
      head:q('.gc-head'), title:q('.gc-title'), sub:q('.gc-sub'), me:q('.gc-me'), verdict:q('.gc-verdict'), vMain:q('.gc-v-main'), vSub:q('.gc-v-sub'), vignette:q('.gc-vignette'),
      flash:q('.gc-flash'), barTop:q('.gc-bar.top'), barBot:q('.gc-bar.bot'), ctl:q('.gc-ctl')};
    canvas = q('.gc-fx'); g = canvas.getContext('2d');
    root.addEventListener('click', onStageClick);
    addEventListener('resize', ()=>{ if(root && !root.hidden){ resize(); layout(); } });
    const pill = document.createElement('button'); pill.type = 'button'; pill.className = 'gc-pill'; pill.hidden = true; pill.innerHTML = '<span>◎</span> Групповая проверка';
    pill.addEventListener('click', ()=>{ minimized = false; pill.hidden = true; root.hidden = false; document.body.classList.add('gc-on'); resize(); layout(); });
    document.body.appendChild(pill); $.pill = pill;
  }
  function resize(){ const dpr = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight; canvas.width = Math.round(W*dpr); canvas.height = Math.round(H*dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0); }
  const K = ()=>(C.intensity/100)*(reduceMotion ? .45 : 1), N = (b)=>Math.max(1, Math.round(b*K()));
  const Dms = (ms)=>ms*C.tempo, wait = (ms)=>new Promise(r=>setTimeout(r, Dms(ms)));
  const anim = (el, fr, ms, o)=>el.animate(fr, Object.assign({duration:Dms(ms), fill:'forwards', easing:'cubic-bezier(.2,.7,.2,1)'}, o || {}));
  const SCENE_FX = {oath:'#9a8cff', link:'#7fe3ff', frozen:'#cfe3ef', stars:'#d6dcff', bridge:'#f0b45c'};
  function accent(kind){ if(C.accent==='custom') return C.custom; if(C.accent!=='auto') return ACCENTS[C.accent];
    return kind==='win' ? ACCENTS.gold : kind==='lose' ? ACCENTS.blood : SCENE_FX[C.scene] || ACCENTS.psi; }
  const setFx = (kind)=>root.style.setProperty('--gcfx', accent(kind));
  const fxColor = ()=>getComputedStyle(root).getPropertyValue('--gcfx').trim() || '#9a8cff';
  const seeded = (n)=>{ let s = (n + 1)*9301 + 49297; return ()=>{ s = (s*9301 + 49297)%233280; return s/233280; }; };

  /* ---------- частицы ---------- */
  let parts = [], rafOn = false, last = 0;
  function spawn(p){ parts.push(Object.assign({x:0, y:0, vx:0, vy:0, ay:0, drag:1, life:0, max:1, size:3, type:'dot', color:'#fff', add:true, alpha:1}, p));
    if(!rafOn){ rafOn = true; last = performance.now(); requestAnimationFrame(tick); } }
  function tick(now){
    const dt = Math.min(.05, (now - last)/1000); last = now; g.clearRect(0, 0, W, H);
    parts = parts.filter(p=>{ p.life += dt; if(p.life >= p.max) return false; if(p.update) p.update(p, dt);
      p.vy += p.ay*dt; const d = Math.pow(p.drag, dt*60); p.vx *= d; p.vy *= d; p.x += p.vx*dt; p.y += p.vy*dt; if(p.vr) p.rot = (p.rot || 0) + p.vr*dt;
      const k = 1 - p.life/p.max; g.globalCompositeOperation = p.add ? 'lighter' : 'source-over'; g.globalAlpha = Math.max(0, Math.min(1, k*p.alpha));
      if(p.type==='dot'){ g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y, Math.max(.3, p.size*(.35 + .65*k)), 0, 6.283); g.fill(); }
      else if(p.type==='spark'){ g.strokeStyle = p.color; g.lineWidth = Math.max(.6, p.size*k); g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx*(p.tail || .035), p.y - p.vy*(p.tail || .035)); g.stroke(); }
      else if(p.type==='ring'){ const r = p.r0 + (p.r1 - p.r0)*(1 - k*k); g.strokeStyle = p.color; g.lineWidth = Math.max(.5, p.size*k); g.beginPath(); g.arc(p.x, p.y, r, 0, 6.283); g.stroke(); }
      else if(p.type==='shard'){ g.save(); g.translate(p.x, p.y); g.rotate(p.rot || 0); g.fillStyle = p.color; g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = .8;
        g.beginPath(); g.moveTo(-p.size, -p.size*.5); g.lineTo(p.size*.9, -p.size*.2); g.lineTo(-p.size*.2, p.size); g.closePath(); g.fill(); g.stroke(); g.restore(); }
      else if(p.type==='bolt'){ g.strokeStyle = p.color; g.lineWidth = 2*k + .5; g.beginPath(); p.pts.forEach((q, i)=>i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.stroke(); }
      return true; });
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    if(parts.length) requestAnimationFrame(tick); else { rafOn = false; g.clearRect(0, 0, W, H); } }
  // центр и радиус ядра — по раскладке, не по экрану: ядро само «вырастает» и пульсирует анимацией масштаба
  const center = ()=>{ const el = $.core; return {x:el.offsetLeft + el.offsetWidth/2, y:el.offsetTop + el.offsetHeight/2, r:el.offsetWidth/2}; };
  const cardPt = (el)=>{ const r = el.getBoundingClientRect(); return {x:r.left + r.width/2, y:r.top + r.height/2}; };
  function ring(x, y, r0, r1, color, size, dur){ spawn({type:'ring', x, y, r0, r1, size, color, max:dur}); }
  function burst(x, y, count, color, o){ o = o || {}; for(let i=0;i<count;i++){ const a = o.a!=null ? o.a + rnd(-o.spread || -.5, o.spread || .5) : rnd(0, 6.283), sp = rnd(o.min || 120, o.max || 620);
    spawn({type:'spark', x, y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, ay:o.g || 0, drag:.94, size:rnd(1.2, 2.6), color, max:rnd(.35, o.life || .9)}); } }
  function motesTo(tx, ty, count, color, R){ for(let i=0;i<count;i++){ const a = rnd(0, 6.283), r = (R || Math.max(W, H)*.6)*rnd(.6, 1);
    spawn({x:tx + Math.cos(a)*r, y:ty + Math.sin(a)*r, size:rnd(1.4, 3.4), color, max:rnd(1, 1.6), a, r, update(p, dt){ p.r *= Math.pow(.16, dt); p.a += dt*2.2; p.x = tx + Math.cos(p.a)*p.r; p.y = ty + Math.sin(p.a)*p.r; }}); } }
  // огонёк по пути: прямо или по живой нити («Связь разумов» — кривая, которая колышется)
  function pulseAlong(a, b, color, dur, size, curved){ spawn({x:a.x, y:a.y, size:size || 4, color, max:dur || .9, update(p){ const t = Math.min(1, p.life/p.max), e = t*t*(3 - 2*t);
    if(curved){ const q = curveCtl(a, b); p.x = (1 - e)*(1 - e)*a.x + 2*(1 - e)*e*q.x + e*e*b.x; p.y = (1 - e)*(1 - e)*a.y + 2*(1 - e)*e*q.y + e*e*b.y; } else { p.x = a.x + (b.x - a.x)*e; p.y = a.y + (b.y - a.y)*e; } }}); }
  function bolt(a, b, color, life){ const pts = [[a.x, a.y]], n = 7, dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    for(let i=1;i<n;i++){ const t = i/n, j = rnd(-1, 1)*L*.08; pts.push([a.x + dx*t - dy/L*j, a.y + dy*t + dx/L*j]); } pts.push([b.x, b.y]); spawn({type:'bolt', pts, color, max:life || .35}); }
  function shake(power, ms){ if(!C.shake || reduceMotion || power < 1) return; const f = [];
    for(let i=0;i<9;i++){ const k = 1 - i/9; f.push({transform:`translate(${rnd(-1, 1)*power*k}px, ${rnd(-1, 1)*power*k}px)`}); } f.push({transform:'none'}); $.shake.animate(f, {duration:ms, easing:'ease-out'}); }
  const flash = (peak, ms)=>$.flash.animate([{opacity:0}, {opacity:peak, offset:.15}, {opacity:0}], {duration:ms, easing:'ease-out'});
  // контрольная точка живой нити: изгиб колышется во времени
  function curveCtl(a, b){ const mx = (a.x + b.x)/2, my = (a.y + b.y)/2, dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, t = performance.now()/700, ph = (a.x*.013 + a.y*.007);
    const w = L*.18*Math.sin(t + ph); return {x:mx - dy/L*w, y:my + dx/L*w}; }

  /* ---------- раскладка карточек, нитей и фигуры сцены ---------- */
  function layout(){
    if(!view) return; const cards = [...$.cards.children], n = cards.length, narrow = W < 720;
    // кольцо — между заголовком и своей карточкой снизу, чтобы карточки участников их не перекрывали;
    // низ — общий для сбора (своя карточка) и итога (надпись исхода на том же месте): раскладка не прыгает при броске
    const top = $.head.getBoundingClientRect().bottom + 12, bottom = Math.min($.me.hidden ? H : $.me.getBoundingClientRect().top - 12, H - Math.max(narrow ? 190 : 215, H*.13 + 115));
    const cols = Math.max(1, Math.min(n, W < 420 ? 2 : 3)), rowsH = Math.ceil(n/cols)*94; // узкий экран: карточки рядами сверху, ядро под ними
    const coreSize = narrow ? Math.max(110, Math.min(W*.5, bottom - top - rowsH - 16)) : Math.max(130, Math.min(300, (bottom - top)*.55));
    const cy = narrow ? Math.min(bottom - coreSize/2, top + rowsH + 8 + coreSize/2) : (top + bottom)/2;
    $.core.style.width = $.core.style.height = coreSize + 'px'; $.core.style.left = (W/2 - coreSize/2) + 'px'; $.core.style.top = (cy - coreSize/2) + 'px';
    if(narrow){ const cw = Math.min(150, (W - 24)/cols - 8);
      cards.forEach((el, i)=>{ const row = Math.floor(i/cols), col = i%cols, inRow = Math.min(cols, n - row*cols); el.style.width = cw + 'px';
        el.style.left = (W/2 + (col - (inRow - 1)/2)*(cw + 8) - cw/2) + 'px'; el.style.top = (top + row*94) + 'px'; }); }
    else { const rx = Math.min(W*.38, 470), ry = Math.max(coreSize*.5, Math.min((bottom - top)/2 - 56, 250));
      cards.forEach((el, i)=>{ const a = -Math.PI/2 + (n===1 ? 0 : (i/n)*Math.PI*2) + (n===2 ? Math.PI/2 : 0), x = W/2 + Math.cos(a)*rx, y = cy + Math.sin(a)*ry;
        el.style.width = ''; el.style.left = (x - 78) + 'px'; el.style.top = (y - 52) + 'px'; }); }
    buildDeco(Math.max(view.need, view.phase==='reveal' ? view.total : 0)); drawThreads();
  }
  function drawThreads(){
    if(!view) return; const c = center(), cards = [...$.cards.children], live = C.scene==='link'; $.threads.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const d = (a, b)=>{ if(!live) return `M${a.x} ${a.y} L${b.x} ${b.y}`; const q = curveCtl(a, b); return `M${a.x} ${a.y} Q${q.x} ${q.y} ${b.x} ${b.y}`; };
    let html = '';
    cards.forEach(el=>{ const p = cardPt(el), cls = el.classList.contains('lose') ? ' dead' : el.classList.contains('ready') ? ' on' : ''; html += `<path class="gc-th${cls}" d="${d(p, c)}"/>`; });
    if(live) for(let i=0;i<cards.length;i++) for(let j=i + 1;j<cards.length;j++){ const on = cards[i].classList.contains('ready') && cards[j].classList.contains('ready');
      html += `<path class="gc-th web${on ? ' on' : ''}" d="${d(cardPt(cards[i]), cardPt(cards[j]))}"/>`; }
    if(C.scene==='stars'){ const lit = cards.filter(el=>el.classList.contains('ready')); for(let i=1;i<lit.length;i++){ const a = cardPt(lit[i - 1]), b = cardPt(lit[i]); html += `<path class="gc-th web on" d="M${a.x} ${a.y} L${b.x} ${b.y}"/>`; } }
    $.threads.innerHTML = html;
  }
  // фигура сцены и места меры успеха (n — сколько мест: нужное, а после броска — сколько набрали, если больше)
  function unitPos(i, n, c){
    const a = -Math.PI/2 + (i/n)*Math.PI*2;
    if(C.scene==='oath') return {x:c.x + Math.cos(a)*c.r*1.55, y:c.y + c.r*.62 + Math.sin(a)*c.r*.46};
    if(C.scene==='link') return {x:c.x + Math.cos(a)*c.r*1.32, y:c.y + Math.sin(a)*c.r*1.05};
    if(C.scene==='frozen') return {x:c.x + Math.cos(a)*c.r*1.08, y:c.y + Math.sin(a)*c.r*1.08};
    if(C.scene==='stars'){ const R = seeded(i), rr = c.r*(1.05 + R()*.5), aa = a + (R() - .5)*(Math.PI/n)*.8; return {x:c.x + Math.cos(aa)*rr*1.45, y:c.y + Math.sin(aa)*rr*.95}; } // созвездие обрамляет сумму, линии её не перечёркивают
    const span = bridgeSpan(c); return {x:c.x - span/2 + (i + .5)*span/n, y:c.y + c.r*.16}; // мост — по линии центра, сумма над ним
  }
  const bridgeSpan = (c)=>Math.min(W < 720 ? W*.86 : W*.56, 960);
  function sigil(i, s){ const R = seeded(i*7 + 3), p = []; for(let k=0;k<4;k++) p.push([(Math.round(R()*2) - 1)*s, (Math.round(R()*2) - 1)*s]);
    return 'M' + p.map(q=>q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' L') + ` M${(-s*.7).toFixed(1)} ${(s*1.25).toFixed(1)} L${(s*.7).toFixed(1)} ${(s*1.25).toFixed(1)}`; }
  function buildDeco(n){
    const c = center(); units = []; for(let i=0;i<n;i++) units.push(unitPos(i, n, c));
    $.deco.setAttribute('viewBox', `0 0 ${W} ${H}`); const need = view ? view.need : n; let h = '';
    const U = (i, inner, x, y)=>`<g class="gc-u${i < litUnits ? ' on' : ''}${i >= need ? ' bonus' : ''}" data-i="${i}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><g class="gc-ui">${inner}</g></g>`;
    if(C.scene==='oath'){ // ритуальный круг на полу: двойной эллипс, пентаграмма, знаки участников клятвы
      const fx = c.x, fy = c.y + c.r*.62, rx = c.r*1.55, ry = c.r*.46, star = [0, 2, 4, 1, 3, 0].map(k=>{ const a = -Math.PI/2 + k/5*Math.PI*2; return `${(fx + Math.cos(a)*rx*.78).toFixed(1)},${(fy + Math.sin(a)*ry*.78).toFixed(1)}`; }).join(' ');
      h = `<g class="gc-oath"><ellipse class="gc-floor" cx="${fx}" cy="${fy}" rx="${rx}" ry="${ry}"/><ellipse class="gc-floor in" cx="${fx}" cy="${fy}" rx="${rx*.84}" ry="${ry*.84}"/>
        <polyline class="gc-floor st" points="${star}"/>${units.map((u, i)=>U(i, `<circle class="gc-u-bg" r="13"/><path class="gc-sig" d="${sigil(i, 6)}"/>`, u.x, u.y)).join('')}</g>`;
    } else if(C.scene==='link'){ // глаз изнанки: сумма — в зрачке; вокруг синапсы
      const rx = c.r*1.02, ry = c.r*.56;
      h = `<g class="gc-link">${units.map(u=>`<line class="gc-spoke" x1="${c.x}" y1="${c.y}" x2="${u.x.toFixed(1)}" y2="${u.y.toFixed(1)}"/>`).join('')}
        <g class="gc-eye${endState==='win' ? ' wide' : endState==='lose' ? ' shut' : ''}" style="transform-origin:${c.x}px ${c.y}px"><path class="gc-eye-w" d="M${c.x - rx} ${c.y} Q${c.x} ${c.y - ry*2} ${c.x + rx} ${c.y} Q${c.x} ${c.y + ry*2} ${c.x - rx} ${c.y} Z"/>
          <circle class="gc-iris" cx="${c.x}" cy="${c.y}" r="${c.r*.5}"/><circle class="gc-pupil" cx="${c.x}" cy="${c.y}" r="${c.r*.34}"/>
          <path class="gc-eye-l" d="M${c.x - rx} ${c.y} Q${c.x} ${c.y - ry*2} ${c.x + rx} ${c.y}"/><path class="gc-eye-l" d="M${c.x - rx} ${c.y} Q${c.x} ${c.y + ry*2} ${c.x + rx} ${c.y}"/></g>
        ${units.map((u, i)=>U(i, `<circle class="gc-u-bg" r="10"/><circle class="gc-u-core" r="4"/>`, u.x, u.y)).join('')}</g>`;
    } else if(C.scene==='frozen'){ // циферблат за суммой: стрелки встают, метки — мера успеха
      const R = c.r*1.42, num = ['XII','I','II','III','IV','V','VI','VII','VIII','IX','X','XI'];
      let ticks = ''; for(let k=0;k<60;k++){ const a = k/60*Math.PI*2, r0 = k%5 ? R*.95 : R*.88; ticks += `<line class="gc-tk${k%5 ? '' : ' h'}" x1="${(c.x + Math.sin(a)*r0).toFixed(1)}" y1="${(c.y - Math.cos(a)*r0).toFixed(1)}" x2="${(c.x + Math.sin(a)*R).toFixed(1)}" y2="${(c.y - Math.cos(a)*R).toFixed(1)}"/>`; }
      h = `<g class="gc-clock${endState==='lose' ? ' broken' : ''}"><circle class="gc-clock-f" cx="${c.x}" cy="${c.y}" r="${R}"/><circle class="gc-clock-f in" cx="${c.x}" cy="${c.y}" r="${R*.8}"/>${ticks}
        ${num.map((t, k)=>{ const a = k/12*Math.PI*2; return `<text class="gc-num" x="${(c.x + Math.sin(a)*R*.72).toFixed(1)}" y="${(c.y - Math.cos(a)*R*.72).toFixed(1)}">${t}</text>`; }).join('')}
        <g class="gc-hand h" style="transform-origin:${c.x}px ${c.y}px;transform:rotate(${hands.h}deg)"><line x1="${c.x}" y1="${c.y + R*.08}" x2="${c.x}" y2="${c.y - R*.42}"/></g>
        <g class="gc-hand m" style="transform-origin:${c.x}px ${c.y}px;transform:rotate(${hands.m}deg)"><line x1="${c.x}" y1="${c.y + R*.1}" x2="${c.x}" y2="${c.y - R*.62}"/></g>
        <g class="gc-hand s" style="transform-origin:${c.x}px ${c.y}px;transform:rotate(${hands.s}deg)"><line x1="${c.x}" y1="${c.y + R*.14}" x2="${c.x}" y2="${c.y - R*.84}"/></g>
        ${units.map((u, i)=>U(i, `<rect class="gc-u-bg" x="-7" y="-7" width="14" height="14" transform="rotate(45)"/><circle class="gc-u-core" r="3"/>`, u.x, u.y)).join('')}</g>`;
    } else if(C.scene==='stars'){ // ночное небо: мерцание, созвездие из пустых звёзд
      const R = seeded(97); let bg = ''; for(let k=0;k<160;k++){ const r = R(); bg += `<circle class="gc-tw" cx="${(R()*W).toFixed(0)}" cy="${(R()*H).toFixed(0)}" r="${(.4 + r*1.4).toFixed(2)}" style="animation-delay:-${(R()*5).toFixed(2)}s;animation-duration:${(2.5 + R()*4).toFixed(2)}s"/>`; }
      let lines = ''; for(let i=1;i<units.length;i++) lines += `<line class="gc-cl${i < litUnits ? ' on' : ''}" data-i="${i}" x1="${units[i - 1].x.toFixed(1)}" y1="${units[i - 1].y.toFixed(1)}" x2="${units[i].x.toFixed(1)}" y2="${units[i].y.toFixed(1)}"/>`;
      h = `<g class="gc-sky${endState==='lose' ? ' dark' : ''}">${bg}<g class="gc-milky"><ellipse cx="${W*.5}" cy="${H*.45}" rx="${W*.7}" ry="${H*.12}" transform="rotate(-18 ${W*.5} ${H*.45})"/></g>${lines}
        ${units.map((u, i)=>U(i, `<circle class="gc-u-bg" r="9"/><path class="gc-u-star" d="M0 -12 L2.2 -2.2 L12 0 L2.2 2.2 L0 12 L-2.2 2.2 L-12 0 L-2.2 -2.2 Z"/><circle class="gc-u-core" r="2.6"/>`, u.x, u.y)).join('')}</g>`;
    } else { // мост над пропастью: края, туман, верёвки, пустые места под доски
      const span = bridgeSpan(c), x0 = c.x - span/2, x1 = c.x + span/2, by = c.y + c.r*.16, R = seeded(31), pw = span/units.length;
      const edge = (x, dir)=>{ let pts = `${dir < 0 ? 0 : W},0 `; for(let y=0;y<=H + 40;y+=40) pts += `${(x + dir*(R()*26 - 4)).toFixed(0)},${y} `; return pts + `${dir < 0 ? 0 : W},${H}`; };
      h = `<g class="gc-bridge${endState==='lose' ? ' fell' : endState==='win' ? ' done' : ''}"><defs><linearGradient id="gcAbyss" x1="0" x2="1"><stop offset="0" stop-color="#050404"/><stop offset=".5" stop-color="#0d1218"/><stop offset="1" stop-color="#050404"/></linearGradient></defs>
        <rect x="${x0 - 30}" y="0" width="${span + 60}" height="${H}" fill="url(#gcAbyss)"/>
        <g class="gc-fog"><ellipse cx="${c.x - span*.2}" cy="${H*.3}" rx="${span*.35}" ry="40"/><ellipse cx="${c.x + span*.25}" cy="${H*.62}" rx="${span*.4}" ry="52"/><ellipse cx="${c.x}" cy="${H*.85}" rx="${span*.3}" ry="36"/></g>
        <polygon class="gc-cliff" points="${edge(x0, -1)}"/><polygon class="gc-cliff" points="${edge(x1, 1)}"/>
        <path class="gc-rope" d="M${x0 - 14} ${by - 17} Q${c.x} ${by - 4} ${x1 + 14} ${by - 17}"/><path class="gc-rope" d="M${x0 - 14} ${by + 17} Q${c.x} ${by + 30} ${x1 + 14} ${by + 17}"/>
        ${units.map((u, i)=>{ const sag = Math.sin((i + .5)/units.length*Math.PI)*13; return U(i, `<rect class="gc-slot" x="${(-pw/2 + 3).toFixed(1)}" y="-14" width="${(pw - 6).toFixed(1)}" height="28" rx="3"/><g class="gc-plank"><rect x="${(-pw/2 + 3).toFixed(1)}" y="-14" width="${(pw - 6).toFixed(1)}" height="28" rx="3"/><line x1="${(-pw/2 + 9).toFixed(1)}" y1="-5" x2="${(pw/2 - 9).toFixed(1)}" y2="-7"/><line x1="${(-pw/2 + 12).toFixed(1)}" y1="6" x2="${(pw/2 - 14).toFixed(1)}" y2="5"/></g>`, u.x, u.y + sag); }).join('')}</g>`;
    }
    $.deco.innerHTML = h; if(endState && $.deco.firstElementChild) $.deco.firstElementChild.classList.add(endState==='win' ? 'won' : 'lost');
  }

  /* ---------- показ состояния (у всех; у Мастера — из run) ---------- */
  function show(r){
    if(!r){ hideStage(); return; }
    if(!view && r.id===closedId) return; // игрок сам закрыл итог — повторные рассылки сцену не открывают
    build(); const fresh = !view || view.id!==r.id, prev = view; view = r;
    if(r.phase==='reveal' && playedId!==r.id){ minimized = false; $.pill.hidden = true; } // бросок — свёрнутая сцена разворачивается
    if(fresh){ C = sanitizeCfg(Object.assign({}, DEFAULT, r.cfg)); playedId = ''; minimized = false; enter(); }
    $.title.textContent = r.title; $.sub.textContent = `Нужно набрать ${r.need} ${catWord(r.need)} успеха на всех · модификатор ${signed(r.mod)} · Максимум = ЗХ + 10 ${r.mod ? (r.mod > 0 ? '+ ' : '− ') + Math.abs(r.mod) : ''}`;
    $.sumNeed.textContent = 'из ' + r.need;
    const me = session && session.myId, mine = r.parts.find(p=>p.id===me), prevMine = prev && prev.id===r.id ? prev.parts.find(p=>p.id===me) : null;
    const have = new Map([...$.cards.children].map(el=>[el.dataset.id, el])), lit = []; // lit — зажглись сейчас: эффект после раскладки
    r.parts.forEach(p=>{ let el = have.get(p.id); have.delete(p.id);
      if(!el){ el = document.createElement('div'); el.className = 'gc-card'; el.dataset.id = p.id; el.innerHTML = `<div class="gc-c-sig"></div><div class="gc-c-name"></div><div class="gc-c-stat"></div><div class="gc-c-max"></div><div class="gc-c-state"></div><div class="gc-c-die">${D20('')}</div>`;
        $.cards.appendChild(el); if(!fresh) anim(el, [{opacity:0, transform:'scale(.7)'}, {opacity:1, transform:'none'}], 420); }
      const was = prev && prev.id===r.id && prev.parts.find(x=>x.id===p.id);
      el.querySelector('.gc-c-name').textContent = p.name; el.querySelector('.gc-c-stat').textContent = p.label; el.querySelector('.gc-c-max').textContent = p.max==null ? 'лист не пришёл' : 'Макс. ' + p.max;
      el.classList.toggle('me', p.id===me); el.classList.toggle('off', !p.online);
      if(r.phase==='gather'){ el.querySelector('.gc-c-state').textContent = p.ready ? '✓ Готов' : p.online ? 'ждём…' : 'не в сети';
        if(p.ready && !el.classList.contains('ready')){ el.classList.add('ready'); if(!fresh) lit.push(el); } else if(!p.ready) el.classList.remove('ready');
        if(was && was.stat!==p.stat){ el.classList.remove('changed'); void el.offsetWidth; el.classList.add('changed'); SFX.glitch(0, 3); } }
    });
    have.forEach(el=>{ el.animate([{opacity:1}, {opacity:0, transform:'scale(.6)'}], {duration:300, fill:'forwards'}).onfinish = ()=>{ el.remove(); layout(); }; });
    if(r.phase==='gather'){
      if(mine){ const changedStat = prevMine && prevMine.stat!==mine.stat;
        $.me.innerHTML = `<div class="gc-me-lbl">${changedStat ? 'Мастер сменил вашу характеристику' : 'Ваша характеристика'}</div><div class="gc-me-stat${changedStat ? ' changed' : ''}">${esc(mine.label)}</div>
          <div class="gc-me-max">${mine.max==null ? '' : `Максимум ${mine.max} · к20 бросает Мастер, когда все будут готовы`}</div>
          ${mine.ready ? '<div class="gc-me-ok">✓ Вы готовы — ждём остальных</div>' : '<button type="button" class="gc-ready" data-gc="ready">Готов</button>'}`; }
      else $.me.innerHTML = `<div class="gc-me-lbl">${isGm() ? 'Вы — Мастер' : 'Вы не участвуете в этой проверке'}</div><div class="gc-me-watch">${isGm() ? 'Характеристики меняются на экране Мастера, вкладка «Групповая»' : 'Наблюдайте — вам характеристика не назначена'}</div>`;
      $.me.hidden = false;
    } else $.me.hidden = true;
    ctlButtons();
    if(!minimized){ root.hidden = false; document.body.classList.add('gc-on'); }
    resize(); layout(); lit.forEach(el=>readyFx(el));
    if(r.phase==='reveal' && playedId!==r.id){ playedId = r.id; if(fresh) finalStatic(); else reveal(r); } // открыл уже после броска — сразу итог
  }
  const catWord = (n)=>{ const m10 = n%10, m100 = n%100; return m10===1 && m100!==11 ? 'категорию' : m10>=2 && m10<=4 && (m100<12 || m100>14) ? 'категории' : 'категорий'; };
  function ctlButtons(){
    const done = view && view.phase==='reveal', gm = isGm() && run && !run.preview;
    $.ctl.innerHTML = (gm && !done ? '<button type="button" data-gc="force" title="Бросить за всех участников сейчас, не дожидаясь «Готов»">⚡ Бросить сейчас</button><button type="button" data-gc="cancel" title="Отменить проверку у всех">✕ Отменить</button>' : '')
      + (gm && done ? '<button type="button" data-gc="end" title="Закрыть сцену у всех">✓ Завершить у всех</button>' : '')
      + (run && run.preview ? '<button type="button" data-gc="close">Закрыть предпросмотр</button>' : !gm && done ? '<button type="button" data-gc="close">Закрыть</button>' : '<button type="button" data-gc="min" title="Свернуть: сцена останется внизу кнопкой">Свернуть</button>');
  }
  function onStageClick(e){
    const b = e.target.closest('[data-gc]'); if(!b) return; const a = b.dataset.gc;
    if(a==='ready'){ if(!view) return; SFX.init(); b.disabled = true;
      if(isGm()) onReady(session.myId, view.id); else if(typeof sendMsg==='function') sendMsg({type:'grp-ready', id:view.id}, session.gmId);
      const mine = $.cards.querySelector(`.gc-card[data-id="${CSS.escape(session.myId || '')}"]`); if(mine && !mine.classList.contains('ready')){ mine.classList.add('ready'); readyFx(mine, true); } }
    else if(a==='min'){ minimized = true; root.hidden = true; document.body.classList.remove('gc-on'); $.pill.hidden = false; }
    else if(a==='close'){ if(run && run.preview){ run = null; } else if(view) closedId = view.id; hideStage(); }
    else if(a==='force') rollAll();
    else if(a==='cancel') uiConfirm('Отменить групповую проверку у всех?', {ok:'Отменить', danger:true}).then(ok=>{ if(ok) cancel(); });
    else if(a==='end') cancel();
  }
  function stopTimers(){ clearInterval(ambTimer); clearInterval(handTimer); ambTimer = handTimer = 0; }
  function hideStage(){ if(!root) return; sceneId++; SFX.stopAmb(); stopTimers(); root.getAnimations({subtree:true}).forEach(x=>x.cancel());
    root.hidden = true; $.pill.hidden = true; document.body.classList.remove('gc-on'); view = null; parts = []; $.cards.innerHTML = ''; $.threads.innerHTML = ''; $.deco.innerHTML = ''; $.crack.innerHTML = ''; }

  /* ---------- вход в сцену и ожидание ---------- */
  function enter(){
    sceneId++; const id = sceneId; root.getAnimations({subtree:true}).forEach(x=>x.cancel()); stopTimers(); parts = []; litUnits = 0; endState = '';
    $.cards.innerHTML = ''; $.crack.innerHTML = ''; $.verdict.className = 'gc-verdict'; $.vMain.textContent = ''; $.vSub.textContent = ''; $.sumN.textContent = '0'; $.core.className = 'gc-core'; $.world.classList.remove('gray');
    root.className = 'gc-stage s-' + C.scene; setFx('wait'); if(C.sound) SFX.init(); SFX.newBus();
    root.hidden = false; document.body.classList.add('gc-on'); resize();
    anim($.dim, [{opacity:0}, {opacity:C.dim ? (C.scene==='stars' ? 1 : .95) : .4}], 600);
    anim($.core, [{opacity:0, transform:'scale(.4)'}, {opacity:1, transform:'none'}], 1100);
    anim($.deco, [{opacity:0}, {opacity:1}], 1400);
    anim($.title, [{opacity:0, letterSpacing:'.6em', filter:'blur(8px)'}, {opacity:1, letterSpacing:'.14em', filter:'blur(0)'}], 1100);
    SFX.whoosh(0, 1.2, 180, 1600, .3); setTimeout(()=>{ if(sceneId===id) SFX.ambient(C.scene); }, Dms(900));
    const every = (ms, fn)=>{ ambTimer = setInterval(()=>{ if(sceneId!==id){ clearInterval(ambTimer); return; } fn(); }, ms); };
    if(C.scene==='oath'){
      SFX.riser(0, 1.1, .1); SFX.bell(.9, 196);
      $.r1.animate([{transform:'rotate(0)'}, {transform:'rotate(360deg)'}], {duration:reduceMotion ? 60000 : 24000, iterations:Infinity});
      $.r2.animate([{transform:'rotate(0)'}, {transform:'rotate(-360deg)'}], {duration:reduceMotion ? 50000 : 17000, iterations:Infinity});
      $.r3.animate([{transform:'rotate(0) scale(1)'}, {transform:'rotate(60deg) scale(1.04)'}, {transform:'rotate(120deg) scale(1)'}], {duration:9000, iterations:Infinity});
      every(240, ()=>{ const c = center(); for(let i=0;i<N(2);i++){ const a = rnd(0, 6.283); spawn({x:c.x + Math.cos(a)*c.r*1.5*rnd(.3, 1), y:c.y + c.r*.62 + Math.sin(a)*c.r*.45*rnd(.3, 1), vy:rnd(-60, -25), vx:rnd(-6, 6), size:rnd(1.2, 2.6), color:fxColor(), max:rnd(1.4, 2.4)}); } });
    } else if(C.scene==='link'){
      SFX.glitch(.3, 4); SFX.zap(.8);
      every(90, ()=>{ drawThreads(); if(Math.random() < .12){ const ready = [...$.cards.querySelectorAll('.gc-card.ready')], c = center(); ready.forEach(el=>pulseAlong(cardPt(el), c, fxColor(), 1.1, 3.5, true)); }
        if(Math.random() < .03) $.tint.animate([{opacity:0}, {opacity:.35}, {opacity:0}], {duration:240, easing:'steps(3)'}); });
    } else if(C.scene==='frozen'){
      $.world.classList.add('gray'); [$.barTop, $.barBot].forEach(b=>anim(b, [{height:'0'}, {height:'9%'}], 700));
      let beat = 0; every(1000, ()=>{ beat++; SFX.tick(0, beat%2 ? 1500 : 1900); turnHand('s', 6); if(beat%4===0){ SFX.heartbeat(0); $.vignette.animate([{opacity:.55}, {opacity:1, offset:.2}, {opacity:.55}], {duration:600}); }
        for(let i=0;i<N(2);i++) spawn({x:rnd(0, W), y:rnd(0, H), vx:rnd(-6, 6), vy:rnd(-8, -2), size:rnd(1, 2.2), color:'#e8eef2', add:false, alpha:.5, max:4}); }); // пылинки висят в воздухе
      hands.h = 10*30 + 9; hands.m = 9*6; hands.s = 0; // без десяти десять — и время застыло (стрелки ставит buildDeco)
    } else if(C.scene==='stars'){
      SFX.chime(.5, 1046.5, .05);
      every(700, ()=>{ if(Math.random() < .45){ const x = rnd(W*.1, W), y = rnd(0, H*.4), a = rnd(2.3, 2.7), sp = rnd(500, 900); spawn({type:'spark', x, y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, size:1.6, color:'#eef1ff', max:rnd(.5, .9), tail:.09}); }
        if(Math.random() < .3) SFX.tone('sine', [1318.5, 1568, 1760, 2093][Math.floor(rnd(0, 4))], 0, .005, .025, 1.6); });
    } else {
      SFX.whoosh(.2, 2.4, 140, 420, .22);
      every(160, ()=>{ const c = center(), span = bridgeSpan(c); spawn({x:c.x + rnd(-span/2, span/2), y:H + 10, vx:rnd(-10, 10), vy:rnd(-70, -30), size:rnd(1, 2.4), color:'#f0b45c', alpha:.6, max:rnd(2, 4)});
        if(Math.random() < .08) SFX.tone('sine', rnd(70, 95), 0, .2, .05, 1.4, 60); }); // искры из пропасти, далёкий гул
    }
  }
  // стрелки циферблата («Остановленное мгновение»): углы в градусах
  const hands = {h:0, m:0, s:0};
  function moveHand(k, v, ms, ease){ const from = hands[k], el = $.deco.querySelector('.gc-hand.' + k); hands[k] = v;
    if(el) el.animate([{transform:`rotate(${from}deg)`}, {transform:`rotate(${v}deg)`}], {duration:Math.max(1, ms || 1), fill:'forwards', easing:ease || 'cubic-bezier(.3,1.6,.5,1)'}); }
  function setHands(hDeg, mDeg, sDeg, ms){ moveHand('h', hDeg, ms); moveHand('m', mDeg, ms); moveHand('s', sDeg, ms); }
  function turnHand(k, d){ moveHand(k, hands[k] + d, 180, 'cubic-bezier(.3,1.8,.5,1)'); }
  // игрок нажал «Готов» (или пришла его отметка)
  function readyFx(el, own){
    const c = center(), p = cardPt(el), ac = fxColor(); anim(el, [{transform:'scale(1)'}, {transform:'scale(1.12)', offset:.3}, {transform:'scale(1)'}], 520, {fill:'none'});
    ring(p.x, p.y, 20, 140, ac, 3, .8); burst(p.x, p.y, N(22), ac, {min:90, max:360, life:.7});
    if(C.scene==='oath'){ SFX.chime(0, own ? 659.3 : 523.25, .1); for(let i=0;i<N(12);i++) setTimeout(()=>pulseAlong(p, {x:c.x, y:c.y + c.r*.62}, ac, .6, 3), i*35); }
    else if(C.scene==='link'){ SFX.zap(0); for(let i=0;i<3;i++) setTimeout(()=>pulseAlong(p, c, ac, .8, 5, true), i*120); const eye = $.deco.querySelector('.gc-eye'); if(eye) eye.animate([{transform:'scaleY(.35)'}, {transform:'scaleY(.7)'}, {transform:'scaleY(.35)'}], {duration:500}); }
    else if(C.scene==='frozen'){ SFX.tick(0, 2600); SFX.heartbeat(.05); turnHand('m', 6); }
    else if(C.scene==='stars'){ SFX.tone('sine', 1568, 0, .005, .08, 2.2); SFX.tone('sine', 2349, .05, .005, .04, 1.8); ring(p.x, p.y, 4, 60, '#fff', 1.5, .7); }
    else { SFX.thud(0, 160, .4); SFX.tone('triangle', 220, 0, .01, .05, .6, 180); burst(p.x, p.y, N(14), '#f0b45c', {a:Math.PI/2, spread:.6, g:400, min:60, max:220}); }
    setTimeout(()=>{ drawThreads(); ring(c.x, c.y, c.r*.6, c.r*1.4, ac, 2, .7); }, 300);
  }

  /* ---------- кульминация и раскрытие ---------- */
  async function climax(id, cards, c, ac){
    if(C.scene==='frozen'){
      [$.barTop, $.barBot].forEach(b=>anim(b, [{height:'9%'}, {height:'14%'}], 500)); $.vignette.classList.add('pulse');
      // стекло времени трескается от центра — и застывает
      const R = seeded(5); let cr = ''; for(let k=0;k<11;k++){ let a = k/11*Math.PI*2 + R()*.4, x = c.x, y = c.y, d = `M${x} ${y}`; const L = Math.max(W, H)*.7;
        for(let s=0;s<6;s++){ a += (R() - .5)*.6; const st = L/6*(.6 + R()*.8); x += Math.cos(a)*st; y += Math.sin(a)*st; d += ` L${x.toFixed(0)} ${y.toFixed(0)}`; } cr += `<path d="${d}"/>`; }
      $.crack.setAttribute('viewBox', `0 0 ${W} ${H}`); $.crack.innerHTML = cr;
      $.crack.querySelectorAll('path').forEach((p, i)=>{ const L = p.getTotalLength(); p.style.strokeDasharray = L; p.animate([{strokeDashoffset:L}, {strokeDashoffset:0}], {duration:Dms(900), delay:Dms(900 + i*40), fill:'forwards', easing:'ease-out'}); });
      setTimeout(()=>{ if(sceneId===id){ SFX.noise(0, .4, 'highpass', 3000, .7, .25); [0, .08, .16].forEach(t=>SFX.tick(t, 3200)); } }, Dms(900));
      cards.forEach(({el}, i)=>{ const d = el.querySelector('.gc-c-die'); el.classList.add('rolling'); for(let k=1;k<=3;k++){ const gh = d.cloneNode(true); gh.classList.add('ghost'); el.appendChild(gh);
          gh.animate([{transform:`translateY(-${H*.5}px) rotate(-280deg)`, opacity:0}, {transform:'translateY(0) rotate(0)', opacity:.28 - k*.07}], {duration:Dms(2600), delay:Dms(k*90 + i*60), fill:'forwards', easing:'cubic-bezier(.25,.6,.3,1)'}); }
        anim(d, [{transform:`translateY(-${H*.5}px) rotate(-280deg)`, opacity:0}, {transform:'translateY(0) rotate(-12deg)', opacity:1}], 2600, {delay:Dms(i*60), easing:'cubic-bezier(.25,.6,.3,1)'}); });
      [0, .55, 1.0, 1.35, 1.6, 1.8, 1.95, 2.07, 2.17, 2.25].forEach((t, i)=>{ SFX.tick(t); setTimeout(()=>sceneId===id && turnHand('s', i < 7 ? 6 : 2), Dms(t*1000)); }); [.2, 1.0, 1.7].forEach(t=>SFX.heartbeat(t)); SFX.whoosh(0, 2.6, 200, 700, .16);
      rollNumbers(cards, 2500, 260);
      await wait(2600); if(sceneId!==id) return;
      SFX.snap(0); $.world.classList.remove('gray'); $.vignette.classList.remove('pulse'); [$.barTop, $.barBot].forEach(b=>anim(b, [{height:'14%'}, {height:'0'}], 300));
      root.querySelectorAll('.gc-c-die.ghost').forEach(x=>x.animate([{opacity:.2}, {opacity:0}], {duration:200, fill:'forwards'}));
      await wait(260); if(sceneId!==id) return;
      $.crack.animate([{opacity:1}, {opacity:0}], {duration:Dms(300), fill:'forwards'}); SFX.noise(0, .8, 'highpass', 3600, .7, .45);
      for(let i=0;i<N(60);i++){ const a = rnd(0, 6.283), sp = rnd(120, 700); spawn({type:'shard', x:c.x + rnd(-W*.3, W*.3), y:c.y + rnd(-H*.3, H*.3), vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, ay:500, drag:.98, size:rnd(5, 16), vr:rnd(-8, 8), color:'rgba(207,227,239,.35)', add:false, max:rnd(.9, 1.6)}); }
      setHands(hands.h + 360, hands.m + 720, hands.s + 1440, Dms(900));
      flash(.55, 240); shake(12*K() + 2, 420); SFX.thud(0, 140, 1);
      cards.forEach(({el})=>{ const p = cardPt(el); ring(p.x, p.y, 10, 170, ac, 4, .8); });
    } else if(C.scene==='link'){
      SFX.riser(0, 1.8, .16); SFX.glitch(.5, 4); SFX.glitch(1.1, 6); SFX.glitch(1.6, 3);
      $.tint.animate([{opacity:0}, {opacity:.4}, {opacity:.1}, {opacity:.5}, {opacity:.15}, {opacity:.6}], {duration:Dms(1800), easing:'steps(6)', fill:'forwards'});
      $.threads.classList.add('surge');
      const pl = setInterval(()=>{ if(sceneId!==id){ clearInterval(pl); return; } cards.forEach(({el})=>pulseAlong(cardPt(el), c, Math.random() < .5 ? ac : '#ff2bd6', .5, 4, true)); if(Math.random() < .5){ const u = units[Math.floor(rnd(0, units.length))]; if(u) bolt(c, u, ac, .25); } }, 110);
      const eye = $.deco.querySelector('.gc-eye'); if(eye) anim(eye, [{transform:'scaleY(.35)'}, {transform:'scaleY(.2)', offset:.6}, {transform:'scaleY(1.08)'}], 1800, {easing:'cubic-bezier(.6,0,.3,1.4)'});
      cards.forEach(({el})=>{ el.classList.add('rolling'); anim(el.querySelector('.gc-c-die'), [{opacity:0, transform:'scale(.3)', filter:'blur(6px)'}, {opacity:1, transform:'scale(1)', filter:'blur(0)'}], 600); });
      anim($.core, [{filter:'none'}, {filter:`drop-shadow(-5px 0 #ff2bd6) drop-shadow(5px 0 #2bf0ff) drop-shadow(0 0 22px ${ac})`}], 1800, {easing:'ease-in'});
      rollNumbers(cards, 1800, 80);
      await wait(1800); clearInterval(pl); if(sceneId!==id) return;
      $.threads.classList.remove('surge'); flash(.9, 260); SFX.zap(0); SFX.thud(0, 120, 1); shake(10*K() + 2, 380); $.tint.animate([{opacity:.6}, {opacity:.12}], {duration:600, fill:'forwards'});
      ring(c.x, c.y, c.r*.3, Math.max(W, H)*.7, ac, 6, 1); cards.forEach(({el})=>bolt(c, cardPt(el), '#fff', .3));
      burst(c.x, c.y, N(70), ac, {min:300, max:1000});
    } else if(C.scene==='stars'){
      // звездопад: с неба — по звезде к каждому участнику
      SFX.riser(0, 1.9, .1); [0, .25, .5, .75, 1, 1.2, 1.4, 1.55, 1.7].forEach(t=>SFX.tone('sine', 1046.5*Math.pow(2, Math.floor(rnd(0, 12))/12), t, .005, .05, 1.5));
      const sh = setInterval(()=>{ if(sceneId!==id){ clearInterval(sh); return; } for(let i=0;i<N(3);i++){ const x = rnd(W*.2, W*1.1), a = rnd(2.2, 2.6), sp = rnd(700, 1300); spawn({type:'spark', x, y:rnd(-20, H*.3), vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, size:rnd(1.4, 2.6), color:Math.random() < .3 ? ac : '#f4f6ff', max:rnd(.5, 1), tail:.1}); } }, 60);
      cards.forEach(({el}, i)=>{ el.classList.add('rolling'); const p = cardPt(el); setTimeout(()=>{ if(sceneId!==id) return; pulseAlong({x:p.x + W*.4, y:-40}, p, '#fff', .55, 5); setTimeout(()=>{ if(sceneId===id){ ring(p.x, p.y, 6, 120, ac, 3, .7); burst(p.x, p.y, N(20), '#fff', {min:80, max:320}); SFX.tone('sine', 2093, 0, .004, .08, 1.2); } }, Dms(550)); }, Dms(300 + i*320));
        anim(el.querySelector('.gc-c-die'), [{opacity:0, transform:`translate(${W*.3}px, -${H*.4}px) rotate(220deg) scale(.4)`}, {opacity:1, transform:'none'}], 900, {delay:Dms(300 + i*320), easing:'cubic-bezier(.3,.7,.3,1)'}); });
      $.sky = $.deco.querySelector('.gc-sky'); if($.sky) anim($.sky, [{opacity:1}, {opacity:.55}, {opacity:1}], 1900);
      rollNumbers(cards, 1900, 90);
      await wait(1950); clearInterval(sh); if(sceneId!==id) return;
      flash(.7, 300); SFX.bell(0, 523.25); SFX.thud(0, 110, .6); shake(8*K() + 2, 380); ring(c.x, c.y, c.r*.2, Math.max(W, H)*.6, '#fff', 4, 1);
    } else if(C.scene==='bridge'){
      // порыв из пропасти: туман поднимается, верёвки раскачиваются; кости брошены через пропасть
      SFX.whoosh(0, 2, 120, 900, .45); SFX.riser(.2, 1.6, .1); SFX.tone('sine', 82, .4, .3, .2, 1.8, 62);
      const fog = $.deco.querySelector('.gc-fog'); if(fog) anim(fog, [{transform:'translateY(0)', opacity:.5}, {transform:'translateY(-40px)', opacity:.95}, {transform:'translateY(0)', opacity:.6}], 2000);
      $.deco.querySelectorAll('.gc-rope').forEach((r, i)=>r.animate([{transform:'translateY(0)'}, {transform:`translateY(${i ? 9 : -9}px)`}, {transform:'translateY(0)'}], {duration:Dms(500), iterations:4}));
      const wind = setInterval(()=>{ if(sceneId!==id){ clearInterval(wind); return; } const span = bridgeSpan(c); for(let i=0;i<N(4);i++) spawn({type:'spark', x:c.x - span/2 + rnd(0, span), y:H + 10, vx:rnd(-40, 40), vy:rnd(-700, -380), size:rnd(1, 2), color:'#f0b45c', max:rnd(.6, 1.1), tail:.05}); }, 70);
      cards.forEach(({el}, i)=>{ el.classList.add('rolling'); const fromLeft = cardPt(el).x > c.x;
        anim(el.querySelector('.gc-c-die'), [{opacity:0, transform:`translate(${fromLeft ? -W*.5 : W*.5}px, ${H*.1}px) rotate(${fromLeft ? 540 : -540}deg)`}, {opacity:1, transform:'translate(0,-30px) rotate(20deg)', offset:.75}, {opacity:1, transform:'none'}], 1500, {delay:Dms(i*140), easing:'cubic-bezier(.3,.6,.4,1)'}); setTimeout(()=>sceneId===id && SFX.tick(0, 900), Dms(i*140 + 1500)); });
      shake(4*K() + 1, 1400); rollNumbers(cards, 1900, 110);
      await wait(1950); clearInterval(wind); if(sceneId!==id) return;
      SFX.thud(0, 90, .9); flash(.35, 260); shake(9*K() + 2, 400);
    } else {
      // Круг клятвы: столб света из круга на полу
      SFX.riser(0, 1.9, .16); SFX.chime(.4, 392, .08); SFX.chime(1.1, 440, .09); [196, 246.9, 293.7].forEach((f, i)=>SFX.tone('sawtooth', f, .2 + i*.2, .8, .025, 1.6));
      [$.r1, $.r2].forEach((r, i)=>r.animate([{transform:'rotate(0)'}, {transform:`rotate(${i ? -1080 : 1080}deg)`}], {duration:Dms(2000), easing:'cubic-bezier(.6,0,.4,1)'}));
      $.beam.style.left = c.x + 'px'; $.beam.style.top = '0px'; $.beam.style.height = (c.y + c.r*.62) + 'px';
      anim($.beam, [{opacity:0, transform:'translateX(-50%) scaleX(.1) scaleY(0)'}, {opacity:.9, transform:'translateX(-50%) scaleX(.4) scaleY(1)', offset:.6}, {opacity:1, transform:'translateX(-50%) scaleX(1) scaleY(1)'}], 2000);
      const fl = $.deco.querySelector('.gc-oath'); if(fl) fl.classList.add('lit');
      const mt = setInterval(()=>{ if(sceneId!==id){ clearInterval(mt); return; } motesTo(c.x, c.y, N(6), ac); for(let i=0;i<N(4);i++) spawn({x:c.x + rnd(-c.r*.3, c.r*.3), y:c.y + c.r*.62, vy:rnd(-700, -350), vx:rnd(-20, 20), size:rnd(1.4, 3), color:'#fff', max:rnd(.5, .9)}); }, 70);
      cards.forEach(({el})=>{ el.classList.add('rolling'); anim(el.querySelector('.gc-c-die'), [{opacity:0, transform:'translateY(-30px) rotate(-200deg)'}, {opacity:1, transform:'none'}], 900); });
      rollNumbers(cards, 2000, 90);
      await wait(2000); clearInterval(mt); if(sceneId!==id) return;
      flash(.85, 260); SFX.thud(0, 110, 1); SFX.bell(0, 130.8); shake(14*K() + 2, 480);
      ring(c.x, c.y, c.r*.5, Math.max(W, H)*.7, ac, 7, 1); setTimeout(()=>ring(c.x, c.y, c.r*.4, Math.max(W, H)*.45, '#f6ecd4', 3, .8), Dms(120));
      burst(c.x, c.y, N(90), ac, {min:260, max:1100, life:1.1});
      anim($.beam, [{opacity:1}, {opacity:.35}], 700);
    }
  }
  // одна категория успеха легла на своё место
  function lightUnit(i, from){
    const u = units[i], el = $.deco.querySelector(`.gc-u[data-i="${i}"]`), ac = accent('win'); if(!u) return; litUnits = Math.max(litUnits, i + 1);
    if(el){ el.classList.add('on'); const ui = el.querySelector('.gc-ui'); if(ui) ui.animate([{transform:'scale(1.9)'}, {transform:'scale(1)'}], {duration:Dms(380), easing:'cubic-bezier(.3,1.6,.5,1)'}); }
    const step = Math.pow(2, (i%8)*2/12);
    if(C.scene==='oath'){ SFX.bell(0, 392*step); for(let k=0;k<N(8);k++) spawn({x:u.x + rnd(-5, 5), y:u.y, vy:rnd(-260, -120), size:rnd(1.2, 2.4), color:ac, max:rnd(.6, 1)}); }
    else if(C.scene==='link'){ bolt(center(), u, ac, .35); SFX.zap(0); SFX.tone('sine', 660*step, 0, .005, .06, .6); }
    else if(C.scene==='frozen'){ turnHand('m', 30); SFX.tick(0, 2200); SFX.tone('triangle', 880*step, .02, .005, .06, .8); }
    else if(C.scene==='stars'){ ring(u.x, u.y, 2, 46, '#fff', 2, .6); SFX.tone('sine', 1046.5*step, 0, .004, .08, 1.8); const ln = $.deco.querySelector(`.gc-cl[data-i="${i}"]`); if(ln) ln.classList.add('on'); }
    else { const pl = el && el.querySelector('.gc-plank'); if(pl) pl.animate([{transform:`translateY(-${H*.35}px) rotate(${rnd(-25, 25)}deg)`, opacity:0}, {transform:'translateY(4px) rotate(0)', opacity:1, offset:.8}, {transform:'none', opacity:1}], {duration:Dms(420), easing:'cubic-bezier(.5,0,.6,1)'});
      setTimeout(()=>{ SFX.thud(0, 150 + i%4*12, .5); SFX.noise(0, .12, 'bandpass', 900, 1.5, .2); for(let k=0;k<N(10);k++) spawn({x:u.x + rnd(-20, 20), y:u.y + 10, vx:rnd(-80, 80), vy:rnd(-60, 40), ay:300, size:rnd(1.5, 3.5), color:'#b39f72', add:false, max:rnd(.5, 1)}); }, Dms(340)); }
    void from;
  }
  function failFx(el, pt, c){
    SFX.tone('sine', 98, 0, .02, .25, .9, 70); el.animate([{transform:'translateX(0)'}, {transform:'translateX(-6px)'}, {transform:'translateX(5px)'}, {transform:'translateX(0)'}], {duration:300});
    if(C.scene==='link'){ SFX.noise(0, .3, 'bandpass', 1800, 2, .15); }
    else if(C.scene==='stars'){ spawn({type:'spark', x:pt.x, y:pt.y, vx:rnd(-60, 60), vy:420, ay:300, size:1.6, color:'#8a8fb0', max:1, tail:.08}); }
    else if(C.scene==='bridge'){ for(let k=0;k<3;k++) spawn({type:'shard', x:pt.x + rnd(-20, 20), y:pt.y, vx:rnd(-40, 40), vy:rnd(40, 120), ay:700, size:rnd(6, 10), vr:rnd(-6, 6), color:'#6f5a3e', add:false, max:1.4}); SFX.tone('sine', 70, .9, .05, .15, .8); }
    else if(C.scene==='frozen'){ SFX.tick(0, 700); }
    void c;
  }
  async function reveal(r){
    const id = ++sceneId; stopTimers(); SFX.stopAmb(); $.me.hidden = true; layout();
    const cards = r.parts.map(p=>({p, el:$.cards.querySelector(`.gc-card[data-id="${CSS.escape(p.id)}"]`)})).filter(x=>x.el), ac = fxColor(), c = center();
    cards.forEach(({el})=>el.classList.add('ready')); drawThreads();
    if(C.scene==='link'){ ambTimer = setInterval(()=>{ if(sceneId===id) drawThreads(); else clearInterval(ambTimer); }, 90); }
    await climax(id, cards, c, ac); if(sceneId!==id) return;
    // карточки по одной: число, исход; каждая категория ложится на своё место, сумма растёт
    let sum = 0;
    for(const {p, el} of cards){ if(sceneId!==id) return;
      const res = p.res || {roll:0, success:false, category:0}, die = el.querySelector('.gc-c-die'), pt = cardPt(el);
      die.querySelector('.gc-dn').textContent = res.missing ? '—' : res.roll; el.classList.remove('rolling');
      el.classList.add(res.success ? 'win' : 'lose'); el.querySelector('.gc-c-state').innerHTML = res.missing ? 'нет листа' : res.success ? `<b>КУ${res.category}</b>${res.roll===12 ? ' · нат. 12' : ''}` : `<b>провал</b>${res.roll===13 ? ' · нат. 13' : ''}`;
      anim(el, [{transform:'scale(1)'}, {transform:'scale(1.16)', offset:.3}, {transform:'scale(1)'}], 420, {fill:'none'});
      if(res.success){ SFX.chime(0, 523.25*Math.pow(2, (res.category - 1)*4/12), .08); burst(pt.x, pt.y, N(14 + res.category*8), accent('win'), {min:120, max:420});
        for(let k=0;k<res.category;k++){ const idx = sum + k; setTimeout(()=>{ if(sceneId!==id) return; const u = units[idx] || c; pulseAlong(pt, u, accent('win'), .5, 6, C.scene==='link');
          setTimeout(()=>{ if(sceneId!==id) return; lightUnit(idx, pt); $.sumN.textContent = idx + 1; anim($.sum, [{transform:'scale(1.35)'}, {transform:'scale(1)'}], 260, {fill:'none'}); }, Dms(500)); }, Dms(k*200)); }
        sum += res.category; }
      else { failFx(el, pt, c); drawThreads(); }
      await wait(res.success ? 560 + res.category*200 : 520);
    }
    await wait(500); if(sceneId!==id) return;
    stopTimers(); $.sumN.textContent = r.total; finalVerdict(r, true);
  }
  function rollNumbers(cards, ms, every){ const end = performance.now() + Dms(ms), t = setInterval(()=>{ const done = performance.now() >= end || !view;
    cards.forEach(({el})=>{ const n = el.querySelector('.gc-c-die .gc-dn'); if(n && el.classList.contains('rolling')) n.textContent = done ? '' : 1 + Math.floor(Math.random()*20); }); if(done) clearInterval(t); }, every || 80); }
  function finalVerdict(r, animate){
    endState = r.ok ? 'win' : 'lose'; setFx(endState); const ac = fxColor(), c = center();
    $.vMain.textContent = r.ok ? 'Коллективный успех' : 'Общий провал'; // одна надпись исхода для всех сцен
    $.vSub.textContent = `${r.total} ${catWord(r.total)} успеха из ${r.need} · ${r.title}`;
    $.verdict.className = 'gc-verdict show ' + endState; $.core.classList.add(endState); ctlButtons();
    const fig = $.deco.firstElementChild; if(fig) fig.classList.add(endState==='win' ? 'won' : 'lost');
    if(C.scene==='link'){ const eye = $.deco.querySelector('.gc-eye'); if(eye){ eye.classList.add(r.ok ? 'wide' : 'shut'); if(!r.ok) eye.getAnimations().forEach(a=>a.cancel()); } } // открытый глаз так и остаётся
    if(C.scene==='frozen') setHands(r.ok ? Math.ceil(hands.h/360)*360 : Math.ceil(hands.h/360)*360 + 180, r.ok ? Math.ceil(hands.m/360)*360 : Math.ceil(hands.m/360)*360 + 180, r.ok ? Math.ceil(hands.s/360)*360 : hands.s + 13, animate ? Dms(900) : 1);
    if(!animate) return;
    anim($.verdict, [{opacity:0, transform:'translateY(20px) scale(.94)'}, {opacity:1, transform:'none'}], 600);
    anim($.vMain, [{filter:'blur(8px)', letterSpacing:'.6em'}, {filter:'blur(0)', letterSpacing:'.14em'}], 900, {fill:'none'});
    if(r.ok){ SFX.win(0); flash(.5, 300);
      if(C.scene==='stars'){ ring(c.x, c.y, 4, Math.max(W, H)*.9, '#fff', 10, 1.4); units.forEach((u, i)=>setTimeout(()=>ring(u.x, u.y, 2, 40, '#fff', 2, .6), Dms(i*60))); burst(c.x, c.y, N(160), '#fff', {min:200, max:1400, life:1.4}); }
      else if(C.scene==='bridge'){ units.forEach((u, i)=>setTimeout(()=>{ ring(u.x, u.y, 4, 60, ac, 2, .6); SFX.tone('triangle', 330*Math.pow(2, i%6/12), 0, .01, .05, .8); }, Dms(i*70))); burst(c.x + bridgeSpan(c)/2, c.y + c.r, N(80), ac, {a:Math.PI, spread:.8, min:200, max:800}); }
      else if(C.scene==='oath'){ ring(c.x, c.y + c.r*.62, c.r*.3, c.r*3, ac, 8, 1.2); anim($.beam, [{opacity:.35}, {opacity:1, filter:'brightness(1.6)'}, {opacity:.6}], 1200); burst(c.x, c.y, N(120), ac, {min:200, max:1000, life:1.3, g:300}); }
      else { ring(c.x, c.y, c.r*.5, Math.max(W, H)*.8, ac, 8, 1.2); burst(c.x, c.y, N(140), ac, {min:200, max:1000, life:1.3, g:300}); motesTo(c.x, c.y, N(40), ac); } }
    else { SFX.lose(0); shake(8*K() + 2, 420); $.world.classList.add('gray');
      if(C.scene==='bridge'){ const lastI = litUnits - 1; units.forEach((u, i)=>{ if(i >= litUnits || i < lastI) return; const el = $.deco.querySelector(`.gc-u[data-i="${i}"] .gc-plank`); if(el) el.animate([{transform:'none'}, {transform:'rotate(8deg)', offset:.3}, {transform:`translateY(${H*.6}px) rotate(70deg)`, opacity:0}], {duration:Dms(1600), delay:Dms(400), fill:'forwards', easing:'cubic-bezier(.5,0,.8,.6)'}); });
        SFX.noise(.4, .5, 'bandpass', 600, 1.2, .3); SFX.tone('sine', 60, 1.6, .05, .2, 1.4, 40); }
      else if(C.scene==='stars'){ units.forEach((u, i)=>{ if(i < litUnits) return; spawn({type:'spark', x:u.x, y:u.y, vx:rnd(-80, 80), vy:rnd(200, 420), ay:400, size:1.6, color:'#8a8fb0', max:rnd(.8, 1.4), tail:.1}); }); }
      else if(C.scene==='oath'){ anim($.beam, [{opacity:.35, transform:'translateX(-50%) scaleX(1) scaleY(1)'}, {opacity:0, transform:'translateX(-50%) scaleX(.05) scaleY(1)'}], 600); }
      else for(let i=0;i<N(40);i++) spawn({x:c.x + rnd(-c.r, c.r), y:c.y + rnd(-c.r*.4, c.r*.4), vx:rnd(-80, 80), vy:rnd(-40, 60), ay:260, drag:.97, size:rnd(2, 5), color:'#8a7d62', add:false, max:rnd(1, 1.8)}); }
  }
  function finalStatic(){ if(!view) return; $.me.hidden = true; let sum = 0; view.parts.forEach(p=>{ const el = $.cards.querySelector(`.gc-card[data-id="${CSS.escape(p.id)}"]`); if(!el || !p.res) return;
    el.classList.add('ready', p.res.success ? 'win' : 'lose'); el.querySelector('.gc-c-die .gc-dn').textContent = p.res.missing ? '—' : p.res.roll; sum += p.res.success ? p.res.category : 0;
    el.querySelector('.gc-c-state').innerHTML = p.res.success ? `<b>КУ${p.res.category}</b>` : '<b>провал</b>'; }); litUnits = sum; $.sumN.textContent = view.total; layout(); finalVerdict(view, false); }

  /* ---------- предпросмотр у себя (Мастер) ---------- */
  function preview(){
    if(run && !run.preview) return uiAlert('Сейчас идёт настоящая групповая проверка — предпросмотр после неё.', {icon:'⚠'});
    const demo = [['Ада', 'ubezhdenie'], ['Борей', 'volya'], ['Сим', 'ponimanie_lyudey'], ['Тень', 'skrytnost']];
    run = {id:'preview' + Date.now().toString(36), preview:true, title:cfg.title.trim() || 'Групповая проверка', mod:cfg.mod, need:cfg.need, cfg:sceneCfg(cfg), phase:'gather', parts:{}, total:0, ok:false};
    demo.forEach(([nm, st], i)=>{ run.parts['demo' + i] = {name:nm, stat:st, label:STAT_LABELS[st], max:12 + i, ready:false, online:true, res:null}; });
    show(publicRun(run));
    Object.keys(run.parts).forEach((pid, i)=>setTimeout(()=>{ if(run && run.preview && run.phase==='gather'){ run.parts[pid].ready = true; show(publicRun(run)); if(Object.values(run.parts).every(p=>p.ready)) setTimeout(rollAll, 700); } }, 1300 + i*850));
  }

  /* ---------- экран Мастера → «Групповая» ---------- */
  function statSelect(pid, cur){
    const c = sheetOf(pid), val = (k)=>c && c.stats && isFinite(+c.stats[k]) ? ` (${+c.stats[k] + 10 + cfg.mod})` : '';
    return `<select data-gc-assign="${esc(pid)}"${run && run.phase==='reveal' && !run.preview ? ' disabled' : ''}><option value="">— не участвует —</option>${GROUPS.map(([gl, keys])=>`<optgroup label="${esc(gl)}">${keys.map(k=>`<option value="${k}"${k===cur ? ' selected' : ''}>${esc(STAT_LABELS[k])}${val(k)}</option>`).join('')}</optgroup>`).join('')}</select>`;
  }
  function renderConfig(box){
    gmBox = box; const c = cfg, inGm = isGm(), live = run && !run.preview ? run : null;
    const ids = inGm ? Object.keys(session.players || {}) : [];
    const offline = live ? Object.keys(live.parts).filter(pid=>ids.indexOf(pid) < 0) : [];
    const rowsHtml = ids.concat(offline).map(pid=>{ const lp = live && live.parts[pid], online = ids.indexOf(pid) >= 0;
      const st = lp ? (live.phase==='reveal' ? (lp.res && lp.res.success ? `КУ${lp.res.category}` : 'провал') : lp.ready ? '✓ готов' : online ? 'ждём' : 'не в сети') : '';
      return `<div class="gc-row${lp && lp.ready ? ' ready' : ''}${online ? '' : ' off'}"><span class="gc-row-name">${esc(lp ? lp.name : playerName(pid))}</span>${statSelect(pid, assign[pid] || (lp && lp.stat) || '')}${st ? `<span class="gc-row-st">${st}</span>` : ''}</div>`; }).join('');
    const nAssigned = ids.filter(pid=>assign[pid]).length;
    box.innerHTML = `<div class="ep-cfg gc-cfg">
      <div class="gs-sub">Одна проверка на несколько персонажей: у каждого — своя характеристика, к20 за всех бросает Мастер по их листам, категории успеха складываются. Набрали нужное — успех, иначе провал.</div>
      ${live ? `<div class="gc-live ${live.phase}"><b>${live.phase==='reveal' ? (live.ok ? '✓ Успех' : '✕ Провал') + ` — ${live.total} из ${live.need}` : '● Идёт: ' + Object.values(live.parts).filter(p=>p.ready).length + ' из ' + Object.keys(live.parts).length + ' готовы'}</b> · «${esc(live.title)}»
        <div class="gs-row">${live.phase==='gather' ? '<button type="button" class="gs-btn primary" data-gcp="force">⚡ Бросить сейчас</button><button type="button" class="gs-btn" data-gcp="show">Показать сцену</button><button type="button" class="gs-btn" data-gcp="cancel">✕ Отменить</button>' : '<button type="button" class="gs-btn primary" data-gcp="end">✓ Завершить у всех</button>'}</div>
        ${live.phase==='gather' ? '<div class="gs-muted">Смена характеристики сразу видна игроку; его «Готов» снимается.</div>' : ''}</div>` : ''}
      <label class="ep-field">Название <input type="text" data-gcc="title" maxlength="60" value="${esc(c.title)}" placeholder="Например: «Переправа через разлом»"></label>
      <h4>Участники и характеристики</h4>
      ${inGm ? (ids.length || offline.length ? `<div class="gc-rows">${rowsHtml}</div><div class="gs-muted">В скобках — Максимум с модификатором.</div>` : '<div class="gs-muted">Игроки пока не подключились.</div>') : '<div class="gs-muted">Участники появятся, когда вы начнёте сессию «Я — Мастер» и игроки подключатся. Сцену можно посмотреть у себя и сейчас.</div>'}
      <div class="gs-row gc-nums"><label>Модификатор <select data-gcc="mod">${Array.from({length:43}, (_, i)=>i - 21).map(v=>`<option value="${v}"${v===c.mod ? ' selected' : ''}>${signed(v)}</option>`).join('')}</select></label>
        <label title="Сумма категорий успеха всех участников, нужная для успеха проверки">Нужно категорий успеха <input type="number" data-gcc="need" min="1" max="99" value="${c.need}"></label></div>
      ${nAssigned ? `<div class="gs-muted">Участников: ${nAssigned}, наибольшая возможная сумма — ${nAssigned*3}.</div>` : ''}
      <h4>Сцена</h4>
      <div class="ep-scenes">${Object.entries(SCENES).map(([k, v])=>`<label class="ep-scene"><input type="radio" name="gcScene" value="${k}"${k===c.scene ? ' checked' : ''}><b>${v.name}</b><span>${v.desc}</span></label>`).join('')}</div>
      <h4>Подача</h4>
      <label class="ep-field">Интенсивность <output>${c.intensity}%</output><input type="range" data-gcc="intensity" min="10" max="100" step="5" value="${c.intensity}"></label>
      <label class="ep-field">Длительность <output>×${c.tempo.toFixed(1)}</output><input type="range" data-gcc="tempo" min="0.6" max="1.6" step="0.1" value="${c.tempo}"></label>
      <div class="gs-row"><label><input type="checkbox" data-gcc="shake"${c.shake ? ' checked' : ''}> Тряска экрана</label><label><input type="checkbox" data-gcc="dim"${c.dim ? ' checked' : ''}> Затемнять экран</label></div>
      <div class="gs-row"><label>Цвет <select data-gcc="accent">${[['auto','Авто по сцене и исходу'],['psi','Пси-свечение'],['gold','Золото'],['blood','Кровь'],['teal','Изнанка'],['custom','Свой цвет']].map(([v, t])=>`<option value="${v}"${v===c.accent ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        ${c.accent==='custom' ? `<input type="color" data-gcc="custom" value="${esc(c.custom)}" aria-label="Свой цвет">` : ''}</div>
      <h4>Звук</h4>
      <div class="gs-row"><label><input type="checkbox" data-gcc="sound"${c.sound ? ' checked' : ''}> Звуковое сопровождение</label></div>
      <label class="ep-field">Громкость <output>${c.volume}%</output><input type="range" data-gcc="volume" min="0" max="100" step="5" value="${c.volume}"></label>
      <div class="gs-row">${live ? '' : `<button type="button" class="gs-btn primary" data-gcp="launch"${inGm ? '' : ' disabled'}>▶ Запустить у всех</button>`}<button type="button" class="gs-btn" data-gcp="preview">▶ Посмотреть у себя</button>
        <button type="button" class="gs-btn small" data-gcp="reset" title="Круг клятвы, модификатор −3, нужно 3 категории, интенсивность 100%, длительность ×1.2, тряска, затемнение и звук">По умолчанию</button></div>
    </div>`;
    if(box._gcBound) return; box._gcBound = true;
    const set = (k, v, rerender)=>{ cfg = sanitizeCfg(Object.assign({}, cfg, {[k]:v})); saveCfg(); if(rerender) renderConfig(box); };
    box.addEventListener('input', (e)=>{ const t = e.target, k = t.dataset && t.dataset.gcc; if(!k) return;
      if(t.type==='range'){ set(k, +t.value); const o = t.parentElement.querySelector('output'); if(o) o.textContent = k==='tempo' ? '×' + (+t.value).toFixed(1) : t.value + '%'; }
      else if(t.type==='text' || t.type==='color') set(k, t.value); });
    box.addEventListener('change', (e)=>{ const t = e.target;
      if(t.dataset.gcAssign!=null){ setAssign(t.dataset.gcAssign, t.value); return; }
      if(t.name==='gcScene'){ set('scene', t.value); return; }
      const k = t.dataset.gcc; if(!k) return;
      if(t.type==='checkbox') set(k, t.checked); else if(k==='need') set(k, +t.value, true); else if(t.tagName==='SELECT') set(k, k==='mod' ? +t.value : t.value, true); });
    box.addEventListener('click', (e)=>{ const b = e.target.closest('[data-gcp]'); if(!b) return; const a = b.dataset.gcp;
      if(a==='launch') launch(); else if(a==='preview') preview(); else if(a==='force') rollAll(); else if(a==='end') cancel();
      else if(a==='cancel') uiConfirm('Отменить групповую проверку у всех?', {ok:'Отменить', danger:true}).then(ok=>{ if(ok) cancel(); });
      else if(a==='show'){ if(run) { minimized = false; show(publicRun(run)); } }
      else if(a==='reset'){ cfg = sanitizeCfg(DEFAULT); saveCfg(); renderConfig(box); } });
  }

  return { handle, onPlayerHello, onPeerLeft, renderConfig, preview, SCENES, get active(){ return !!run; } };
})();
