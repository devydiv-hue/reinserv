/* ======================================================================
   PWA — регистрация сервис-воркера (pwa/sw.js: страница открывается и без сети) и установка как приложения:
   пункт «📲 Установить как приложение» в меню «ЧЗХ❓❓❓». Chrome/Edge/Android — системное окно установки;
   iPhone/iPad — подсказка «Поделиться → На экран „Домой“». Только при открытии по http(s), не файлом.
   ====================================================================== */
const Pwa = (function(){
  let deferred = null;
  const standalone = ()=>(window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone===true;
  const ios = ()=>/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints > 1);
  if('serviceWorker' in navigator && /^https?:$/.test(location.protocol)){
    window.addEventListener('load', ()=>{ navigator.serviceWorker.register('sw.js').catch(e=>console.warn('[PWA] сервис-воркер не зарегистрирован', e)); });
  }
  window.addEventListener('beforeinstallprompt', (e)=>{ e.preventDefault(); deferred = e; });
  window.addEventListener('appinstalled', ()=>{ deferred = null; if(typeof uiToast==='function') uiToast('Реинкарнатор установлен как приложение', {icon:'📲'}); });
  function install(){
    if(standalone()){ uiAlert('Вы уже в установленном приложении.', {title:'Приложение', icon:'📲'}); return; }
    if(deferred){ deferred.prompt(); deferred.userChoice.finally(()=>{ deferred = null; }); return; }
    if(ios()){ uiAlert('Safari: кнопка «Поделиться» (квадрат со стрелкой) → «На экран „Домой“». Приложение откроется во весь экран и будет работать без сети.', {title:'Установить на iPhone / iPad', icon:'📲'}); return; }
    if(!/^https?:$/.test(location.protocol)){ uiAlert('Установка работает, когда лист открыт по ссылке сервера (http://localhost:3000 или ссылка ngrok), а не файлом.', {title:'Приложение', icon:'📲'}); return; }
    uiAlert('Браузер пока не предложил установку. В Chrome / Edge — значок «Установить» в адресной строке или меню ⋮ → «Установить приложение». Ссылка должна быть https (ngrok) или localhost.', {title:'Установить как приложение', icon:'📲'});
  }
  return { install, get installed(){ return standalone(); } };
})();
