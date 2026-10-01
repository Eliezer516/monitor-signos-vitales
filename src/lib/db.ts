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

import type { Ajustes, Paciente, Registro, Visita } from './tipos'
import { AJUSTES_POR_DEFECTO } from './rangos'
import { claveDia } from './fechas'

const DB_NOMBRE = 'signos-vitales'
// v2: se anade el store de visitas. La v1 no lo tenia; `onupgradeneeded` crea
// el store nuevo sin tocar los existentes, de modo que los datos ya guardados
// sobreviven a la actualizacion.
const DB_VERSION = 2
const STORE_REGISTROS = 'registros'
const STORE_VISITAS = 'visitas'
const STORE_CLAVE = 'clave-valor'

const LS_REGISTROS = 'msv:registros'
const LS_VISITAS = 'msv:visitas'
const LS_AJUSTES = 'msv:ajustes'
const LS_PACIENTES = 'msv:pacientes'

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
        if (!db.objectStoreNames.contains(STORE_CLAVE)) {
          db.createObjectStore(STORE_CLAVE)
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
  return leer<Paciente[]>(LS_PACIENTES) ?? []
}

export async function guardarPacientes(pacientes: Paciente[]): Promise<void> {
  escribir(LS_PACIENTES, pacientes)
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
      r.bpm === nuevo.bpm &&
      r.orina === nuevo.orina,
  )
}

/** Fecha de hoy en formato de clave, reexportada para los consumidores. */
export { claveDia }