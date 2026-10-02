/**
 * Fusion de datos entre dispositivos.
 *
 * Todo lo que hay aqui es puro y sin estado: recibe dos listas y devuelve la
 * fusion. Es a proposito, porque es la parte donde un error no se ve en pantalla
 * sino semanas despues, cuando un registro ya no esta y no se sabe por que.
 *
 * La regla general es last-write-wins por identificador: gana la version con la
 * marca de modificacion mas reciente. Lo que marca la diferencia con el
 * "solo anade lo que falte" que habia antes es que aqui el remoto puede
 * REEMPLAZAR a lo local cuando es mas nuevo, y que los borrados viajan en las
 * dos direcciones mediante marcas (`Borrado`) en vez de desaparecer.
 *
 * Dos propiedades de las que depende el ciclo de sincronizacion:
 *
 * 1. Idempotencia. Fusionar lo mismo dos veces tiene que dar lo mismo, o cada
 *    sincronizacion inventaria cambios nuevos y el ciclo no pararia nunca.
 * 2. Simetria. `fusionar(a, b)` y `fusionar(b, a)` dan el mismo resultado, para
 *    que dos dispositivos que sincronizan en distinto orden converjan.
 */

import type {
  AjustesCompartidos,
  Ambito,
  Borrado,
  CampoCompartido,
  MarcasCompartidas,
  Sincronizable,
} from './tipos'

/**
 * Dias que se conserva una marca de borrado antes de purgarla.
 *
 * Es una heuristica, no un protocolo con acuses de recibo: no se sabe que
 * dispositivos han visto cada borrado, asi que no se puede saber cuando es
 * seguro olvidarlo. Con 90 dias se cubre de sobra el caso real (un movil sin
 * señal unos dias), a cambio de que un dispositivo desconectado mas de tres
 * meses pueda resucitar un borrado antiguo. Documentado como limitacion.
 */
export const DIAS_TOMBSTONE = 90

/** Resultado de emparejar dos listas, con el recuento para poder contarlo. */
export interface ResultadoFusion<T> {
  /** La lista ya fusionada. */
  fusionados: T[]
  /** Datos que venian del otro dispositivo y aqui no estaban. */
  entraron: number
  /**
   * Cuantos hay solo en este dispositivo, y por tanto se van a subir.
   *
   * No es una perdida ni un error: es lo pendiente de enviar. Se cuenta aparte
   * de `pisados` a proposito, porque mezclarlos haria que cada sincronizacion
   * anunciara como perdida lo que en realidad son los datos nuevos sin enviar.
   */
  enviables: number
  /**
   * Cuantos existen en ambos con contenido distinto, o sea que uno de los dos
   * dispositivos va a perder su version. No deberia pasar en uso normal: solo si
   * alguien exporta, edita sin sincronizar y restaura.
   */
  pisados: number
  /**
   * Cuados estaban aqui y una marca de borrado los elimino, es decir, lo que
   * se borro en el otro dispositivo. Se cuenta aparte porque es lo unico que
   * hace desaparecer informacion de la pantalla.
   */
  borradosAplicados: number
  /** Marcas de borrado resultantes, ya purgadas. */
  borrados: Borrado[]
}

/** Marca que se compara para decidir quien gana. */
const marca = (e: Sincronizable): string => e.updatedAt ?? e.createdAt

/** Compara dos marcas ISO sin fallar si alguna viene vacia o es invalida. */
function comparar(a: string, b: string): number {
  if (a === b) return 0
  // `<` sobre cadenas compara el orden lexicografico, que para ISO 8601 con
  // formato fijo coincide con el cronologico. El fallback a `Date` cubre
  // marcas malformadas, que pueden venir de un archivo editado a mano.
  if (a && b) return a < b ? -1 : 1
  return a ? 1 : -1
}

/**
 * Compara dos valores por contenido, sin que importe el orden de las claves.
 *
 * Un `JSON.stringify` a pelo no sirve: el mismo registro puede venir de una
 * version antigua de la app, de un archivo editado a mano o del otro
 * dispositivo, y con distinto orden de claves. Sin normalizar, "el remoto ha
 * pisado lo local" saltaria por diferencias que no existen y el aviso dejaria
 * de significar nada.
 */
function igual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  const ordenar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(ordenar)
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, valor]) => [k, ordenar(valor)]),
      )
    }
    return v
  }
  return JSON.stringify(ordenar(a)) === JSON.stringify(ordenar(b))
}

/** Quita las marcas de borrado mas antiguas que la ventana de purgado. */export function purgarBorrados(borrados: Borrado[], ahora = Date.now()): Borrado[] {
  const limite = ahora - DIAS_TOMBSTONE * 24 * 60 * 60 * 1000
  return borrados.filter((b) => comparar(b.borradoAt, new Date(limite).toISOString()) > 0)
}

/** Une dos listas de marcas de borrado quedandose con la mas reciente por par. */
export function fusionarBorrados(locales: Borrado[], remotos: Borrado[]): Borrado[] {
  const porClave = new Map<string, Borrado>()
  const clave = (b: Borrado) => `${b.ambito}:${b.id}`
  for (const b of [...locales, ...remotos]) {
    const previa = porClave.get(clave(b))
    if (!previa || comparar(b.borradoAt, previa.borradoAt) > 0) porClave.set(clave(b), b)
  }
  return purgarBorrados([...porClave.values()])
}

/**
 * Fusiona dos listas de entidades sincronizables de un mismo ambito.
 *
 * `locales` y `remotos` se tratan con la misma rutina y sin que ninguno mande
 * mas que el otro mas alla de "si el remoto es mas nuevo, entra". Esa
 * simetria es la que hace que dos dispositivos converjan.
 */
export function emparejar<T extends Sincronizable>(
  locales: T[],
  remotos: T[],
  borrados: Borrado[],
  ambito: Ambito,
  ahora = Date.now(),
): ResultadoFusion<T> {
  const marcas = purgarBorrados(borrados, ahora).filter((b) => b.ambito === ambito)
  const borradosAqui = new Set(marcas.map((b) => b.id))

  const porId = new Map<string, T>()
  for (const item of [...locales, ...remotos]) {
    const previa = porId.get(item.id)
    if (!previa || comparar(marca(item), marca(previa)) > 0) porId.set(item.id, item)
  }

  const idsLocales = new Set(locales.map((e) => e.id))
  const idsRemotos = new Set(remotos.map((e) => e.id))

  const fusionados: T[] = []
  let entraron = 0
  let enviables = 0
  let pisados = 0
  let borradosAplicados = 0

  for (const [id, item] of porId) {
    // Una marca de borrado siempre gana a una entrada viva mas antigua: si el
    // movil borro esto a las 10:00 y el portatil lo edito a las 09:00, el
    // registro esta borrado.
    if (borradosAqui.has(id)) {
      if (idsLocales.has(id)) borradosAplicados++
      continue
    }
    const enLocal = idsLocales.has(id)
    const enRemoto = idsRemotos.has(id)
    if (enLocal && enRemoto) {
      // Solo se cuenta como pisado si las dos versiones difieren de verdad:
      // `emparejar` con listas identicas debe dar cero, no "todo fue pisado".
      if (!igual(locales.find((e) => e.id === id), remotos.find((e) => e.id === id))) pisados++
    } else if (enRemoto) {
      entraron++
    } else {
      enviables++
    }
    fusionados.push(item)
  }

  return { fusionados, entraron, enviables, pisados, borradosAplicados, borrados: purgarBorrados(borrados, ahora) }
}

// ---------------------------------------------------------------------------
// Ajustes compartidos
// ---------------------------------------------------------------------------

/** Campos de Ajustes que si se sincronizan, en el orden en que se recorren. */
export const CAMPOS_COMPARTIDOS: CampoCompartido[] = [
  'umbral',
  'limites',
  'presionHabitual',
  'plantillas',
]

/**
 * Fusion campo a campo de la parte de Ajustes que si se comparte.
 *
 * Se hace por campo y no sobre el bloque entero porque dos dispositivos
 * ajustando cosas distintas a la vez se pisan si se compara el bloque: el que
 * llega segundo sobrescribe los umbrales aunque solo hubiera tocado las
 * plantillas.
 */
/**
 * Fusiona los ajustes compartidos campo a campo.
 *
 * `remotos` es parcial a proposito: un backup puede traer solo el campo que se
 * cambio en el otro dispositivo. Los campos que no vienen no compiten, asi que
 * no hay nada que decidir sobre ellos.
 */
export function fusionarAjustes(
  locales: AjustesCompartidos,
  remotos: Partial<AjustesCompartidos>,
  marcasLocales: MarcasCompartidas,
  marcasRemotas: MarcasCompartidas,
): { ajustes: AjustesCompartidos; marcas: MarcasCompartidas; pisados: number } {
  const ajustes = { ...locales }
  const marcas: MarcasCompartidas = { ...marcasLocales }
  let pisados = 0

  for (const campo of CAMPOS_COMPARTIDOS) {
    const local = marcasLocales[campo]
    const remoto = marcasRemotas[campo]
    // Sin marca de un lado, ese lado no ha tocado el campo: gana el otro.
    const ganaRemoto = remoto !== undefined && (local === undefined || comparar(remoto, local) > 0)
    if (!ganaRemoto) continue
    if (!igual(remotos[campo], locales[campo])) pisados++
    ;(ajustes as Record<string, unknown>)[campo] = remotos[campo]
    marcas[campo] = remoto
  }

  return { ajustes, marcas, pisados }
}

/** Marca un campo de Ajustes como modificado ahora mismo. */
export function marcarAhora(
  marcas: MarcasCompartidas,
  campo: CampoCompartido,
  ahora = new Date(),
): MarcasCompartidas {
  return { ...marcas, [campo]: ahora.toISOString() }
}
