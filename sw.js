/* 巷口早餐铺 · Service Worker
   目标：离线优先。游戏本体不含任何网络请求，这里只需把外壳文件缓存住，
   装到主屏后即使完全断网也能直接进游戏（对应「不联网」的诉求）。

   策略：cache-first，仅在网络可用且缓存未命中时回源。
   注意：Service Worker 只在 https 或 localhost 下生效；file:// 打开时会注册失败，
        这在下面的注册代码里已被静默忽略，不影响游戏本身运行。
*/

const VERSION = 'v1';
const CACHE = 'xiangkou-zaocan-' + VERSION;

/* 应用外壳：全部为本地静态文件，无第三方依赖 */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-1024.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // 单个文件失败不应让整个安装失败，因此逐个 add 并吞掉错误
      .then(cache => Promise.all(SHELL.map(url =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('xiangkou-zaocan-') && k !== CACHE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 只管自己的资源

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        // 只缓存成功的同源响应
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => {
        // 离线且未缓存：导航请求一律回退到 index.html
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});
