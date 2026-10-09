/**
 * Pruebas del esquema y de la replica contra una base de verdad.
 *
 *   npm run test:db-turso
 *
 * Se usa un fichero SQLite local en vez de Turso porque el protocolo es el
 * mismo (libSQL habla SQLite) y asi estas pruebas corren sin conexion, sin
 * credenciales y sin tocar datos reales. Lo que no se puede probar aqui es la
 * latencia y los limites del servicio, que solo se ven contra Turso.
 *
 * Lo que se prueba es lo que un `drizzle-kit generate` no puede comprobar: que la
 * migracion aplica, que el `upsert` es idempotente y que una fila mas antigua no
 * pisa una mas nueva. Eso ultimo es lo que sostiene la replica offline: un
 * telefono que estuvo dias sin conexion sube al final datos viejos, y si
 * escalaran sobre datos nuevos, dos dispositivos se picarian datos.
 */

import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { eq, sql } from 'drizzle-orm'
import { readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as schema from '../src/lib/turso/schema'

let fallos = 0
let total = 0
function ok(nombre: string, cond: boolean, extra = '') {
  total++
  if (!cond) {
    fallos++
    console.log('  FALLO:', nombre, extra)
  } else console.log('  ok:', nombre)
}

const fichero = join(tmpdir(), `msv-test-${process.pid}.db`)
const cliente = createClient({ url: `file:${fichero}` })
const db = drizzle(cliente, { schema })

/** Aplica el SQL generado, partiendo por los separadores de Drizzle Kit. */
function aplicarMigracion(sqlTexto: string) {
  for (const bloque of sqlTexto.split('--> statement-breakpoint')) {
    const sentencia = bloque.trim()
    if (sentencia) cliente.execute(sentencia)
  }
}

const reg = (
  id: string,
  fecha: string,
  updatedAt: string,
  sis = 120,
  pacienteId = 'p1',
) => ({
  id,
  pacienteId,
  fecha,
  hora: '08:00',
  presionSis: sis,
  presionDia: 80,
  o2: 97,
  bpm: 70,
  notas: '',
  ejemplo: false,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt,
})

console.log('1. La migracion aplica sobre una base vacia')
{
  for (const migracion of [
    '0000_unique_vermin.sql',
    '0001_handy_silhouette.sql',
    '0002_sweet_nemesis.sql',
  ]) {
    const sqlTexto = readFileSync(new URL(`../drizzle/${migracion}`, import.meta.url), 'utf8')
    try {
      aplicarMigracion(sqlTexto)
      ok(`se aplica ${migracion} sin error`, true)
    } catch (e) {
      ok(`se aplica ${migracion} sin error`, false, String(e))
    }
  }
  const t = await cliente.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' AND name != '_litestream'`,
  )
  const tablas = (t.rows as { name: string }[]).map((r) => r.name).sort()
  ok('crea las 7 tablas', tablas.length === 7, tablas.join(','))
  ok(
    'son las esperadas',
    ['ajustes', 'borrados', 'pacientes', 'registros', 'replica', 'sondas', 'visitas'].every((t) =>
      tablas.includes(t),
    ),
    tablas.join(','),
  )
}

console.log('2. Un paciente y sus registros')
{
  await db.insert(schema.pacientes).values({
    id: 'p1',
    nombre: 'Ana',
    presionHabitual: { sis: 120, dia: 80 },
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
  })
  const pacientesLeidos = await db.select().from(schema.pacientes)
  ok('se guarda y se lee', pacientesLeidos.length === 1)
  // La sonda es por ficha y esta activa por defecto (migracion 0002): un
  // paciente antiguo sin el campo se lee como que si la lleva.
  ok(
    'la sonda se activa por defecto',
    pacientesLeidos[0].sonda === true,
    String(pacientesLeidos[0].sonda),
  )

  // Y se puede desactivar por ficha: la columna guarda el false y lo devuelve.
  await db.update(schema.pacientes).set({ sonda: false }).where(eq(schema.pacientes.id, 'p1'))
  ok(
    'la sonda desactivada se lee como tal',
    (await db.select().from(schema.pacientes))[0].sonda === false,
  )
  await db.update(schema.pacientes).set({ sonda: true }).where(eq(schema.pacientes.id, 'p1'))

  await db.insert(schema.registros).values(reg('r1', '2026-10-01', '2026-10-01T09:00:00.000Z'))
  const leidos = await db.select().from(schema.registros)
  ok('el registro se guarda', leidos.length === 1)
  ok('los numeros no se alteran', leidos[0].presionSis === 120 && leidos[0].o2 === 97)
  ok('el booleano de ejemplo se lee como booleano', leidos[0].ejemplo === false)

  // La sonda es entidad aparte desde la migracion 0001. Un vaciado se guarda en
  // su propia tabla y se lee con su volumen.
  await db.insert(schema.sondas).values({
    id: 's1',
    pacienteId: 'p1',
    fecha: '2026-10-01',
    hora: '09:30',
    volumen: 350,
    notas: '',
    ejemplo: false,
    createdAt: '2026-10-01T09:30:00.000Z',
    updatedAt: '2026-10-01T09:30:00.000Z',
  })
  const leidasSondas = await db.select().from(schema.sondas)
  ok('el vaciado de la sonda se guarda', leidasSondas.length === 1)
  ok('el volumen se conserva', leidasSondas[0].volumen === 350)
}

console.log('3. Subir lo mismo dos veces no crea dos filas')
{
  // Es lo que pasa cuando el telefono sube, se corta la conexion a mitad y
  // vuelve a intentarlo. Si el `upsert` no fuera idempotente, la misma medicion
  // apareceria duplicada en el historial.
  const veces = 3
  for (let i = 0; i < veces; i++) {
    await db
      .insert(schema.registros)
      .values(reg('r2', '2026-10-02', '2026-10-02T09:00:00.000Z'))
      .onConflictDoUpdate({
        target: schema.registros.id,
        set: { updatedAt: '2026-10-02T09:00:00.000Z' },
      })
  }
  ok('sigue habiendo una sola fila', (await db.select().from(schema.registros)).length === 2)
}

console.log('4. Un cambio antiguo no pisa uno nuevo')
{
  // La regla que hace que dos telefonos puedan alternarse sin perder datos. La
  // condicion va en el `where` del `upsert`: si no, el que llegue despues gana
  // siempre, y un telefono que estuvo dias sin conexion perderia su trabajo.
const subir = (fila: ReturnType<typeof reg>) =>
    db
      .insert(schema.registros)
      .values(fila)
      .onConflictDoUpdate({
        target: schema.registros.id,
        set: { presionSis: fila.presionSis, updatedAt: fila.updatedAt },
        // La condicion es la parte importante: `excluded` es la fila que
        // intentaba entrar, asi que solo se acepta si es mas nueva que la que
        // ya estaba. Sin este `where`, el que llegue despues gana siempre y un
        // telefono que estuvo dias sin conexion perderia su trabajo.
        where: sql`excluded.updated_at > ${schema.registros.updatedAt}`,
      })

  await subir(reg('r3', '2026-10-03', '2026-10-03T12:00:00.000Z', 130))
  // Llega una version mas antigua, como si fuera un telefono que lleva dias
  // desconectado.
  await subir(reg('r3', '2026-10-03', '2026-10-01T09:00:00.000Z', 111))
  const tras = await db.select().from(schema.registros).where(sql`id = 'r3'`)
  ok('gana la version mas nueva', tras[0]?.presionSis === 130, `${tras[0]?.presionSis}`)

  // Y al reves: la version antigua si es mas nueva.
  await subir(reg('r3', '2026-10-03', '2026-10-09T09:00:00.000Z', 144))
  const tras2 = await db.select().from(schema.registros).where(sql`id = 'r3'`)
  ok('y entra cuando si es mas nueva', tras2[0]?.presionSis === 144, `${tras2[0]?.presionSis}`)
}

console.log('5. Los borrados se guardan con ambito')
{
  await db.insert(schema.borrados).values([
    { ambito: 'registros', id: 'r9', borradoAt: '2026-10-04T10:00:00.000Z' },
    // El mismo id en otro ambito: por eso la clave es compuesta.
    { ambito: 'visitas', id: 'r9', borradoAt: '2026-10-04T10:00:00.000Z' },
  ])
  const marcas = await db.select().from(schema.borrados)
  ok('no se confunden ambitos', marcas.length === 2)
  // Reintentar el mismo borrado no debe fallar: la clave compuesta lo impide.
  await db
    .insert(schema.borrados)
    .values({ ambito: 'registros', id: 'r9', borradoAt: '2026-10-04T11:00:00.000Z' })
    .onConflictDoUpdate({
      target: [schema.borrados.ambito, schema.borrados.id],
      set: { borradoAt: '2026-10-04T11:00:00.000Z' },
    })
  ok('reintentar el borrado se actualiza', (await db.select().from(schema.borrados)).length === 2)
}

console.log('6. Ajustes: una sola fila, con sus marcas')
{
  await db.insert(schema.ajustes).values({
    id: 1,
    umbral: { o2Min: 90 },
    limites: { o2Min: 70 },
    presionHabitual: { sis: 120, dia: 80 },
    plantillas: [{ id: 'p', texto: 'tras la cena', activa: true }],
    marcas: { umbral: '2026-10-05T10:00:00.000Z' },
    updatedAt: '2026-10-05T10:00:00.000Z',
  })
  const fila = await db.select().from(schema.ajustes)
  ok('guarda una fila', fila.length === 1)
  ok('el JSON de umbral se lee como objeto', fila[0].umbral.o2Min === 90)
  ok('las marcas se leen como objeto', fila[0].marcas.umbral === '2026-10-05T10:00:00.000Z')
  ok('las plantillas se leen como lista', fila[0].plantillas[0].texto === 'tras la cena')
}

console.log('7. Borrar un paciente se lleva sus registros')
{
  // La cascada evita dejar mediciones huerfanas apuntando a una ficha que ya no
  // existe, que es un estado que ni la app ni el informe saben representar.
  const antes = (await db.select().from(schema.registros)).length
  await db.insert(schema.pacientes).values({
    id: 'p2',
    nombre: 'Solo para la cascada',
    createdAt: '2026-10-06T08:00:00.000Z',
    updatedAt: '2026-10-06T08:00:00.000Z',
  })
  await db.insert(schema.registros).values(reg('r4', '2026-10-06', '2026-10-06T09:00:00.000Z', 130, 'p2'))
  await db.delete(schema.pacientes).where(sql`id = 'p2'`)
  ok('desaparecen sus registros', (await db.select().from(schema.registros)).length === antes)
}

console.log('8. La consulta del historial usa el indice')
{
  // Si el indice no cubre (paciente, fecha), el historial recorre la tabla
  // entera, y se nota a partir de unos miles de filas.
  const indices = await cliente.execute(`PRAGMA index_list(registros)`)
  const nombres = (indices.rows as { name: string }[]).map((r) => r.name)
  ok('existe el indice de paciente y fecha', nombres.includes('registros_paciente_fecha'), nombres.join(','))

  const plan = await cliente.execute(
    `EXPLAIN QUERY PLAN SELECT * FROM registros WHERE paciente_id = 'p1' AND fecha = '2026-10-01'`,
  )
  const detalle = JSON.stringify(plan.rows)
  ok('y SQLite lo usa en esa consulta', detalle.includes('registros_paciente_fecha'), detalle)
}

cliente.close()
try {
  unlinkSync(fichero)
} catch {
  // En Windows el fichero puede quedar bloqueado un instante; no es grave.
}
console.log(fallos === 0 ? '\nTODO CORRECTO' : `\n${fallos} FALLOS de ${total}`)
if (fallos > 0) process.exit(1)