/**
 * Pruebas de la sincronizacion contra una API de Drive simulada.
 *
 *   npm run test:sync
 *
 * Se prueba lo que no se puede probar en el navegador sin una cuenta de verdad:
 * que un fichero corrupto o de otra app no pueda pisar datos, que dos
 * sincronizaciones seguidas no se inventen cambios, y que una subida a medias
 * no borre lo que ya estaba en Drive.
 */

import { RemotoDanado, esPaqueteValido, olvidarRemoto, resumirCambios, sincronizar } from '../src/lib/sincronizar'
import { construirBackup, leerBackup } from '../src/lib/exportar'
import type { AjustesCompartidos, Borrado, MarcasCompartidas, Paciente, Registro, Visita } from '../src/lib/tipos'
import { AJUSTES_POR_DEFECTO } from '../src/lib/rangos'

let fallos = 0
let total = 0
function ok(nombre: string, cond: boolean, extra = '') {
  total++
  if (!cond) {
    fallos++
    console.log('  FALLO:', nombre, extra)
  } else console.log('  ok:', nombre)
}

// ---------------------------------------------------------------------------
// Drive simulado
// ---------------------------------------------------------------------------

/** Estado del Drive falso entre llamadas. */
const drive = { ficheros: new Map<string, { nombre: string; cuerpo: string }>(), siguienteId: 1, llamadas: [] as string[] }

/** Respuestas que se anteponen a la logica, para probar fallos. */
let fallo: { status: number; cuerpo?: string } | null = null

/** El `globalThis.fetch` que se guarda antes de sustituirlo. */
const fetchOriginal = globalThis.fetch

function instalarFetch() {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url)
    drive.llamadas.push(`${init?.method ?? 'GET'} ${u.replace('https://www.googleapis.com', '')}`)
    if (fallo) return respuestaJSON(fallo.status, fallo.cuerpo ?? {})
    // El orden importa: la URL de subida tambien contiene `/files?`, asi que si
    // se comprobara la busqueda primero, la creacion del fichero se tomaria por
    // un listado y jamas se escribiria nada.
    if (u.includes('upload/drive')) {
      // El cuerpo de la creacion es un `Blob`, y `String(blob)` daria
      // "[object Blob]": hay que leer su texto para poder comprobarlo.
      const cuerpo = init?.body
      const crudo = cuerpo instanceof Blob ? await cuerpo.text() : String(cuerpo ?? '')
      // Enviado por multipart: el JSON que interesa es la ultima parte, tras el
      // segundo separador de linea en blanco. El PATCH lo manda en crudo.
      const partes = crudo.split('\r\n\r\n')
      const contenido =
        init?.method === 'PATCH'
          ? crudo
          : (partes[partes.length - 1] ?? '').replace(/\r\n--paquete--\r\n?$/, '')
      const id =
        init?.method === 'PATCH'
          ? u.split('/files/')[1].split('?')[0]
          : `f${drive.siguienteId++}`
      drive.ficheros.set(id, { nombre: 'datos.json', cuerpo: contenido })
      return respuestaJSON(200, JSON.stringify({ id }))
    }
    if (init?.method === 'DELETE') {
      const id = u.split('/files/')[1].split('?')[0]
      drive.ficheros.delete(id)
      return new Response(null, { status: 204 })
    }
    if (u.includes('/files?')) {
      const encontrados = [...drive.ficheros.entries()].map(([id, f]) => ({ id, name: f.nombre }))
      return respuestaJSON(200, JSON.stringify({ files: encontrados }))
    }
    if (u.includes('alt=media')) {
      const id = u.split('/files/')[1].split('?')[0]
      const f = drive.ficheros.get(id)
      if (!f) return respuestaJSON(404, '{}')
      return new Response(f.cuerpo, { status: 200 })
    }
    return respuestaJSON(404, '{}')
  }) as typeof fetch
}

function respuestaJSON(status: number, cuerpo: string): Response {
  return new Response(cuerpo, { status, headers: { 'Content-Type': 'application/json' } })
}

instalarFetch()

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

const ajustes: AjustesCompartidos = {
  umbral: AJUSTES_POR_DEFECTO.umbral,
  limites: AJUSTES_POR_DEFECTO.limites,
  presionHabitual: AJUSTES_POR_DEFECTO.presionHabitual,
  plantillas: [],
}
const marcasVacias: MarcasCompartidas = {}

function reg(id: string, updatedAt: string, presionSis = 120): Registro {
  return {
    id,
    fecha: '2026-10-01',
    hora: '08:00',
    presionSis,
    presionDia: 80,
    o2: 97,
    bpm: 70,
    orina: null,
    notas: '',
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt,
  }
}

const localBase = {
  registros: [reg('a', '2026-10-01T09:00:00Z', 120)],
  visitas: [] as Visita[],
  pacientes: [] as Paciente[],
  borrados: [] as Borrado[],
  ajustes,
  marcas: marcasVacias,
}

const remotoBase = {
  registros: [reg('b', '2026-10-01T10:00:00Z', 130)],
  visitas: [] as Visita[],
  pacientes: [] as Paciente[],
  borrados: [] as Borrado[],
  ajustes,
  marcas: marcasVacias,
}

function sembrar(paquete: unknown) {
  drive.ficheros.set('f0', { nombre: 'datos.json', cuerpo: JSON.stringify(paquete) })
}

function paqueteDe(d: Partial<typeof remotoBase> = {}) {
  return construirBackup({ ...remotoBase, ...d })
}

// ---------------------------------------------------------------------------
// Pruebas
// ---------------------------------------------------------------------------

console.log('1. Validacion del fichero remoto')
ok('acepta un paquete propio', esPaqueteValido(JSON.stringify(paqueteDe())))
ok('acepta un backup antiguo sin borrados ni ajustes', esPaqueteValido(JSON.stringify({ app: 'signos-vitales', version: 1, registros: [reg('a', '2026-10-01T09:00:00Z')] })))
ok('acepta un paquete solo de ajustes', esPaqueteValido(JSON.stringify({ app: 'signos-vitales', version: 3, ajustes })))
ok('rechaza un texto vacio', !esPaqueteValido('   '))
ok('rechaza algo que no es JSON', !esPaqueteValido('esto no es json'))
ok('rechaza un array', !esPaqueteValido('[]'))
ok('rechaza otra app', !esPaqueteValido(JSON.stringify({ app: 'otra-cosa', registros: [] })))
ok('rechaza una version desconocida', !esPaqueteValido(JSON.stringify({ app: 'signos-vitales', version: 99, registros: [] })))
ok('rechaza un objeto vacio con la marca correcta', !esPaqueteValido(JSON.stringify({ app: 'signos-vitales', version: 3 })))
ok('rechaza registros que no son una lista', !esPaqueteValido(JSON.stringify({ app: 'signos-vitales', version: 3, registros: 'esto no es una lista' })))
ok('rechaza visitas que no son una lista', !esPaqueteValido(JSON.stringify({ app: 'signos-vitales', version: 3, visitas: 42 })))
ok('rechaza marcas que no son un objeto', !esPaqueteValido(JSON.stringify({ app: 'signos-vitales', version: 3, registros: [], marcas: [] })))
ok('rechaza marcas con valores que no son cadenas', !esPaqueteValido(JSON.stringify({ app: 'signos-vitales', version: 3, registros: [], marcas: { umbral: 123 } })))
ok('rechaza un tombstone sin id', !esPaqueteValido(JSON.stringify({ app: 'signos-vitales', version: 3, registros: [], borrados: [{ ambito: 'registros', borradoAt: '2026-10-01T10:00:00Z' }] })))
ok('rechaza un tombstone con ambito desconocido', !esPaqueteValido(JSON.stringify({ app: 'signos-vitales', version: 3, registros: [], borrados: [{ ambito: 'inventado', id: 'a', borradoAt: '2026-10-01T10:00:00Z' }] })))
ok('rechaza un tombstone sin fecha', !esPaqueteValido(JSON.stringify({ app: 'signos-vitales', version: 3, registros: [], borrados: [{ ambito: 'registros', id: 'a' }] })))
ok('acepta un tombstone bien formado', esPaqueteValido(JSON.stringify({ app: 'signos-vitales', version: 3, registros: [], borrados: [{ ambito: 'registros', id: 'a', borradoAt: '2026-10-01T10:00:00Z' }] })))

console.log('2. Primer ciclo sin fichero en Drive')
{
  drive.ficheros.clear()
  drive.llamadas.length = 0
  const { resumen, paquete } = await sincronizar(localBase, 'token')
  ok('crea el fichero', resumen.creado === true)
  ok('sube los datos locales', paquete.registros.length === 1)
  ok('no inventa entradas', resumen.registros.entraron === 0)
  ok('no reporta pixados', resumen.registros.pisados === 0)
  ok('el fichero existe en Drive', drive.ficheros.size === 1)
  ok('el contenido es un paquete valido', esPaqueteValido([...drive.ficheros.values()][0].cuerpo))
}

console.log('3. Traer datos de otro dispositivo')
{
  drive.ficheros.clear()
  sembrar(paqueteDe())
  const { resumen, paquete } = await sincronizar(localBase, 'token')
  ok('entra lo que no teniamos', resumen.registros.entraron === 1, `${resumen.registros.entraron}`)
  ok('la union tiene los dos', paquete.registros.length === 2)
  ok('el remoto queda guardado tambien', [...drive.ficheros.values()][0].cuerpo.includes('"b"'))
  // `a` estaba solo aqui, asi que forma parte de lo que se sube. Contarlo como
  // "enviado" y no como perdida es justo el matiz de `enviables`.
  ok('cuenta lo que se sube', resumen.enviados === 1, `${resumen.enviados}`)
}

console.log('4. Editar el mismo registro en los dos sitios')
{
  drive.ficheros.clear()
  sembrar(paqueteDe({ registros: [reg('a', '2026-10-01T12:00:00Z', 999)] }))
  const { resumen, paquete } = await sincronizar(localBase, 'token')
  const fusionado = paquete.registros.find((r) => r.id === 'a')
  ok('gana la version mas nueva', fusionado?.presionSis === 999, `${fusionado?.presionSis}`)
  ok('y se avisa de que se ha cambiado', resumen.registros.pisados === 1)
  // Lo que se sube debe ser la version que ha ganado, no la que teniamos antes.
  ok('Drive se queda con la version ganadora', [...drive.ficheros.values()][0].cuerpo.includes('999'))
}

console.log('5. Un borrado del otro dispositivo no resucita')
{
  drive.ficheros.clear()
  const paquete = paqueteDe()
  paquete.borrados = [{ ambito: 'registros', id: 'a', borradoAt: '2026-10-01T13:00:00.000Z' }]
  sembrar(paquete)
  const { resumen, paquete: subido } = await sincronizar(localBase, 'token')
  ok('el registro desaparece', subido.registros.every((r) => r.id !== 'a'))
  ok('y se cuenta como borrado', resumen.registros.borradosAplicados === 1, `${resumen.registros.borradosAplicados}`)
  ok('la marca viaja de vuelta a Drive', JSON.parse([...drive.ficheros.values()][0].cuerpo).borrados.length === 1)
}

console.log('6. Sincronizar dos veces no inventa nada')
{
  drive.ficheros.clear()
  sembrar(paqueteDe())
  const uno = await sincronizar(localBase, 'token')
  // Se sincroniza otra vez con lo ya fusionado, que es lo que pasara al
  // pulsar el boton dos veces.
  const estado = {
    registros: uno.paquete.registros,
    visitas: uno.paquete.visitas,
    pacientes: uno.paquete.pacientes,
    borrados: uno.paquete.borrados ?? [],
    ajustes: uno.paquete.ajustes ?? ajustes,
    marcas: uno.paquete.marcas ?? marcasVacias,
  }
  const dos = await sincronizar(estado, 'token')
  ok('no aparecen datos nuevos', dos.resumen.registros.entraron === 0, `${dos.resumen.registros.entraron}`)
  ok('no se pisa nada', dos.resumen.registros.pisados === 0)
  ok('no se borra nada', dos.resumen.registros.borradosAplicados === 0)
  ok('el contenido no cambia', JSON.stringify(dos.paquete.registros) === JSON.stringify(uno.paquete.registros))
}

console.log('7. Un fichero danado se rechaza sin tocar nada')
{
  // Un backup puede ser la unica copia de datos que todavia no estan en este
  // dispositivo. Sobescribirlo en silencio perderia esos datos y nadie se
  // enteraria, asi que sincronizar falla y deja que sea la persona quien decida.
  const danados: [string, unknown][] = [
    ['registros que no son una lista', { app: 'signos-vitales', version: 3, registros: 'esto no es una lista' }],
    ['ajustes con forma rara', { app: 'signos-vitales', version: 3, registros: [], ajustes: { umbral: 'un numero' } }],
    ['marcas que no son fechas', { app: 'signos-vitales', version: 3, registros: [], marcas: { umbral: 'ayer' } }],
    ['tombstone sin id', { app: 'signos-vitales', version: 3, registros: [], borrados: [{ ambito: 'registros' }] }],
  ]
  for (const [nombre, contenido] of danados) {
    drive.ficheros.clear()
    sembrar(contenido)
    const antes = [...drive.ficheros.values()][0].cuerpo
    let error: unknown = null
    try {
      await sincronizar(localBase, 'token')
    } catch (e) {
      error = e
    }
    ok(`rechaza ${nombre}`, error instanceof RemotoDanado, String(error))
    ok(`  y no reescribe el fichero de Drive`, [...drive.ficheros.values()][0].cuerpo === antes)
  }
}

console.log('8. Ajustes compartidos, sin arrastrar lo del dispositivo')
{
  drive.ficheros.clear()
  const remoto = {
    ...paqueteDe(),
    ajustes: { ...ajustes, umbral: { ...ajustes.umbral, o2Min: 88 } },
    marcas: { umbral: '2026-10-01T14:00:00.000Z' },
  }
  sembrar(remoto)
  const { paquete } = await sincronizar(localBase, 'token')
  ok('entra el umbral remoto mas nuevo', paquete.ajustes?.umbral.o2Min === 88, `${paquete.ajustes?.umbral.o2Min}`)
  ok('el paquete no lleva tema ni pacienteActivo', !('tema' in (paquete.ajustes ?? {})) && !('pacienteActivo' in (paquete.ajustes ?? {})))
}

console.log('9. Fallos de red')
{
  drive.ficheros.clear()
  sembrar(paqueteDe())
  fallo = { status: 0 }
  let error: unknown = null
  try {
    await sincronizar(localBase, 'token')
  } catch (e) {
    error = e
  }
  fallo = null
  ok('propaga un error legible', error instanceof Error && /conexion/i.test(error.message), String(error))
  ok('y el fichero de Drive no se toca', [...drive.ficheros.values()][0].cuerpo.includes('"b"'))
}

console.log('10. Error de sesion caducada')
{
  fallo = { status: 401 }
  let error: unknown = null
  try {
    await sincronizar(localBase, 'token')
  } catch (e) {
    error = e
  }
  fallo = null
  ok('dice que hay que volver a conectar', error instanceof Error && /caducado/i.test(error.message), String(error))
}

console.log('11. Olvidar la copia remota')
{
  drive.ficheros.clear()
  sembrar(paqueteDe())
  await olvidarRemoto('token')
  ok('borra el fichero', drive.ficheros.size === 0)
  await olvidarRemoto('token')
  ok('no falla si ya no habia nada', true)
}

console.log('12. Resumen legible para la persona')
{
  drive.ficheros.clear()
  sembrar(paqueteDe())
  const { resumen } = await sincronizar(localBase, 'token')
  const texto = resumirCambios(resumen)
  ok('menciona los datos nuevos', /datos nuevos/.test(texto ?? ''), String(texto))
  const vacio = {
    ...resumen,
    registros: { ...resumen.registros, entraron: 0 },
    enviados: 0,
  }
  ok('avisa cuando no hay nada que hacer', resumirCambios(vacio) === 'Todo ya estaba sincronizado')
}

console.log('13. Un backup con ajustes raros no rompe la app')
{
  // `leerBackup` es el unico lector, y alimenta tanto Drive como "Restaurar".
  // Si un `umbral` llega como cadena, `ajustes.umbral.o2Min` revienta al pintar.
  const base = { app: 'signos-vitales', version: 3, registros: [reg('a', '2026-10-01T09:00:00Z')] }
  const r1 = leerBackup(JSON.stringify({ ...base, ajustes: { umbral: 'hola' } }))
  ok('descarta un umbral que no es un registro de numeros', r1.ajustes === null, JSON.stringify(r1.ajustes))
  const r2 = leerBackup(JSON.stringify({ ...base, ajustes: { umbral: { ...ajustes.umbral, o2Min: 91 } } }))
  ok('conserva un umbral valido', r2.ajustes?.umbral.o2Min === 91)
  const r3 = leerBackup(JSON.stringify({ ...base, ajustes: { umbral: { o2Min: 'mucho' } } }))
  ok('descarta un umbral con un campo que no es numero', r3.ajustes === null, JSON.stringify(r3.ajustes))
  const r4 = leerBackup(JSON.stringify({ ...base, ajustes: { umbral: 'hola', plantillas: [{ id: 'p', texto: 'x', activa: true }] } }))
  ok('conserva el campo bueno y tira el malo', r4.ajustes?.plantillas.length === 1 && r4.ajustes?.umbral === undefined, JSON.stringify(r4.ajustes))
  const r5 = leerBackup(JSON.stringify({ ...base, ajustes: { umbral: 'hola' }, marcas: { umbral: 'ayer' } }))
  ok('descarta la marca de un campo descartado', r5.marcas.umbral === undefined, JSON.stringify(r5.marcas))
  const r6 = leerBackup(JSON.stringify({ ...base, ajustes: { umbral: ajustes.umbral }, marcas: { umbral: '2026-10-01T10:00:00.000Z' } }))
  ok('conserva una marca con fecha real', r6.marcas.umbral === '2026-10-01T10:00:00.000Z')
  const r6b = leerBackup(JSON.stringify({ ...base, marcas: { umbral: '2026-10-01T10:00:00.000Z' } }))
  // Una marca sin su valor no se conserva: si se guardara, al fusionar ganaria
  // el remoto y asignaria `undefined` sobre un umbral que aqui si es bueno.
  ok('descarta una marca cuyo valor no viene', r6b.marcas.umbral === undefined, JSON.stringify(r6b.marcas))
  const r7 = leerBackup(JSON.stringify({ ...base, ajustes: { umbral: ajustes.umbral }, marcas: { campoInventado: '2026-10-01T10:00:00.000Z' } }))
  ok('descarta una marca de un campo que no existe', r7.marcas.campoInventado === undefined)
}

console.log('14. Un backup que solo trae borrados es valido')
{
  // Es lo que genera un dispositivo donde solo se ha borrado algo. Si se
  // rechazara por no tener mediciones, el borrado nunca llegaria al otro lado.
  const soloBorrados = { app: 'signos-vitales', version: 3, registros: [], borrados: [{ ambito: 'registros', id: 'a', borradoAt: '2026-10-01T10:00:00.000Z' }] }
  ok('pasa la validacion', esPaqueteValido(JSON.stringify(soloBorrados)))
  const leido = leerBackup(JSON.stringify(soloBorrados))
  ok('se leen sus borrados', leido.borrados.length === 1 && leido.borrados[0].id === 'a')
  const soloAjustes = { app: 'signos-vitales', version: 3, ajustes }
  ok('y un backup solo de ajustes tambien', esPaqueteValido(JSON.stringify(soloAjustes)))
}
// Se devuelve el `fetch` real antes de resumir, para que nada de lo que se
// imprima a partir de aqui salga por una red simulada.
globalThis.fetch = fetchOriginal

console.log(fallos === 0 ? '\nTODO CORRECTO' : `\n${fallos} FALLOS de ${total}`)
if (fallos > 0) process.exit(1)
