/* ======================================================================
   BlobDock — капля у края экрана и её выезжающая панель (кубы, экран Мастера): общий механизм.
   Каплю тянут по всему экрану (включается значком ✥ в панели), при отпускании она «перетекает» к ближайшему краю
   (левому, правому, верхнему или нижнему) и поворачивается к нему выпуклой стороной; значок внутри остаётся ровным.
   Панель выезжает от того же края и целиком помещается в окно. Позиция — край + доля длины этого края (переживает
   смену размера окна). Движение — недодемпфированная пружина в 2D: капля следует за курсором с инерцией,
   вытягивается вдоль движения, у края мягко покачивается. Открытая панель на время перетаскивания гаснет.
   «Ползание»: если снять булавку (значок в любой из панелей — настройка общая для всех капель), капли медленно
   ползут по краям экрана по часовой стрелке, огибая углы; замирают, пока панель открыта, каплю тянут, курсор рядом
   или идёт обучение. По умолчанию булавка стоит — капли на месте (кубы слева, экран Мастера справа).
   ====================================================================== */
const BlobDock = (function(){
  const EDGES = ['left', 'right', 'top', 'bottom'];
  const EDGE_ROT = { left:0, right:180, top:90, bottom:-90 }; // поворот капли: выпуклой стороной к краю
  const DOCK_MARGIN = 44, FAB_HALF = 29; // отступ от углов вдоль края; полуширина капли (центр от края)
  const CRAWL_SPEED = 11;                // пикс./с — «медленно ползут»
  const CRAWL_KEEP_AWAY = 170;           // курсор ближе — капля замирает (дальше её откроет приближение)
  const PIN_KEY = 'reincarnator_blob_pin_v1';
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const VW = ()=>document.documentElement.clientWidth || window.innerWidth; // без полосы прокрутки — капля у правого края её не закрывает
  const viewportKnown = ()=>window.innerHeight > DOCK_MARGIN*3 && VW() > DOCK_MARGIN*3; // скрытая вкладка — размер 0
  const isVertical = (edge)=>edge==='left' || edge==='right';
  let pinned = true; try{ const v = localStorage.getItem(PIN_KEY); if(v!==null) pinned = v!=='0'; }catch(e){}
  const docks = [];
  let ptrX = -1e5, ptrY = -1e5;
  window.addEventListener('pointermove', (e)=>{ ptrX = e.clientX; ptrY = e.clientY; }, {passive:true});

  // Периметр по часовой стрелке: верх (слева направо) → право (сверху вниз) → низ (справа налево) → лево (снизу вверх)
  function perimeterLen(){ const W = VW(), H = window.innerHeight; return 2*(W - 2*DOCK_MARGIN) + 2*(H - 2*DOCK_MARGIN); }
  function toPerimeter(edge, pos){
    const W = VW(), H = window.innerHeight, M = DOCK_MARGIN, a = W - 2*M, b = H - 2*M;
    const along = Math.min((isVertical(edge) ? H : W) - M, Math.max(M, pos*(isVertical(edge) ? H : W)));
    if(edge==='top') return along - M;
    if(edge==='right') return a + (along - M);
    if(edge==='bottom') return a + b + (W - M - along);
    return 2*a + b + (H - M - along);
  }
  function fromPerimeter(t){
    const W = VW(), H = window.innerHeight, M = DOCK_MARGIN, a = W - 2*M, b = H - 2*M, P = 2*a + 2*b;
    t = ((t % P) + P) % P;
    if(t < a) return {edge:'top', pos:(M + t)/W};
    if(t < a + b) return {edge:'right', pos:(M + t - a)/H};
    if(t < 2*a + b) return {edge:'bottom', pos:(W - M - (t - a - b))/W};
    return {edge:'left', pos:(H - M - (t - 2*a - b))/H};
  }

  // o: {key, fab, panel, edge, pos, unrotVar, isOpen(), onDragStart(), moveBtn, moveTitle(on), pinBtn, dragExclude}
  function create(o){
    const dock = (function(){
      try{
        const v = JSON.parse(localStorage.getItem(o.key) || 'null');
        if(v && typeof v==='object'){
          const pos = Number(v.pos!=null ? v.pos : v.y); // y — формат самой первой версии (только левый край)
          return { edge:EDGES.indexOf(v.edge)>=0 ? v.edge : o.edge, pos:Math.min(0.97, Math.max(0.03, isFinite(pos) ? pos : o.pos)), movable:v.movable===true };
        }
      }catch(e){}
      return { edge:o.edge, pos:o.pos, movable:false };
    })();
    const save = ()=>{ try{ localStorage.setItem(o.key, JSON.stringify(dock)); }catch(e){} };
    let dragging = false, suppressClick = false, panelWasOpen = false, pendingPanelShow = false, saveTimer = 0;
    let fx = 0, fy = 0, vx = 0, vy = 0, tx = 0, ty = 0, rot = EDGE_ROT[dock.edge], trot = rot, raf = 0;
    function anchorFor(edge, pos){ // центр капли у края
      const vw = VW(), vh = window.innerHeight, len = isVertical(edge) ? vh : vw;
      const along = Math.min(len - DOCK_MARGIN, Math.max(DOCK_MARGIN, pos*len));
      if(edge==='left') return {x:FAB_HALF, y:along};
      if(edge==='right') return {x:vw - FAB_HALF, y:along};
      if(edge==='top') return {x:along, y:FAB_HALF};
      return {x:along, y:vh - FAB_HALF};
    }
    function nearestEdge(x, y){
      const d = { left:x, right:VW() - x, top:y, bottom:window.innerHeight - y };
      return EDGES.reduce((a, b)=>d[b] < d[a] ? b : a, 'left');
    }
    function renderFab(stretch, angle){
      const f = o.fab;
      if(!viewportKnown()){ // размер окна ещё неизвестен — та же позиция в процентах
        const p = (dock.pos*100).toFixed(2) + '%', r = EDGE_ROT[dock.edge];
        f.style.left = dock.edge==='right' ? `calc(100% - ${FAB_HALF}px)` : dock.edge==='left' ? FAB_HALF + 'px' : p;
        f.style.top = dock.edge==='bottom' ? `calc(100% - ${FAB_HALF}px)` : dock.edge==='top' ? FAB_HALF + 'px' : p;
        f.style.transform = `translate(-50%,-50%) rotate(${r}deg)`;
        f.style.setProperty(o.unrotVar, (-r) + 'deg');
        return;
      }
      f.style.left = fx.toFixed(1) + 'px'; f.style.top = fy.toFixed(1) + 'px';
      const s = stretch || 0;
      f.style.transform = s > 0.004 // вытягивание вдоль движения (в экранных осях), поверх поворота к краю
        ? `translate(-50%,-50%) rotate(${angle.toFixed(1)}deg) scale(${(1+s).toFixed(3)},${(1-s*0.45).toFixed(3)}) rotate(${(-angle).toFixed(1)}deg) rotate(${rot.toFixed(2)}deg)`
        : `translate(-50%,-50%) rotate(${rot.toFixed(2)}deg)`;
      f.style.setProperty(o.unrotVar, (-rot).toFixed(2) + 'deg');
    }
    // Панель — у края капли, по центру на её уровне, но целиком в пределах окна
    function place(){
      const p = o.panel;
      EDGES.forEach(e=>p.classList.toggle('edge-' + e, dock.edge===e));
      if(!viewportKnown()){ p.classList.remove('placed'); p.style.left = ''; p.style.top = ''; return; }
      const a = anchorFor(dock.edge, dock.pos), w = p.offsetWidth, h = p.offsetHeight, vw = VW(), vh = window.innerHeight;
      let left, top;
      if(isVertical(dock.edge)){ left = dock.edge==='left' ? 0 : vw - w; top = Math.min(vh - h - 8, Math.max(8, a.y - h/2)); }
      else { top = dock.edge==='top' ? 0 : vh - h; left = Math.min(vw - w - 8, Math.max(8, a.x - w/2)); }
      p.style.left = Math.round(left) + 'px'; p.style.top = Math.round(top) + 'px';
      p.classList.add('placed');
    }
    function wiggle(){
      if(reduceMotion) return;
      const p = o.panel; p.classList.remove('dock-wiggle'); void p.offsetWidth; p.classList.add('dock-wiggle');
      setTimeout(()=>p.classList.remove('dock-wiggle'), 750);
    }
    function showPanelAgain(){
      pendingPanelShow = false;
      o.fab.classList.remove('dock-show');
      place();
      o.panel.classList.remove('dock-hidden');
      if(panelWasOpen && o.isOpen()) wiggle();
      panelWasOpen = false;
    }
    function step(){
      vx = vx*0.70 + (tx - fx)*0.15; vy = vy*0.70 + (ty - fy)*0.15;
      fx += vx; fy += vy;
      const dr = ((trot - rot) % 360 + 540) % 360 - 180; // кратчайший поворот к краю
      rot += dr*0.2;
      const speed = Math.hypot(vx, vy);
      renderFab(reduceMotion ? 0 : Math.min(0.32, speed/40), Math.atan2(vy, vx)*180/Math.PI);
      if(dragging || speed > 0.05 || Math.hypot(tx - fx, ty - fy) > 0.3 || Math.abs(dr) > 0.3){ raf = requestAnimationFrame(step); return; }
      raf = 0; fx = tx; fy = ty; rot = trot; renderFab(0, 0);
      if(pendingPanelShow) showPanelAgain();
    }
    function kick(){
      if(reduceMotion){ fx = tx; fy = ty; rot = trot; vx = vy = 0; renderFab(0, 0); if(pendingPanelShow && !dragging) showPanelAgain(); return; }
      if(!raf) raf = requestAnimationFrame(step);
    }
    function startDrag(e, handle){
      if(!dock.movable || e.button>0 || !viewportKnown()) return;
      e.preventDefault(); // не начинать выделение текста страницы при протягивании
      if(!raf){ const a = anchorFor(dock.edge, dock.pos); fx = tx = a.x; fy = ty = a.y; vx = vy = 0; rot = trot = EDGE_ROT[dock.edge]; }
      const sx = e.clientX, sy = e.clientY, fromFab = handle===o.fab;
      const gx = fromFab ? fx - sx : 0, gy = fromFab ? fy - sy : 0; // за панель — капля «перетекает» под курсор
      let moved = false;
      const onMove = (ev)=>{
        if(!moved){
          if(Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return; // маленький сдвиг — это ещё клик
          moved = true; dragging = true; if(o.onDragStart) o.onDragStart();
          document.body.classList.add('dice-dock-dragging');
          panelWasOpen = o.isOpen();
          if(panelWasOpen) o.panel.classList.add('dock-hidden');
          o.fab.classList.add('dock-show');
        }
        ev.preventDefault();
        tx = Math.min(VW() - FAB_HALF, Math.max(FAB_HALF, ev.clientX + gx));
        ty = Math.min(window.innerHeight - FAB_HALF, Math.max(FAB_HALF, ev.clientY + gy));
        kick();
      };
      const onUp = ()=>{
        window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp);
        document.body.classList.remove('dice-dock-dragging');
        if(!moved) return;
        dragging = false;
        if(fromFab) suppressClick = true; // отпускание капли после перетаскивания — не открывать панель
        const edge = nearestEdge(tx, ty);
        dock.edge = edge; dock.pos = isVertical(edge) ? ty / window.innerHeight : tx / VW(); save();
        const a = anchorFor(dock.edge, dock.pos); tx = a.x; ty = a.y; trot = EDGE_ROT[edge];
        pendingPanelShow = true;
        kick(); // пружина доводит каплю к краю и покачивает, затем у этого края снова появляется панель
      };
      window.addEventListener('pointermove', onMove, {passive:false});
      window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
    }
    function setMovable(on){
      dock.movable = !!on; save();
      const btn = o.moveBtn;
      if(btn){ btn.classList.toggle('active', dock.movable); btn.setAttribute('aria-pressed', dock.movable ? 'true' : 'false'); btn.title = o.moveTitle(dock.movable); }
      o.panel.classList.toggle('movable', dock.movable);
      o.fab.style.touchAction = dock.movable ? 'none' : '';
      if(dock.movable) wiggle();
    }
    // Шаг «ползания»: сдвиг вдоль периметра на dt секунд (вызывает общий таймер ниже)
    function crawl(dt){
      if(dragging || o.isOpen() || !viewportKnown()) return;
      const cs = getComputedStyle(o.fab); if(cs.display==='none' || cs.visibility==='hidden') return; // капля скрыта (у игрока нет экрана Мастера)
      if(Math.hypot(ptrX - fx, ptrY - fy) < CRAWL_KEEP_AWAY) return;
      const n = fromPerimeter(toPerimeter(dock.edge, dock.pos) + CRAWL_SPEED*dt);
      dock.edge = n.edge; dock.pos = n.pos;
      const a = anchorFor(dock.edge, dock.pos); tx = a.x; ty = a.y; trot = EDGE_ROT[dock.edge];
      if(!raf){ fx = tx; fy = ty; if(Math.abs(((trot - rot) % 360 + 540) % 360 - 180) > 0.3) kick(); else renderFab(0, 0); }
      if(!saveTimer) saveTimer = setTimeout(()=>{ saveTimer = 0; save(); }, 3000); // не чаще раза в 3 с
    }
    function paintPin(){
      const b = o.pinBtn; if(!b) return;
      b.classList.toggle('active', pinned); b.setAttribute('aria-pressed', pinned ? 'true' : 'false');
      b.title = pinned ? 'Капли закреплены. Снять булавку — капли кубов и экрана Мастера медленно поползут по краям экрана'
                       : 'Капли медленно ползут по краям экрана — нажмите, чтобы закрепить их на месте';
    }
    // запуск
    const a0 = anchorFor(dock.edge, dock.pos); fx = tx = a0.x; fy = ty = a0.y; rot = trot = EDGE_ROT[dock.edge];
    renderFab(0, 0); place(); setMovable(dock.movable);
    if(o.moveBtn) o.moveBtn.addEventListener('click', ()=>setMovable(!dock.movable));
    if(o.pinBtn) o.pinBtn.addEventListener('click', ()=>setPinned(!pinned));
    o.panel.addEventListener('pointerdown', (e)=>{ if(e.target.closest(o.dragExclude || 'button')) return; startDrag(e, o.panel); });
    o.fab.addEventListener('pointerdown', (e)=>startDrag(e, o.fab));
    window.addEventListener('resize', ()=>{
      if(dragging) return;
      const b = anchorFor(dock.edge, dock.pos); fx = tx = b.x; fy = ty = b.y; vx = vy = 0; rot = trot = EDGE_ROT[dock.edge];
      renderFab(0, 0); place();
    });
    const api = {
      place, crawl, paintPin,
      get dragging(){ return dragging; },
      consumeClick(){ if(suppressClick){ suppressClick = false; return true; } return false; }
    };
    docks.push(api); paintPin(); syncCrawl();
    return api;
  }

  // Общий таймер «ползания»: работает, только пока булавка снята и вкладка браузера видна
  let crawlRaf = 0, lastT = 0;
  function crawlTick(t){
    if(pinned){ crawlRaf = 0; return; }
    const dt = lastT ? Math.min(0.1, (t - lastT)/1000) : 0; lastT = t;
    const busy = document.hidden || (typeof Onboarding!=='undefined' && Onboarding.busy()) || document.body.classList.contains('dice-dock-dragging');
    if(dt && !busy) docks.forEach(d=>d.crawl(dt));
    crawlRaf = requestAnimationFrame(crawlTick);
  }
  function syncCrawl(){ if(!pinned && !crawlRaf){ lastT = 0; crawlRaf = requestAnimationFrame(crawlTick); } }
  function setPinned(v){
    pinned = !!v; try{ localStorage.setItem(PIN_KEY, pinned ? '1' : '0'); }catch(e){}
    docks.forEach(d=>d.paintPin()); syncCrawl();
    if(typeof uiToast==='function') uiToast(pinned ? 'Капли закреплены на месте' : 'Капли медленно ползут по краям экрана — булавка закрепит их', {icon:'📌'});
  }
  return { create, setPinned, get pinned(){ return pinned; } };
})();
