/**
 * Persistencia local.
 *
 * Estrategia: IndexedDB como almacen principal (soporta muchos registros sin
 * bloquear el hilo principal) y localStorage como espejo de respaldo. Si
 * IndexedDB no esta disponible (modo privado de Safari, permisos negados), la
 * app sigue funcionando escribiendo solo a localStorage.
 *
 * Los datos de salud nunca salen del dispositivo: no hay backend ni Analytic.
 */

import type { Ajustes, Ambito, Borrado, MarcasCompartidas, Paciente, Registro, Sonda, Visita } from './tipos'
import { AJUSTES_POR_DEFECTO } from './rangos'
import { claveDia } from './fechas'
import { fusionarBorrados as fusionarBorradosLocales } from './fusion'

const DB_NOMBRE = 'signos-vitales'
// v2: se anade el store de visitas.
// v3: se anade el store de borrados, que guarda las marcas de lo que se borro
// en cualquier dispositivo para que el borrado tambien viaje al sincronizar.
// v4: se anade el store de sondas, que guarda los vaciados de la bolsa. Es un
// store propio y no un campo de registros porque la sonda se vacia cuando toca,
// no cuando se mide la tension.
// Las versiones anteriores no tenian estos stores; `onupgradeneeded` crea los
// stores nuevos sin tocar los existentes, de modo que los datos ya guardados
// sobreviven a la actualizacion.
const DB_VERSION = 4
const STORE_REGISTROS = 'registros'
const STORE_VISITAS = 'visitas'
const STORE_SONDAS = 'sondas'
const STORE_BORRADOS = 'borrados'
const STORE_CLAVE = 'clave-valor'

const LS_REGISTROS = 'msv:registros'
const LS_VISITAS = 'msv:visitas'
const LS_SONDAS = 'msv:sondas'
const LS_AJUSTES = 'msv:ajustes'
const LS_PACIENTES = 'msv:pacientes'
const LS_BORRADOS = 'msv:borrados'
const LS_MARCAS = 'msv:marcas-compartidas'

/** Lee y parsea JSON de localStorage devolviendo `null` ante cualquier error. */
function leer<T>(clave: string): T | null {
  try {
    const bruto = localStorage.getItem(clave)
    return bruto ? (JSON.parse(bruto) as T) : null
  } catch {
    return null
  }
}

function escribir(clave: string, valor: unknown): boolean {
  try {
    localStorage.setItem(clave, JSON.stringify(valor))
    return true
  } catch {
    // Cuota excedida: no es recuperable aqui, pero tampoco debe romper la app.
    return false
  }
}

/** Identificador unico, compatible con navegadores sin `randomUUID`. */
export function nuevoId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------

let promesaDB: Promise<IDBDatabase | null> | null = null

/** Abre la base de datos una sola vez y reutiliza la promesa. */
function abrirDB(): Promise<IDBDatabase | null> {
  if (promesaDB) return promesaDB
  promesaDB = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    try {
      const req = indexedDB.open(DB_NOMBRE, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_REGISTROS)) {
          const store = db.createObjectStore(STORE_REGISTROS, { keyPath: 'id' })
          // Indices para consultas por dia y por paciente sin recorrer todo.
          store.createIndex('fecha', 'fecha')
          store.createIndex('createdAt', 'createdAt')
        }
        if (!db.objectStoreNames.contains(STORE_VISITAS)) {
          const store = db.createObjectStore(STORE_VISITAS, { keyPath: 'id' })
          store.createIndex('fecha', 'fecha')
          store.createIndex('createdAt', 'createdAt')
        }
        if (!db.objectStoreNames.contains(STORE_SONDAS)) {
          const store = db.createObjectStore(STORE_SONDAS, { keyPath: 'id' })
          store.createIndex('fecha', 'fecha')
          store.createIndex('createdAt', 'createdAt')
        }
        if (!db.objectStoreNames.contains(STORE_CLAVE)) {
          db.createObjectStore(STORE_CLAVE)
        }
        if (!db.objectStoreNames.contains(STORE_BORRADOS)) {
          // Clave compuesta ambito+id: un mismo id puede existir en registros y
          // en visitas sin que un borrado de uno arrase al otro.
          db.createObjectStore(STORE_BORRADOS, {
            keyPath: ['ambito', 'id'],
          })
        }
      }
      req.onsuccess = () => {
        const db = req.result
        // Si otra pestana pide una version superior, liberamos la conexion.
        db.onversionchange = () => db.close()
        resolve(db)
      }
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return promesaDB
}

/** Indica si IndexedDB esta realmente disponible. */
export async function indexedDBDisponible(): Promise<boolean> {
  return (await abrirDB()) !== null
}

function transaccion<T>(
  db: IDBDatabase,
  store: string,
  modo: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, modo)
    const req = fn(tx.objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ---------------------------------------------------------------------------
// Registros
// ---------------------------------------------------------------------------

/** Carga todos los registros, de IndexedDB o de localStorage como respaldo. */
export async function cargarRegistros(): Promise<Registro[]> {
  const db = await abrirDB()
  if (db) {
    try {
      const registros = await transaccion<Registro[]>(db, STORE_REGISTROS, 'readonly', (s) =>
        s.getAll(),
      )
      // El espejo permite arrancar al instante y cubre bases recien creadas.
      const espejo = leer<Registro[]>(LS_REGISTROS)
      if (espejo && espejo.length > registros.length) {
        void guardarRegistros(espejo)
        return ordenar(espejo)
      }
      return ordenar(registros)
    } catch {
      // Si IndexedDB falla a mitad, usamos el espejo.
    }
  }
  return ordenar(leer<Registro[]>(LS_REGISTROS) ?? [])
}

/**
 * Guarda la lista completa. Se escribe siempre el espejo en localStorage para
 * tener una segunda copia recuperable si la base se corrompe.
 */
export async function guardarRegistros(registros: Registro[]): Promise<void> {
  escribir(LS_REGISTROS, registros)
  await guardarLista(STORE_REGISTROS, registros)
}

// ---------------------------------------------------------------------------
// Visitas
// ---------------------------------------------------------------------------

/** Carga las visitas, de IndexedDB o del espejo en localStorage. */
export async function cargarVisitas(): Promise<Visita[]> {
  const db = await abrirDB()
  if (db) {
    try {
      const visitas = await transaccion<Visita[]>(db, STORE_VISITAS, 'readonly', (s) => s.getAll())
      const espejo = leer<Visita[]>(LS_VISITAS)
      if (espejo && espejo.length > visitas.length) {
        void guardarVisitas(espejo)
        return ordenarVisitas(espejo)
      }
      return ordenarVisitas(visitas)
    } catch {
      // Si IndexedDB falla a mitad, usamos el espejo.
    }
  }
  return ordenarVisitas(leer<Visita[]>(LS_VISITAS) ?? [])
}

export async function guardarVisitas(visitas: Visita[]): Promise<void> {
  escribir(LS_VISITAS, visitas)
  await guardarLista(STORE_VISITAS, visitas)
}

// ---------------------------------------------------------------------------
// Sondas
// ---------------------------------------------------------------------------

/** Carga las sondas, de IndexedDB o del espejo en localStorage. */
export async function cargarSondas(): Promise<Sonda[]> {
  const db = await abrirDB()
  if (db) {
    try {
      const sondas = await transaccion<Sonda[]>(db, STORE_SONDAS, 'readonly', (s) => s.getAll())
      const espejo = leer<Sonda[]>(LS_SONDAS)
      if (espejo && espejo.length > sondas.length) {
        void guardarSondas(espejo)
        return ordenarSondas(espejo)
      }
      return ordenarSondas(sondas)
    } catch {
      // Si IndexedDB falla a mitad, usamos el espejo.
    }
  }
  return ordenarSondas(leer<Sonda[]>(LS_SONDAS) ?? [])
}

export async function guardarSondas(sondas: Sonda[]): Promise<void> {
  escribir(LS_SONDAS, sondas)
  await guardarLista(STORE_SONDAS, sondas)
}

/** Ordena por fecha y hora descendentes: el ultimo vaciado primero. */
export function ordenarSondas(sondas: Sonda[]): Sonda[] {
  return [...sondas].sort((a, b) =>
    a.fecha === b.fecha ? b.hora.localeCompare(a.hora) : b.fecha.localeCompare(a.fecha),
  )
}

/**
 * Ordena por fecha y hora descendentes: lo mas reciente primero.
 *
 * Una visita sin hora queda al final de su dia, no al principio: se esta
 * ordenando de lo mas reciente a lo mas antiguo y no consta cuando ocurrio, asi
 * que se coloca donde menos implica que fue lo primero que paso.
 */
export function ordenarVisitas(visitas: Visita[]): Visita[] {
  return [...visitas].sort((a, b) =>
    a.fecha === b.fecha
      ? (b.hora ?? '').localeCompare(a.hora ?? '')
      : b.fecha.localeCompare(a.fecha),
  )
}

/** Reescribe un store completo: primero se limpia y luego se inserta cada fila. */
async function guardarLista<T>(store: string, filas: T[]): Promise<void> {
  const db = await abrirDB()
  if (!db) return
  try {
    const tx = db.transaction(store, 'readwrite')
    const s = tx.objectStore(store)
    s.clear()
    for (const fila of filas) s.put(fila)
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } catch {
    // El espejo en localStorage ya garantiza que no se pierdan datos.
  }
}

// ---------------------------------------------------------------------------
// Borrados
// ---------------------------------------------------------------------------

/**
 * Marcas de lo que se ha borrado, que son las que hacen que el borrado viaje al
 * otro dispositivo en vez de reaparecer.
 *
 * A diferencia de `cargarRegistros`, aqui no se compara el espejo por longitud.
 * Alli "la lista mas larga es la buena" porque son los mismos registros. Una
 * lista de borrados mas corta puede ser la correcta (hemos purgado marcas
 * antiguas) y una mas larga tambien, asi que la longitud no dice nada: manda
 * IndexedDB y el espejo solo se usa si la base no esta disponible.
 */
export async function cargarBorrados(): Promise<Borrado[]> {
  const db = await abrirDB()
  if (db) {
    try {
      return await transaccion<Borrado[]>(db, STORE_BORRADOS, 'readonly', (s) => s.getAll())
    } catch {
      // Si IndexedDB falla a mitad, usamos el espejo.
    }
  }
  return leer<Borrado[]>(LS_BORRADOS) ?? []
}

export async function guardarBorrados(borrados: Borrado[]): Promise<void> {
  escribir(LS_BORRADOS, borrados)
  await guardarLista(STORE_BORRADOS, borrados)
}

/**
 * Anota un borrado sin tocar el almacen desde los contextos.
 *
 * Se expone por separado de `eliminar` porque cada contexto borra su propio
 * almacen, pero la marca va al mismo sitio para que `lib/fusion` pueda reunir
 * los tres ambitos en un solo paquete.
 */
export async function registrarBorrado(ambito: Ambito, id: string): Promise<Borrado[]> {
  const actuales = await cargarBorrados()
  const otros = actuales.filter((b) => !(b.ambito === ambito && b.id === id))
  const marca: Borrado = { ambito, id, borradoAt: new Date().toISOString() }
  const siguiente = [...otros, marca]
  await guardarBorrados(siguiente)
  return siguiente
}

/**
 * Une los borrados que llegan de fuera (de la replica o de un backup) con los que ya
 * hay y deja el resultado escrito.
 *
 * Va en `db.ts` y no en los contextos por dos motivos:
 *
 * - Los tres ambitos comparten el mismo store, asi que hay que leer lo que hay
 *   de verdad. Si cada contexto fusionara contra su propia copia en memoria,
 *   el segundo en fusionar taparia al primero y se perderian marcas.
 * - Leer y guardar por separado deja un hueco entre medias. Si en ese hueco
 *   borra otra cosa, ese borrado se perderia al escribir la lista entera.
 *
 * Devuelve la lista unida ya persistida, que es la que hay que usar para
 * limpiar registros, visitas o pacientes.
 */
export async function fusionarBorradosGuardados(entrantes: Borrado[]): Promise<Borrado[]> {
  const actuales = await cargarBorrados()
  if (entrantes.length === 0) return actuales
  const unidas = fusionarBorradosLocales(actuales, entrantes)
  await guardarBorrados(unidas)
  return unidas
}

// ---------------------------------------------------------------------------
// Ajustes y pacientes
// ---------------------------------------------------------------------------

/** Ajustes guardados, fusionados con los valores por defecto. */
export async function cargarAjustes(): Promise<Ajustes> {
  const db = await abrirDB()
  let guardados: Partial<Ajustes> | null = null
  if (db) {
    try {
      guardados = await transaccion<Partial<Ajustes>>(db, STORE_CLAVE, 'readonly', (s) =>
        s.get(LS_AJUSTES),
      )
    } catch {
      guardados = null
    }
  }
  if (!guardados) guardados = leer<Partial<Ajustes>>(LS_AJUSTES)
  return {
    ...AJUSTES_POR_DEFECTO,
    ...(guardados ?? {}),
    // Los sub-objetos se fusionan aparte para no perder claves nuevas.
    umbral: { ...AJUSTES_POR_DEFECTO.umbral, ...(guardados?.umbral ?? {}) },
    limites: { ...AJUSTES_POR_DEFECTO.limites, ...(guardados?.limites ?? {}) },
    // Si la app se actualiza y aparece una clave nueva dentro de un sub-objeto,
    // la fusion aporta el valor por defecto en lugar de `undefined`.
    presionHabitual: { ...AJUSTES_POR_DEFECTO.presionHabitual, ...(guardados?.presionHabitual ?? {}) },
    recordatorio: { ...AJUSTES_POR_DEFECTO.recordatorio, ...(guardados?.recordatorio ?? {}) },
    plantillas: guardados?.plantillas?.length ? guardados.plantillas : AJUSTES_POR_DEFECTO.plantillas,
  }
}

export async function guardarAjustes(ajustes: Ajustes): Promise<void> {
  escribir(LS_AJUSTES, ajustes)
  const db = await abrirDB()
  if (!db) return
  try {
    await transaccion(db, STORE_CLAVE, 'readwrite', (s) => s.put(ajustes, LS_AJUSTES))
  } catch {
    // localStorage ya tiene la copia.
  }
}

export async function cargarPacientes(): Promise<Paciente[]> {
  return (leer<Paciente[]>(LS_PACIENTES) ?? []).map(normalizarPaciente)
}

export async function guardarPacientes(pacientes: Paciente[]): Promise<void> {
  escribir(LS_PACIENTES, pacientes)
}

/**
 * Los pacientes se guardaban con `creadoAt` mientras que registros y visitas
 * usaban `createdAt`. Al unificarlos en `Sincronizable` hay que traducir el
 * nombre, y aprovechar para rellenar `createdAt` de los que vinieron de una
 * version todavia mas antigua, que no tenian ninguna marca.
 */
export function normalizarPaciente(p: Paciente): Paciente {
  const { creadoAt, ...resto } = p as Paciente & { creadoAt?: string }
  return {
    ...resto,
    createdAt: p.createdAt ?? creadoAt ?? '1970-01-01T00:00:00.000Z',
    // Sin el campo (datos anteriores a esta version) la sonda se considera
    // activa: es la opcion que no hace desaparecer una seccion que ya se usaba.
    sonda: p.sonda ?? true,
  }
}

/**
 * Ultima modificacion de cada campo de Ajustes que si se comparte.
 *
 * Se guarda aparte del propio valor para no meter `updatedAt` dentro de
 * `Umbrales` ni de `Limites`, que tambien los usan los reportes y las pruebas
 * como estructuras de datos planas.
 */
export function cargarMarcas(): MarcasCompartidas {
  return leer<MarcasCompartidas>(LS_MARCAS) ?? {}
}

export function guardarMarcas(marcas: MarcasCompartidas): void {
  escribir(LS_MARCAS, marcas)
}

/** Ordena por fecha y hora descendentes: lo mas reciente primero. */
export function ordenar(registros: Registro[]): Registro[] {
  return [...registros].sort((a, b) =>
    a.fecha === b.fecha
      ? b.hora.localeCompare(a.hora)
      : b.fecha.localeCompare(a.fecha),
  )
}

/** Marca los registros sin `createdAt` para que datos viejos sigan ordenando. */
export function normalizarRegistro(r: Registro): Registro {
  return { ...r, createdAt: r.createdAt ?? `${r.fecha}T${r.hora}:00` }
}

/**
 * Compara un registro nuevo con los existentes y descarta duplicados.
 * El flujo tipico de registro rapido es "Ahora -> Guardar" y pulsar dos veces
 * crearia dos filas identicas; aqui se evita sin intervención del usuario.
 */
export function esDuplicado(nuevo: Registro, existentes: Registro[]): boolean {
  return existentes.some(
    (r) =>
      r.fecha === nuevo.fecha &&
      r.hora === nuevo.hora &&
      r.presionSis === nuevo.presionSis &&
      r.presionDia === nuevo.presionDia &&
      r.o2 === nuevo.o2 &&
      r.bpm === nuevo.bpm,
  )
}

/** Fecha de hoy en formato de clave, reexportada para los consumidores. */
export { claveDia }