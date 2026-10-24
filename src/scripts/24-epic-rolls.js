/* ======================================================================
   ЭПИЧНЫЕ БРОСКИ — сцена на весь экран у всех за столом вместо обычного полёта кости.
   Мастер: экран Мастера → «Эпичные» — сцена и подача (интенсивность, длительность, тряска, затемнение, цвет, надпись, звук) и
   автоправила (нат. 12, нат. 13, спасбросок от смерти, «чудо»; по умолчанию выключены). «Игроки» — светящийся D20 у игрока:
   его следующий бросок к20 эпичный (любой: проверка и спасбросок из листа, способность, атака с карты, к20 панели кубов).
   Настройки и метки рассылает Мастер (epic-cfg) — у игроков ничего своего нет. Эпичный бросок играет сцену у бросившего
   сразу и у остальных по epic-play; атаку с карты считает Мастер — он и запускает сцену. Тайный бросок: сцена у всех,
   вместо числа «?» (и у бросившего — как и обычный тайный бросок), число и итог — только Мастеру.
   ====================================================================== */
const EpicRolls = (function(){
  const KEY = 'reincarnator_epic_v1';
  const SCENES = {
    psi:   {name:'Пси-разлом', desc:'Кость всплывает в кольцах изнанки, мир дрожит, вспышка — и число.'},
    seal:  {name:'Печать судьбы', desc:'Кость падает на стол, как печать на личное дело: удар, брызги чернил, оттиск.'},
    forge: {name:'Горнило', desc:'Кость раскаляется в искрах и бьёт, как молот по наковальне.'},
    slowmo:{name:'Замедление времени', desc:'Полёт в замедлении, стук сердца, щелчок — и время возвращается.'},
    crack: {name:'Трещина', desc:'Для провалов: кость качается, трескается и разлетается осколками.'}
  };
  const RULES = [
    {key:'nat12', label:'Натуральная 12'},
    {key:'nat13', label:'Натуральная 13'},
    {key:'death', label:'Спасбросок от смерти'},
    {key:'miracle', label:'Категория 3 при Максимуме 10 и ниже'}
  ];
  const ACCENTS = {blood:'#d0553a', gold:'#e2b24c', psi:'#9a8cff'};
  const DEFAULT = {scene:'psi', intensity:100, tempo:1.6, shake:true, dim:true, accent:'auto', custom:'#4fd1a5', caption:'', sound:true, volume:60,
    rules:{nat12:'', nat13:'', death:'', miracle:''}};
  const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const esc = (x)=>String(x==null ? '' : x).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const rnd = (a, b)=>a + Math.random()*(b - a);

  function sanitizeCfg(c){
    const o = c && typeof c==='object' ? c : {}, d = DEFAULT;
    const num = (v, a, b, def)=>{ v = +v; return isFinite(v) ? Math.max(a, Math.min(b, v)) : def; };
    const bool = (v, def)=>typeof v==='boolean' ? v : def;
    const rules = {}; RULES.forEach(r=>{ const v = o.rules && o.rules[r.key]; rules[r.key] = SCENES[v] ? v : ''; });
    return { scene:SCENES[o.scene] ? o.scene : d.scene, intensity:Math.round(num(o.intensity, 10, 100, d.intensity)), tempo:Math.round(num(o.tempo, .6, 1.6, d.tempo)*10)/10,
      shake:bool(o.shake, d.shake), dim:bool(o.dim, d.dim), accent:['auto','blood','gold','psi','custom'].indexOf(o.accent)>=0 ? o.accent : d.accent,
      custom:/^#[0-9a-f]{6}$/i.test(o.custom || '') ? o.custom : d.custom, caption:String(o.caption || '').slice(0, 40),
      sound:bool(o.sound, d.sound), volume:Math.round(num(o.volume, 0, 100, d.volume)), rules };
  }
  let myCfg = (function(){ try{ return sanitizeCfg(JSON.parse(localStorage.getItem(KEY) || 'null') || DEFAULT); }catch(e){ return sanitizeCfg(DEFAULT); } })();
  const saveCfg = ()=>{ try{ localStorage.setItem(KEY, JSON.stringify(myCfg)); }catch(e){} };
  let remoteCfg = null, remoteArmed = []; // у игрока — то, что прислал Мастер
  const armed = new Set();                // у Мастера — чей следующий к20 эпичный
  const role = ()=>typeof session!=='undefined' ? session.role : null;
  const isPlayer = ()=>role()==='player';
  const cfgNow = ()=>isPlayer() ? remoteCfg : myCfg;
  const amArmed = ()=>isPlayer() && !!session.myId && remoteArmed.indexOf(session.myId) >= 0;
  const whoName = ()=>((document.getElementById('fName') || {}).value || '').trim() || (typeof session!=='undefined' && session.ownName) || 'Игрок'; // имя персонажа

  /* ---------- Мастер: рассылка настроек и меток ---------- */
  let cfgTimer = 0;
  function broadcastCfg(to){ if(role()!=='gm' || typeof sendMsg!=='function') return; sendMsg({type:'epic-cfg', cfg:myCfg, armed:[...armed]}, to); }
  function broadcastSoon(){ clearTimeout(cfgTimer); cfgTimer = setTimeout(()=>broadcastCfg(), 300); }
  function refreshGm(){ if(typeof GmScreen!=='undefined' && GmScreen.isOpen) GmScreen.render(); }
  function isArmed(id){ return armed.has(id); }
  function toggleArm(id){
    if(!id) return;
    const p = typeof session!=='undefined' && session.players && session.players[id], name = p ? ((p.extra && p.extra.name) || p.name || 'игрок') : 'игрок';
    if(armed.has(id)){ armed.delete(id); uiToast(`Эпичный бросок снят: ${name}`, {icon:'✦'}); }
    else { armed.add(id); uiToast(`Следующий бросок к20 — эпичный: ${name} («${SCENES[myCfg.scene].name}»)`, {icon:'✦', ms:4000}); }
    broadcastCfg(); refreshGm();
  }
  function onPlayerHello(id){ broadcastCfg(id); }

  /* ---------- какой бросок эпичный ---------- */
  function ruleScene(cfg, info){
    const r = cfg.rules || {};
    if(info.death && r.death) return r.death;
    if(info.value===12 && info.success!==false && r.nat12) return r.nat12;
    if(info.value===13 && info.success===false && r.nat13) return r.nat13;
    if(info.success && info.category===3 && info.max!=null && info.max <= 10 && r.miracle) return r.miracle;
    return '';
  }
  function kindOf(info){
    if(info.unknown) return 'neutral';
    if(info.value===12 && info.success!==false) return 'crit';
    if(info.value===13 && info.success===false) return 'fumble';
    return info.success ? 'success' : 'fail';
  }
  function dataFor(scene, cfg, info, who){
    const kind = kindOf(info), v = info.value;
    const main = cfg.caption.trim() || info.main || (kind==='crit' ? 'Критический успех' : kind==='fumble' ? 'Провал' : kind==='success' ? 'Успех' : kind==='fail' ? 'Провал' : (info.label || 'Бросок'));
    const sub = info.sub || [who, info.label, `к20 = ${v}`, kind==='neutral' ? 'итог — у Мастера' : info.success && info.category ? `категория ${info.category}` : ''].filter(Boolean).join(' · ');
    return {id:Date.now().toString(36) + Math.random().toString(36).slice(2, 8), scene, cfg:Object.assign({}, cfg, {rules:undefined}), value:v, kind, main, sub};
  }
  // учебный бросок (обучение) и учебный стол — сцена только у себя: метку не тратит и другим не уходит
  const tutorial = ()=>typeof Onboarding!=='undefined' && Onboarding.busy();
  const sandboxed = ()=>typeof GameTable!=='undefined' && !!(GameTable.inSandbox && GameTable.inSandbox());
  const hiddenOf = (d, who)=>Object.assign({}, d, {value:'?', kind:'hidden', main:'Тайный бросок', sub:`${who} · результат знает Мастер`});
  // Бросок к20 своего листа (проверка, спасбросок, способность, к20 панели кубов). info: {value, max, success, category, label,
  // death, secret, unknown}. Не эпичный — null; эпичный — Promise, который завершится после сцены.
  function forOwnRoll(info){
    const cfg = cfgNow(); if(!cfg) return null;
    const quiet = tutorial(), arm = !quiet && amArmed(), scene = arm ? cfg.scene : ruleScene(cfg, info);
    if(!scene) return null;
    if(arm){ remoteArmed = remoteArmed.filter(x=>x!==session.myId); sendMsg({type:'epic-used'}, session.gmId); }
    const who = whoName(), d = dataFor(scene, cfg, info, who), hid = info.secret ? hiddenOf(d, who) : null;
    if(!quiet && role() && typeof sendMsg==='function'){
      if(hid){ if(isPlayer()) sendMsg({type:'epic-play', data:d}, session.gmId); sendMsg({type:'epic-play', data:hid, hidden:true}); } // число — только Мастеру
      else sendMsg({type:'epic-play', data:d});
    }
    seen.add(d.id);
    return play(hid && isPlayer() ? hid : d); // тайный бросок: бросивший, как и все, видит «?» — результат знает Мастер
  }
  // Игрок бросил к20 атаки с карты — итог считает Мастер и он же запустит сцену: обычный полёт кости у себя не нужен
  function willMapEpic(value){
    const cfg = cfgNow(); if(!cfg || tutorial() || sandboxed()) return false;
    return amArmed() || (value===12 && !!cfg.rules.nat12) || (value===13 && !!cfg.rules.nat13);
  }
  // (Мастер) атака / манёвр / граната с карты жетоном игрока: ownerId — его игрок; true — сцена запущена у всех
  function forMapRoll(ownerId, info){
    if(isPlayer()) return false;
    const quiet = tutorial() || sandboxed(), cfg = myCfg, arm = !quiet && !!ownerId && armed.has(ownerId), scene = arm ? cfg.scene : ruleScene(cfg, info);
    if(!scene) return false;
    if(arm){ armed.delete(ownerId); broadcastCfg(); refreshGm(); }
    const d = dataFor(scene, cfg, info, info.who || '');
    if(!quiet && role()==='gm' && typeof sendMsg==='function') sendMsg({type:'epic-play', data:d});
    seen.add(d.id); play(d);
    return true;
  }

  /* ---------- сообщения ---------- */
  const seen = new Set();
  function sanitizeData(x){
    if(!x || typeof x!=='object' || !SCENES[x.scene]) return null;
    const v = x.value==='?' ? '?' : Math.max(1, Math.min(20, Math.round(+x.value || 1)));
    return {id:String(x.id || '').slice(0, 40) || String(Math.random()), scene:x.scene, cfg:sanitizeCfg(x.cfg), value:v,
      kind:['crit','fumble','success','fail','neutral','hidden'].indexOf(x.kind)>=0 ? x.kind : 'neutral', main:String(x.main || '').slice(0, 60), sub:String(x.sub || '').slice(0, 160)};
  }
  function handle(msg){
    if(!msg || typeof msg.type!=='string' || msg.type.indexOf('epic-')!==0) return false;
    if(msg.type==='epic-cfg'){ if(isPlayer() && msg.from && msg.from===session.gmId){ remoteCfg = sanitizeCfg(msg.cfg); remoteArmed = Array.isArray(msg.armed) ? msg.armed.map(String).slice(0, 60) : []; } return true; }
    if(msg.type==='epic-used'){ if(role()==='gm' && msg.from && armed.delete(msg.from)){ broadcastCfg(); refreshGm(); } return true; }
    if(msg.type==='epic-play'){
      if(role()==='gm' && msg.hidden) return true; // Мастеру тайный бросок пришёл целиком отдельным сообщением
      const d = sanitizeData(msg.data); if(!d || seen.has(d.id)) return true;
      seen.add(d.id); play(d); return true;
    }
    return true;
  }

  /* ---------- звук: всё синтезируется WebAudio, без файлов ---------- */
  let S = sanitizeCfg(DEFAULT); // настройки сцены, которая играет сейчас
  const SFX = {
    ctx:null, master:null, bus:null, verb:null, noiseBuf:null,
    init(){
      if(this.ctx){ if(this.ctx.state==='suspended') this.ctx.resume(); return true; }
      const AC = window.AudioContext || window.webkitAudioContext; if(!AC) return false;
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.gain.value = .5; this.master.connect(c.destination);
      const len = Math.floor(c.sampleRate*2.6), imp = c.createBuffer(2, len, c.sampleRate);
      for(let ch=0; ch<2; ch++){ const d = imp.getChannelData(ch); for(let i=0;i<len;i++) d[i] = (Math.random()*2 - 1)*Math.pow(1 - i/len, 2.8); }
      this.verb = c.createConvolver(); this.verb.buffer = imp; const vg = c.createGain(); vg.gain.value = .3; this.verb.connect(vg); vg.connect(this.master);
      const nb = this.noiseBuf = c.createBuffer(1, c.sampleRate*2, c.sampleRate), nd = nb.getChannelData(0); for(let i=0;i<nd.length;i++) nd[i] = Math.random()*2 - 1;
      return true;
    },
    newBus(){ if(!this.ctx) return; const old = this.bus, c = this.ctx;
      if(old){ old.gain.setTargetAtTime(0, c.currentTime, .03); setTimeout(()=>{ try{ old.disconnect(); }catch(e){} }, 400); }
      this.master.gain.setTargetAtTime((S.volume/100)*.9, c.currentTime, .02);
      this.bus = c.createGain(); this.bus.connect(this.master); this.bus.connect(this.verb); },
    get on(){ return !!(S.sound && this.ctx && this.bus && this.ctx.state==='running'); },
    t(d){ return this.ctx.currentTime + Math.max(0, d)*S.tempo; },
    env(gn, t, a, peak, dec){ gn.gain.setValueAtTime(.0001, t); gn.gain.exponentialRampToValueAtTime(Math.max(.0002, peak), t + a); gn.gain.exponentialRampToValueAtTime(.0001, t + a + dec); },
    tone(type, f, d, a, peak, dec, f2, glide){ if(!this.on) return; const c = this.ctx, t = this.t(d), o = c.createOscillator(), gn = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t); if(f2) o.frequency.exponentialRampToValueAtTime(f2, t + (glide || dec));
      this.env(gn, t, a, peak, dec); o.connect(gn); gn.connect(this.bus); o.start(t); o.stop(t + a + dec + .05); },
    noise(d, dur, type, f, q, peak, a, f2){ if(!this.on) return; const c = this.ctx, t = this.t(d), src = c.createBufferSource(), fl = c.createBiquadFilter(), gn = c.createGain();
      src.buffer = this.noiseBuf; src.loop = true; fl.type = type; fl.frequency.setValueAtTime(f, t); if(f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur); fl.Q.value = q;
      this.env(gn, t, a || .005, peak, Math.max(.01, dur - (a || .005))); src.connect(fl); fl.connect(gn); gn.connect(this.bus); src.start(t); src.stop(t + dur + .05); },
    thud(d, f0, gain){ this.tone('sine', f0 || 140, d, .004, gain || .9, .7, 36, .45); this.noise(d, .18, 'lowpass', 700, .7, (gain || .9)*.5); },
    stamp(d){ this.noise(d, .07, 'highpass', 1600, .7, .35); this.tone('sine', 95, d, .003, .45, .28, 52, .2); },
    whoosh(d, dur, f0, f1, peak){ this.noise(d, dur, 'bandpass', f0, 1.3, peak || .4, dur*.7, f1); },
    riser(d, dur, peak){ if(!this.on) return; const c = this.ctx, t = this.t(d), fl = c.createBiquadFilter(), gn = c.createGain(), end = t + dur*S.tempo;
      fl.type = 'lowpass'; fl.frequency.setValueAtTime(180, t); fl.frequency.exponentialRampToValueAtTime(3200, end); fl.Q.value = 4;
      gn.gain.setValueAtTime(.0001, t); gn.gain.exponentialRampToValueAtTime(peak || .18, end); gn.gain.exponentialRampToValueAtTime(.0001, end + .08);
      [110, 110.6, 164.8].forEach(f=>{ const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f*2, end); o.connect(fl); o.start(t); o.stop(end + .1); });
      fl.connect(gn); gn.connect(this.bus); },
    drone(d, dur, peak){ if(!this.on) return; const c = this.ctx, t = this.t(d), fl = c.createBiquadFilter(), gn = c.createGain(), end = t + dur*S.tempo;
      fl.type = 'lowpass'; fl.frequency.value = 520; gn.gain.setValueAtTime(.0001, t); gn.gain.exponentialRampToValueAtTime(peak || .16, t + .5); gn.gain.setValueAtTime(peak || .16, end - .1); gn.gain.exponentialRampToValueAtTime(.0001, end + .5);
      [55, 55.4, 82.4].forEach(f=>{ const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(fl); o.start(t); o.stop(end + .6); });
      fl.connect(gn); gn.connect(this.bus); },
    chime(d, base){ const b = base || 523.25; [0, 4, 7, 12, 16].forEach((s, i)=>this.tone('triangle', b*Math.pow(2, s/12), d + i*.07, .01, .16, 2.4)); },
    sting(d){ this.tone('sine', 98, d, .02, .32, 1.6); this.tone('sine', 116.5, d + .05, .02, .22, 1.5); },
    clang(d){ if(!this.on) return; const c = this.ctx, t = this.t(d), car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), gn = c.createGain();
      car.frequency.value = 660; mod.frequency.value = 660*1.414; mg.gain.setValueAtTime(1200, t); mg.gain.exponentialRampToValueAtTime(5, t + 1.4);
      mod.connect(mg); mg.connect(car.frequency); this.env(gn, t, .002, .4, 1.8); car.connect(gn); gn.connect(this.bus);
      car.start(t); mod.start(t); car.stop(t + 2); mod.stop(t + 2); this.tone('sine', 1336, d, .002, .12, 1.2); },
    crackle(d, dur, rate){ if(!this.on) return; const count = Math.round(dur*rate); for(let i=0;i<count;i++){ const x = Math.pow(i/count, .6); this.noise(d + x*dur, .015, 'highpass', rnd(1800, 5200), .8, rnd(.05, .22)); } },
    roar(d, dur, peak){ this.noise(d, dur, 'lowpass', 220, .8, peak || .35, dur*.85, 900); },
    heartbeat(d){ this.tone('sine', 62, d, .01, .7, .16, 44, .14); this.tone('sine', 58, d + .2, .01, .45, .16, 42, .14); },
    tick(d){ this.tone('square', 1900, d, .001, .06, .03); },
    glitch(d, count){ for(let i=0;i<(count || 5);i++) this.tone('square', rnd(240, 2200), d + i*.045, .001, .07, .04); },
    crack(d){ this.noise(d, .05, 'bandpass', 2600, 2, .45); this.tone('square', 3200, d, .001, .05, .02); },
    shatter(d){ this.noise(d, .7, 'highpass', 3200, .7, .5); for(let i=0;i<9;i++) this.tone('sine', rnd(2200, 6200), d + rnd(0, .35), .001, .07, rnd(.15, .4)); },
    sadFall(d){ this.tone('sine', 392, d, .03, .22, 1.3, 130, 1.2); this.tone('sine', 466, d + .08, .03, .14, 1.2, 155, 1.1); },
    snap(d){ this.noise(d, .26, 'bandpass', 3400, 1.5, .4, .2, 300); this.tone('square', 2400, d + .26, .001, .08, .03); }
  };
  // Браузер пускает звук только после действия пользователя — первый клик или нажатие на странице будит звук заранее
  ['pointerdown', 'keydown'].forEach(ev=>document.addEventListener(ev, ()=>{ if(!SFX.ctx || SFX.ctx.state!=='running') SFX.init(); }, {capture:true, passive:true}));

  /* ---------- сцена: оверлей поверх всего экрана ---------- */
  let root = null, $ = null, canvas = null, g = null, W = 0, Hh = 0;
  const H6 = [[0,-100],[86.6,-50],[86.6,50],[0,100],[-86.6,50],[-86.6,-50]], T3 = [[0,-56],[48.5,28],[-48.5,28]];
  const FACES = [[[T3[0],H6[5],H6[0]],'f2'],[[T3[0],H6[0],H6[1]],'f2'],[[T3[0],H6[1],T3[1]],'f1'],[[T3[1],H6[1],H6[2]],'f3'],[[T3[1],H6[2],H6[3]],'f3'],
                 [[T3[1],H6[3],T3[2]],'f1'],[[T3[2],H6[3],H6[4]],'f3'],[[T3[2],H6[4],H6[5]],'f2'],[[T3[2],H6[5],T3[0]],'f1'],[[T3[0],T3[1],T3[2]],'f0']];
  const CRACKS = ['M2 4 L-14 -18 L-8 -34 L-22 -52 L-30 -76', 'M2 4 L20 -6 L44 2 L58 -14 L80 -22', 'M2 4 L6 26 L-6 44 L4 66 L-4 92', 'M-14 -18 L-36 -10 L-52 8', 'M44 2 L52 24 L70 34'];
  const pts = (a)=>a.map(p=>p.join(',')).join(' ');
  const DIE_SVG = `<svg viewBox="-110 -110 220 220" aria-hidden="true">
      ${FACES.map(([p, c])=>`<polygon class="ep-face ${c}" points="${pts(p)}"/>`).join('')}
      ${FACES.map(([p])=>`<polygon class="ep-edge" points="${pts(p)}"/>`).join('')}
      <text class="ep-num small n1" x="45" y="-24" transform="rotate(60 45 -24)">8</text>
      <text class="ep-num small n2" x="0" y="54" transform="rotate(180 0 54)">14</text>
      <text class="ep-num small n3" x="-45" y="-24" transform="rotate(-60 -45 -24)">2</text>
      <text class="ep-num main" x="0" y="6">20</text>
      <g class="ep-cracks">${CRACKS.map(d=>`<path d="${d}"/>`).join('')}</g></svg>`;
  function build(){
    if(root) return;
    root = document.createElement('div'); root.className = 'ep-stage'; root.hidden = true; root.setAttribute('aria-live', 'polite');
    root.innerHTML = `<div class="ep-shake">
        <div class="ep-world"><div class="ep-dim"></div><div class="ep-tint"></div></div>
        <div class="ep-glow"></div>
        <div class="ep-runes"><svg viewBox="-260 -260 520 520"><defs>
            <path id="epRingA" d="M -220 0 a 220 220 0 1 1 440 0 a 220 220 0 1 1 -440 0"/><path id="epRingB" d="M -165 0 a 165 165 0 1 0 330 0 a 165 165 0 1 0 -330 0"/></defs>
          <g class="ep-ring ep-ring1"><circle r="236" fill="none" style="stroke:var(--epfx)" stroke-width="1.5" opacity=".7"/><circle r="204" fill="none" style="stroke:var(--epfx)" stroke-width="1" opacity=".45" stroke-dasharray="3 9"/>
            <text font-family="Cinzel, serif" font-size="19" letter-spacing="6" style="fill:var(--epfx)"><textPath href="#epRingA">НАРРА-КА ✦ ПСИ-ПОЛЕ ✦ ИЗНАНКА ✦ НАРРА-КА ✦ ПСИ-ПОЛЕ ✦ ИЗНАНКА ✦</textPath></text></g>
          <g class="ep-ring ep-ring2"><circle r="178" fill="none" style="stroke:var(--epfx)" stroke-width="1" opacity=".5"/>
            <text font-family="Cinzel, serif" font-size="14" letter-spacing="5" style="fill:var(--epfx)" opacity=".85"><textPath href="#epRingB">КОСТЬ ДУХОВ ✧ ВРАТА ✧ КОСТЬ ДУХОВ ✧ ВРАТА ✧ КОСТЬ ДУХОВ ✧ ВРАТА ✧</textPath></text></g></svg></div>
        <div class="ep-seal"><svg viewBox="-160 -160 320 320"><defs>
            <filter id="epInky" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="7"/></filter>
            <path id="epSealRing" d="M -118 0 a 118 118 0 1 1 236 0 a 118 118 0 1 1 -236 0"/></defs>
          <g filter="url(#epInky)" fill="none" style="stroke:var(--epfx)"><circle r="148" stroke-width="7"/><circle r="134" stroke-width="2"/><circle r="92" stroke-width="3"/>
            <text font-family="Cinzel, serif" font-size="20" font-weight="800" letter-spacing="4" style="fill:var(--epfx)" stroke="none"><textPath href="#epSealRing">ПЕЧАТЬ СУДЬБЫ ✦ ЛИЧНОЕ ДЕЛО РЕИНКАРНАТА ✦</textPath></text>
            <text class="ep-seal-num" y="6" text-anchor="middle" dominant-baseline="central" font-family="Cinzel, serif" font-size="74" font-weight="800" style="fill:var(--epfx)" stroke="none">12</text></g></svg></div>
        <div class="ep-die-wrap"><div class="ep-die">${DIE_SVG}</div></div>
        <canvas class="ep-fx"></canvas>
        <div class="ep-vignette"></div>
        <div class="ep-caption"><div class="ep-cap-main"></div><div class="ep-cap-sub"></div></div>
        <div class="ep-flash"></div>
        <div class="ep-bar top"></div><div class="ep-bar bot"></div>
      </div><div class="ep-skip">нажмите, чтобы закрыть</div>`;
    document.body.appendChild(root);
    const q = (s)=>root.querySelector(s);
    $ = {shake:q('.ep-shake'), world:q('.ep-world'), dim:q('.ep-dim'), tint:q('.ep-tint'), glow:q('.ep-glow'), runes:q('.ep-runes'), ring1:q('.ep-ring1'), ring2:q('.ep-ring2'),
      seal:q('.ep-seal'), sealNum:q('.ep-seal-num'), wrap:q('.ep-die-wrap'), die:q('.ep-die'), vignette:q('.ep-vignette'), caption:q('.ep-caption'),
      capMain:q('.ep-cap-main'), capSub:q('.ep-cap-sub'), flash:q('.ep-flash'), barTop:q('.ep-bar.top'), barBot:q('.ep-bar.bot')};
    canvas = q('.ep-fx'); g = canvas.getContext('2d');
    root.addEventListener('pointerdown', (e)=>{ e.preventDefault(); e.stopPropagation(); if(skipFn) skipFn(); });
    addEventListener('resize', resize);
  }
  function resize(){ if(!root) return; const dpr = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; Hh = innerHeight;
    canvas.width = Math.round(W*dpr); canvas.height = Math.round(Hh*dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0); }
  const crackPaths = ()=>[...$.die.querySelectorAll('.ep-cracks path')];
  function hideCracks(){ crackPaths().forEach(p=>{ const L = p.getTotalLength(); p.style.strokeDasharray = L; p.style.strokeDashoffset = L; }); }
  const setNum = (v)=>{ $.die.querySelectorAll('.ep-num.main').forEach(n=>n.textContent = v); };
  const setSmall = ()=>{ ['n1','n2','n3'].forEach(k=>$.die.querySelectorAll('.' + k).forEach(n=>n.textContent = 1 + Math.floor(Math.random()*20))); };

  /* ---------- частицы ---------- */
  let parts = [], rafOn = false, last = 0;
  function spawn(p){ parts.push(Object.assign({x:W/2, y:Hh/2, vx:0, vy:0, ay:0, drag:1, life:0, max:1, size:3, rot:0, vr:0, type:'dot', color:'#fff', add:false, alpha:1}, p));
    if(!rafOn){ rafOn = true; last = performance.now(); requestAnimationFrame(tick); } }
  function tick(now){
    const dt = Math.min(.05, (now - last)/1000); last = now; g.clearRect(0, 0, W, Hh);
    parts = parts.filter(p=>{
      p.life += dt; if(p.life >= p.max) return false;
      if(p.update) p.update(p, dt);
      p.vy += p.ay*dt; const d = Math.pow(p.drag, dt*60); p.vx *= d; p.vy *= d; p.x += p.vx*dt; p.y += p.vy*dt; p.rot += p.vr*dt;
      const k = 1 - p.life/p.max; g.globalCompositeOperation = p.add ? 'lighter' : 'source-over'; g.globalAlpha = Math.max(0, Math.min(1, k*p.alpha));
      if(p.type==='dot'){ g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y, Math.max(.3, p.size*(.35 + .65*k)), 0, 6.283); g.fill(); }
      else if(p.type==='spark'){ g.strokeStyle = p.color; g.lineWidth = Math.max(.6, p.size*k); g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx*.035, p.y - p.vy*.035); g.stroke(); }
      else if(p.type==='shard'){ g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.color; g.strokeStyle = '#1c1712'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(-p.size, -p.size*.6); g.lineTo(p.size*.9, -p.size*.2); g.lineTo(-p.size*.1, p.size); g.closePath(); g.fill(); g.stroke(); g.restore(); }
      else if(p.type==='ring'){ const r = p.r0 + (p.r1 - p.r0)*(1 - Math.pow(k, 2)); g.strokeStyle = p.color; g.lineWidth = Math.max(.5, p.size*k); g.beginPath(); g.arc(p.x, p.y, r, 0, 6.283); g.stroke(); }
      return true;
    });
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    if(parts.length) requestAnimationFrame(tick); else { rafOn = false; g.clearRect(0, 0, W, Hh); }
  }
  const K = ()=>(S.intensity/100)*(reduceMotion ? .45 : 1);
  const n = (base)=>Math.max(1, Math.round(base*K()));
  const cx = ()=>W/2, cy = ()=>Hh/2, dieR = ()=>$.wrap.offsetWidth/2;
  function shockwave(color, r1, size, dur){ spawn({type:'ring', x:cx(), y:cy(), r0:dieR()*.6, r1, size, color, max:dur, add:true}); }
  function inkSplat(color, count){ for(let i=0;i<count;i++){ const a = rnd(0, 6.283), sp = rnd(120, 620); spawn({x:cx() + Math.cos(a)*dieR()*.5, y:cy() + Math.sin(a)*dieR()*.5, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp*.8, ay:520, drag:.94, size:rnd(2, 7), color, max:rnd(.6, 1.3)}); } }
  function dust(count){ for(let i=0;i<count;i++){ const s = Math.random() < .5 ? -1 : 1; spawn({x:cx() + s*rnd(0, dieR()), y:cy() + dieR()*.7, vx:s*rnd(80, 380), vy:rnd(-90, -10), ay:60, drag:.93, size:rnd(4, 11), color:'rgba(226,211,172,.5)', max:rnd(.7, 1.4)}); } }
  function sparks(count, opt){ opt = opt || {}; for(let i=0;i<count;i++){ const a = opt.up ? rnd(-2.6, -.55) : rnd(0, 6.283), sp = rnd(opt.min || 220, opt.max || 900);
    spawn({type:'spark', x:cx() + rnd(-dieR()*.4, dieR()*.4), y:cy() + rnd(-dieR()*.3, dieR()*.3), vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, ay:opt.g==null ? 700 : opt.g, drag:.95, size:rnd(1.2, 2.8), color:opt.color || (Math.random() < .5 ? '#ffd27a' : '#ff8a3a'), add:true, max:rnd(.4, opt.life || 1.1)}); } }
  function motes(count, color){ const R = Math.max(W, Hh)*.62; for(let i=0;i<count;i++){ const a = rnd(0, 6.283), r = R*rnd(.7, 1);
    spawn({x:cx() + Math.cos(a)*r, y:cy() + Math.sin(a)*r, size:rnd(1.5, 3.6), color, add:true, max:rnd(1, 1.6), a, r, update(p, dt){ p.r *= Math.pow(.18, dt); p.a += dt*2.4; p.x = cx() + Math.cos(p.a)*p.r; p.y = cy() + Math.sin(p.a)*p.r; }}); } }
  function shards(count){ for(let i=0;i<count;i++){ const a = rnd(-3.0, -.15), sp = rnd(90, 420); spawn({type:'shard', x:cx() + rnd(-dieR()*.6, dieR()*.6), y:cy() + rnd(-dieR()*.6, dieR()*.4),
    vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, ay:900, drag:.985, size:rnd(5, 14), rot:rnd(0, 6), vr:rnd(-9, 9), color:['#cdbb8f','#b39f72','#8a7d62','#e2d3ac'][i%4], max:rnd(1.2, 2)}); } }
  function embers(count){ for(let i=0;i<count;i++){ spawn({x:cx() + rnd(-W*.3, W*.3), y:cy() + rnd(0, Hh*.3), vx:rnd(-20, 20), vy:rnd(-90, -30), drag:.99, size:rnd(1, 2.4), color:'#ffb35c', add:true, max:rnd(1.2, 2.6)}); } }

  /* ---------- общий запуск сцены ---------- */
  let runId = 0, numTimer = 0, skipFn = null;
  const alive = (id)=>id===runId;
  const wait = (ms)=>new Promise(r=>setTimeout(r, ms*S.tempo));
  const D = (ms)=>ms*S.tempo;
  const anim = (el, frames, ms, opts)=>el.animate(frames, Object.assign({duration:D(ms), fill:'forwards', easing:'cubic-bezier(.2,.7,.2,1)'}, opts || {}));
  const fx = ()=>getComputedStyle(root).getPropertyValue('--epfx').trim();
  function accentFor(kind){
    if(S.accent==='custom') return S.custom;
    if(S.accent!=='auto') return ACCENTS[S.accent];
    return kind==='crit' ? ACCENTS.gold : kind==='fumble' ? ACCENTS.blood : kind==='success' ? '#f6ecd4' : kind==='fail' ? '#b7a688' : ACCENTS.psi;
  }
  function reset(){
    runId++;
    [$.wrap, $.die, $.caption, $.capMain, $.seal, $.runes, $.ring1, $.ring2, $.glow, $.dim, $.tint, $.flash, $.vignette, $.barTop, $.barBot, $.shake, root]
      .forEach(el=>el.getAnimations({subtree:true}).forEach(a=>a.cancel()));
    root.querySelectorAll('.ep-ghost').forEach(x=>x.remove());
    $.die.className = 'ep-die'; $.die.style.filter = ''; $.wrap.style.opacity = 0; $.world.classList.remove('gray'); $.vignette.classList.remove('pulse');
    $.caption.className = 'ep-caption'; hideCracks(); parts = []; clearInterval(numTimer);
    if(SFX.ctx) SFX.newBus();
  }
  function rollNumbers(ms, final, every){ clearInterval(numTimer); const end = performance.now() + D(ms);
    numTimer = setInterval(()=>{ if(performance.now() >= end){ clearInterval(numTimer); setNum(final); return; } setNum(1 + Math.floor(Math.random()*20)); }, every || 70); }
  function shake(power, ms){ if(!S.shake || reduceMotion || power < 1) return; const f = [];
    for(let i=0;i<9;i++){ const k = 1 - i/9; f.push({transform:`translate(${rnd(-1, 1)*power*k}px, ${rnd(-1, 1)*power*k}px) rotate(${rnd(-1, 1)*power*.04*k}deg)`}); }
    f.push({transform:'none'}); $.shake.animate(f, {duration:ms, easing:'ease-out'}); }
  const flash = (peak, ms)=>$.flash.animate([{opacity:0}, {opacity:peak, offset:.15}, {opacity:0}], {duration:ms, easing:'ease-out'});
  const dimIn = (to)=>anim($.dim, [{opacity:0}, {opacity:S.dim ? to : .25}], 380);
  function showCaption(out, cls){
    $.capMain.textContent = out.main; $.capSub.textContent = out.sub; if(cls) $.caption.classList.add(cls);
    anim($.caption, [{opacity:0, transform:'translateY(18px) scale(.96)'}, {opacity:1, transform:'none'}], 520);
  }
  function stinger(out, d){ if(out.kind==='crit') SFX.chime(d); else if(out.kind==='success' || out.kind==='neutral' || out.kind==='hidden') SFX.chime(d, 392); else SFX.sting(d); }

  const PLAY = {
    async seal(out, id){
      const ac = fx(); dimIn(.78); if(out.kind==='crit') $.die.classList.add('gold');
      $.sealNum.textContent = out.value; setSmall(); rollNumbers(1150, out.value);
      SFX.whoosh(0, 1.05, 260, 2600, .45); SFX.riser(.1, 1.0, .1);
      $.wrap.style.opacity = 1;
      await anim($.wrap, [{transform:`translate(${-W*.42}px, ${-Hh*.62}px) rotate(-620deg) scale(.45)`, opacity:0},
        {transform:`translate(${-W*.18}px, ${-Hh*.28}px) rotate(-320deg) scale(.9)`, opacity:1, offset:.35},
        {transform:'translate(12px, -48px) rotate(-24deg) scale(1.18)', opacity:1, offset:.8}, {transform:'translate(0, -56px) rotate(-14deg) scale(1.22)', opacity:1}], 1150).finished;
      if(!alive(id)) return;
      anim($.die, [{transform:'rotate(0)'}, {transform:'rotate(2deg)'}, {transform:'rotate(-2deg)'}, {transform:'rotate(1deg)'}, {transform:'rotate(0)'}], 380, {fill:'none'});
      await wait(380); if(!alive(id)) return;
      SFX.thud(0, 150, 1); SFX.stamp(.03);
      anim($.wrap, [{transform:'translate(0, -56px) rotate(-14deg) scale(1.22)', opacity:1}, {transform:'translate(0, 6px) rotate(0deg) scale(.9)', opacity:1, offset:.55}, {transform:'none', opacity:1}], 260, {easing:'cubic-bezier(.5,0,.3,1)'});
      await wait(140); if(!alive(id)) return;
      shake(20*K() + 4, 560); flash(.3*K(), 200);
      shockwave(ac, Math.max(W, Hh)*.6, 7, .9); dust(n(34)); inkSplat(ac, n(80));
      anim($.seal, [{opacity:0, transform:'translate(-50%,-50%) scale(2.4) rotate(-28deg)'}, {opacity:.95, transform:'translate(-50%,-50%) scale(.96) rotate(-9deg)', offset:.7}, {opacity:.85, transform:'translate(-50%,-50%) scale(1) rotate(-8deg)'}], 380, {easing:'cubic-bezier(.6,0,.3,1)'});
      await wait(260); if(!alive(id)) return;
      showCaption(out); stinger(out, 0);
    },
    async psi(out, id){
      const ac = fx(); dimIn(.86); $.die.classList.add('psi'); setSmall(); rollNumbers(1850, out.value, 90);
      anim($.tint, [{opacity:0}, {opacity:.35}, {opacity:.12}, {opacity:.45}, {opacity:.2}, {opacity:.55}], 1800, {easing:'steps(6)'});
      anim($.runes, [{opacity:0, transform:'translate(-50%,-50%) scale(.55)'}, {opacity:.95, transform:'translate(-50%,-50%) scale(1)'}], 900);
      $.ring1.animate([{transform:'rotate(0deg)'}, {transform:'rotate(360deg)'}], {duration:9000, iterations:Infinity});
      $.ring2.animate([{transform:'rotate(0deg)'}, {transform:'rotate(-360deg)'}], {duration:6000, iterations:Infinity});
      SFX.drone(0, 2.1, .16); SFX.riser(.25, 1.6, .14); SFX.glitch(.6, 4); SFX.glitch(1.15, 6); SFX.glitch(1.55, 3);
      $.wrap.style.opacity = 1;
      anim($.wrap, [{transform:`translate(0, ${Hh*.36}px) scale(.55)`, opacity:0}, {transform:'translate(0, 8px) scale(.95)', opacity:1, offset:.75}, {transform:'translate(0, -6px) scale(1)', opacity:1}], 1800, {easing:'cubic-bezier(.3,.1,.2,1)'});
      anim($.die, [{transform:'rotate(0) translate(0,0)'}, {transform:'rotate(4deg) translate(2px,-1px)'}, {transform:'rotate(-3deg) translate(-2px,1px)'}, {transform:'rotate(0) translate(0,0)'}], 160, {iterations:11, fill:'none'});
      anim($.die, [{filter:'drop-shadow(0 0 0 transparent)'}, {filter:`drop-shadow(-4px 0 #ff2bd6) drop-shadow(4px 0 #2bf0ff) drop-shadow(0 0 18px ${ac})`}], 1800, {easing:'ease-in'});
      const em = setInterval(()=>{ if(!alive(id)){ clearInterval(em); return; } motes(n(9), ac); }, 70);
      await wait(1800); clearInterval(em); if(!alive(id)) return;
      flash(.95, 260); SFX.thud(0, 120, 1); stinger(out, .05); SFX.noise(0, .5, 'highpass', 2400, .7, .25, .3, 9000);
      anim($.runes, [{opacity:.95, transform:'translate(-50%,-50%) scale(1)'}, {opacity:0, transform:'translate(-50%,-50%) scale(1.8)'}], 520);
      anim($.tint, [{opacity:.6}, {opacity:.18}], 600);
      shockwave(ac, Math.max(W, Hh)*.7, 6, 1); setTimeout(()=>alive(id) && shockwave('#f6ecd4', Math.max(W, Hh)*.45, 3, .8), D(120));
      anim($.wrap, [{transform:'translate(0, -6px) scale(1)', opacity:1}, {transform:'translate(0, -6px) scale(1.3)', opacity:1, offset:.3}, {transform:'translate(0, -6px) scale(1)', opacity:1}], 420);
      shake(10*K() + 2, 380); sparks(n(60), {color:ac, g:0, life:.9, min:300, max:1000});
      await wait(160); if(!alive(id)) return;
      showCaption(out, 'glitch');
    },
    async forge(out, id){
      const ac = fx(); dimIn(.8); setSmall(); setNum(out.value);
      $.wrap.style.opacity = 1;
      await anim($.wrap, [{transform:`translate(0, ${-Hh*.62}px) rotate(-90deg)`, opacity:1}, {transform:'translate(0, 0) rotate(-8deg)', opacity:1, offset:.55}, {transform:'translate(0, -38px) rotate(4deg)', opacity:1, offset:.75},
        {transform:'translate(0, 0) rotate(0)', opacity:1, offset:.9}, {transform:'translate(0, -8px)', opacity:1, offset:.95}, {transform:'none', opacity:1}], 820, {easing:'cubic-bezier(.4,0,.6,1)'}).finished;
      if(!alive(id)) return;
      SFX.thud(0, 110, .6); dust(n(14));
      $.die.style.setProperty('--heat', D(1600)/1000 + 's'); $.die.classList.add('hot');
      anim($.glow, [{opacity:0, transform:'scale(.5)'}, {opacity:1, transform:'scale(1.35)'}], 1650, {easing:'ease-in'});
      anim($.die, [{transform:'skewX(0) scale(1)'}, {transform:'skewX(1.5deg) scale(1.01)'}, {transform:'skewX(-1.5deg) scale(1)'}, {transform:'skewX(0) scale(1.01)'}], 220, {iterations:8, fill:'none'});
      SFX.crackle(.1, 1.7, 26); SFX.roar(0, 1.75, .32); SFX.riser(.6, 1.1, .08);
      let tk = 0; const em = setInterval(()=>{ if(!alive(id)){ clearInterval(em); return; } tk++; sparks(n(2 + tk*.6), {up:true, g:520, min:160, max:520, life:1.2}); }, 60);
      await wait(1650); clearInterval(em); if(!alive(id)) return;
      SFX.clang(0); SFX.thud(0, 160, 1); stinger(out, .1);
      $.die.classList.add('forged'); flash(.4*K(), 240); shake(16*K() + 3, 480);
      sparks(n(170), {min:260, max:1100, life:1.2}); shockwave('#ffb35c', Math.max(W, Hh)*.55, 6, .8); shockwave(ac, Math.max(W, Hh)*.35, 3, .7);
      anim($.wrap, [{transform:'scale(1)', opacity:1}, {transform:'scale(1.22)', opacity:1, offset:.25}, {transform:'scale(1)', opacity:1}], 360);
      showCaption(out);
      const eb = setInterval(()=>{ if(!alive(id)){ clearInterval(eb); return; } embers(n(3)); }, 120); setTimeout(()=>clearInterval(eb), D(2200));
    },
    async slowmo(out, id){
      const ac = fx(); dimIn(.7); setSmall(); rollNumbers(2500, out.value, 230);
      [$.barTop, $.barBot].forEach(b=>anim(b, [{height:'0'}, {height:'11%'}], 420));
      $.world.classList.add('gray'); $.vignette.classList.add('pulse');
      $.wrap.style.opacity = 1;
      const frames = [{transform:`translate(${-W*.46}px, ${Hh*.12}px) rotate(-260deg) scale(.7)`, opacity:1}, {transform:`translate(${-W*.25}px, ${-Hh*.2}px) rotate(-170deg) scale(.85)`, opacity:1, offset:.35},
        {transform:`translate(${-W*.06}px, ${-Hh*.08}px) rotate(-60deg) scale(.95)`, opacity:1, offset:.75}, {transform:'translate(0, 0) rotate(-20deg) scale(1)', opacity:1}];
      const dur = 2500, ghosts = reduceMotion ? 0 : 4;
      for(let i=1;i<=ghosts;i++){ const gh = document.createElement('div'); gh.className = 'ep-die-wrap ep-ghost'; gh.style.opacity = 0; gh.style.zIndex = 2;
        gh.innerHTML = `<div class="ep-die">${DIE_SVG}</div>`; $.shake.insertBefore(gh, $.wrap); const op = .32 - i*.06;
        gh.querySelectorAll('.ep-num.main').forEach(x=>x.textContent = ''); gh.querySelectorAll('.ep-cracks').forEach(x=>x.remove());
        gh.animate(frames.map(f=>Object.assign({}, f, {opacity:op})), {duration:D(dur), delay:D(i*70), fill:'forwards', easing:'cubic-bezier(.25,.6,.3,1)'}); }
      anim($.wrap, frames, dur, {easing:'cubic-bezier(.25,.6,.3,1)'});
      [.25, 1.15, 1.85].forEach((t)=>{ SFX.heartbeat(t); setTimeout(()=>alive(id) && $.vignette.animate([{opacity:.55}, {opacity:1, offset:.2}, {opacity:.55}], {duration:520, easing:'ease-out'}), D(t*1000)); });
      [.1, .6, 1.0, 1.35, 1.65, 1.9, 2.1, 2.25, 2.37, 2.46].forEach(t=>SFX.tick(t));
      SFX.whoosh(0, 2.5, 200, 700, .18);
      await wait(2500); if(!alive(id)) return;
      SFX.snap(0); SFX.thud(.26, 150, 1); stinger(out, .3);
      await wait(260); if(!alive(id)) return;
      [$.barTop, $.barBot].forEach(b=>anim(b, [{height:'11%'}, {height:'0'}], 260));
      $.world.classList.remove('gray'); $.vignette.classList.remove('pulse');
      root.querySelectorAll('.ep-ghost').forEach(gh=>gh.animate([{opacity:.2}, {opacity:0}], {duration:180, fill:'forwards'}));
      flash(.6, 220); shake(12*K() + 2, 420);
      anim($.wrap, [{transform:'translate(0, 0) rotate(-20deg) scale(1)', opacity:1}, {transform:'rotate(0) scale(1.38)', opacity:1, offset:.35}, {transform:'none', opacity:1}], 380);
      [0, 110, 220].forEach((ms, i)=>setTimeout(()=>alive(id) && shockwave(i===1 ? '#f6ecd4' : ac, Math.max(W, Hh)*(.4 + i*.15), 5 - i, .8), D(ms)));
      sparks(n(40), {color:ac, g:0, min:200, max:700, life:.7});
      showCaption(out);
    },
    async crack(out, id){
      dimIn(.82); setSmall(); setNum(out.value);
      $.wrap.style.opacity = 1;
      anim($.wrap, [{transform:`translate(${W*.55}px, ${-Hh*.15}px) rotate(420deg)`, opacity:1}, {transform:`translate(${W*.2}px, 0) rotate(160deg)`, opacity:1, offset:.45},
        {transform:`translate(${W*.08}px, -30px) rotate(70deg)`, opacity:1, offset:.62}, {transform:'translate(-10px, 0) rotate(-12deg)', opacity:1, offset:.82}, {transform:'translate(0, 0) rotate(0)', opacity:1}], 1050, {easing:'cubic-bezier(.3,.6,.4,1)'});
      SFX.thud(.47, 110, .5); SFX.thud(.86, 100, .35); SFX.whoosh(0, .5, 600, 1600, .15);
      await wait(1050); if(!alive(id)) return;
      [0, .2, .42, .62].forEach(t=>SFX.tick(t));
      await anim($.die, [{transform:'rotate(0)'}, {transform:'rotate(-11deg)', offset:.2}, {transform:'rotate(9deg)', offset:.45}, {transform:'rotate(-6deg)', offset:.7}, {transform:'rotate(3deg)', offset:.85}, {transform:'rotate(0)'}], 900, {easing:'ease-in-out', fill:'none'}).finished;
      if(!alive(id)) return;
      crackPaths().forEach((p, i)=>p.animate([{strokeDashoffset:p.style.strokeDashoffset}, {strokeDashoffset:0}], {duration:D(320), delay:D(i*70), fill:'forwards', easing:'ease-out'}));
      [0, .1, .22, .3].forEach(t=>SFX.crack(t));
      await wait(520); if(!alive(id)) return;
      $.die.classList.add('cracked'); SFX.shatter(0); SFX.thud(0, 80, .7); SFX.sadFall(.35);
      shards(n(46)); dust(n(18)); shake(9*K() + 2, 420);
      $.world.classList.add('gray'); $.vignette.classList.add('pulse');
      anim($.wrap, [{transform:'none', opacity:1}, {transform:'translate(0, 10px) rotate(6deg) scale(.94)', opacity:.92}], 700);
      showCaption(out);
      anim($.capMain, [{filter:'blur(6px)', letterSpacing:'.5em'}, {filter:'blur(0)', letterSpacing:'.12em'}], 800, {fill:'none'});
    }
  };
  // Сцены играют по очереди: два эпичных броска подряд не перебивают друг друга
  let chain = Promise.resolve();
  function play(d){ chain = chain.then(()=>runScene(d)).catch((e)=>{ console.warn('[Эпичный бросок]', e); hide(); }); return chain; }
  function hide(){ if(!root) return; reset(); root.hidden = true; document.body.classList.remove('ep-on'); }
  async function runScene(d){
    build(); S = sanitizeCfg(d.cfg);
    if(S.sound) SFX.init();
    root.hidden = false; document.body.classList.add('ep-on'); resize();
    reset(); const id = runId;
    root.style.setProperty('--epfx', accentFor(d.kind));
    let skipped = false; const skip = new Promise(r=>{ skipFn = ()=>{ skipped = true; r(); }; });
    const run = (async()=>{ try{ await PLAY[d.scene](d, id); }catch(e){ /* сцену прервали — анимации отменены */ } if(!skipped) await wait(1900); })();
    await Promise.race([run, skip]);
    skipFn = null;
    if(!skipped) await new Promise(r=>{ const a = root.animate([{opacity:1}, {opacity:0}], {duration:420, fill:'forwards'}); a.onfinish = r; a.oncancel = r; });
    hide();
  }
  // Показать сцену только у себя (кнопка «Посмотреть» у Мастера)
  function preview(kind){ const v = kind==='fumble' ? 13 : 12; const d = dataFor(myCfg.scene, myCfg, {value:v, success:kind!=='fumble', category:3, max:15, label:'Пример'}, 'Предпросмотр'); return play(d); }

  /* ---------- экран Мастера → «Эпичные» ---------- */
  const D20_ICON = '<svg class="ep-d20" viewBox="-110 -110 220 220" aria-hidden="true"><polygon points="0,-100 86.6,-50 86.6,50 0,100 -86.6,50 -86.6,-50" fill="none" stroke="currentColor" stroke-width="12" stroke-linejoin="round"/><polygon points="0,-56 48.5,28 -48.5,28" fill="none" stroke="currentColor" stroke-width="10" stroke-linejoin="round"/><path d="M0 -56 L0 -100 M48.5 28 L86.6 50 M-48.5 28 L-86.6 50" stroke="currentColor" stroke-width="10"/></svg>';
  function armButtonHtml(id){
    const on = armed.has(id);
    return `<button type="button" class="gs-btn gs-epic${on ? ' on' : ''}" data-a="epic" data-id="${esc(id)}" aria-pressed="${on}" title="${on ? 'Следующий бросок к20 этого игрока — эпичный («' + esc(SCENES[myCfg.scene].name) + '»). Нажмите, чтобы снять' : 'Сделать следующий бросок к20 этого игрока эпичным — сцена у всех на экране'}">${D20_ICON}</button>`;
  }
  function renderConfig(box){
    const c = myCfg, inGm = role()==='gm';
    const sceneOpts = (sel, withNone)=>(withNone ? '<option value="">обычный бросок</option>' : '') + Object.entries(SCENES).map(([k, v])=>`<option value="${k}"${k===sel ? ' selected' : ''}>${v.name}</option>`).join('');
    const ids = inGm ? Object.keys(session.players || {}) : [];
    box.innerHTML = `<div class="ep-cfg">
      <div class="gs-sub">Эпичный бросок — сцена на весь экран у всех за столом. Светящийся D20 у игрока (здесь или на вкладке «Игроки») делает его следующий бросок к20 эпичным.</div>
      ${inGm ? (ids.length ? `<div class="ep-arm-list">${ids.map(id=>{ const p = session.players[id]; const nm = (p.extra && p.extra.name) || p.name || 'игрок'; return `<span class="ep-arm-item">${armButtonHtml(id)}<span>${esc(nm)}</span></span>`; }).join('')}</div>` : '<div class="gs-muted">Игроки пока не подключились.</div>') : '<div class="gs-muted">Метки D20 появятся, когда вы начнёте сессию «Я — Мастер» и игроки подключатся. Автоправила работают и без сессии.</div>'}
      <h4>Сцена</h4>
      <div class="ep-scenes">${Object.entries(SCENES).map(([k, v])=>`<label class="ep-scene"><input type="radio" name="epScene" value="${k}"${k===c.scene ? ' checked' : ''}><b>${v.name}</b><span>${v.desc}</span></label>`).join('')}</div>
      <h4>Подача</h4>
      <label class="ep-field">Интенсивность <output>${c.intensity}%</output><input type="range" data-ep="intensity" min="10" max="100" step="5" value="${c.intensity}"></label>
      <label class="ep-field">Длительность <output>×${c.tempo.toFixed(1)}</output><input type="range" data-ep="tempo" min="0.6" max="1.6" step="0.1" value="${c.tempo}"></label>
      <div class="gs-row"><label><input type="checkbox" data-ep="shake"${c.shake ? ' checked' : ''}> Тряска экрана</label><label><input type="checkbox" data-ep="dim"${c.dim ? ' checked' : ''}> Затемнять экран</label></div>
      <div class="gs-row"><label>Цвет <select data-ep="accent">${[['auto','Авто по исходу'],['blood','Кровь печати'],['gold','Золото'],['psi','Пси-свечение'],['custom','Свой цвет']].map(([v, t])=>`<option value="${v}"${v===c.accent ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        ${c.accent==='custom' ? `<input type="color" data-ep="custom" value="${esc(c.custom)}" aria-label="Свой цвет">` : ''}</div>
      <label class="ep-field">Надпись <input type="text" data-ep="caption" maxlength="40" value="${esc(c.caption)}" placeholder="Авто: «Критический успех», «Провал»…"></label>
      <h4>Звук</h4>
      <div class="gs-row"><label><input type="checkbox" data-ep="sound"${c.sound ? ' checked' : ''}> Звуковые эффекты</label></div>
      <label class="ep-field">Громкость <output>${c.volume}%</output><input type="range" data-ep="volume" min="0" max="100" step="5" value="${c.volume}"></label>
      <h4>Автоправила <span class="gs-muted">— сцена сама, без метки</span></h4>
      ${RULES.map(r=>`<div class="ep-rule"><span>${r.label}</span><select data-rule="${r.key}">${sceneOpts(c.rules[r.key], true)}</select></div>`).join('')}
      <div class="gs-row"><button type="button" class="gs-btn" data-ep-preview="crit">▶ Посмотреть у себя</button><button type="button" class="gs-btn" data-ep-preview="fumble">▶ Провал у себя</button>
        <button type="button" class="gs-btn small" data-ep-reset title="Пси-разлом, интенсивность 100%, длительность ×1.6, тряска, затемнение и звук; автоправила выключены">По умолчанию</button></div>
    </div>`;
    if(box._epBound) return; box._epBound = true;
    const set = (k, v, rerender)=>{ myCfg = sanitizeCfg(Object.assign({}, myCfg, {[k]:v})); saveCfg(); broadcastSoon(); if(rerender) renderConfig(box); };
    box.addEventListener('input', (e)=>{ const t = e.target, k = t.dataset && t.dataset.ep; if(!k) return;
      if(t.type==='range'){ set(k, +t.value); const o = t.parentElement.querySelector('output'); if(o) o.textContent = k==='tempo' ? '×' + (+t.value).toFixed(1) : t.value + '%'; }
      else if(t.type==='text' || t.type==='color') set(k, t.value); });
    box.addEventListener('change', (e)=>{ const t = e.target;
      if(t.name==='epScene'){ set('scene', t.value); return; }
      if(t.dataset.rule){ const rules = Object.assign({}, myCfg.rules, {[t.dataset.rule]:t.value}); set('rules', rules); return; }
      const k = t.dataset.ep; if(!k) return;
      if(t.type==='checkbox') set(k, t.checked);
      else if(t.tagName==='SELECT') set(k, t.value, k==='accent'); });
    box.addEventListener('click', (e)=>{
      const pv = e.target.closest('[data-ep-preview]'); if(pv){ preview(pv.dataset.epPreview); return; }
      if(e.target.closest('[data-ep-reset]')){ myCfg = sanitizeCfg(DEFAULT); saveCfg(); broadcastSoon(); renderConfig(box); }
      // светящийся D20 (data-a="epic") переключает экран Мастера — общим обработчиком кнопок игроков
    });
  }

  return { handle, onPlayerHello, forOwnRoll, willMapEpic, forMapRoll, isArmed, toggleArm, armButtonHtml, renderConfig, preview, SCENES };
})();
