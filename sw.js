/* ============================================================
 * sw.js —— 滚滚长河 Service Worker（PWA 离线支持）
 *  策略：HTML 网络优先（保证更新及时，落网时回退缓存）；
 *        其余资源 缓存优先 + 后台更新（stale-while-revalidate）
 *  缓存名带版本号：发布新版只需升 SW_VERSION。
 * ============================================================ */
'use strict';

const SW_VERSION = 'v13.1';
const CACHE_NAME = 'tr-cache-' + SW_VERSION;
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          if (k !== CACHE_NAME) return caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // 只管同源（维基图片走网络）

  const isHTML = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').indexOf('text/html') >= 0;

  if (isHTML) {
    /* 网络优先：新版本立即可见；断网回退缓存 */
    e.respondWith(
      fetch(req).then(function (res) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
    );
    return;
  }

  /* 静态资源：缓存优先 + 后台刷新 */
  e.respondWith(
    caches.match(req).then(function (hit) {
      const fetching = fetch(req).then(function (res) {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || fetching;
    })
  );
});
