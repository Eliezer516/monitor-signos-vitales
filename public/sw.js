/**
 * Service worker: cachea la aplicacion entera para que funcione sin conexion.
 *
 * Estrategia:
 *  - Navegaciones (HTML): red primero, con la copia guardada como respaldo.
 *    Asi se recoge una version nueva en cuanto hay conexion y, sin ella, se
 *    arranca con la ultima que se conoce.
 *  - Recursos con hash en el nombre (/assets/*): cache primero. Vite les pone
 *    el hash de su contenido, asi que son inmutables y servirlos de cache es
 *    seguro y es lo mas rapido.
 *  - El resto: cache primero, refrescando por detras.
 *
 * Reglas que no se pueden romper:
 *
 * 1. BUILD_ID lo inyecta el build (ver `versionServiceWorker` en vite.config.ts)
 *    con un hash del bundle real. Es lo unico que hace que el navegador detecte
 *    que hay un service worker nuevo, y lo que hace que `activate` pueda tirar
 *    las caches viejas. Si fuera un literal fijo, la cache se congelaria para
 *    siempre en la primera visita.
 *
 * 2. Cada URL se guarda en UN SOLO sitio (`assets-<id>`). Una misma entrada en
 *    dos caches es la causa clasica de "sin conexion me sale la version vieja":
 *    `caches.match()` sin `cacheName` recorre las caches en orden de creacion y
 *    devuelve la primera que encuentra, que es la mas antigua.
 *
 * 3. Todas las lecturas van contra una cache nombrada de forma explicita. No
 *    se usa nunca `caches.match()` a pelo.
 *
 * No se cachean nunca las peticiones de datos externos.
 */

// Marcador sustituido por el build. Si se sirve este archivo tal cual (sin
// pasar por Vite) el service worker sigue siendo valido, solo que no versiona.
const BUILD_ID = '__BUILD_ID__'

// Lista de recursos minimos para arrancar sin conexion. El build la reescribe
// entera anadiendo los /assets/* con hash de esta compilacion, que es lo que
// permite que la PRIMERA visita sin conexion ya funcione entera.
const PRECARGA = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  // Los iconos se necesitan aunque no haya datos: los usa la pantalla de
  // instalacion de Android y las notificaciones.
  '/icono.svg',
  '/icono-192.png',
  '/icono-512.png',
  '/icono-maskable.png',
  '/favicon.svg',
]

const CACHE_ASSETS = `assets-${BUILD_ID}`

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE_ASSETS)
      // `addAll` falla entero si falta un recurso; se anaden de uno en uno para
      // que un icono ausente no impida instalar el service worker.
      .then((cache) =>
        Promise.allSettled(
          PRECARGA.map((url) =>
            // `cache: 'reload'` salta la cache HTTP del navegador: si no, se
            // podria precargar una copia vieja desde el disco.
            cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
          ),
        ),
      ),
  )
  // Aqui NO se llama a `skipWaiting()` a proposito.
  //
  // La version nueva se queda en espera hasta que la pagina avise. Mientras
  // tanto sigue mandando la version vieja, con SU cache y SU bundle, que es
  // justo lo que debe pasar: si se activara sola, `activate` borraria la cache
  // anterior y la pagina que esta abierta (bundle viejo) se quedaria sin sus
  // archivos al quedarse sin conexion. Esperando, las dos ramas son
  // coherentes; la decision la toma quien esta usando la app, en
  // `src/lib/actualizacion.ts`.
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) =>
        Promise.all(
          // Todo lo que no sea de esta version se va, incluidas las caches de
          // versiones anteriores y las que creo el service worker antiguo.
          claves.filter((c) => c !== CACHE_ASSETS).map((c) => caches.delete(c)),
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

  if (peticion.mode === 'navigate') {
    evento.respondWith(navegacion(peticion))
    return
  }

  // Los assets llevan el hash de su contenido en el nombre: si el nombre no
  // cambia, el contenido tampoco. Cache primero y sin mas.
  if (url.pathname.startsWith('/assets/')) {
    evento.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_ASSETS)
        const enCache = await cache.match(peticion)
        if (enCache) return enCache

        const respuesta = await fetch(peticion)
        if (respuesta.ok) await cache.put(peticion, respuesta.clone())
        return respuesta
      })(),
    )
    return
  }

  // Resto (manifest, iconos, fuentes): cache primero, refrescando por detras.
  evento.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_ASSETS)
      const enCache = await cache.match(peticion)

      const desdeRed = fetch(peticion)
        .then(async (respuesta) => {
          if (respuesta.ok) await cache.put(peticion, respuesta.clone())
          return respuesta
        })
        // El `.catch` va aqui para que un fallo de red no quede como promesa
        // rechazada sin vigilar cuando el valor en cache ya se va a devolver.
        .catch(() => undefined)

      if (enCache) return enCache
      return (await desdeRed) ?? new Response('', { status: 504 })
    })(),
  )
})

/**
 * Pagina de la aplicacion: red primero.
 *
 * El `index.html` es lo unico que cambia entre versiones, porque las rutas son
 * por hash y todo el bundle va con hash en el nombre. Guardarlo actualizado en
 * cada carga con conexion es lo que hace que, al volver a estar sin ella, se
 * abra la ultima version descargada y no la que se instalo por primera vez.
 */
async function navegacion(peticion) {
  try {
    const respuesta = await fetch(peticion)
    // Solo se guarda si de verdad es la pagina: un 404 o un 5xx en HTML
    // acabaria sirviendo como pantalla de arranque.
    if (respuesta.ok) {
      const cache = await caches.open(CACHE_ASSETS)
      // Se guarda bajo las dos claves por las que puede pedirse la portada.
      await Promise.all([cache.put('/', respuesta.clone()), cache.put('/index.html', respuesta.clone())])
    }
    return respuesta
  } catch {
    const cache = await caches.open(CACHE_ASSETS)
    const guardada = (await cache.match('/index.html')) ?? (await cache.match('/'))
    if (guardada) return guardada
    return new Response('Sin conexion y sin copia guardada de la aplicacion.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}

// La pagina avisa cuando quiere activar la version nueva, que hasta entonces
// sigue en espera. Ver la nota del `install` sobre por que no se fuerza aqui.
self.addEventListener('message', (evento) => {
  if (evento.data === 'skip-waiting') self.skipWaiting()
})