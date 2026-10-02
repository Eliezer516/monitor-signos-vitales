/**
 * Cliente de la base de datos.
 *
 * Es lazy a proposito: este modulo se importa desde toda la app, y crear una
 * conexion al cargarlo haria que la app no arrancara si la base no estuviera
 * configurada. Aqui se devuelve `null` y quien lo necesita decide, que es lo que
 * hace `conexion()`.
 */

import { createClient, type Client } from '@libsql/client'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import * as schema from './schema'

/** Fila de `ajustes`: hay una sola, con `id` fijo a 1. */
export type AjustesFila = typeof schema.ajustes.$inferSelect

export type Base = LibSQLDatabase<typeof schema>

let promesa: Promise<Base | null> | null = null

/**
 * Direccion de la base.
 *
 * Se lee de `import.meta.env` y no de un archivo, para que quien despliegue la
 * ponga donde ya pone sus demas variables. El prefijo `VITE_` es necesario
 * porque Vite solo expone al bundle las variables que lo llevan.
 *
 * Que quede incrustada no es un problema: son las credenciales de la base de
 * quien despliega, y en un proyecto auto-hospedado cada instalacion tiene las
 * suyas y no las comparte con nadie. La unica excepcion seria una instancia
 * publica compartida, y ahi no deberia haber datos de pacientes.
 */
export function url(): string {
  return import.meta.env.VITE_TURSO_URL ?? ''
}

/**
 * Token de acceso.
 *
 * Turso emite tokens de solo lectura y de lectura y escritura; este es el
 * segundo, que es el que necesita la replica. Va aparte del URL a proposito:
 * asi el mismo par sirve para las dos cosas y solo se pueden cambiar los
 * permisos de una sin tocar la otra.
 */
export function token(): string {
  return import.meta.env.VITE_TURSO_TOKEN ?? ''
}

/** Si hay donde conectarse. Decide si la replica se ofrece en Ajustes. */
export function tursoConfigurado(): boolean {
  return url() !== '' && token() !== ''
}

/**
 * Conexion, creada la primera vez que se pide y reutilizada despues.
 *
 * Devuelve `null` en lugar de lanzar cuando no hay configuracion, para que
 * importar este modulo sea siempre seguro.
 */
export function conexion(): Promise<Base | null> {
  if (promesa) return promesa
  if (!tursoConfigurado()) return Promise.resolve(null)

  promesa = Promise.resolve().then(() => {
    const cliente: Client = createClient({ url: url(), authToken: token() })
    return drizzle(cliente, { schema })
  })
  return promesa
}

/**
 * Probar la conexion y decir si las credenciales no valen.
 *
 * Se usa antes de ofrecer la replica, para que un token equivocado se diga al
 * configurar y no semanas despues, cuando alguien pulse "Sincronizar" y no
 * entienda que ocurre. Es una consulta minima a proposito: si el esquema no esta
 * aplicado, tambien falla aqui, que es justo lo que hay que detectar.
 */
export async function comprobar(): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const db = await conexion()
  if (!db) return { ok: false, motivo: 'No hay base de datos configurada' }
  try {
    await db.all(sql`SELECT 1`)
  } catch {
    return { ok: false, motivo: 'No se puede conectar con la base de datos' }
  }
  return { ok: true }
}

/**
 * Instante que da la propia base, no el reloj del dispositivo.
 *
 * Dos telefonos con la hora desfasada pueden desordenarse entre si. SQLite
 * guarda el momento de cada escritura, asi que si el reloj local va atras, un
 * cambio hecho hoy podria quedar con una fecha anterior a la de un cambio de
 * ayer y no ganaria nunca. Por eso `updatedAt` sale de aqui.
 */
export async function ahora(): Promise<string> {
  const db = await conexion()
  // Sin base no hay nada que consultar. Se cae al reloj del dispositivo, que es
  // peor por la desincronizacion entre telefonos, pero desde luego es mejor que
  // lanzar: esta funcion tambien se usa para marcar cambios locales mientras se
  // trabaja sin conexion, que es el caso normal.
  if (!db) return new Date().toISOString()
  // Formato ISO con milisegundos, para que sea comparable con las marcas que
  // ya se guardan en el backup y en IndexedDB.
  const r = await db.all<{ ahora: string }>(
    sql`SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS ahora`,
  )
  return r[0]?.ahora ?? new Date().toISOString()
}