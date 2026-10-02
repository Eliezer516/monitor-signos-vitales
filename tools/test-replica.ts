/**
 * El ciclo de replica, contra un SQLite de verdad.
 *
 *   npm run test:replica
 *
 * Aqui no se comprueba que el codigo llame a las funciones correctas, sino lo unico
 * que importa: que dos dispositivos que sincronizan en distinto orden acaban con
 * exactamente lo mismo, y que nada desaparece por el camino.
 *
 * Se usa un fichero local y no Turso a proposito. Lo que se falla aqui son bugs de
 * logica, no de red: que `excluded.updatedAt > updatedAt` no llegue a SQLite por un
 * `sql.raw` mal escrito, que un `upsert` se lleve por delante una columna que no
 * iba, que un tombstone se escriba pero la fila se quede. Un test que necesita red
 * para detectar eso se acaba omitiendo. La red se prueba aparte, en `db:probar`.
 */

import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { AJUSTES_POR_DEFECTO } from '../src/lib/rangos'
import { leerReparto, pacienteACrear, repartir } from '../src/lib/turso/mapeo'
import { sincronizar, type EstadoReplicable } from '../src/lib/turso/replica'
import * as schema from '../src/lib/turso/schema'
import type {
  AjustesCompartidos,
  Ambito,
  Borrado,
  Paciente,
  Registro,
  Visita,
} from '../src/lib/tipos'

let fallos = 0
let total = 0
function ok(nombre: string, cond: boolean, extra = '') {
  total++
  if (!cond) {
    fallos++
    console.log('  FALLO:', nombre, extra)
  } else console.log('  ok:', nombre)
}

const ajustes: AjustesCompartidos = {
  umbral: AJUSTES_POR_DEFECTO.umbral,
  limites: AJUSTES_POR_DEFECTO.limites,
  presionHabitual: AJUSTES_POR_DEFECTO.presionHabitual,
  plantillas: [],
}

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

/** Se construye a mano y no con `db.ts`: ese escribe en IndexedDB y aqui no hay. */
const borro = (ambito: Ambito, id: string, borradoAt: string): Borrado[] => [
  { ambito, id, borradoAt },
]

/** Un dispositivo con su parte de estado local. */
function dispositivo(parcial: Partial<EstadoReplicable> = {}): EstadoReplicable {
  return {
    registros: [],
    visitas: [],
    pacientes: [],
    borrados: [],
    ajustes,
    marcas: {},
    pacienteActivo: null,
    ...parcial,
  }
}

const ruta = join(tmpdir(), `msv-replica-${process.pid}.db`)
const cliente = createClient({ url: `file:${ruta}` })
const db = drizzle(cliente, { schema })

/**
 * Aplica el SQL generado, partiendo por los separadores de Drizzle Kit.
 *
 * Se aplica el fichero de verdad y no una definicion hecha a mano: si `schema.ts` y
 * `drizzle/` se desincronizasen, el test estaria probando una base de datos que no
 * es la que se despliega, y pasaria sin avisar.
 */
{
  const sqlTexto = readFileSync(
    new URL('../drizzle/0000_unique_vermin.sql', import.meta.url),
    'utf8',
  )
  for (const bloque of sqlTexto.split('--> statement-breakpoint')) {
    const sentencia = bloque.trim()
    if (sentencia) await cliente.execute(sentencia)
  }
}

const leerFilas = async () => ({
  registros: await db.select().from(schema.registros),
  visitas: await db.select().from(schema.visitas),
  pacientes: await db.select().from(schema.pacientes),
  borrados: await db.select().from(schema.borrados),
  ajustes: await db.select().from(schema.ajustes),
})
const pacienteEnBase = async () => (await db.select().from(schema.pacientes))[0]

/** Id de la ficha que se borra en el paso 7, para poder referenciarla despues. */
let idFichaBorrada = ''

console.log('1. El primer ciclo crea la ficha y sube las mediciones')
{
  const r = await sincronizar(
    dispositivo({
      registros: [reg('r1', '2026-10-01T09:00:00.000Z')],
      visitas: [vis('v1', '2026-10-02T09:00:00.000Z')],
    }),
    db,
  )
  ok(
    'informa de la ficha creada',
    r.pacienteCreado?.nombre === 'Paciente 1',
    String(r.pacienteCreado?.nombre),
  )
  ok('no dice que moviera nada', r.movidos === 0, String(r.movidos))

  const filas = await leerFilas()
  ok('sube el registro', filas.registros.length === 1, String(filas.registros.length))
  ok('sube la visita', filas.visitas.length === 1, String(filas.visitas.length))
  ok('crea el paciente', filas.pacientes.length === 1, String(filas.pacientes.length))
  ok(
    'el registro queda atribuido a esa ficha',
    filas.registros[0]?.pacienteId === filas.pacientes[0]?.id,
    `${filas.registros[0]?.pacienteId} vs ${filas.pacientes[0]?.id}`,
  )
  ok('la visita tambien', filas.visitas[0]?.pacienteId === filas.pacientes[0]?.id)
  ok('guarda los ajustes compartidos', filas.ajustes.length === 1)
}

console.log('2. Un segundo ciclo con la ficha ya creada no inventa otra')
{
  const anterior = await pacienteEnBase()
  const r = await sincronizar(
    dispositivo({
      registros: [reg('r1', '2026-10-01T09:00:00.000Z'), reg('r2', '2026-10-01T10:00:00.000Z')],
      pacientes: [anterior],
      pacienteActivo: anterior.id,
    }),
    db,
  )
  ok('no crea ficha nueva', r.pacienteCreado === null)
  const filas = await leerFilas()
  ok('sigue habiendo una sola ficha', filas.pacientes.length === 1, String(filas.pacientes.length))
  ok('no duplica el registro ya subido', filas.registros.length === 2, String(filas.registros.length))
}

console.log('3. Dos dispositivos convergen al mismo contenido')
{
  // Telefono B, que hasta ahora no habia visto nada.
  const rB = await sincronizar(
    dispositivo({
      registros: [reg('r9', '2026-10-03T09:00:00.000Z')],
      visitas: [vis('v9', '2026-10-03T09:00:00.000Z')],
    }),
    db,
  )
  ok(
    'B sube lo suyo y nada mas',
    rB.resumen.enviados === 2,
    `enviados=${rB.resumen.enviados}`,
  )
  ok('B recibe lo que ya estaba', rB.paquete.registros.some((x) => x.id === 'r1'))
  ok('y se queda con la ficha de los demas', rB.paquete.pacientes.length === 1, String(rB.paquete.pacientes.length))

  // A parte de lo suyo, recibe lo de B, y al reenviar no pierde nada.
  const rA = await sincronizar(
    dispositivo({
      registros: [
        reg('r1', '2026-10-01T09:00:00.000Z'),
        reg('r2', '2026-10-01T10:00:00.000Z'),
        reg('r9', '2026-10-03T09:00:00.000Z'),
      ],
      visitas: [vis('v1', '2026-10-02T09:00:00.000Z'), vis('v9', '2026-10-03T09:00:00.000Z')],
      pacientes: [await pacienteEnBase()],
    }),
    db,
  )
  const filas = await leerFilas()
  ok('A termina con los 3 registros', filas.registros.length === 3, String(filas.registros.length))
  ok('A termina con las 2 visitas', filas.visitas.length === 2, String(filas.visitas.length))
  ok(
    'A no pierde nada al reenviar',
    rA.paquete.registros.length === 3,
    String(rA.paquete.registros.length),
  )
  ok('sin cambios de ajuste', rA.resumen.ajustes === 0, String(rA.resumen.ajustes))
}

console.log('4. Un conflicto lo gana el mas nuevo, en todas las columnas')
{
  // Local va mas atras en el reloj, asi que no debe ganar.
  await sincronizar(
    dispositivo({
      registros: [reg('r1', '2026-10-01T09:00:00.000Z'), reg('r2', '2026-10-01T10:00:00.000Z', 111)],
      visitas: [],
      pacientes: [await pacienteEnBase()],
    }),
    db,
  )
  const viejo = await db.select().from(schema.registros).where(eq(schema.registros.id, 'r2'))
  ok('un cambio mas viejo no pisa', viejo[0]?.presionSis === 120, String(viejo[0]?.presionSis))

  // Y ahora uno mas nuevo, que si debe ganar, y en la columna del dato.
  await sincronizar(
    dispositivo({
      registros: [reg('r1', '2026-10-01T09:00:00.000Z'), reg('r2', '2026-10-05T10:00:00.000Z', 133)],
      visitas: [],
      pacientes: [await pacienteEnBase()],
    }),
    db,
  )
  const nuevo = await db.select().from(schema.registros).where(eq(schema.registros.id, 'r2'))
  ok('un cambio mas nuevo si pisa', nuevo[0]?.presionSis === 133, String(nuevo[0]?.presionSis))
}

console.log('5. Renombrar un paciente cambia el nombre de verdad')
{
  // El fallo que hace el `set` mal escrito: actualizar solo `updatedAt` deja el
  // nombre viejo para siempre y no dice nada.
  const p = await pacienteEnBase()
  await sincronizar(
    dispositivo({
      pacientes: [{ ...p, nombre: 'Ana Lopez', updatedAt: '2026-10-06T09:00:00.000Z' }],
      pacienteActivo: p.id,
    }),
    db,
  )
  const tras = await pacienteEnBase()
  ok('el nombre se actualiza', tras.nombre === 'Ana Lopez', tras.nombre)
}

console.log('6. Un tombstone borra la fila de verdad, no solo deja el rastro')
{
  const p = await pacienteEnBase()
  await sincronizar(
    dispositivo({
      registros: [reg('r1', '2026-10-01T09:00:00.000Z')],
      pacientes: [p],
      borrados: borro('registros', 'r1', '2026-10-06T10:00:00.000Z'),
      pacienteActivo: p.id,
    }),
    db,
  )
  const filas = await leerFilas()
  ok(
    'la medicion desaparece de la base',
    !filas.registros.some((x) => x.id === 'r1'),
    filas.registros.map((x) => x.id).join(','),
  )
  ok('el resto se queda', filas.registros.length === 2, String(filas.registros.length))
  ok('deja constancia del borrado', filas.borrados.length === 1, String(filas.borrados.length))
}

console.log('7. Borrar un paciente se lleva tambien sus mediciones')
{
  const p = await pacienteEnBase()
  idFichaBorrada = p.id
  const antes = await db.select().from(schema.registros)
  await sincronizar(
    dispositivo({ borrados: borro('pacientes', p.id, '2026-10-06T11:00:00.000Z') }),
    db,
  )
  const filas = await leerFilas()
  ok('ya no hay pacientes', filas.pacientes.length === 0, String(filas.pacientes.length))
  ok(
    'y sus mediciones se fueron con el',
    filas.registros.length === 0,
    `${filas.registros.length} de ${antes.length}`,
  )
}

console.log('8. Borrar la ficha y seguir midiendo funciona')
{
  // El caso que hace que el borrado de un paciente tenga que tratarse aparte: en el
  // mismo ciclo llega la ficha borrada y medicion nueva. Si al contar las fichas se
  // mirase la borrada, creeria que ya hay una donde atribuirlas, no crearia
  // ninguna, y la medicion nueva no tendria donde guardarse.
  const r = await sincronizar(
    dispositivo({
      registros: [reg('n1', '2026-10-07T09:00:00.000Z')],
      borrados: borro('pacientes', idFichaBorrada, '2026-10-06T11:00:00.000Z'),
    }),
    db,
  )
  ok('crea ficha nueva pese al borrado', r.pacienteCreado !== null)
  const filas = await leerFilas()
  ok('el registro nuevo se sube', filas.registros.length === 1, String(filas.registros.length))
  ok('y no revive lo borrado', !filas.registros.some((x) => x.id === 'r1'))
  ok('la ficha nueva es distinta de la borrada', filas.pacientes[0]?.id !== idFichaBorrada)
}

console.log('9. La atribucion de pacientes es estable')
{
  // La parte fina, y la que mas caro sale si se equivoca: la app guarda un unico
  // paciente activo, asi que atribuir "al activo de ahora" moveria en cada ciclo
  // todas las mediciones ya subidas, y dos personas acabarian mezcladas. Aqui se
  // comprueba que no.
  type FilaR = Parameters<typeof leerReparto>[0][number]
  const reparto = leerReparto([{ id: 'r1', pacienteId: 'pA' } as FilaR], [])

  const estable = repartir([{ id: 'r1' }, { id: 'r2' }], reparto.registros, new Set(['pA', 'pB']), 'pB')
  ok('una fila ya atribuida se queda', estable.asignados.get('r1') === 'pA', String(estable.asignados.get('r1')))
  ok('una nueva va al destino', estable.asignados.get('r2') === 'pB', String(estable.asignados.get('r2')))
  ok('no cuenta como movimiento', estable.movidos === 0, String(estable.movidos))

  const huerfano = repartir([{ id: 'r1' }], reparto.registros, new Set(['pB']), 'pB')
  ok('si la ficha se borro, se mueve', huerfano.asignados.get('r1') === 'pB')
  ok('y se cuenta como movimiento', huerfano.movidos === 1, String(huerfano.movidos))
}

console.log('10. Crear la ficha solo cuando hace falta')
{
  ok('no hace falta con cero filas', pacienteACrear(null, [], 0) === null)
  ok('hace falta con filas y sin fichas', pacienteACrear(null, [], 3) !== null)
  ok('no hace falta si ya hay ficha', pacienteACrear(null, [paciente('p1', 'Ana', 'x')], 3) === null)
  ok(
    'reutiliza el id activo si su ficha no esta',
    pacienteACrear('p9', [], 2)?.id === 'p9',
    String(pacienteACrear('p9', [], 2)?.id),
  )
}

console.log('11. Queda registrado cuando se sincronizo')
{
  const filas = await db.select().from(schema.replica)
  ok('hay una fila de estado', filas.length === 1, String(filas.length))
  ok('con las dos marcas', !!filas[0]?.ultimoEnviado && !!filas[0]?.ultimoRecibido)
}

console.log(`\n${total - fallos}/${total} pruebas correctas`)
if (fallos > 0) process.exit(1)