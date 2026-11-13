// Service worker: abre o app na hora, mesmo com internet ruim.
// - assets/ (JS, CSS, fonte, com hash no nome): cache primeiro. Nunca mudam: versão nova = nome novo.
// - a página (navegação): rede primeiro, para cada publicação chegar na hora; cache só sem internet.
// - outras origens (APIs de IA, etc.): não toca.

const CACHE = 'flipper-agent-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

/**
 * Guarda a página nova e, se ela aponta para um JS principal diferente (versão nova publicada),
 * apaga do cache todos os arquivos de versões antigas. Assim o celular fica só com a versão atual.
 * O que a versão nova precisar (fonte, modo demo) volta ao cache no primeiro uso.
 */
async function keepOnlyCurrent(pageRes) {
  const cache = await caches.open(CACHE)
  const html = await pageRes.clone().text()
  const old = await cache.match('./')
  const oldHtml = old ? await old.text() : ''
  await cache.put('./', pageRes)
  const main = (h) => (h.match(/assets\/index-[^"']+\.js/) || [''])[0]
  if (!oldHtml || main(html) === main(oldHtml)) return
  const keep = new Set(html.match(/assets\/[^"']+/g) || [])
  for (const key of await cache.keys()) {
    const path = new URL(key.url).pathname
    const i = path.indexOf('assets/')
    if (i >= 0 && !keep.has(path.slice(i))) await cache.delete(key)
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          event.waitUntil(keepOnlyCurrent(copy))
          return res
        })
        .catch(() => caches.match('./')),
    )
    return
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
  }
})
