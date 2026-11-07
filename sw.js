'use strict';

const CACHE_PREFIX = 'khan-family-';
const CACHE_NAME = CACHE_PREFIX + 'v92';

const SCOPE = new URL(self.registration.scope);
const ROOT_URL = SCOPE.href;                         // e.g. https://site/
const INDEX_URL = new URL('index.html', SCOPE).href; // e.g. https://site/index.html
const OPTIONAL = ['manifest.webmanifest'];           // cached if available, never blocks install

// Versioned, never-changing files (Firebase SDK 10.14.1, font binaries): once cached they are never downloaded again.
const FIREBASE_BASE = 'https://www.gstatic.com/firebasejs/10.14.1/';
const PRECACHE_EXTERNAL = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map(f => FIREBASE_BASE + f);
function isImmutable(url) {
  return url.hostname === 'fonts.gstatic.com' || (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'));
}
const STATIC_DESTINATIONS = new Set(['script', 'style', 'image', 'font', 'worker', 'manifest']);
const APPROVED_EXTERNAL = new Set(['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com']);

/* ---------- helpers ---------- */

// A redirected response can't be used to answer a navigation, so rebuild it clean.
async function clean(response) {
  if (!response.redirected) return response;
  const body = await response.blob();
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function isShellPath(url) {
  return url.origin === SCOPE.origin && (url.pathname === SCOPE.pathname || url.pathname === SCOPE.pathname + 'index.html');
}

async function putShell(cache, response) {
  const copy = await clean(response.clone());
  await Promise.all([cache.put(ROOT_URL, copy.clone()), cache.put(INDEX_URL, copy)]);
}

async function matchShell(cache) {
  return (await cache.match(ROOT_URL)) || (await cache.match(INDEX_URL));
}

function offlineResponse() {
  return new Response(
    '<!doctype html><html lang="bn"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<body style="font-family:system-ui,sans-serif;background:#070b1a;color:#eef2ff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px">' +
    '<p>অফলাইন — ইন্টারনেট সংযোগ দিয়ে আবার চেষ্টা করুন।</p></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}

/* ---------- lifecycle ---------- */

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // The app shell is mandatory: if it can't be fetched, the install fails and the previous
    // service worker (with its working cache) keeps running.
    const shell = await fetch(ROOT_URL, { cache: 'no-cache' });
    if (!shell.ok) throw new Error('App shell fetch failed: ' + shell.status);
    await putShell(cache, shell);

    // Nice-to-have files: best effort only.
    await Promise.all(OPTIONAL.map(async path => {
      try {
        const res = await fetch(path, { cache: 'reload' });
        if (res.ok) await cache.put(new URL(path, SCOPE).href, res);
      } catch (_) { /* ignore */ }
    }));

    // Firebase SDK: best effort, so the very next launch (even offline) needs no download.
    await Promise.all(PRECACHE_EXTERNAL.map(async href => {
      try {
        if (await cache.match(href)) return;
        const res = await fetch(href, { mode: 'cors' });
        if (res.ok) await cache.put(href, res);
      } catch (_) { /* ignore */ }
    }));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(name => name.startsWith('khan-') && name !== CACHE_NAME) // covers khan-family-* and the old khan-v37
        .map(name => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

/* ---------- fetch strategies ---------- */

// Page navigations: cache first. The app shell opens instantly from the cache; a fresh copy is fetched in the
// background (conditional request, so it is tiny when nothing changed) and used from the next launch.
function shellSig(res) {
  return (res.headers.get('etag') || '') + '|' + (res.headers.get('last-modified') || '') + '|' + (res.headers.get('content-length') || '');
}

async function notifyUpdate() {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  list.forEach(c => { try { c.postMessage({ type: 'upd' }); } catch (_) { /* ignore */ } });
}

async function sameBody(a, b) {
  const [x, y] = await Promise.all([a.clone().arrayBuffer(), b.clone().arrayBuffer()]);
  if (x.byteLength !== y.byteLength) return false;
  const u = new Uint8Array(x), v = new Uint8Array(y);
  for (let i = 0; i < u.length; i++) if (u[i] !== v[i]) return false;
  return true;
}

async function refreshShell(cache, cached) {
  try {
    const response = await fetch(ROOT_URL, { cache: 'no-cache' });
    if (!response.ok || response.type !== 'basic') return;
    // Compare the actual page content, not headers (ETag / Content-Length can differ on every request on a CDN).
    let changed = true;
    if (cached) changed = !(await sameBody(cached, response));
    if (!changed) return;
    await putShell(cache, response);
    if (cached) await notifyUpdate();
  } catch (_) { /* offline: keep the cached shell */ }
}

async function handleNavigate(event) {
  const request = event.request;
  const cache = await caches.open(CACHE_NAME);
  const cached = await matchShell(cache);
  const url = new URL(request.url);

  if (cached && isShellPath(url)) {
    event.waitUntil(refreshShell(cache, cached)); // must be registered before we answer
    return cached;
  }

  // First ever launch (nothing cached yet) or a non-shell path: go to the network.
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic' && isShellPath(url)) {
      event.waitUntil(putShell(cache, response.clone()).catch(() => {}));
    }
    return response;
  } catch (_) {
    return cached || offlineResponse();
  }
}

// Immutable files: cache first, no background re-download.
async function cacheFirst(event) {
  const request = event.request;
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
    }
    return response;
  } catch (_) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

// Static files: answer from cache instantly, refresh in the background.
async function staleWhileRevalidate(event) {
  const request = event.request;
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const network = fetch(request);
  const update = network.then(async response => {
    if (response && (response.ok || response.type === 'opaque')) {
      try { await cache.put(request, response.clone()); } catch (_) { /* quota etc. */ }
    }
  }).catch(() => {});
  event.waitUntil(update); // background refresh survives even after the cached answer was sent

  if (cached) return cached;
  try { return await network; }
  catch (_) { return new Response('', { status: 504, statusText: 'Offline' }); }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.pathname.startsWith('/.netlify/')) return;
  if (request.headers.has('range')) return; // let the browser handle media range requests itself

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigate(event));
    return;
  }

  if (isImmutable(url)) {
    event.respondWith(cacheFirst(event));
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  if ((sameOrigin && STATIC_DESTINATIONS.has(request.destination)) || APPROVED_EXTERNAL.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event));
  }
});

/* ---------- push notifications ---------- */

function targetFrom(d, n, payload) {
  const fcmLink = (payload.fcmOptions && payload.fcmOptions.link) || (payload.fcm_options && payload.fcm_options.link);
  const direct = d.url || d.link || n.click_action || n.url || fcmLink;
  if (direct) return String(direct);
  if (d.go) {
    const q = new URLSearchParams({ go: d.go });
    if (d.chat) q.set('chat', d.chat);
    return './?' + q.toString();
  }
  return './';
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload = {};
    if (event.data) {
      try { payload = event.data.json() || {}; }
      catch (_) { try { payload = { body: event.data.text() }; } catch (__) { payload = {}; } }
    }
    const n = payload.notification && typeof payload.notification === 'object' ? payload.notification : payload;
    const d = Object.assign({}, payload.data || {}, n.data || {});
    const tag = n.tag || d.tag || undefined;

    const options = {
      body: n.body || d.body || '',
      icon: n.icon || 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: targetFrom(d, n, payload), go: d.go, chat: d.chat }
    };
    if (tag) { options.tag = tag; options.renotify = true; } // renotify is only valid together with a tag

    await self.registration.showNotification(n.title || d.title || 'খান পরিবার', options);
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const info = event.notification.data || {};

  event.waitUntil((async () => {
    let target;
    try { target = new URL(info.url || './', SCOPE); } catch (_) { target = new URL('./', SCOPE); }
    if (target.origin !== SCOPE.origin) target = new URL('./', SCOPE); // never open foreign URLs from a notification

    const go = info.go || target.searchParams.get('go');
    const chat = info.chat || target.searchParams.get('chat');

    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = windows.filter(c => c.url.startsWith(SCOPE.origin + SCOPE.pathname));
    const client = mine.find(c => c.focused) || mine.find(c => c.visibilityState === 'visible') || mine[0];

    if (client) {
      try { await client.focus(); } catch (_) { /* some platforms refuse */ }
      if (go) {
        // The page already knows how to jump to a tab / chat: tell it, don't reload it.
        client.postMessage({ type: 'go', go, chat: chat || undefined });
      } else if ('navigate' in client && new URL(client.url).pathname !== target.pathname) {
        try { await client.navigate(target.href); } catch (_) { /* ignore */ }
      }
      return;
    }
    return self.clients.openWindow(target.href);
  })());
});
