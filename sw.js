// Service worker minimal : met en cache le squelette de l'app (HTML/CSS/JS/
// icônes) pour qu'elle puisse au moins s'ouvrir sans réseau, plutôt que de
// rester sur un écran blanc. Ne met JAMAIS en cache les appels vers
// Supabase — les données de l'app doivent toujours venir du réseau, jamais
// de ce cache, pour éviter d'afficher des informations périmées comme si
// elles étaient à jour.
//
// Stratégie : "réseau d'abord, secours par le cache" — l'app la plus
// récente est toujours servie quand le réseau est là, le cache ne sert que
// de filet de sécurité hors-ligne. Incrémenter CACHE_NAME force le
// remplacement du cache au prochain déploiement.
var CACHE_NAME = 'carnet-shell-v2';

var PRECACHE_URLS = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './ui-common.js',
  './carte-grise-ocr.js',
  './export-dossier.js',
  './checklist-sessions.js',
  './data-sync-calc.js',
  './render.js',
  './entry-modal.js',
  './vehicle-modals.js',
  './journal-backups-init.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache){ return cache.addAll(PRECACHE_URLS); })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys()
      .then(function(names){
        return Promise.all(
          names.filter(function(name){ return name !== CACHE_NAME; })
               .map(function(name){ return caches.delete(name); })
        );
      })
      .then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event){
  var req = event.request;

  // On n'intercepte jamais : les requêtes qui ne sont pas de simples
  // lectures (GET), ni celles vers un autre domaine que l'app elle-même —
  // Supabase (API, Storage, Auth) notamment, qui doit toujours passer par le
  // réseau, jamais par ce cache.
  var sameOrigin;
  try { sameOrigin = new URL(req.url).origin === self.location.origin; }
  catch(e){ sameOrigin = false; }
  if(req.method !== 'GET' || !sameOrigin) return;

  event.respondWith(
    fetch(req)
      .then(function(res){
        var resClone = res.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put(req, resClone); });
        return res;
      })
      .catch(function(){
        return caches.match(req).then(function(cached){
          return cached || caches.match('./index.html');
        });
      })
  );
});
