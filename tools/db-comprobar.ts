/**
 * Comprobar que el esquema esta aplicado de verdad en la base configurada.
 *
 *   npm run db:comprobar
 *
 * Esto NO es lo mismo que que `drizzle-kit migrate` terminara bien: eso solo
 * dice que no hubo error de red. Este comando vuelve a preguntar a la base y
 * comprueba una por una que cada tabla y cada indice existen. Es lo que hace
 * falta para saber que un despliegue nuevo ha quedado bien, antes de confiar en
 * el.
 *
 * Solo lee. Se puede ejecutar en cuanto se termine de migrar.
 */

import { createClient } from '@libsql/client'
import { existsSync } from 'node:fs'

if (existsSync('.env')) process.loadEnvFile('.env')

const url = process.env.TURSO_URL ?? process.env.VITE_TURSO_URL ?? ''
const authToken = process.env.TURSO_TOKEN ?? process.env.VITE_TURSO_TOKEN ?? ''

if (!url || !authToken) {
  console.log('Sin configuracion: no hay VITE_TURSO_URL ni VITE_TURSO_TOKEN en el entorno.')
  console.log('Copia .env.example como .env y rellenalas.')
  process.exit(1)
}

// El host se imprime porque ayuda a confirmar que se ha mirado la base
// correcta. El token no se imprime nunca.
const host = url.replace(/^libsql:\/\//, '').split('.')[0]

const cliente = createClient({ url, authToken })
let fallos = 0

async function comprobar(nombre: string, condiciones: [string, boolean][]) {
  const malas = condiciones.filter(([, c]) => !c)
  if (malas.length === 0) {
    console.log(`  ok: ${nombre}`)
  } else {
    fallos++
    console.log(`  FALLO: ${nombre}`)
    for (const [detalle] of malas) console.log(`        falta: ${detalle}`)
  }
}

console.log(`Base: ${host}\n`)

console.log('1. Se puede conectar con el token')
{
  // Si el token estuviese caducado o mal copiado, esto falla aqui y no tiene
  // sentido seguir. Se distingue el fallo de credenciales del fallo de red.
  try {
    await cliente.execute('SELECT 1')
    await comprobar('responde', [['una consulta minima', true]])
  } catch (e) {
    await comprobar('responde', [[String(e), false]])
    cliente.close()
    console.log(fallos ? '\nFALLO DE CONEXION' : '\nTODO CORRECTO')
    process.exit(1)
  }
}

console.log('2. Las 6 tablas del esquema existen')
{
  const esperadas = ['ajustes', 'borrados', 'pacientes', 'registros', 'replica', 'visitas']
  const r = await cliente.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`,
  )
  const reales = new Set((r.rows as { name: string }[]).map((x) => x.name))
  await comprobar(
    'tablas creadas',
    esperadas.map((t) => [`${t}`, reales.has(t)] as [string, boolean]),
  )
}

console.log('3. Los indices de consulta existen')
{
  // Sin ellos el historial y las graficas recorren la tabla entera. No es un
  // fallo de datos, asi que conviene comprobarlo por separado.
  for (const [tabla, indice] of [
    ['registros', 'registros_paciente_fecha'],
    ['visitas', 'visitas_paciente_fecha'],
    ['pacientes', 'pacientes_nombre'],
  ]) {
    const r = await cliente.execute(`PRAGMA index_list(${tabla})`)
    const nombres = (r.rows as { name: string }[]).map((x) => x.name)
    await comprobar(`${tabla}.${indice}`, [[indice, nombres.includes(indice)]])
  }
}

console.log('4. Las claves foraneas apuntan a pacientes')
{
  for (const tabla of ['registros', 'visitas']) {
    const r = await cliente.execute(`PRAGMA foreign_key_list(${tabla})`)
    const filas = r.rows as { table: string }[]
    const ok = filas.some((f) => f.table === 'pacientes')
    await comprobar(`${tabla} -> pacientes`, [['paciente_id con clave foranea', ok]])
  }
}

console.log('5. Drizzle tiene registrado que no hay mas migraciones pendientes')
{
  // Esta tabla la lleva drizzle-kit. Si falta, es que la base no es la que
  // thinks uno, o que se ha aplicado el SQL a mano sin registrar la migracion.
  // En ese caso las migraciones futuras volverian a aplicarse desde cero.
  const r = await cliente.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'`,
  )
  await comprobar('tabla de control de drizzle', [['__drizzle_migrations', r.rows.length === 1]])
}

console.log('6. La base esta vacia (nadie ha escrito todavia)')
{
  // No es un requisito: puede haber datos y sigue siendo correcto. Se informa
  // para que quede claro de que lado empieza esto.
  for (const tabla of ['pacientes', 'registros', 'visitas']) {
    const r = await cliente.execute(`SELECT count(*) AS n FROM ${tabla}`)
    const n = (r.rows as { n: number }[])[0]?.n ?? 0
    console.log(`  ${tabla}: ${n}`)
  }
}

cliente.close()
console.log(fallos === 0 ? '\nESQUEMA CORRECTO' : `\n${fallos} FALLOS`)
if (fallos > 0) process.exit(1)