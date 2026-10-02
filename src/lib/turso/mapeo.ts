/**
 * Conversiones entre las filas de la base y los tipos de la app.
 *
 * Todo este modulo es puro: no lee ni escribe en ninguna base. Esa separacion es
 * a proposito, porque aqui estan las dos cosas que son mas faciles de equivocar
 * al tocar el esquema, y una prueba de integracion no ayuda a verlas.
 *
 * La primera es `updatedAt`. En la app es opcional, porque los datos guardados
 * antes de que existiera la sincronizacion no lo tienen. En la base la columna es
 * `NOT NULL`, asi que hay que decidir que se escribe cuando falta. Se usa
 * `createdAt`, que es justo lo que hace `lib/fusion` al comparar: si aqui se
 * pusiera otro valor, el mismo registro ganaria o perderia de forma distinta en
 * la base y en la pantalla.
 *
 * La segunda, y la que importa, es de que paciente es cada fila. La app guarda un
 * unico `pacienteActivo` en los ajustes y no guarda de quien es cada medicion. En
 * una base compartida eso no sirve: `pacienteId` es obligatorio y tiene clave
 * foranea. Asignar "el paciente activo" en el momento de subir parece la
 * solucion y no lo es: en cuanto se cambiara de paciente en los ajustes, todas las
 * mediciones ya subidas cambiarian de dueno, y dos sesiones de dos personas
 * distintas acabarian mezcladas bajo el mismo nombre.
 *
 * Por eso la asignacion es estable. Se reutiliza la que ya tiene cada fila en la
 * base, y solo se decide para las que son nuevas. El unico caso en que una fila
 * existente cambia de paciente no es un error: cuando el paciente al que
 * pertenecia esta borrado. Ahi se mueve al destino, porque las alternativas son
 * dejarla apuntando a una ficha que ya no existe, que la base no permite, o
 * borrarla, que destruye mediciones que la app todavia muestra.
 *
 * Los tipos de las filas se sacan del esquema con `$inferSelect` y no se escriben
 * a mano, para que un cambio de columna rompa la compilacion y no falle en
 * silencio al escribir una propiedad que ya no existe. Ojo con el nombre de las
 * propiedades: son las que se le han puesto en `schema.ts` (`presionSis`), no el
 * nombre de la columna en SQL (`presion_sis`). Solo el SQL en crudo lleva el
 * segundo.
 */

import { nuevoId } from '../db'
import type {
  AjustesCompartidos,
  Borrado,
  MarcasCompartidas,
  Paciente,
  Registro,
  Visita,
} from '../tipos'
import type { ajustes, borrados, pacientes, registros, visitas } from './schema'

export type FilaRegistro = typeof registros.$inferSelect
export type FilaVisita = typeof visitas.$inferSelect
export type FilaPaciente = typeof pacientes.$inferSelect
export type FilaBorrado = typeof borrados.$inferSelect
export type FilaAjustes = typeof ajustes.$inferSelect

/** Nombre de la ficha que se crea si no hay ninguna a la que atribuir. */
export const NOMBRE_POR_DEFECTO = 'Paciente 1'

/** Marca con la que se decide quien gana. Sin `updatedAt`, se usa `createdAt`. */
function marca(e: { createdAt: string; updatedAt?: string }): string {
  return e.updatedAt ?? e.createdAt
}

// ---------------------------------------------------------------------------
// A que paciente va cada fila
// ---------------------------------------------------------------------------

/**
 * Que paciente tiene cada fila ya subida.
 *
 * Se lee de la base antes de escribir, y es lo que hace estable la asignacion.
 */
export interface Reparto {
  registros: Map<string, string>
  visitas: Map<string, string>
}

/** Recoge el reparto actual de la base, para no reasignar nada ya subido. */
export function leerReparto(filasR: FilaRegistro[], filasV: FilaVisita[]): Reparto {
  return {
    registros: new Map(filasR.map((f) => [f.id, f.pacienteId])),
    visitas: new Map(filasV.map((f) => [f.id, f.pacienteId])),
  }
}

/** Asignaciones mas cuantas filas han cambiado de dueno, y por que. */
export interface RepartoHecho {
  asignados: Map<string, string>
  /**
   * Filas que estaban asignadas a un paciente que ya no existe y se han movido al
   * destino. Se cuentan y se le dicen a la persona, porque es el unico caso en que
   * datos de una persona pueden acabar bajo el nombre de otra, y conviene que se
   * sepa en el momento en lugar de descubrirlo despues en un informe.
   */
  movidos: number
}

/**
 * Decide el paciente de cada fila.
 *
 * `validos` son los ids de los pacientes que van a existir despues de la fusion.
 * Se usa eso y no "los que hay ahora en la base" a proposito: un paciente creado
 * en este mismo ciclo todavia no esta en la base, y tomarlo por invalido haria que
 * sus filas cambiaran de dueno en cada ciclo.
 */
export function repartir(
  locales: { id: string }[],
  reparto: Map<string, string>,
  validos: Set<string>,
  destino: string,
): RepartoHecho {
  const asignados = new Map<string, string>()
  let movidos = 0
  for (const r of locales) {
    const previo = reparto.get(r.id)
    if (previo && validos.has(previo)) {
      asignados.set(r.id, previo)
    } else {
      if (previo) movidos++
      asignados.set(r.id, destino)
    }
  }
  return { asignados, movidos }
}

// ---------------------------------------------------------------------------
// Registros
// ---------------------------------------------------------------------------

export function registroAFila(r: Registro, pacienteId: string): typeof registros.$inferInsert {
  return {
    id: r.id,
    pacienteId,
    fecha: r.fecha,
    hora: r.hora,
    presionSis: r.presionSis,
    presionDia: r.presionDia,
    o2: r.o2,
    bpm: r.bpm,
    // `null` es un dato real: significa que en esa toma no se midio orina. No es
    // un campo vacio que se pueda confundir con que se olvido.
    orina: r.orina,
    notas: r.notas ?? '',
    ejemplo: r.ejemplo ?? false,
    createdAt: r.createdAt,
    updatedAt: marca(r),
  }
}

export function filaARegistro(f: FilaRegistro): Registro {
  return {
    id: f.id,
    fecha: f.fecha,
    hora: f.hora,
    presionSis: f.presionSis,
    presionDia: f.presionDia,
    o2: f.o2,
    bpm: f.bpm,
    orina: f.orina,
    notas: f.notas,
    ejemplo: f.ejemplo,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  }
}

// ---------------------------------------------------------------------------
// Visitas
// ---------------------------------------------------------------------------

export function visitaAFila(v: Visita, pacienteId: string): typeof visitas.$inferInsert {
  return {
    id: v.id,
    pacienteId,
    fecha: v.fecha,
    // Una visita sin hora es legitima: muchas se escriben a posteriori.
    hora: v.hora ?? null,
    tipo: v.tipo,
    motivo: v.motivo,
    profesional: v.profesional,
    indicaciones: v.indicaciones ?? '',
    notas: v.notas ?? '',
    ejemplo: v.ejemplo ?? false,
    createdAt: v.createdAt,
    updatedAt: marca(v),
  }
}

export function filaAVisita(f: FilaVisita): Visita {
  return {
    id: f.id,
    fecha: f.fecha,
    hora: f.hora ?? undefined,
    tipo: f.tipo,
    motivo: f.motivo,
    profesional: f.profesional,
    indicaciones: f.indicaciones,
    notas: f.notas,
    ejemplo: f.ejemplo,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  }
}

// ---------------------------------------------------------------------------
// Pacientes
// ---------------------------------------------------------------------------

export function pacienteAFila(p: Paciente): typeof pacientes.$inferInsert {
  return {
    id: p.id,
    nombre: p.nombre,
    nacimiento: p.nacimiento ?? null,
    notas: p.notas ?? null,
    presionHabitual: p.presionHabitual ?? null,
    createdAt: p.createdAt,
    updatedAt: marca(p),
  }
}

export function filaAPaciente(f: FilaPaciente): Paciente {
  return {
    id: f.id,
    nombre: f.nombre,
    nacimiento: f.nacimiento ?? undefined,
    notas: f.notas ?? undefined,
    presionHabitual: f.presionHabitual ?? undefined,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  }
}

/**
 * Ficha que hay que crear para poder atribuir filas, o `null` si con lo que hay
 * basta.
 *
 * Solo se crea una, y solo si no hay ningun paciente. En cuanto existe una ficha
 * se reutiliza: crear una por dispositivo dejaria las mismas mediciones repartidas
 * entre varias fichas con nombres parecidos, que es justo el problema que el
 * `pacienteId` pretendia evitar.
 */
export function pacienteACrear(
  pacienteActivo: string | null,
  pacientes: Paciente[],
  filasQueAtribuir: number,
): Paciente | null {
  if (filasQueAtribuir === 0) return null
  if (pacientes.length > 0) return null

  const ahora = new Date().toISOString()
  return {
    // Si hay un paciente activo pero su ficha no esta, es que se borro en otro
    // dispositivo. Se recupera con ese identificador en lugar de crear otro, para
    // que las mediciones de ese telefono sigan bajo la misma ficha.
    id: pacienteActivo ?? nuevoId(),
    nombre: NOMBRE_POR_DEFECTO,
    createdAt: ahora,
    updatedAt: ahora,
  }
}

// ---------------------------------------------------------------------------
// Borrados
// ---------------------------------------------------------------------------

export function borradoAFila(b: Borrado): typeof borrados.$inferInsert {
  return { ambito: b.ambito, id: b.id, borradoAt: b.borradoAt }
}

export function filaABorrado(f: FilaBorrado): Borrado {
  return { ambito: f.ambito, id: f.id, borradoAt: f.borradoAt }
}

// ---------------------------------------------------------------------------
// Ajustes compartidos
// ---------------------------------------------------------------------------

/**
 * Los ajustes van en una sola fila con las cuatro estructuras en JSON.
 *
 * Las marcas viajan dentro y no en una tabla aparte porque siempre se leen y se
 * escriben juntas con su valor: separarlas permitiria guardar media marca, que es
 * justo el estado que hace que un campo gane o pierda de forma arbitraria.
 *
 * `id` fijo a 1 porque la tabla no crece: hay una fila o no hay nada.
 */
export function ajustesAFila(
  a: AjustesCompartidos,
  marcas: MarcasCompartidas,
  actualizado: string,
): typeof ajustes.$inferInsert {
  return {
    id: 1,
    umbral: a.umbral,
    limites: a.limites,
    presionHabitual: a.presionHabitual,
    plantillas: a.plantillas,
    marcas,
    updatedAt: actualizado,
  }
}

export function filaAAjustes(f: FilaAjustes | undefined): {
  ajustes: Partial<AjustesCompartidos> | null
  marcas: MarcasCompartidas
} {
  // Sin fila todavia no hay ajustes ni marcas. `null` y no un objeto vacio: el
  // primero se distingue de "hay ajustes que son estos".
  if (!f) return { ajustes: null, marcas: {} }
  return {
    ajustes: {
      umbral: f.umbral,
      limites: f.limites,
      presionHabitual: f.presionHabitual ?? undefined,
      plantillas: f.plantillas,
    },
    marcas: f.marcas ?? {},
  }
}