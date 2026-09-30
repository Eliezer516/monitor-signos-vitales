/**
 * Service worker: cachea el shell de la aplicacion para que funcione sin
 * conexion.
 *
 * Estrategia:
 *  - Navegaciones (HTML): red primero con copia de respaldo. Permite detectar
 *    actualizaciones cuando hay conexion y sigue funcionando sin ella.
 *  - Recursos estaticos con hash en el nombre (/assets/*): cache primero. Son
 *    inmutables, asi que servirlos de cache es seguro y es lo mas rapido.
 *  - El resto: cache primero con refresco en segundo plano.
 *
 * No se cachean nunca las peticiones de datos externos.
 */

const VERSION = 'v1'
const CACHE_ESTATICO = `estatico-${VERSION}`
const CACHE_PAGINAS = `paginas-${VERSION}`

// Recursos minimos para arrancar sin conexion. El resto se guarda solo tras la
// primera visita, con la estrategia "cache primero".
const PRECARGA = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icono.svg',
  // Los iconos se necesitan aunque no haya datos: son los que muestra la
  // pantalla de instalacion de Android y las notificaciones.
  '/icono-192.png',
  '/icono-512.png',
  '/favicon.svg',
]

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE_ESTATICO)
      // `addAll` falla entero si un recurso falta; se anaden de uno en uno para
      // que un icono ausente no impida instalar el service worker.
      .then((cache) =>
        Promise.allSettled(PRECARGA.map((url) => cache.add(url).catch(() => undefined))),
      )
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) =>
        Promise.all(
          claves
            .filter((c) => c !== CACHE_ESTATICO && c !== CACHE_PAGINAS)
            .map((c) => caches.delete(c)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request

  // Solo se gestionan GET; las escrituras pasan siempre a la red.
  if (peticion.method !== 'GET') return

  const url = new URL(peticion.url)
  if (url.origin !== self.location.origin) return

  // Navegaciones: red primero para recoger una version nueva del bundle.
  if (peticion.mode === 'navigate') {
    evento.respondWith(
      fetch(peticion)
        .then((respuesta) => {
          const copia = respuesta.clone()
          caches.open(CACHE_PAGINAS).then((c) => c.put('/index.html', copia))
          return respuesta
        })
        .catch(async () => {
          const enCache = await caches.match('/index.html')
          return enCache ?? new Response('Sin conexion', { status: 503 })
        }),
    )
    return
  }

  // Recursos con hash: inmutables, se sirven siempre de cache.
  if (url.pathname.startsWith('/assets/')) {
    evento.respondWith(
      caches.match(peticion).then(
        (enCache) =>
          enCache ??
          fetch(peticion).then((respuesta) => {
            const copia = respuesta.clone()
            caches.open(CACHE_ESTATICO).then((c) => c.put(peticion, copia))
            return respuesta
          }),
      ),
    )
    return
  }

  // Resto: cache primero, refrescando por detrás.
  evento.respondWith(
    caches.match(peticion).then((enCache) => {
      const desdeRed = fetch(peticion)
        .then((respuesta) => {
          if (respuesta.ok) {
            const copia = respuesta.clone()
            caches.open(CACHE_ESTATICO).then((c) => c.put(peticion, copia))
          }
          return respuesta
        })
        .catch(() => enCache)
      return enCache ?? desdeRed
    }),
  )
})

// Permite actualizar la app en caliente desde la pagina.
self.addEventListener('message', (evento) => {
  if (evento.data === 'skip-waiting') self.skipWaiting()
})