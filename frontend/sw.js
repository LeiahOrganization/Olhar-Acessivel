// Service worker: guarda a casca do aplicativo para abrir mesmo com internet
// ruim. As chamadas ao modelo de visao e ao servidor sempre vao a rede — o que
// fica em cache e so a interface.

const CACHE = "olhar-acessivel-v2";
const CASCA = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./css/tokens.css",
  "./js/app.js",
  "./js/config.js",
  "./js/prompts.js",
  "./js/imagem.js",
  "./js/ia.js",
  "./js/servidor.js",
  "./js/fala.js",
  "./js/camera.js",
  "./js/armazenamento.js",
  "./js/ui.js",
  "./manifest.webmanifest",
  "./icons/icone.svg",
  "./icons/icone-192.png",
  "./icons/icone-512.png",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CASCA)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (evento) => {
  const pedido = evento.request;
  if (pedido.method !== "GET") return;

  const url = new URL(pedido.url);
  // nunca cachear API de visao, audio do servidor nem imagens do banco
  if (url.pathname.startsWith("/api/") || url.origin !== location.origin) return;

  // Rede primeiro, cache como reserva: uma versao nova publicada no Pages chega
  // ja na proxima abertura, e o aplicativo continua abrindo sem internet.
  evento.respondWith(
    fetch(pedido)
      .then((resposta) => {
        if (resposta.ok) {
          const copia = resposta.clone();
          caches.open(CACHE).then((cache) => cache.put(pedido, copia));
        }
        return resposta;
      })
      .catch(() =>
        caches.match(pedido).then(
          (guardado) => guardado || caches.match("./index.html")
        )
      )
  );
});
