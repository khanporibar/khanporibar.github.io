const C='khan-v12';
const CORE=['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png','favicon-32.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>Promise.all(CORE.map(u=>c.add(u).catch(()=>{})))))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>clients.claim())));
const swr=(req)=>caches.open(C).then(c=>c.match(req).then(hit=>{const net=fetch(req).then(r=>{if(r&&(r.ok||r.type=='opaque'))c.put(req,r.clone());return r}).catch(()=>hit);return hit||net}));
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!='GET')return;const u=new URL(r.url);
 if(r.mode=='navigate'){e.respondWith(fetch(r).then(res=>{if(res.ok){const cp=res.clone();caches.open(C).then(c=>{c.put('./',cp.clone());c.put(r,cp)})}return res}).catch(()=>caches.match(r).then(h=>h||caches.match('./')||caches.match('index.html')).then(h=>h||new Response('অফলাইন — একবার ইন্টারনেট দিয়ে অ্যাপ খুলে নিন।',{headers:{'Content-Type':'text/plain; charset=utf-8'}}))));return}
 if(u.pathname.startsWith('/.netlify/'))return;
 if(u.origin==location.origin||u.hostname=='www.gstatic.com'||u.hostname=='fonts.googleapis.com'||u.hostname=='fonts.gstatic.com'){e.respondWith(swr(r))}});
self.addEventListener('push',e=>{let d={};try{d=e.data.json()}catch(x){}const n=d.notification||d.data||d;e.waitUntil(self.registration.showNotification(n.title||'খান পরিবার',{body:n.body||'',icon:'icon-192.png',badge:'icon-192.png',data:{url:'./'}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window'}).then(l=>{for(const c of l){if('focus' in c)return c.focus()}return clients.openWindow('./')}))});
