const CACHE='fitjourney-v4';
const ASSETS=['./','./index.html','./app.js','./cloud.js','./notifications.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
  event.respondWith(fetch(req).then(response=>{
    if(response.ok){const clone=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(req,clone)));}
    return response;
  }).catch(()=>caches.match(req)));
});

self.addEventListener('push', event => { let data = {}; try { data = event.data.json(); } catch {} event.waitUntil(self.registration.showNotification(data.title || 'Fit Journey', {body: data.body || 'Time for your walk', tag: data.tag || 'daily-walk'})); });
self.addEventListener('notificationclick', event => {event.notification.close();event.waitUntil(self.clients.openWindow('./'));});
