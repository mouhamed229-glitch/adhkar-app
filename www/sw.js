const CACHE = 'adhkar-v16';
const AUDIO_CACHE = 'adhkar-audio-v1';
const CORE  = ['./index.html'];

// Installation : mettre en cache la page principale immédiatement
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE).catch(() => {}))
  );
});

// Activation : virer les anciens caches (jamais le cache audio, il est précieux et lourd à reconstituer)
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== AUDIO_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ── Fichiers audio : cache dédié, fichier complet stocké une fois,
  //    puis servi (y compris en tranches "Range") depuis le cache → relecture
  //    instantanée et 100% hors-ligne après la première écoute.
  if (url.pathname.includes('/audio/')) {
    e.respondWith(handleAudioRequest(req));
    return;
  }

  // ── Reste de l'app (HTML/JS/CSS/icônes) : Cache-First + stale-while-revalidate
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) {
        fetch(req).then(fresh => {
          if (fresh && fresh.status === 200) {
            caches.open(CACHE).then(c => c.put(req, fresh));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then(res => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(req, clone));
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

async function handleAudioRequest(req) {
  const cache = await caches.open(AUDIO_CACHE);
  const cacheKey = new Request(req.url, { method: 'GET' });
  let full = await cache.match(cacheKey);

  if (!full) {
    try {
      const netRes = await fetch(cacheKey);
      if (netRes && netRes.status === 200) {
        await cache.put(cacheKey, netRes.clone());
        full = netRes;
      } else {
        return netRes;
      }
    } catch (err) {
      return new Response('', { status: 504, statusText: 'Hors-ligne et non mis en cache' });
    }
  }

  const rangeHeader = req.headers.get('range');
  if (!rangeHeader) return full.clone();

  try {
    const buffer = await full.clone().arrayBuffer();
    const total = buffer.byteLength;
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    const start = match ? parseInt(match[1], 10) : 0;
    const end = match && match[2] ? Math.min(parseInt(match[2], 10), total - 1) : total - 1;
    const chunk = buffer.slice(start, end + 1);

    return new Response(chunk, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Type': full.headers.get('Content-Type') || 'audio/mpeg',
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': String(chunk.byteLength),
        'Accept-Ranges': 'bytes'
      }
    });
  } catch (err) {
    return full.clone();
  }
}

// Message pour mise en cache forcée d'une URL (app shell)
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'CACHE_NOW') {
    caches.open(CACHE).then(c => c.addAll(e.data.urls || []));
  }
});