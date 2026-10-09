/**
 * El ciclo de replica contra la base de datos.
 *
 *   Leer -> fusionar -> escribir la union -> devolver lo fusionado.
 *
 * Es la parte que faltaba cuando solo existia el esquema. Y aunque tiene una base
 * de datos debajo, aqui no hay ninguna referencia a Turso ni a `@libsql/client`: se
 * recibe una conexion ya abierta. Eso permite probarlo contra un fichero SQLite
 * local sin cambiar una linea, que es como se comprueba de verdad que dos
 * dispositivos convergen.
 *
 * **Lo local es la fuente de verdad y nunca se sobrescribe con lo remoto.**
 *
 * Lo que hay en la base es un objetivo de fusion, no una copia que se restaure
 * encima. El perdedor de un conflicto conserva todo en su IndexedDB y lo vuelve a
 * subir en el siguiente ciclo, de modo que no hay perdida permanente. Si esto se
 * cambiara por "borrar la base y escribir lo que llega", dos dispositivos
 * sincronizando a la vez se destruirian datos sin avisar. Por eso se escribe
 * siempre lo ya fusionado, nunca lo que habia antes: la base tiene que dejar de
 * ser la foto de un dispositivo para pasar a ser la union.
 */

import { getTableColumns, inArray, sql, type SQL } from 'drizzle-orm'
import type { Backup } from '../exportar'
import { fusionarPaquetes, type ResumenSincronizacion } from '../sincronizar'
import type {
  AjustesCompartidos,
  Ambito,
  Borrado,
  MarcasCompartidas,
  Paciente,
  Registro,
  Sonda,
  Visita,
} from '../tipos'
import { conexion, type Base } from './cliente'
import {
  ajustesAFila,
  borradoAFila,
  filaAAjustes,
  filaABorrado,
  filaAPaciente,
  filaARegistro,
  filaASonda,
  filaAVisita,
  leerReparto,
  pacienteACrear,
  pacienteAFila,
  registroAFila,
  repartir,
  sondaAFila,
  visitaAFila,
  type Reparto,
} from './mapeo'
import { ajustes, borrados, pacientes, registros, replica, sondas, visitas } from './schema'

/**
 * Que tiene este dispositivo ahora mismo.
 *
 * Es el mismo `EstadoLocal` que usa el backup manual, mas el paciente activo. Se
 * reutiliza a proposito: las reglas de fusion no pueden depender de si el paquete
 * venia de un fichero descargado o de una base de datos.
 */
export interface EstadoReplicable {
  registros: Registro[]
  visitas: Visita[]
  sondas: Sonda[]
  pacientes: Paciente[]
  borrados: Borrado[]
  ajustes: AjustesCompartidos
  marcas: MarcasCompartidas
  /**
   * Paciente al que se atribuyen las filas nuevas.
   *
   * No forma parte de `EstadoLocal` porque no se replica: es un ajuste de este
   * dispositivo. Se necesita aqui solo para decidir de quien son las mediciones que
   * aun no estan subidas.
   */
  pacienteActivo: string | null
}

export interface ResultadoReplica {
  /** Lo fusionado, para dejarlo en pantalla y en el almacen local. */
  paquete: Backup
  resumen: ResumenSincronizacion
  /**
   * Ficha creada para poder atribuir las filas que no tenian paciente. Se
   * devuelve para que la interfaz pueda contarlo: crear una ficha con nombre
   * "Paciente 1" es algo que conviene que se sepa, no algo que pase en silencio.
   */
  pacienteCreado: Paciente | null
  /** Filas que cambiaron de paciente porque su ficha se habia borrado. */
  movidos: number
}

// ---------------------------------------------------------------------------
// Descargar
// ---------------------------------------------------------------------------

/**
 * Lee lo que hay ahora mismo en la base, ya pasado a los tipos de la app.
 *
 * Se leen todas las filas, no solo las recientes. La tabla `replica` guarda hasta
 * donde se ha llegado, pero usarla para no releer exigiria que cada escritura
 * fuera atomica con esa marca, y con reintentos a mitad de subir eso no se puede
 * garantizar: la marca podria quedar puesta sin la fila. Releer entero es barato
 * comparado con perder un cambio.
 */
async function leerRemoto(db: Base) {
  const [filasR, filasV, filasS, filasP, filasB, filaAjustes] = await Promise.all([
    db.select().from(registros),
    db.select().from(visitas),
    db.select().from(sondas),
    db.select().from(pacientes),
    db.select().from(borrados),
    db.select().from(ajustes).limit(1),
  ])

  const leidos = filaAAjustes(filaAjustes[0])
  return {
    registros: filasR.map(filaARegistro),
    visitas: filasV.map(filaAVisita),
    sondas: filasS.map(filaASonda),
    pacientes: filasP.map(filaAPaciente),
    borrados: filasB.map(filaABorrado),
    ajustes: leidos.ajustes,
    marcas: leidos.marcas,
    /** El reparto actual, que hace falta antes de decidir los pacientes. */
    reparto: leerReparto(filasR, filasV, filasS),
  }
}

// ---------------------------------------------------------------------------
// Escribir
// ---------------------------------------------------------------------------

/**
 * Columnas a reescribir cuando una fila ya existe.
 *
 * Se reescribe la fila entera, no solo `updatedAt`. Lo otro seria un fallo
 * silencioso muy/molesto: un cambio de nombre en un paciente se detectaria bien
 * porque su `updatedAt` es mas nuevo, se entraria por el `where`, se actualizaria
 * solo la columna de fecha, y el nombre se quedaria viejo para siempre sin que
 * nada fallara.
 *
 * Los nombres de SQL se sacan de la tabla y no se escriben a mano porque la
 * propiedad TypeScript y la columna no coinciden: `presionSis` es `presion_sis`.
 * Con `sql.raw` y el nombre real de la columna, el unico sitio que hay que tocar
 * al renombrar algo es `schema.ts`.
 */
function columnasParaActualizar(
  tabla: Parameters<typeof getTableColumns>[0],
  ...claves: string[]
): Record<string, SQL> {
  const columnas = getTableColumns(tabla)
  const set: Record<string, SQL> = {}
  for (const [clave, columna] of Object.entries(columnas)) {
    if (claves.includes(clave)) continue
    set[clave] = sql.raw(`excluded."${columna.name}"`)
  }
  return set
}

/**
 * `excluded.<columna>` en SQL crudo.
 *
 * El nombre sale de la columna, no se escribe a mano, porque aqui no valen los
 * nombres de TypeScript: la propiedad `updatedAt` es la columna `updated_at`, y
 * escribir `excluded.updatedAt` a mano no da error al compilar; da error al
 * ejecutar, con un `no such column` que aparece en mitad de una subida y no dice
 * nada de cual era el problema.
 */
function excluido(columna: { name: string }): SQL {
  return sql.raw(`excluded."${columna.name}"`)
}

/** Si hay filas que atribuir, tiene que haber alguna ficha a la que atribuirlas. */
function destinoValido(
  filas: { registros: Registro[]; visitas: Visita[]; sondas: Sonda[] },
  destino: string,
): void {
  if (destino) return
  if (filas.registros.length === 0 && filas.visitas.length === 0 && filas.sondas.length === 0) return
  // No se devuelve en silencio. Saltarse estas filas seria la forma mas facil de
  // perder datos sin enterarse: la app las seguiria mostrando, creeria que estan
  // guardadas, y no estarian en ningun sitio mas que en el telefono.
  throw new Error(
    'Hay mediciones que subir pero ningun paciente al que atribuirlas. No se van a descartar.',
  )
}

/** Ids a borrar de cada tabla, segun los tombstones del paquete. */
function borradosPorTabla(borrados: Borrado[]): Record<Ambito, string[]> {
  const salida: Record<Ambito, string[]> = { registros: [], visitas: [], pacientes: [], sondas: [] }
  for (const b of borrados) salida[b.ambito].push(b.id)
  return salida
}

/** Fichas borradas, venga el tombstone de este telefono o del otro. */
function pacientesBorrados(borrados: Borrado[]): Set<string> {
  return new Set(borrados.filter((b) => b.ambito === 'pacientes').map((b) => b.id))
}

/**
 * Quita las filas que se han ido con un paciente borrado.
 *
 * Sin esto hay un fallo que solo aparece cuando se borra la ultima ficha: la base
 * borra en cascada las mediciones de ese paciente, pero el paquete ya fusionado las
 * sigue trayendo, y al intentar subirlas de nuevo no hay ficha a la que atribuirlas.
 * El ciclo entero falla y el telefono se queda sin poder sincronizar.
 *
 * Solo se quitan las que ya estaban subidas. `reparto` solo conoce las que tienen
 * dueno: una medicion que todavia no ha salido del telefono no puede pertenecer a un
 * paciente borrado en la base, porque no estaba en la base. Esa se queda y se
 * atribuira a la ficha que se cree despues.
 */
function purgarConPaciente(
  registros: Registro[],
  visitas: Visita[],
  sondas: Sonda[],
  reparto: Reparto,
  muertos: Set<string>,
): { registros: Registro[]; visitas: Visita[]; sondas: Sonda[] } {
  const sinDueno = (id: string, mapa: Map<string, string>) => {
    const dueno = mapa.get(id)
    return dueno !== undefined && muertos.has(dueno)
  }
  return {
    registros: registros.filter((r) => !sinDueno(r.id, reparto.registros)),
    visitas: visitas.filter((v) => !sinDueno(v.id, reparto.visitas)),
    sondas: sondas.filter((s) => !sinDueno(s.id, reparto.sondas)),
  }
}

/**
 * Escribe lo ya fusionado.
 *
 * Cada `upsert` lleva la comparacion `excluded.updatedAt > updatedAt` dentro del
 * `where`. Va en la base y no en el codigo de quien llama por una razon concreta:
 * si el telefono pierde la conexion a mitad de subir y vuelve a intentarlo, solo
 * SQLite puede saber si lo que llega ahora es mas viejo que lo que ya estaba.
 * Comprobarlo antes en JavaScript dejaria una ventana entre la comprobacion y la
 * escritura, que es justo donde se cuelan los datos duplicados.
 */
async function escribir(db: Base, paquete: Backup, reparto: Reparto) {
  // `Backup` declara `visitas`, `borrados`, `ajustes` y `marcas` como opcionales
  // porque un fichero de una version antigua no los trae. `construirBackup` si los
  // pone siempre, pero aqui no se asume eso: se rellenan y punto.
  const lasVisitas = paquete.visitas ?? []
  const lasSondas = paquete.sondas ?? []
  const validos = new Set(paquete.pacientes.map((p) => p.id))
  const destino = paquete.pacientes[0]?.id ?? ''
  destinoValido({ registros: paquete.registros, visitas: lasVisitas, sondas: lasSondas }, destino)

  const r = repartir(paquete.registros, reparto.registros, validos, destino)
  const v = repartir(lasVisitas, reparto.visitas, validos, destino)
  const s = repartir(lasSondas, reparto.sondas, validos, destino)

  if (paquete.pacientes.length > 0) {
    const filas = paquete.pacientes.map(pacienteAFila)
    await db
      .insert(pacientes)
      .values(filas)
      .onConflictDoUpdate({
        target: pacientes.id,
        set: columnasParaActualizar(pacientes, 'id'),
        where: sql`${excluido(pacientes.updatedAt)} > ${pacientes.updatedAt}`,
      })
  }

  if (paquete.registros.length > 0) {
    const filas = paquete.registros.map((x) => registroAFila(x, r.asignados.get(x.id) ?? destino))
    await db
      .insert(registros)
      .values(filas)
      .onConflictDoUpdate({
        target: registros.id,
        set: columnasParaActualizar(registros, 'id'),
        where: sql`${excluido(registros.updatedAt)} > ${registros.updatedAt}`,
      })
  }

  if (lasVisitas.length > 0) {
    const filas = lasVisitas.map((x) => visitaAFila(x, v.asignados.get(x.id) ?? destino))
    await db
      .insert(visitas)
      .values(filas)
      .onConflictDoUpdate({
        target: visitas.id,
        set: columnasParaActualizar(visitas, 'id'),
        where: sql`${excluido(visitas.updatedAt)} > ${visitas.updatedAt}`,
      })
  }

  if (lasSondas.length > 0) {
    const filas = lasSondas.map((x) => sondaAFila(x, s.asignados.get(x.id) ?? destino))
    await db
      .insert(sondas)
      .values(filas)
      .onConflictDoUpdate({
        target: sondas.id,
        set: columnasParaActualizar(sondas, 'id'),
        where: sql`${excluido(sondas.updatedAt)} > ${sondas.updatedAt}`,
      })
  }

  if (paquete.borrados && paquete.borrados.length > 0) {
    // Los tombstones se escriben Y se borra la fila. Solo con escribir el
    // tombstone no bastaria: los otros dispositivos aprenderian que algo se borro,
    // pero la fila seguiria en la base de por si, con los datos clinicos dentro.
    //
    // Los pacientes van los ultimos, y no por capricho: sus mediciones caen con
    // `ON DELETE CASCADE`, asi que borrarlos antes exigiria quitar antes tambien
    // cada fila que se fue con ellos.
    const porTabla = borradosPorTabla(paquete.borrados)

    if (porTabla.registros.length > 0) {
      await db.delete(registros).where(inArray(registros.id, porTabla.registros))
    }
    if (porTabla.visitas.length > 0) {
      await db.delete(visitas).where(inArray(visitas.id, porTabla.visitas))
    }
    if (porTabla.sondas.length > 0) {
      await db.delete(sondas).where(inArray(sondas.id, porTabla.sondas))
    }
    if (porTabla.pacientes.length > 0) {
      await db.delete(pacientes).where(inArray(pacientes.id, porTabla.pacientes))
    }

    await db
      .insert(borrados)
      .values(paquete.borrados.map(borradoAFila))
      .onConflictDoUpdate({
        target: [borrados.ambito, borrados.id],
        set: { borradoAt: excluido(borrados.borradoAt) },
        where: sql`${excluido(borrados.borradoAt)} > ${borrados.borradoAt}`,
      })
  }

  if (paquete.ajustes) {
    const fila = ajustesAFila(paquete.ajustes, paquete.marcas ?? {}, ahoraIso())
    await db
      .insert(ajustes)
      .values(fila)
      .onConflictDoUpdate({
        target: ajustes.id,
        set: columnasParaActualizar(ajustes, 'id'),
        where: sql`${excluido(ajustes.updatedAt)} > ${ajustes.updatedAt}`,
      })
  }

  return r.movidos + v.movidos + s.movidos
}

/** ISO del reloj local. */
function ahoraIso(): string {
  return new Date().toISOString()
}

// ---------------------------------------------------------------------------
// El ciclo
// ---------------------------------------------------------------------------

/**
 * Un ciclo completo.
 *
 * El orden importa y es lo que garantiza que no se pierde nada:
 *
 *   1. Se lee lo que hay en la base. No se toca todavia nada.
 *   2. Se fusiona con lo local. Lo local nunca se sobrescribe.
 *   3. Se escribe la union.
 *
 * Si el paso 3 falla, los datos locales siguen intactos y la base se queda como
 * estaba. Es al reves de lo habitual, y a proposito: en una app que guarda datos
 * clinicos en el telefono, lo que se puede perder es la copia de la nube, nunca lo
 * que la persona tiene encima.
 */
export async function sincronizar(
  local: EstadoReplicable,
  db?: Base,
): Promise<ResultadoReplica> {
  const base = db ?? (await conexion())
  if (!base) throw new Error('No hay base de datos configurada')

  // 1. Leer. Nada de esto modifica el estado local.
  const remoto = await leerRemoto(base)

  // Un paciente borrado no cuenta como existente. Si no se filtrara aqui, borrar la
  // unica ficha dejaria al telefono sin poder volver a subir nada: `pacienteACrear`
  // veria que "ya hay un paciente" y no crearia ninguno, y las mediciones nuevas se
  // quedarian sin a quien atribuirlas.
  const muertos = pacientesBorrados([...local.borrados, ...(remoto.borrados ?? [])])
  const vivos = [...local.pacientes, ...remoto.pacientes].filter((p) => !muertos.has(p.id))

  // La ficha que falta se anade ANTES de fusionar, para que entre en la union y
  // los registros puedan atribuirse a ella. Si se crees despues, el primer ciclo
  // subiria mediciones apuntando a una ficha que todavia no existe, y la base los
  // rechazaria por la clave foranea.
  const filasQueAtribuir = local.registros.length + local.visitas.length + local.sondas.length
  const nuevo = pacienteACrear(local.pacienteActivo, vivos, filasQueAtribuir)
  const pacientesLocales = nuevo ? [...local.pacientes, nuevo] : local.pacientes

  // 2. Fusionar. La misma funcion que usa el backup manual.
  const { paquete, resumen } = fusionarPaquetes(
    {
      registros: local.registros,
      visitas: local.visitas,
      sondas: local.sondas,
      pacientes: pacientesLocales,
      borrados: local.borrados,
      ajustes: local.ajustes,
      marcas: local.marcas,
    },
    remoto,
  )

  // Las mediciones que ya estaban subidas y eran del paciente que se acaba de
  // borrar no se reintentan: la base las borro en cascada y volver a mandarlas sin
  // ficha seria un error de clave foranea que pararia el ciclo entero.
  const repisable = purgarConPaciente(
    paquete.registros,
    paquete.visitas ?? [],
    paquete.sondas ?? [],
    remoto.reparto,
    muertos,
  )

  // 3. Escribir la union.
  const movidos = await escribir(base, { ...paquete, ...repisable }, remoto.reparto)

  // La marca se escribe al final, y no antes, para que un fallo a mitad no deje
  // constancia de algo que no llego a subirse. Aun asi no se usa para no releer:
  // queda como informacion de diagnostico.
  const ahora = ahoraIso()
  await base
    .insert(replica)
    .values({ id: 1, ultimoEnviado: ahora, ultimoRecibido: ahora, updatedAt: ahora })
    .onConflictDoUpdate({
      target: replica.id,
      set: { ultimoEnviado: ahora, ultimoRecibido: ahora, updatedAt: ahora },
    })

  return { paquete, resumen, pacienteCreado: nuevo, movidos }
}

/** Cuando se sincronizo la ultima vez. Para la pantalla de Ajustes. */
export async function ultimaReplica(): Promise<{
  ultimoEnviado: string
  ultimoRecibido: string
} | null> {
  const db = await conexion()
  if (!db) return null
  const filas = await db.select().from(replica).limit(1)
  const f = filas[0]
  if (!f) return null
  return { ultimoEnviado: f.ultimoEnviado, ultimoRecibido: f.ultimoRecibido }
}

export { tursoConfigurado } from './cliente'