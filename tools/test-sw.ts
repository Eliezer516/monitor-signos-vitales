/**
 * Pruebas del service worker contra un `CacheStorage` y una `fetch` simulados.
 *
 * Se ejecuta sobre el `dist/sw.js` REAL, ya con la version y la lista de
 * precarga inyectadas por el build, que es donde estaba el fallo que hacia que
 * sin conexion se abriera siempre la primera version que se instalo.
 *
 *   npm run build && npm run test:sw
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORIGEN = 'https://ejemplo.test'

let fallos = 0
let total = 0

function ok(condicion: boolean, nombre: string, extra = '') {
  total++
  if (condicion) console.log(`  ok: ${nombre}`)
  else {
    fallos++
    console.log(`  FALLO: ${nombre}${extra ? ` -> ${extra}` : ''}`)
  }
}

function igual(recibido: unknown, esperado: unknown, nombre: string) {
  ok(
    JSON.stringify(recibido) === JSON.stringify(esperado),
    nombre,
    `recibido ${JSON.stringify(recibido)}, esperado ${JSON.stringify(esperado)}`,
  )
}

// ---------------------------------------------------------------------------
// Doble de CacheStorage
// ---------------------------------------------------------------------------

/**
 * Una `Cache` real normaliza las claves a URL absoluta, asi que el doble tiene
 * que hacerlo tambien. Si no, `/index.html` precargado y `/index.html` guardado
 * por la navegacion acabarían en entradas distintas y la prueba mentiria.
 */
function clave(url: string): string {
  if (url.startsWith('http')) return url
  return ORIGEN + (url.startsWith('/') ? url : `/${url}`)
}

interface Respuesta {
  ok: boolean
  status: number
  cuerpo: string
  clone(): Respuesta
}

function respuesta(cuerpo: string, status = 200): Respuesta {
  return { ok: status >= 200 && status < 300, status, cuerpo, clone: () => respuesta(cuerpo, status) }
}

class CacheSimulada {
  entradas = new Map<string, string>()

  constructor(readonly nombre: string) {}

  async add(peticion: Request | string) {
    const r = await red(clave(typeof peticion === 'string' ? peticion : peticion.url))
    if (!r.ok) throw new Error(`no se pudo precargar ${r.status}`)
    this.entradas.set(clave(typeof peticion === 'string' ? peticion : peticion.url), r.cuerpo)
  }

  async match(peticion: Request | string): Promise<Respuesta | undefined> {
    const cuerpo = this.entradas.get(clave(typeof peticion === 'string' ? peticion : peticion.url))
    return cuerpo === undefined ? undefined : respuesta(cuerpo)
  }

  async put(peticion: Request | string, r: Respuesta) {
    this.entradas.set(clave(typeof peticion === 'string' ? peticion : peticion.url), r.cuerpo)
  }
}

class CacheStorageSimulado {
  private mapa = new Map<string, CacheSimulada>()

  async open(nombre: string) {
    let c = this.mapa.get(nombre)
    if (!c) {
      c = new CacheSimulada(nombre)
      this.mapa.set(nombre, c)
    }
    return c
  }

  async keys() {
    return [...this.mapa.keys()]
  }

  async delete(nombre: string) {
    return this.mapa.delete(nombre)
  }

  /**
   * `caches.match` global, el que devolvia la copia vieja: recorre las caches
   * en orden de creacion y devuelve la primera que coincide.
   */
  async match(peticion: Request | string) {
    for (const c of this.mapa.values()) {
      const r = await c.match(peticion)
      if (r) return r
    }
    return undefined
  }

  limpiar() {
    this.mapa.clear()
  }

  entrada(nombre: string, url: string) {
    return this.mapa.get(nombre)?.entradas.get(clave(url))
  }
}

// ---------------------------------------------------------------------------
// Red simulada
// ---------------------------------------------------------------------------

/** Cuando vale `false`, toda peticion falla: es lo que ve el usuario sin conexion. */
const RED = { activa: true, colgada: false }

async function red(url: string, signal?: AbortSignal): Promise<Respuesta> {
  if (!RED.activa) throw new Error('sin conexion')

  // Ni responde ni falla. Es lo que hace un movil con cobertura pero sin salida a
  // internet, o un portal cautivo: la peticion simplemente se queda ahi.
  //
  // Es el caso que hacia pasar la prueba de "SIN conexion" sin encontrar el fallo
  // real: ahi la red simulada falla al instante, como hace un navegador en modo
  // avion, y un `fetch` sin plazo no se distingue. Contra la red real, que si
  // aguanta, la navegacion se quedaba esperando hasta que el sistema operativo
  // se rendia y la pantalla no aparecia en medio minuto.
  if (RED.colgada) {
    return new Promise<Respuesta>((_resolver, rechazar) => {
      signal?.addEventListener('abort', () => rechazar(new Error('peticion abortada')))
    })
  }

  const relativa = url === `${ORIGEN}/` ? '/index.html' : url.slice(ORIGEN.length)
  const ruta = join(RAIZ, 'dist', relativa)
  if (!existsSync(ruta)) return respuesta('no encontrado', 404)
  return respuesta(readFileSync(ruta, 'utf8'))
}

// ---------------------------------------------------------------------------
// Carga del service worker real
// ---------------------------------------------------------------------------

const rutaSw = join(RAIZ, 'dist', 'sw.js')
if (!existsSync(rutaSw)) {
  console.log('\nFalta dist/sw.js. Ejecuta `npm run build` antes.\n')
  process.exit(1)
}

const codigo = readFileSync(rutaSw, 'utf8')

type Escucha = (e: never) => void

/**
 * `Request` de Node rechaza las URL relativas y el worker precarga con rutas
 * relativas. Se sustituye por un doble construible que las absolutiza igual que
 * haria el navegador.
 */
class Peticion {
  url: string
  method = 'GET'
  mode = 'no-cors'
  cache?: string

  constructor(url: string, init?: { cache?: string }) {
    this.url = clave(url)
    this.cache = init?.cache
  }
}

class Entorno {
  listeners: Record<string, Escucha[]> = {}
  caches = new CacheStorageSimulado()
  reclamados = 0
  saltados = 0

  readonly self = {
    addEventListener: (tipo: string, fn: Escucha) => {
      ;(this.listeners[tipo] ??= []).push(fn)
    },
    location: { origin: ORIGEN },
    clients: {
      claim: async () => {
        this.reclamados++
      },
    },
    skipWaiting: () => {
      this.saltados++
    },
  }

  constructor() {
    new Function(
      'self_',
      'caches_',
      'red',
      'Request',
      `
      const self = self_;
      const caches = caches_;
      const fetch = (r, init) => red(String(r.url), init?.signal);
      ${codigo}
      `,
    )(this.self, this.caches, red, Peticion)
  }

  /** Lanza un evento y espera a lo que su `waitUntil` devuelva. */
  async instalar(tipo: string, evento: Record<string, unknown> = {}) {
    let pendiente: Promise<unknown> | undefined
    for (const fn of this.listeners[tipo] ?? []) {
      fn({ ...evento, waitUntil: (p: Promise<unknown>) => (pendiente = p) } as never)
    }
    await pendiente
  }

  /**
   * Simula una peticion. Devuelve `null` si el worker no la intercepto, que es
   * lo que tiene que pasar con las escrituras y con los origenes ajenos.
   */
  async pedir(opciones: { url: string; mode?: string; method?: string }): Promise<Respuesta | null> {
    let promesa: Promise<Respuesta> | undefined
    this.instalar('fetch', {
      request: { url: clave(opciones.url), method: opciones.method ?? 'GET', mode: opciones.mode ?? 'no-cors' },
      respondWith: (p: Promise<Respuesta>) => (promesa = p),
    })
    return promesa ? promesa.catch(() => respuesta('fallo de red', 0)) : null
  }
}

const htmlEnDisco = readFileSync(join(RAIZ, 'dist', 'index.html'), 'utf8')

const versionDe = (c: string) => /const BUILD_ID = '([^']*)'/.exec(c)?.[1] ?? ''

/** El array va con comillas simples en el fuente y con dobles tras el build. */
const precargaDe = (c: string) =>
  (/const PRECARGA = (\[[\s\S]*?\])/.exec(c)?.[1] ?? '').match(/['"]([^'"]+)['"]/g)?.map((s) => s.slice(1, -1)) ?? []

// ---------------------------------------------------------------------------
// Pruebas
// ---------------------------------------------------------------------------

console.log('\nVersionado por el build')

const version = versionDe(codigo)
const precarga = precargaDe(codigo)
const assets = precarga.filter((u) => u.startsWith('/assets/'))

ok(version !== '' && version !== '__BUILD_ID__', 'el build sustituyo BUILD_ID', `"${version}"`)
ok(assets.length > 0, 'PRECARGA incluye los assets con hash de esta compilacion', `${assets.length}`)
ok(
  assets.every((u) => /-[A-Za-z0-9_-]{8}\.(js|css)$/.test(u)),
  'los assets precargados llevan hash de contenido en el nombre',
)
ok(precarga.includes('/') && precarga.includes('/index.html'), 'la portada se precarga bajo las dos claves')
ok(
  precarga.every((u) => ['/', '/index.html'].includes(u) || existsSync(join(RAIZ, 'dist', u))),
  'todo lo precargado es un archivo que existe en dist',
  precarga.filter((u) => !['/', '/index.html'].includes(u) && !existsSync(join(RAIZ, 'dist', u))).join(', '),
)
ok(
  assets.some((u) => /index-.*\.js$/.test(u)) && assets.some((u) => /index-.*\.css$/.test(u)),
  'esta el bundle y la hoja de estilo del build actual',
)

console.log('\nInstalacion')

const e1 = new Entorno()
await e1.instalar('install')

const claves1 = await e1.caches.keys()
igual(claves1.length, 1, 'crea una sola cache')
ok(claves1[0].startsWith('assets-'), 'la cache lleva la version', claves1[0])
ok(e1.caches.entrada(claves1[0], '/index.html') === htmlEnDisco, 'precarga el index.html real del build')
ok(e1.caches.entrada(claves1[0], '/manifest.webmanifest') !== undefined, 'precarga el manifest')
ok(e1.caches.entrada(claves1[0], '/icono-192.png') !== undefined, 'precarga los iconos')
for (const u of assets) {
  ok(e1.caches.entrada(claves1[0], u) !== undefined, `precarga ${u}`)
}
ok(e1.saltados === 0, 'NO se auto-activa: la version nueva se queda esperando', `skipWaiting=${e1.saltados}`)

console.log('\nActivacion')

{
  const e = new Entorno()
  // Estado real de un navegador que ya uso una version anterior.
  await e.caches.open('assets-vieja-0000')
  await e.caches.open('estatico-v1')
  await e.caches.open('paginas-v1')
  await e.caches.open('otro-ajeno')

  await e.instalar('install')
  await e.instalar('activate')

  const claves = await e.caches.keys()
  igual(claves.length, 1, 'deja una sola cache tras activar')
  ok(
    !claves.some((c) => ['estatico-v1', 'paginas-v1', 'assets-vieja-0000', 'otro-ajeno'].includes(c)),
    'borra las caches anteriores, incluidas las del worker antiguo',
    claves.join(', '),
  )
  ok(e.reclamados === 1, 'reclama los clientes que ya estaban abiertos')
}

console.log('\nNavegacion con conexion')

{
  const e = new Entorno()
  await e.instalar('install')
  await e.instalar('activate')
  const cache = (await e.caches.keys())[0]

  // La app enruta por hash, asi que la unica navegacion real es la portada.
  const r = await e.pedir({ url: `${ORIGEN}/`, mode: 'navigate' })
  ok(r !== null && r.ok, 'responde con la pagina de la red')
  igual(r!.cuerpo, htmlEnDisco, 'entrega el index.html de la red')

  ok(
    e.caches.entrada(cache, '/index.html') === htmlEnDisco,
    'refresca el index.html guardado con la version acabada de descargar',
  )
  ok(e.caches.entrada(cache, '/') === htmlEnDisco, 'lo guarda tambien bajo la clave "/"')
}

console.log('\nErrores que no deben contaminar la cache')

{
  const e = new Entorno()
  await e.instalar('install')
  await e.instalar('activate')
  const cache = (await e.caches.keys())[0]

  // Si el servidor devuelve un error, ese error no puede pasar a ser la
  // pantalla de arranque de la siguiente visita sin conexion.
  const r = await e.pedir({ url: `${ORIGEN}/no-existe`, mode: 'navigate' })
  igual(r!.status, 404, 'propaga el 404 del servidor')
  igual(
    e.caches.entrada(cache, '/index.html'),
    htmlEnDisco,
    'un 404 no machaca el index.html guardado',
  )
}

console.log('\nNavegacion SIN conexion')

{
  const e = new Entorno()
  await e.instalar('install')
  await e.instalar('activate')

  await e.pedir({ url: `${ORIGEN}/`, mode: 'navigate' })

  RED.activa = false
  const r = await e.pedir({ url: `${ORIGEN}/`, mode: 'navigate' })
  RED.activa = true

  ok(r !== null && r.ok, 'sin red responde con la copia guardada en lugar de un error')
  igual(r!.cuerpo, htmlEnDisco, 'la copia guardada es la pagina de la app')
  ok(r!.cuerpo.includes('<div id="root">'), 'la copia guardada trae el contenedor de la app')

  const global = await e.caches.match(`${ORIGEN}/index.html`)
  ok(global !== undefined, 'la entrada se encuentra tambien con caches.match global')
}

console.log('\nNavegacion con la red COLGADA')

{
  const e = new Entorno()
  await e.instalar('install')
  await e.instalar('activate')

  // Con conexion, para quedarse con una copia guardada de esta misma version.
  await e.pedir({ url: `${ORIGEN}/`, mode: 'navigate' })

  RED.colgada = true
  const t0 = Date.now()
  const r = await e.pedir({ url: `${ORIGEN}/`, mode: 'navigate' })
  const pasado = Date.now() - t0
  RED.colgada = false

  ok(r !== null && r.ok, 'una red que no responde NO deja la app sin abrir')
  igual(r!.cuerpo, htmlEnDisco, 'sale la copia guardada, no una pantalla de error')
  ok(r!.cuerpo.includes('<div id="root">'), 'la copia guardada trae el contenedor de la app')

  // El fallo era justo que no se llamaba: sin plazo, esta promesa no resolvia nunca
  // y la prueba se quedaba colgada en lugar de fallar. Ahora tiene que responder.
  const plazo = Number(/const ESPERA_RED_MS = ([\d.e+]+)/.exec(codigo)?.[1] ?? '3000')
  ok(plazo > 0 && plazo <= 10000, 'el plazo de red es corto', `${plazo} ms`)
  ok(
    pasado < plazo + 2000,
    'responde pasado el plazo, sin colgarse hasta que el sistema se rinde',
    `${pasado} ms`,
  )
}

console.log('\nCoherencia entre versiones')

{
  RED.activa = true
  const e = new Entorno()

  // El navegador tiene la version vieja Y se instala la nueva al mismo tiempo.
  // La vieja se crea primero, que es justo el orden que fazia que `caches.match`
  // global devolviera la copia antigua.
  const vieja = await e.caches.open('assets-vieja-antigua')
  await vieja.put(`${ORIGEN}/index.html`, respuesta('VERSION VIEJA'))

  await e.instalar('install')
  await e.instalar('activate')

  const cacheNueva = (await e.caches.keys()).find((c) => c !== 'assets-vieja-antigua')
  ok(cacheNueva !== undefined, 'la cache nueva convive con la vieja hasta que se acepta', (await e.caches.keys()).join(', '))

  const guardadaEnNueva = e.caches.entrada(cacheNueva!, '/index.html')!

  RED.activa = false
  const r = await e.pedir({ url: `${ORIGEN}/`, mode: 'navigate' })
  RED.activa = true

  ok(!r!.cuerpo.includes('VERSION VIEJA'), 'sin red NO devuelve la copia de una cache anterior')
  igual(r!.cuerpo, guardadaEnNueva, 'devuelve la copia de la cache de ESTA version')
}

console.log('\nRecursos con hash')

{
  const e = new Entorno()
  await e.instalar('install')
  const cache = (await e.caches.keys())[0]
  const asset = assets.find((u) => /index-.*\.js$/.test(u))!

  RED.activa = false
  const r = await e.pedir({ url: `${ORIGEN}${asset}` })
  RED.activa = true

  ok(r !== null && r.ok, 'el bundle precargado se sirve sin conexion')
  ok(r!.cuerpo === readFileSync(join(RAIZ, 'dist', asset), 'utf8'), 'sirve el archivo exacto del build')
  ok(e.caches.entrada(cache, asset) !== undefined, 'los assets quedan en la cache')
}

console.log('\nLo que no debe pasar por la cache')

{
  const e = new Entorno()
  await e.instalar('install')
  await e.instalar('activate')

  ok((await e.pedir({ url: `${ORIGEN}/privado`, method: 'POST' })) === null, 'una escritura va directa a la red')
  ok((await e.pedir({ url: 'https://otro-sitio.test/dato.js' })) === null, 'un origen externo no se cachea')
}

console.log('\nActivacion bajo demanda')

{
  const e = new Entorno()
  await e.instalar('install')
  await e.instalar('activate')
  const antes = e.saltados

  await e.instalar('message', { data: 'otro-caso' })
  igual(e.saltados, antes, 'un mensaje que no es skip-waiting no activa nada')

  await e.instalar('message', { data: 'skip-waiting' })
  igual(e.saltados, antes + 1, 'skip-waiting activa la version que esperaba')
}

console.log(`\n${fallos === 0 ? 'TODO CORRECTO' : `${fallos} FALLOS de ${total}`}\n`)
process.exit(fallos === 0 ? 0 : 1)