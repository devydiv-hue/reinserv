/* Аварийная плашка: если при загрузке страницы основной скрипт упал или не разобрался (старый браузер,
   особенности Safari и т.п.), вместо молча неработающего листа наверху появляется текст ошибки и версия
   браузера — их достаточно прислать разработчику. Намеренно старый синтаксис (ES5), чтобы этот блок
   запустился в любом браузере, даже там, где основной скрипт не разбирается. Ловит только ошибки до конца
   загрузки страницы, а не каждое исключение по ходу игры. */
(function(){
  var shown = false, booted = false;
  function show(msg){
    if(shown) return; shown = true;
    function put(){
      var d = document.createElement('div');
      d.setAttribute('style', 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#9c2f1c;color:#fff;' +
        'font:14px/1.45 Arial,sans-serif;padding:10px 14px;box-shadow:0 4px 12px rgba(0,0,0,.5);word-break:break-word;');
      d.textContent = 'Страница не смогла полностью запуститься в этом браузере. Пришлите этот текст тому, кто ' +
        'поддерживает лист: ' + msg + ' — ' + navigator.userAgent;
      document.body.appendChild(d);
    }
    if(document.body) put(); else document.addEventListener('DOMContentLoaded', put);
  }
  window.addEventListener('error', function(e){
    if(booted) return;
    show((e && e.message ? e.message : 'неизвестная ошибка') + (e && e.lineno ? ' (строка ' + e.lineno + ')' : ''));
  });
  window.addEventListener('load', function(){ setTimeout(function(){ booted = true; }, 0); });
})();
