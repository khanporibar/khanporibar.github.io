const CACHE_PREFIX='khan-family-';
const CACHE_NAME=CACHE_PREFIX+'v39';
const CORE=['./','index.html','manifest.webmanifest'];
const STATIC_DESTINATIONS=new Set(['script','style','image','font','worker']);
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await Promise.all(CORE.map(async url=>{try{const response=await fetch(url,{cache:'reload'});if(response.ok)await cache.put(url,response)}catch(_){}}));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>(name.startsWith(CACHE_PREFIX)&&name!==CACHE_NAME)||name==='khan-v37').map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});
async function networkFirst(request){
  const cache=await caches.open(CACHE_NAME);
  try{const response=await fetch(request);if(response&&response.ok)await cache.put(request,response.clone());return response}
  catch(error){return (await cache.match(request))||(await cache.match('./'))||(await cache.match('index.html'))||new Response('অফলাইন — ইন্টারনেট সংযোগ দিয়ে আবার চেষ্টা করুন।',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})}
}
async function staleWhileRevalidate(request){
  const cache=await caches.open(CACHE_NAME),cached=await cache.match(request);
  const fresh=fetch(request).then(async response=>{if(response&&(response.ok||response.type==='opaque')){try{await cache.put(request,response.clone())}catch(_){}}return response}).catch(()=>null);
  return cached||await fresh||new Response('',{status:504,statusText:'Offline'});
}
self.addEventListener('fetch',event=>{
  const request=event.request;if(request.method!=='GET')return;
  const url=new URL(request.url);if(url.pathname.startsWith('/.netlify/'))return;
  if(request.mode==='navigate'){event.respondWith(networkFirst(request));return}
  const sameOrigin=url.origin===self.location.origin;
  const approvedExternal=url.hostname==='www.gstatic.com'||url.hostname==='fonts.googleapis.com'||url.hostname==='fonts.gstatic.com';
  if((sameOrigin&&STATIC_DESTINATIONS.has(request.destination))||approvedExternal){event.respondWith(staleWhileRevalidate(request))}
});
self.addEventListener('push',event=>{
  let data={};try{data=event.data?event.data.json():{}}catch(_){data={body:event.data?event.data.text():''}}
  const n=data.notification||data.data||data;
  event.waitUntil(self.registration.showNotification(n.title||'খান পরিবার',{body:n.body||'',icon:'icon-192.png',badge:'icon-192.png',data:{url:(n.data&&n.data.url)||'./'}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();const target=event.notification.data&&event.notification.data.url||'./';
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
    for(const client of windows){if('focus' in client){await client.focus();if('navigate' in client)try{await client.navigate(target)}catch(_){}return}}
    return self.clients.openWindow(target);
  }));
});
