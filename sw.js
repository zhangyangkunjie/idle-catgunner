/* Idle Cat Gunner 手机版 Service Worker：缓存游戏资源，支持离线游玩
   v3：修复缓存污染——沙箱停止时网关返回 HTML 错误页会被缓存成 wasm/data，
   导致 "WebAssembly.Module doesn't parse at byte 0" 报错。现在缓存前校验内容类型。 */
const CACHE = 'idle-cat-gunner-v3';
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './apple-touch-icon.png'];

// 错误页/坏响应识别：非 200，或二进制资源却返回了 HTML/JSON
function isBadResponse(res) {
  if (!res || !res.ok) return true;
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  return ct.includes('text/html') || ct.includes('application/json') || ct.includes('text/plain');
}

// 首页校验：必须是本游戏页面（防止把网关的"工作空间已停止"错误页缓存成首页）
async function isOurPage(res) {
  try {
    const text = await res.clone().text();
    return text.includes('unity-canvas');
  } catch (e) {
    return false;
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const c = await caches.open(CACHE);
    for (const item of PRECACHE) {
      try {
        const res = await fetch(item);
        if (res.ok && (item.includes('.html') || item === './' ? await isOurPage(res) : true)) {
          await c.put(item, res);
        }
      } catch (e) {}
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 游戏资源：缓存优先，但命中坏缓存时丢弃并回源；坏响应绝不写入缓存
  if (url.pathname.includes('/game/Build/')) {
    event.respondWith((async () => {
      const c = await caches.open(CACHE);
      let hit = await c.match(req);
      if (hit && isBadResponse(hit)) { await c.delete(req); hit = null; }
      try {
        const res = await fetch(req);
        if (!isBadResponse(res)) c.put(req, res.clone());
        return res;
      } catch (e) {
        if (hit) return hit; // 断网时回落到已验证的好缓存
        return Response.error();
      }
    })());
    return;
  }

  // 页面与清单：网络优先，失败回落缓存（保证离线可打开）
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      const isPage = (res.headers.get('content-type') || '').includes('text/html');
      if (res.ok && (!isPage || (await isOurPage(res)))) {
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
      }
      return res;
    } catch (e) {
      const c = await caches.open(CACHE);
      return (await c.match(req)) || (await c.match('./')) || Response.error();
    }
  })());
});
