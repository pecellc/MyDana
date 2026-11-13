// KeuanganKu Lightweight PWA Service Worker
const CACHE_NAME = 'keuanganku-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './icon.svg',
  './manifest.json',
  './supabase-config.js',
  './auth.js',
  './db.js',
  './buyer.js',
  './app.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Network first for real-time data & Supabase, fallback to cache
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
