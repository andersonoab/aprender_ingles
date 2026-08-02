/* ═══════════════════════════════════════════════════════════════
   SERVICE WORKER — Lousa da Fluência
   Igarapé Digital

   Estratégia: stale-while-revalidate para tudo que é do próprio
   domínio. Abre instantâneo a partir do cache e atualiza em segundo
   plano. Isso evita as duas armadilhas clássicas:
   - cache-first puro, que congela o app numa versão velha;
   - network-first puro, que trava a abertura fora de cobertura.

   Para trocar de versão: incremente CACHE_VERSION.
═══════════════════════════════════════════════════════════════ */

const CACHE_VERSION = "v2";
const CACHE_NAME = `lousa-${CACHE_VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./ux-mobile.css",
  "./storage-guard.js",
  "./app.js",
  "./walk-engine.js",
  "./bridge-mode.js",
  "./ux-mobile.js",
  "./data-loader.js",
  "./frases_unicas_1000.txt",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];

// Domínios externos que vale a pena guardar para uso offline.
const RUNTIME_ALLOW = [
  "raw.githubusercontent.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdnjs.cloudflare.com"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll falha inteiro se um item falhar; aqui cada um é
      // independente para o SW nunca deixar de instalar.
      Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith("lousa-") && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function shouldHandle(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.origin === self.location.origin) return true;
  if (url.pathname.includes("translate_tts")) return false; // áudio de voz não vai para o cache
  if (url.pathname.includes("translate_a")) return false;   // tradução também não
  return RUNTIME_ALLOW.includes(url.hostname);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!shouldHandle(request)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);

      const network = fetch(request)
        .then((response) => {
          if (response && (response.ok || response.type === "opaque")) {
            cache.put(request, response.clone()).catch(() => {});
          }
          return response;
        })
        .catch(() => null);

      if (cached) return cached;

      const fresh = await network;
      if (fresh) return fresh;

      if (request.mode === "navigate") {
        const shell = await cache.match("./index.html");
        if (shell) return shell;
      }
      return new Response("Recurso indisponível offline.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    })
  );
});
