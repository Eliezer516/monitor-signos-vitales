/**
 * Probar la base de verdad: escribir y leer.
 *
 *   npm run db:probar
 *
 * `db:comprobar` solo lee. Esto ademas escribe, y esa es la parte que importa:
 * el token que se genera en el panel de Turso puede ser de solo lectura, y eso
 * no se detecta hasta que la replica intenta subir algo. Aqui se comprueba antes.
 *
 * Escribe en una base de datos real, asi que la limpieza va en un `finally`: si
 * una comprobacion falla a la mitad, las filas de prueba se borran igual. Y
 * borra tambien las de ejecuciones anteriores que se quedaron a medias, que se
 * localizan por el prefijo `prueba-` y no tienen nada que ver con datos reales.
 */

import { createClient } from '@libsql/client'
import { existsSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import * as schema from '../src/lib/turso/schema'

if (existsSync('.env')) process.loadEnvFile('.env')

const url = process.env.TURSO_URL ?? process.env.VITE_TURSO_URL ?? ''
const authToken = process.env.TURSO_TOKEN ?? process.env.VITE_TURSO_TOKEN ?? ''

if (!url || !authToken) {
  console.log('Sin configuracion: copia .env.example como .env y rellenala.')
  process.exit(1)
}

const cliente = createClient({ url, authToken })
const db = drizzle(cliente, { schema })

const host = url.replace(/^libsql:\/\//, '').split('.')[0]
// Marca unico por ejecucion, para que dos pruebas simultaneas no se pisen.
const id = `prueba-${Date.now()}`

let fallos = 0
function ok(nombre: string, cond: boolean, extra = '') {
  if (!cond) {
    fallos++
    console.log(`  FALLO: ${nombre} ${extra}`)
  } else console.log(`  ok: ${nombre}`)
}

/**
 * Borra las filas de prueba de esta ejecucion y de las anteriores.
 *
 * El borrado del paciente arrastra sus registros por cascada, asi que basta con
 * borrar el paciente. Los registros sueltos se borran igualmente por si se
 * llegaran a crear sin paciente.
 */
async function limpiar() {
  await db.delete(schema.pacientes).where(sql`id LIKE 'prueba-%'`)
  await db.delete(schema.registros).where(sql`id LIKE 'prueba-%'`)
  await db.delete(schema.visitas).where(sql`id LIKE 'prueba-%'`)
}

const ahora = new Date().toISOString()

console.log(`Base: ${host}\n`)

try {
  console.log('1. Escribir')
  {
    const paciente = {
      id,
      nombre: 'Prueba de conexion',
      nacimiento: '1990-01-01',
      notas: 'Fila temporal, se borra al terminar',
      presionHabitual: { sis: 120, dia: 80 },
      createdAt: ahora,
      updatedAt: ahora,
    }
    const registro = {
      id: `${id}-r`,
      pacienteId: id,
      fecha: '2026-10-02',
      hora: '08:30',
      presionSis: 128,
      presionDia: 82,
      o2: 96,
      bpm: 71,
      orina: null,
      notas: 'Fila temporal',
      ejemplo: false,
      createdAt: ahora,
      updatedAt: ahora,
    }

    try {
      await db.insert(schema.pacientes).values(paciente)
      await db.insert(schema.registros).values(registro)
      ok('inserta un paciente y un registro', true)
    } catch (e) {
      ok('inserta un paciente y un registro', false, String(e))
      console.log('')
      console.log('  Si el mensaje habla de permisos o de solo lectura, el token es de')
      console.log('  SOLO LECTURA. En el panel de Turso hay que generar uno de lectura')
      console.log('  y escritura: la replica necesita escribir.')
      throw e
    }
  }

  console.log('2. Leer lo escrito')
  {
    const pacientes = await db.select().from(schema.pacientes).where(sql`id = ${id}`)
    ok('lee el paciente', pacientes.length === 1)
    ok('los numeros no se alteran', pacientes[0]?.presionHabitual?.sis === 120)
    ok('el JSON se conserva', pacientes[0]?.nombre === 'Prueba de conexion')

    const registros = await db.select().from(schema.registros).where(sql`paciente_id = ${id}`)
    ok('lee el registro', registros.length === 1 && registros[0]?.presionSis === 128)
    ok('orina null sigue siendo null', registros[0]?.orina === null)

    // Esta es la consulta que hace el historial. Si el indice no existiera, esto
    // seguiria devolviendo lo mismo pero recorreria la tabla entera, asi que se
    // comprueba el plan y no solo el resultado.
    const plan = await cliente.execute(
      `EXPLAIN QUERY PLAN SELECT * FROM registros WHERE paciente_id = '${id}' AND fecha = '2026-10-02'`,
    )
    ok(
      'el historial usa el indice',
      JSON.stringify(plan.rows).includes('registros_paciente_fecha'),
      JSON.stringify(plan.rows),
    )
  }

  console.log('3. La regla de conflicto: gana lo mas nuevo')
  {
    // Es lo que sostiene la replica offline: un telefono que estuvo dias sin
    // conexion sube al final datos viejos, y si escalaran sobre datos nuevos, dos
    // dispositivos se picarian datos.
    const id2 = `${id}-r2`
    const subir = (presionSis: number, updatedAt: string) =>
      db
        .insert(schema.registros)
        .values({
          id: id2,
          pacienteId: id,
          fecha: '2026-10-03',
          hora: '09:00',
          presionSis,
          presionDia: 80,
          o2: 97,
          bpm: 70,
          orina: null,
          notas: '',
          ejemplo: false,
          createdAt: ahora,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: schema.registros.id,
          set: { presionSis, updatedAt },
          where: sql`excluded.updated_at > ${schema.registros.updatedAt}`,
        })

    await subir(130, '2026-10-03T12:00:00.000Z')
    // Llega una version mas antigua, como si fuera un telefono que lleva dias
    // desconectado.
    await subir(111, '2026-10-01T09:00:00.000Z')
    const tras = await db.select().from(schema.registros).where(sql`id = ${id2}`)
    ok('un cambio antiguo no pisa uno nuevo', tras[0]?.presionSis === 130, `${tras[0]?.presionSis}`)

    await subir(144, '2026-10-09T09:00:00.000Z')
    const tras2 = await db.select().from(schema.registros).where(sql`id = ${id2}`)
    ok('uno nuevo si entra', tras2[0]?.presionSis === 144, `${tras2[0]?.presionSis}`)
  }
} catch (e) {
  // El error ya se ha informado. Se deja que el `finally` limpie y se sale con
  // codigo de error.
  console.log(`  interrumpido: ${e instanceof Error ? e.message : String(e)}`)
  fallos++
} finally {
  console.log('4. Limpiar')
  try {
    await limpiar()
    const quedan = await db.select().from(schema.pacientes).where(sql`id LIKE 'prueba-%'`)
    ok('no queda ninguna fila de prueba', quedan.length === 0, `${quedan.length} sin borrar`)
    const huerfanos = await db.select().from(schema.registros).where(sql`id LIKE 'prueba-%'`)
    ok('ni registros sueltos', huerfanos.length === 0, `${huerfanos.length} sin borrar`)
  } catch (e) {
    fallos++
    console.log(`  FALLO al limpiar: ${e instanceof Error ? e.message : String(e)}`)
  }
  cliente.close()
}

console.log(fallos === 0 ? '\nLA BASE ACEPTA ESCRITURAS' : `\n${fallos} FALLOS`)
if (fallos > 0) process.exit(1)