/* ======================================================================
   МЕДИА В ЗАМЕТКАХ МАСТЕРА: картинки, гифки, короткие ролики.
   - Хранятся в этом браузере (IndexedDB reincarnator_note_media_v1) — готовиться к встрече можно без сервера.
     В тексте заметки — строка «![подпись](media:ID)»; в просмотре на её месте картинка или ролик с кнопкой «📜».
   - Добавить: «🖼 Медиа» в правке заметки, вставка из буфера (Ctrl+V) или перетаскивание файла в текст заметки.
     Статичные картинки больше 1920 px или 2 МБ ужимаются в WebP; гифки и ролики — как есть (до 20 МБ).
     Ролики .mov с iPhone браузеры не показывают — нужен MP4.
   - Игрокам: файл загружается на сервер игры при отправке (POST /media-upload, только подтверждённый Мастер),
     игроки получают ссылку /user-media/…; ролики у игрока запускаются сами — со звуком, если браузер разрешит,
     иначе без звука и с кнопкой «🔊».
   ====================================================================== */
const NoteMedia = (function(){
  const DB = 'reincarnator_note_media_v1', ST = 'media', MB = 1024*1024;
  const REF_RE = /^\s*!\[([^\]]*)\]\(media:([a-z0-9]{8,40})\)\s*$/;
  const esc = (s)=>escapeHtml(s==null ? '' : String(s));
  const objUrls = new Map();
  async function get(id){
    const d = await rdbOpen(DB, ST, 'id');
    const r = await new Promise((res, rej)=>{ const q = d.transaction(ST, 'readonly').objectStore(ST).get(id); q.onsuccess = ()=>res(q.result || null); q.onerror = ()=>rej(q.error); });
    d.close(); return r;
  }
  async function put(rec){ const d = await rdbOpen(DB, ST, 'id'); await rdbPut(d, ST, [rec]); d.close(); }
  async function srcOf(id){ if(objUrls.has(id)) return objUrls.get(id); const r = await get(id); if(!r || !r.blob) return null; const s = {u:URL.createObjectURL(r.blob), type:r.type}; objUrls.set(id, s); return s; }
  const newId = ()=>(Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).replace(/[^a-z0-9]/g, '').slice(0, 20);
  async function prepare(file){
    const t = file.type;
    if(t==='video/quicktime') throw new Error('ролик .mov (iPhone) браузеры не показывают — сохраните его как MP4');
    if(/^video\/(mp4|webm)$/.test(t) || t==='image/gif'){ if(file.size > 20*MB) throw new Error('файл больше 20 МБ'); return file; }
    if(!/^image\/(png|jpeg|webp)$/.test(t)) throw new Error('подойдут картинки PNG, JPEG, WebP, GIF и ролики MP4/WebM');
    const bmp = await createImageBitmap(file), k = Math.min(1, 1920/Math.max(bmp.width, bmp.height));
    if(k===1 && file.size <= 2*MB){ bmp.close && bmp.close(); return file; }
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width*k); cv.height = Math.round(bmp.height*k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close && bmp.close();
    let b = await new Promise(res=>cv.toBlob(res, 'image/webp', 0.85));
    if(!b || b.type!=='image/webp') b = await new Promise(res=>cv.toBlob(res, 'image/jpeg', 0.85));
    return b;
  }
  async function addFile(file){
    const blob = await prepare(file), id = newId();
    await put({id, name:String(file.name || 'медиа').replace(/\.[^.]+$/, '').slice(0, 60), type:blob.type || file.type, blob, size:blob.size, added:Date.now(), url:'', origin:''});
    return {id, ref:`![${String(file.name || 'медиа').replace(/\.[^.]+$/, '').replace(/[\[\]]/g, '').slice(0, 60)}](media:${id})`};
  }
  function pickFiles(){
    return new Promise(res=>{ const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true;
      inp.accept = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm'; inp.onchange = ()=>res([...(inp.files || [])]); inp.click(); });
  }
  // файлы → строки-ссылки для заметки (ошибки — по каждому файлу)
  async function addFiles(files){
    const refs = [], bad = [];
    for(const f of files){ try{ refs.push((await addFile(f)).ref); }catch(e){ bad.push(`${f.name}: ${e.message}`); } }
    if(bad.length) uiAlert('Не добавлено:\n' + bad.join('\n'), {title:'Медиа', icon:'🖼'});
    return refs;
  }
  // разметка: строка-ссылка → место под медиа (заполняется hydrate после вставки в страницу)
  function lineHtml(line){
    const m = line.match(REF_RE); if(!m) return null;
    return `<figure class="nm" data-mid="${m[2]}"><div class="nm-slot"><span class="gs-muted">загрузка…</span></div>${m[1] ? `<figcaption>${esc(m[1])}</figcaption>` : ''}<button type="button" class="gs-btn small nm-send" data-nm-send="${m[2]}" title="Показать игрокам только это">📜</button></figure>`;
  }
  async function hydrate(root){
    if(!root) return;
    for(const f of root.querySelectorAll('figure.nm[data-mid]')){
      const slot = f.querySelector('.nm-slot'); if(!slot || slot.dataset.done) continue; slot.dataset.done = '1';
      let s = null; try{ s = await srcOf(f.dataset.mid); }catch(e){}
      if(!s){ slot.innerHTML = '<span class="gs-muted">⚠ файла нет в этом браузере (заметка перенесена без медиа?)</span>'; continue; }
      slot.innerHTML = s.type.indexOf('video/')===0 ? `<video src="${s.u}" controls muted playsinline preload="metadata"></video>` : `<img src="${s.u}" alt="">`;
    }
  }
  const idsIn = (text)=>String(text || '').split('\n').map(l=>{ const m = l.match(REF_RE); return m ? m[2] : null; }).filter(Boolean);
  const captionOf = (text, id)=>{ for(const l of String(text || '').split('\n')){ const m = l.match(REF_RE); if(m && m[2]===id) return m[1]; } return ''; };
  const stripRefs = (text)=>String(text || '').split('\n').filter(l=>!REF_RE.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // на сервер — при отправке игрокам; уже загруженное на этот же сервер повторно не грузится
  async function upload(id){
    const r = await get(id); if(!r) throw new Error('файла нет в этом браузере');
    if(r.url && r.origin===location.origin){ try{ const h = await fetch(r.url, {method:'HEAD'}); if(h.ok) return {url:r.url, type:r.type}; }catch(e){} }
    if(typeof session==='undefined' || session.role!=='gm' || !session.ws || session.ws.readyState!==WebSocket.OPEN) throw new Error('нужен открытый стол («Я — Мастер»)');
    const resp = await fetch('/media-upload', {method:'POST', headers:{'Content-Type':r.type, 'X-Client-Id':session.myId, 'X-Media-Id':id}, body:r.blob});
    let j = {}; try{ j = await resp.json(); }catch(e){}
    if(!resp.ok || !j.url) throw new Error(j.error || ('ошибка ' + resp.status));
    r.url = j.url; r.origin = location.origin; await put(r);
    return {url:j.url, type:r.type};
  }
  // перенос подготовки файлом: медиа из заметок и сцен — внутрь файла (base64)
  async function exportFor(texts){
    const ids = [...new Set(texts.flatMap(idsIn))], out = [];
    for(const id of ids){ const r = await get(id).catch(()=>null); if(!r || !r.blob) continue;
      const b64 = await new Promise((res, rej)=>{ const fr = new FileReader(); fr.onload = ()=>res(String(fr.result).split(',')[1] || ''); fr.onerror = ()=>rej(fr.error); fr.readAsDataURL(r.blob); });
      out.push({id, name:r.name, type:r.type, b64}); }
    return out;
  }
  async function importList(list){
    let n = 0;
    for(const x of (Array.isArray(list) ? list : [])){
      if(!x || !/^[a-z0-9]{8,40}$/.test(x.id || '') || typeof x.b64!=='string' || !/^(image|video)\//.test(x.type || '')) continue;
      const bin = atob(x.b64), arr = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
      await put({id:x.id, name:String(x.name || 'медиа').slice(0, 60), type:x.type, blob:new Blob([arr], {type:x.type}), size:arr.length, added:Date.now(), url:'', origin:''}); n++;
    }
    return n;
  }
  /* ---------- у игрока: показ медиа раздатки ---------- */
  const MEDIA_URL_RE = /^\/user-media\/[a-z0-9]{8,40}\.(gif|webp|png|jpg|mp4|webm)$/;
  function sanitize(list){
    return (Array.isArray(list) ? list : []).slice(0, 12).filter(x=>x && MEDIA_URL_RE.test(x.url || ''))
      .map(x=>({url:x.url, kind:/\.(mp4|webm)$/.test(x.url) ? 'video' : 'img', cap:String(x.cap || '').slice(0, 120)}));
  }
  function showHtml(list){
    return (list || []).map(x=>`<figure class="nm nm-show">${x.kind==='video' ? `<video src="${esc(x.url)}" controls playsinline preload="auto" data-autoplay></video><button type="button" class="nm-unmute" style="display:none">🔊 Включить звук</button>` : `<a href="${esc(x.url)}" target="_blank" rel="noopener"><img src="${esc(x.url)}" alt=""></a>`}${x.cap ? `<figcaption>${esc(x.cap)}</figcaption>` : ''}</figure>`).join('');
  }
  // ролики — сами: сначала со звуком; браузер не разрешил — без звука и с кнопкой «🔊»
  function autoplay(root){
    (root || document).querySelectorAll('video[data-autoplay]').forEach(v=>{
      v.removeAttribute('data-autoplay');
      const btn = v.parentNode.querySelector('.nm-unmute');
      v.muted = false;
      v.play().catch(()=>{ v.muted = true; v.play().catch(()=>{}); if(btn){ btn.style.display = ''; btn.onclick = ()=>{ v.muted = false; v.play().catch(()=>{}); btn.style.display = 'none'; }; } });
    });
  }
  return { REF_RE, addFiles, pickFiles, lineHtml, hydrate, idsIn, captionOf, stripRefs, upload, exportFor, importList, sanitize, showHtml, autoplay };
})();
