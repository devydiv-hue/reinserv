// Реинкарнатор — сервис-воркер (PWA): приложение открывается и без сети.
// Страница — «сначала сеть»: при связи всегда свежая версия (и она же кладётся в кэш), без связи — последняя
// сохранённая. Иконки и шрифты — из кэша. Звуки (/user-sounds, /assets/sounds) не кэшируются — они большие;
// карты и картинки своих объектов (/user-maps, /user-assets) — «сначала сеть», копия на случай обрыва.
// WebSocket, загрузки (POST) и /healthz сервис-воркер не трогает.
'use strict';
const VERSION = 'reinc-v1';
const SHELL = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)).catch(()=>{}).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', (e)=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

function networkFirst(req, cacheKey){
  return fetch(req).then(res=>{
    if(res && res.ok){ const copy = res.clone(); caches.open(VERSION).then(c=>c.put(cacheKey || req, copy)).catch(()=>{}); }
    return res;
  }).catch(()=>caches.match(cacheKey || req).then(hit=>hit || caches.match('./')));
}
function cacheFirst(req){
  return caches.match(req).then(hit=>hit || fetch(req).then(res=>{
    if(res && (res.ok || res.type==='opaque')){ const copy = res.clone(); caches.open(VERSION).then(c=>c.put(req, copy)).catch(()=>{}); }
    return res;
  }));
}

self.addEventListener('fetch', (e)=>{
  const req = e.request;
  if(req.method!=='GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if(url.origin===self.location.origin){
    const p = url.pathname;
    if(p==='/healthz' || p.startsWith('/user-sounds/') || p.startsWith('/assets/sounds/')) return;
    if(req.mode==='navigate' || p==='/' || p.endsWith('.html')){ e.respondWith(networkFirst(req, './')); return; }
    if(p.startsWith('/icons/') || p==='/manifest.webmanifest'){ e.respondWith(cacheFirst(req)); return; }
    if(p.startsWith('/user-maps/') || p.startsWith('/user-assets/')){ e.respondWith(networkFirst(req)); return; }
    return;
  }
  if(url.hostname==='fonts.googleapis.com' || url.hostname==='fonts.gstatic.com'){ e.respondWith(cacheFirst(req)); }
});
