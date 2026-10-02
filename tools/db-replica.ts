/**
 * El ciclo de replica completo contra la base de verdad.
 *
 *   npm run db:replica
 *
 * `db:probar` comprueba que se puede escribir y que la regla de conflicto funciona.
 * Esto va un paso mas alla y ejecuta `sincronizar` de verdad, el mismo camino que
 * sigue la app: fusion, atribucion de pacientes, borrados en cascada y la marca de
 * estado.
 *
 * La razon de existir aparte del test con un fichero SQLite es que hay cosas que
 * solo fallan contra el servicio: Turso va por HTTP, cada escritura es una ida y
 * vuelta, y el servicio puede cortar una peticion a mitad. Un ciclo que aguanta en
 * local no dice nada de si aguanta ahi.
 *
 * **Toca una base real, asi que se limpia siempre.**
 *
 * Y no solo las filas de prueba: `sincronizar` tambien escribe la fila de ajustes
 * compartidos y la de estado de la replica, que son singletons. Se guardan antes y
 * se dejan como estaban al terminar; si no existian, se borran. Sin eso, una prueba
 * dejaria los ajustes de un `AJUSTES_POR_DEFECTO` de prueba en la base de quien la
 * ejecuta, y no se veria hasta que un telefono real trajera sus propios umbrales y
 * no prevailieran.
 */

import { createClient } from '@libsql/client'
import { existsSync } from 'node:fs'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { AJUSTES_POR_DEFECTO } from '../src/lib/rangos'
import { sincronizar, type EstadoReplicable } from '../src/lib/turso/replica'
import * as schema from '../src/lib/turso/schema'
import type { AjustesCompartidos, Ambito, Borrado, Paciente, Registro, Visita } from '../src/lib/tipos'

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
const marca = `prueba-${Date.now()}`

let fallos = 0
function ok(nombre: string, cond: boolean, extra = '') {
  if (!cond) {
    fallos++
    console.log(`  FALLO: ${nombre} ${extra}`)
  } else console.log(`  ok: ${nombre}`)
}

const ajustes: AjustesCompartidos = {
  umbral: AJUSTES_POR_DEFECTO.umbral,
  limites: AJUSTES_POR_DEFECTO.limites,
  presionHabitual: AJUSTES_POR_DEFECTO.presionHabitual,
  plantillas: [],
}

const ahora = new Date().toISOString()

const paciente = (id: string, nombre: string, updatedAt: string): Paciente => ({
  id,
  nombre,
  createdAt: updatedAt,
  updatedAt,
})

const reg = (id: string, updatedAt: string, sis = 120): Registro => ({
  id,
  fecha: '2026-10-01',
  hora: '08:00',
  presionSis: sis,
  presionDia: 80,
  o2: 97,
  bpm: 70,
  orina: null,
  notas: '',
  ejemplo: false,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt,
})

const vis = (id: string, updatedAt: string): Visita => ({
  id,
  fecha: '2026-10-02',
  hora: null,
  tipo: 'consulta',
  motivo: 'Revision',
  profesional: 'Dr. Perez',
  indicaciones: '',
  notas: '',
  ejemplo: false,
  createdAt: '2026-10-02T09:00:00.000Z',
  updatedAt,
})

const borro = (ambito: Ambito, id: string, borradoAt: string): Borrado[] => [
  { ambito, id, borradoAt },
]

const local = (parcial: Partial<EstadoReplicable> = {}): EstadoReplicable => ({
  registros: [],
  visitas: [],
  pacientes: [],
  borrados: [],
  ajustes,
  marcas: {},
  pacienteActivo: null,
  ...parcial,
})

/**
 * Estado previo de los dos singletons, para devolverlos al sitio.
 *
 * `null` significa que no existian, y en ese caso hay que borrarlos al terminar.
 */
const antesAjustes = await db.select().from(schema.ajustes).where(eq(schema.ajustes.id, 1))
const antesReplica = await db.select().from(schema.replica).where(eq(schema.replica.id, 1))

async function limpiar() {
  // Los pacientes primero: se llevan sus registros y visitas por cascada.
  await db.delete(schema.pacientes).where(sql`id LIKE 'prueba-%'`)
  await db.delete(schema.registros).where(sql`id LIKE 'prueba-%'`)
  await db.delete(schema.visitas).where(sql`id LIKE 'prueba-%'`)
  await db.delete(schema.borrados).where(sql`id LIKE 'prueba-%'`)

  if (antesAjustes.length === 0) {
    await db.delete(schema.ajustes).where(eq(schema.ajustes.id, 1))
  } else {
    await db
      .insert(schema.ajustes)
      .values(antesAjustes[0])
      .onConflictDoUpdate({
        target: schema.ajustes.id,
        set: {
          umbral: sql`excluded.umbral`,
          limites: sql`excluded.limites`,
          presionHabitual: sql`excluded.presionHabitual`,
          plantillas: sql`excluded.plantillas`,
          marcas: sql`excluded.marcas`,
          updatedAt: sql`excluded.updatedAt`,
        },
      })
  }

  if (antesReplica.length === 0) {
    await db.delete(schema.replica).where(eq(schema.replica.id, 1))
  } else {
    await db
      .insert(schema.replica)
      .values(antesReplica[0])
      .onConflictDoUpdate({
        target: schema.replica.id,
        set: {
          ultimoEnviado: sql`excluded.ultimo_enviado`,
          ultimoRecibido: sql`excluded.ultimo_recibido`,
          updatedAt: sql`excluded.updatedAt`,
        },
      })
  }
}

console.log(`Base: ${host}\n`)

try {
  console.log('1. El primer ciclo sube lo que hay en el telefono')
  {
    const idP = `${marca}-p`
    const r = await sincronizar(
      local({
        registros: [reg(`${marca}-r1`, '2026-10-01T09:00:00.000Z')],
        visitas: [vis(`${marca}-v1`, '2026-10-02T09:00:00.000Z')],
        pacientes: [paciente(idP, 'Prueba replica', ahora)],
        pacienteActivo: idP,
      }),
      db,
    )
    ok('no crea ficha nueva', r.pacienteCreado === null, String(r.pacienteCreado))

    const filas = await db.select().from(schema.registros).where(sql`id LIKE 'prueba-%'`)
    ok('el registro llega', filas.length === 1, String(filas.length))
    ok('con el paciente correcto', filas[0]?.pacienteId === idP, String(filas[0]?.pacienteId))

    const filaAj = await db.select().from(schema.ajustes).where(eq(schema.ajustes.id, 1))
    ok('escribe los ajustes compartidos', filaAj.length === 1)
    ok('y las marcas viajan dentro', !!filaAj[0]?.marcas)

    const est = await db.select().from(schema.replica).where(eq(schema.replica.id, 1))
    ok('deja la marca de estado', est.length === 1)
  }

  console.log('2. Un segundo ciclo no rompe nada al repetirlo')
  {
    const idP = `${marca}-p`
    await sincronizar(
      local({
        registros: [reg(`${marca}-r1`, '2026-10-01T09:00:00.000Z'), reg(`${marca}-r2`, '2026-10-01T10:00:00.000Z')],
        visitas: [vis(`${marca}-v1`, '2026-10-02T09:00:00.000Z')],
        pacientes: [paciente(idP, 'Prueba replica', ahora)],
        pacienteActivo: idP,
      }),
      db,
    )
    const filas = await db.select().from(schema.registros).where(sql`id LIKE 'prueba-%'`)
    ok('sigue habiendo los 2, sin duplicar', filas.length === 2, String(filas.length))
  }

  console.log('3. Dos ciclos seguidos dan el mismo resultado')
  {
    // El mismo estado subido dos veces tiene que acabar igual que una vez. Si no,
    // cada ciclo estaria cambiando algo y la app no pararia nunca de subir.
    const estado = local({
      registros: [reg(`${marca}-r1`, '2026-10-01T09:00:00.000Z'), reg(`${marca}-r2`, '2026-10-01T10:00:00.000Z')],
      visitas: [vis(`${marca}-v1`, '2026-10-02T09:00:00.000Z')],
      pacientes: [paciente(`${marca}-p`, 'Prueba replica', ahora)],
      pacienteActivo: `${marca}-p`,
    })
    const a = await sincronizar(estado, db)
    const b = await sincronizar(estado, db)
    ok(
      'la segunda vez no envia nada nuevo',
      b.resumen.enviados === 0,
      `primera=${a.resumen.enviados} segunda=${b.resumen.enviados}`,
    )
    const filas = await db.select().from(schema.registros).where(sql`id LIKE 'prueba-%'`)
    ok('y no duplica filas', filas.length === 2, String(filas.length))
  }

  console.log('4. Un tombstone borra la fila por HTTP')
  {
    await sincronizar(
      local({
        registros: [reg(`${marca}-r1`, '2026-10-01T09:00:00.000Z')],
        pacientes: [paciente(`${marca}-p`, 'Prueba replica', ahora)],
        borrados: borro('registros', `${marca}-r1`, '2026-10-03T09:00:00.000Z'),
        pacienteActivo: `${marca}-p`,
      }),
      db,
    )
    const filas = await db.select().from(schema.registros).where(sql`id LIKE 'prueba-%'`)
    ok('la fila desaparece', !filas.some((f) => f.id === `${marca}-r1`), filas.map((f) => f.id).join(','))
    ok('la otra se queda', filas.length === 1, String(filas.length))
    const tombstones = await db.select().from(schema.borrados).where(sql`id LIKE 'prueba-%'`)
    ok('y queda el rastro del borrado', tombstones.length === 1, String(tombstones.length))
  }

  console.log('5. Un cambio mas antiguo no pisa uno nuevo, contra el servicio')
  {
    const id = `${marca}-r3`
    await sincronizar(
      local({
        registros: [reg(id, '2026-10-09T09:00:00.000Z', 150)],
        pacientes: [paciente(`${marca}-p`, 'Prueba replica', ahora)],
        pacienteActivo: `${marca}-p`,
      }),
      db,
    )
    await sincronizar(
      local({
        registros: [reg(id, '2026-10-01T09:00:00.000Z', 90)],
        pacientes: [paciente(`${marca}-p`, 'Prueba replica', ahora)],
        pacienteActivo: `${marca}-p`,
      }),
      db,
    )
    const tras = await db.select().from(schema.registros).where(eq(schema.registros.id, id))
    ok('gana el mas reciente', tras[0]?.presionSis === 150, String(tras[0]?.presionSis))
  }
} catch (e) {
  fallos++
  console.log(`  interrumpido: ${e instanceof Error ? e.message : String(e)}`)
} finally {
  console.log('6. Limpiar')
  try {
    await limpiar()
    const quedan = await db.select().from(schema.pacientes).where(sql`id LIKE 'prueba-%'`)
    ok('no queda ningun paciente de prueba', quedan.length === 0, `${quedan.length}`)
    const regs = await db.select().from(schema.registros).where(sql`id LIKE 'prueba-%'`)
    ok('ni registros', regs.length === 0, `${regs.length}`)
    const tomb = await db.select().from(schema.borrados).where(sql`id LIKE 'prueba-%'`)
    ok('ni rastros de borrado', tomb.length === 0, `${tomb.length}`)

    // Lo importante: los dos singletons han vuelto a como estaban.
    const ajAhora = await db.select().from(schema.ajustes).where(eq(schema.ajustes.id, 1))
    ok(
      'los ajustes compartidos como estaban',
      ajAhora.length === antesAjustes.length,
      `${ajAhora.length} vs ${antesAjustes.length}`,
    )
    const estAhora = await db.select().from(schema.replica).where(eq(schema.replica.id, 1))
    ok(
      'y la marca de estado tambien',
      estAhora.length === antesReplica.length,
      `${estAhora.length} vs ${antesReplica.length}`,
    )
  } catch (e) {
    fallos++
    console.log(`  FALLO al limpiar: ${e instanceof Error ? e.message : String(e)}`)
  }
  cliente.close()
}

console.log(fallos === 0 ? '\nLA REPLICA FUNCIONA CONTRA LA BASE REAL' : `\n${fallos} FALLOS`)
if (fallos > 0) process.exit(1)
