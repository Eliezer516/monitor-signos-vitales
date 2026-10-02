/**
 * Esquema de la base de datos sincronizada (Turso / libSQL, dialecto SQLite).
 *
 * Es el equivalente en SQL de `lib/tipos.ts`. Los dos lados tienen que contar
 * lo mismo: si un campo se queda aqui y no alla, o al reves, al migrar se
 * pierde sin avisar. Los tipos de TypeScript de aqui son la fuente para
 * `leerBackup`, no al reves.
 *
 * Dos criterios que condicionan el diseño:
 *
 * - **Una persona, varios dispositivos.** No hay tabla de usuarios a proposito.
 *   Cada despliegue de este proyecto tiene su propia base, y quien despliega
 *   configura sus credenciales. Por eso no hace falta ningun sistema de cuentas.
 *
 * - **La base es unihijo, no la verdad.** La app funciona sin conexion y guarda
 *   en IndexedDB; esto es donde se replica. Por eso cada fila lleva
 *   `updatedAt`: es la columna que decide quien gana cuando dos dispositivos
 *   han cambiado lo mismo, y `borrados` existe porque borrar una fila de verdad
 *   no deja rastro con el que resolver un conflicto.
 */

import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Fecha y hora en texto ISO.
 *
 * Se guardan como texto y no como `integer` con epoch a proposito. Los dos
 * formatos ordenan bien, pero el ISO se lee en un volcado, se puede escribir a
 * mano para corregir un dato y no depende de la zona horaria de quien mire.
 * El orden lexicografico coincide con el cronologico, que es justo lo que
 * necesita `updatedAt`.
 */
const iso = (nombre: string) => text(nombre)

export const pacientes = sqliteTable(
  'pacientes',
  {
    id: text('id').primaryKey(),
    nombre: text('nombre').notNull(),
    /** "YYYY-MM-DD". Opcional para permitir una ficha minima. */
    nacimiento: text('nacimiento'),
    notas: text('notas'),
    /**
     * Presion habitual de esta persona, en JSON (`{ "sis": 120, "dia": 80 }`).
     *
     * Va en JSON y no en dos columnas porque es un par inseparable que siempre
     * se lee y escribe junto: partirlo solo permitiria guardar media
     * prescripcion, que es peor que no guardarla.
     */
    presionHabitual: text('presion_habitual', { mode: 'json' }).$type<{
      sis: number
      dia: number
    } | null>(),
    createdAt: iso('created_at').notNull(),
    updatedAt: iso('updated_at').notNull(),
  },
  (t) => [index('pacientes_nombre').on(t.nombre)],
)

export const registros = sqliteTable(
  'registros',
  {
    id: text('id').primaryKey(),
    /**
     * A quien pertenece la medicion.
     *
     * En `lib/tipos.ts` un `Registro` NO tiene este campo: ahi solo hay un
     * conjunto local de datos y un `pacienteActivo` que es un ajuste de la
     * maquina. En una base compartida eso no llega: si se mide a dos personas
     * con el mismo movil, sus series quedarian mezcladas sin posibilidad de
     * separarlas despues, porque el dato original no sabe a quien pertenecia.
     * Por eso el campo se anade aqui, aunque haya que migrar los datos
     * existentes asignandoles su paciente actual.
     */
    pacienteId: text('paciente_id')
      .notNull()
      .references(() => pacientes.id, { onDelete: 'cascade' }),
    /** Dia local "YYYY-MM-DD", no UTC: cerca de medianoche importa. */
    fecha: text('fecha').notNull(),
    /** Hora local "HH:MM". */
    hora: text('hora').notNull(),
    presionSis: integer('presion_sis').notNull(),
    presionDia: integer('presion_dia').notNull(),
    o2: integer('o2').notNull(),
    bpm: integer('bpm').notNull(),
    /** `null` cuando no se midio orina en esa toma. */
    orina: integer('orina'),
    notas: text('notas').notNull().default(''),
    /** Marca los registros de los datos de ejemplo, que se borran de un golpe. */
    ejemplo: integer('ejemplo', { mode: 'boolean' }).notNull().default(false),
    createdAt: iso('created_at').notNull(),
    updatedAt: iso('updated_at').notNull(),
  },
  (t) => [
    // El historial y las graficas siempre preguntan por un paciente y un rango
    // de fechas. Es la consulta que se hace en cada pantalla.
    index('registros_paciente_fecha').on(t.pacienteId, t.fecha),
  ],
)

export const visitas = sqliteTable(
  'visitas',
  {
    id: text('id').primaryKey(),
    /** Igual que en `registros`: no existia en el modelo local. */
    pacienteId: text('paciente_id')
      .notNull()
      .references(() => pacientes.id, { onDelete: 'cascade' }),
    fecha: text('fecha').notNull(),
    /** Opcional: muchas visitas se escriben a posteriori. */
    hora: text('hora'),
    tipo: text('tipo', { enum: ['consulta', 'domicilio'] }).notNull(),
    motivo: text('motivo').notNull(),
    profesional: text('profesional').notNull(),
    indicaciones: text('indicaciones').notNull().default(''),
    notas: text('notas').notNull().default(''),
    ejemplo: integer('ejemplo', { mode: 'boolean' }).notNull().default(false),
    createdAt: iso('created_at').notNull(),
    updatedAt: iso('updated_at').notNull(),
  },
  (t) => [index('visitas_paciente_fecha').on(t.pacienteId, t.fecha)],
)

/**
 * Marcas de lo que se ha borrado.
 *
 * Una tabla aparte y no una columna `borrado`: borrar de verdad una fila deja la
 * base sin rastro, asi que si dos dispositivos borran cosas distintas y luego
 * se sincronizan, no habria forma de saber que la union correcta es "las dos
 * cosas menos lo borrado". Guardar el aviso es lo que permite que un borrado se
 * propague en vez de resucitar.
 *
 * La clave es compuesta por `ambito` e `id` porque los tres ambitos comparten
 * tabla: un `id` de visita puede coincidir con uno de registro y no son la
 * misma fila.
 */
export const borrados = sqliteTable(
  'borrados',
  {
    ambito: text('ambito', { enum: ['registros', 'visitas', 'pacientes'] }).notNull(),
    id: text('id').notNull(),
    borradoAt: iso('borrado_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ambito, t.id] })],
)

/**
 * Ajustes compartidos, en una sola fila.
 *
 * Una fila y no una por ajuste porque son cuatro valores que se leen y se
 * escriben juntos al sincronizar, y separarlos solo permitiria guardar medio
 * conjunto. `umbral`, `limites` y `plantillas` van en JSON por lo mismo que
 * `presionHabitual` en pacientes: son estructuras que ya estan definidas en
 * `lib/tipos.ts` y que solo tienen sentido completas.
 *
 * `marcas` es el mapa campo -> instante, que es lo que permite que dos
 * dispositivos cambien umbrales distintos sin pisarse. Sin el, el `updatedAt`
 * de la fila obligaria a que un cambio de umbral se llevara por delante un
 * cambio de plantillas hecho a la vez.
 *
 * `id` fijo a 1: la tabla no crece nunca y no hay nada que borrar.
 */
export const ajustes = sqliteTable('ajustes', {
  id: integer('id').primaryKey(),
  umbral: text('umbral', { mode: 'json' }).$type<Record<string, number>>().notNull(),
  limites: text('limites', { mode: 'json' }).$type<Record<string, number>>().notNull(),
  presionHabitual: text('presion_habitual', { mode: 'json' }).$type<{
    sis: number
    dia: number
  } | null>(),
  plantillas: text('plantillas', { mode: 'json' }).$type<
    { id: string; texto: string; activa: boolean }[]
  >().notNull(),
  marcas: text('marcas', { mode: 'json' }).$type<Record<string, string>>().notNull(),
  updatedAt: iso('updated_at').notNull(),
})

/**
 * Estado de la replica en este dispositivo.
 *
 * Sirve para saber que se ha subido ya y que se ha descargado ya. Sin esto,
 * sincronizar seria releer y reenviar todo cada vez: mas lento, y sobre todo
 * imposible de hacer cuando hay conexion intermitente, porque no hay forma de
 * distinguir "esto no lo he subido" de "esto ya estaba".
 *
 * `id` fijo a 1 por la misma razon que en `ajustes`.
 */
export const replica = sqliteTable('replica', {
  id: integer('id').primaryKey(),
  /** Instantane del ultimo cambio guardado en la base, para subir solo lo nuevo. */
  ultimoEnviado: iso('ultimo_enviado').notNull(),
  /** Instantane de lo ultimo que se ha bajado, para traer solo lo que falte. */
  ultimoRecibido: iso('ultimo_recibido').notNull(),
  updatedAt: iso('updated_at').notNull(),
})

/**
 * Marca de tiempo del motor, expuesta por la base.
 *
 * Sirve para lo unico que el reloj del dispositivo no puede dar: dos telefonos
 * con la hora desfasada pueden desordenarse entre si. SQLite guarda
 * el momento en el que se escribio cada fila, asi que si el reloj va atras un
 * cambio no viajaria nunca. Por eso `updatedAt` no se toma de
 * `new Date()`, sino de aqui.
 */
export const relojSql = sql<Date>`CURRENT_TIMESTAMP`