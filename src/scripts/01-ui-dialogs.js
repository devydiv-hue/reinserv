/* ======================================================================
   СВОИ ОКНА вместо системных alert/confirm/prompt — в стиле боковой панели бросков кубов: тёмный глянец,
   металлический отблеск, плавный выезд. Все функции возвращают Promise (системные окна блокировали страницу,
   эти — нет), поэтому вызывающий код ждёт ответа через await / then.
     uiAlert(text, opts)              → Promise<void>
     uiConfirm(text, opts)            → Promise<boolean>     opts: title, ok, cancel, danger, icon
     uiPrompt(text, value, opts)      → Promise<string|null> opts: title, ok, multiline, type, placeholder
     uiForm(title, fields, opts)      → Promise<{name:value}|null>  fields: [{name, label, value, multiline, type, placeholder}]
     uiToast(text, opts)              — короткое уведомление снизу, само исчезает (opts: icon, ms)
   Enter — подтвердить (в многострочном поле — Ctrl+Enter), Esc или клик мимо окна — отмена.
   ====================================================================== */
(function(){
  let depth = 0;
  const esc = (s)=>String(s==null ? '' : s).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function uiDialog(o){
    return new Promise((resolve)=>{
      const back = document.createElement('div'); back.className = 'ui-dlg-back';
      back.style.zIndex = String(10050 + (depth++)*2);
      const fields = o.fields || [];
      const icon = o.icon || (o.danger ? '!' : fields.length ? '✎' : o.buttons && o.buttons.length>1 ? '?' : 'i');
      back.innerHTML = `<div class="ui-dlg${o.danger ? ' danger' : ''}" role="dialog" aria-modal="true">
        <div class="ui-dlg-head"><span class="ui-dlg-hex${o.danger ? ' red' : ''}">${esc(icon)}</span><div class="ui-dlg-title">${esc(o.title || 'Реинкарнатор')}</div></div>
        ${o.text ? `<div class="ui-dlg-text">${esc(o.text)}</div>` : ''}${o.html || ''}
        ${fields.map((f, i)=>f.type==='checkbox' ? `<label class="ui-dlg-check"><input type="checkbox" name="${esc(f.name || 'f' + i)}" ${f.value ? 'checked' : ''}><span>${esc(f.label || '')}</span></label>` : `<label class="ui-dlg-field"><span>${esc(f.label || '')}</span>${f.multiline
          ? `<textarea name="${esc(f.name || 'f' + i)}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(f.value)}</textarea>`
          : `<input name="${esc(f.name || 'f' + i)}" type="${esc(f.type || 'text')}" value="${esc(f.value)}" placeholder="${esc(f.placeholder || '')}" autocomplete="off">`}</label>`).join('')}
        <div class="ui-dlg-btns">${(o.buttons || [{label:'Понятно', value:true, primary:true}]).map((b, i)=>
          `<button type="button" class="ui-dlg-btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>
        <div class="ui-dlg-sheen"></div></div>`;
      const prevFocus = document.activeElement;
      document.body.appendChild(back);
      requestAnimationFrame(()=>back.classList.add('show'));
      const btns = o.buttons || [{label:'Понятно', value:true, primary:true}];
      let done = false;
      const values = ()=>{ const r = {}; back.querySelectorAll('input, textarea').forEach(el=>{ r[el.name] = el.type==='checkbox' ? el.checked : el.value; }); return r; };
      const finish = (v)=>{
        if(done) return; done = true; depth = Math.max(0, depth - 1);
        back.classList.remove('show'); back.classList.add('hide');
        document.removeEventListener('keydown', onKey, true);
        setTimeout(()=>back.remove(), 260);
        try{ if(prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({preventScroll:true}); }catch(e){}
        resolve(v);
      };
      const pick = (i)=>{ const b = btns[i]; finish(typeof b.value==='function' ? b.value(values()) : b.value); };
      const primaryIdx = Math.max(0, btns.findIndex(b=>b.primary));
      function onKey(e){
        if(!back.isConnected || back.style.zIndex!==String(10050 + (depth - 1)*2)) return; // клавиши — только верхнему окну
        if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); finish(o.cancelValue); }
        else if(e.key==='Enter' && (e.target.tagName!=='TEXTAREA' || e.ctrlKey || e.metaKey)){
          if(e.target.tagName==='BUTTON' && back.contains(e.target)) return; // Enter на кнопке — её собственный клик
          e.preventDefault(); e.stopPropagation(); pick(primaryIdx); }
      }
      document.addEventListener('keydown', onKey, true);
      back.addEventListener('pointerdown', (e)=>{ if(e.target===back) back._downOnBack = true; });
      back.addEventListener('click', (e)=>{
        const b = e.target.closest('.ui-dlg-btn'); if(b){ pick(+b.dataset.i); return; }
        if(e.target===back && back._downOnBack) finish(o.cancelValue);
        back._downOnBack = false;
      });
      setTimeout(()=>{ const f = back.querySelector('input:not([type=checkbox]), textarea') || back.querySelectorAll('.ui-dlg-btn')[primaryIdx];
        if(f){ f.focus({preventScroll:true}); if(f.select && f.tagName==='INPUT') f.select(); } }, 30);
    });
  }
  window.uiDialog = uiDialog;
  window.uiAlert = (text, o)=>uiDialog(Object.assign({text, title:'Внимание', cancelValue:undefined, buttons:[{label:'Понятно', value:undefined, primary:true}]}, o || {})).then(()=>{});
  window.uiConfirm = (text, o)=>{ o = o || {};
    return uiDialog(Object.assign({text, title:'Подтвердите', cancelValue:false,
      buttons:[{label:o.cancel || 'Отмена', value:false}, {label:o.ok || 'Да', value:true, primary:true, danger:!!o.danger}]}, o)); };
  window.uiPrompt = (text, value, o)=>{ o = o || {};
    return uiDialog(Object.assign({title:o.title || 'Введите', text:o.title ? text : '', fields:[{name:'v', label:o.title ? '' : text, value:value==null ? '' : value, multiline:o.multiline, type:o.type, placeholder:o.placeholder}],
      cancelValue:null, buttons:[{label:o.cancel || 'Отмена', value:null}, {label:o.ok || 'Готово', value:(v)=>v.v, primary:true}]}, o, {title:o.title || 'Введите'})); };
  window.uiForm = (title, fields, o)=>{ o = o || {};
    return uiDialog(Object.assign({title, fields, cancelValue:null, buttons:[{label:o.cancel || 'Отмена', value:null}, {label:o.ok || 'Готово', value:(v)=>v, primary:true}]}, o)); };
  let toastEl = null, toastTimer = 0;
  window.uiToast = (text, o)=>{ o = o || {};
    if(!toastEl){ toastEl = document.createElement('div'); toastEl.className = 'ui-toast'; document.body.appendChild(toastEl); }
    toastEl.innerHTML = `${o.icon ? `<span class="ui-dlg-hex small${o.red ? ' red' : ''}">${esc(o.icon)}</span>` : ''}<span>${esc(text)}</span><span class="ui-dlg-sheen"></span>`;
    toastEl.classList.remove('show'); void toastEl.offsetWidth; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(()=>toastEl.classList.remove('show'), o.ms || 3200);
  };
})();
