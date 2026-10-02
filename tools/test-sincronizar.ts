/**
 * Pruebas de la fusion entre dispositivos.
 *
 *   npm run test:sincronizar
 *
 * Aqui ya no hay ninguna red simulada, porque la fusion es pura: se le da lo que
 * hay en este dispositivo y lo que hay fuera, y se comprueba que sale la union.
 * Eso es justo lo que hay que probar en el nucleo que comparten todos los
 * destinos, incluidos los que todavia no existen.
 *
 * Estas pruebas salen de las que cubrian el ciclo con Drive. Se conserva todo lo
 * que no dependia de la API de Google: la validacion del paquete, la union de
 * datos, la edicion simultanea, los borrados, la idempotencia, los ajustes
 * compartidos y los avisos. Se ha perdido, y hay que rehacerlo con el transporte
 * que lo sustituya, lo que probaba el almacenamiento remoto: que un paquete
 * danado no se sobrescriba en silencio, que un fallo de red no se traguen datos
 * y que se pueda recuperar de una sesion caducada.
 */

import { esPaqueteValido, fusionarPaquetes, resumirCambios, type EstadoLocal } from '../src/lib/sincronizar'
import { construirBackup, leerBackup } from '../src/lib/exportar'
import type {
  AjustesCompartidos,
  Borrado,
  MarcasCompartidas,
  Paciente,
  Registro,
  Visita,
} from '../src/lib/tipos'
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

const local: EstadoLocal = {
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

/**
 * Lo que llega de fuera pasando por el formato de verdad.
 *
 * Se serializa y se vuelve a leer a proposito, en vez de pasar el objeto tal
 * cual: asi la prueba recorre tambien el lector, y se comprueba que el formato
 * que se guarda en un sitio y se lee de otro sigue entendiendo lo mismo que
 * entiende la fusion.
 */
function desdePaquete(bruto: unknown) {
  return leerBackup(JSON.stringify(bruto))
}

function paqueteDe(d: Partial<typeof remotoBase> = {}) {
  return construirBackup({ ...remotoBase, ...d })
}

// ---------------------------------------------------------------------------
// Pruebas
// ---------------------------------------------------------------------------

console.log('1. Validacion del paquete')
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

console.log('2. El otro lado aun no tiene nada')
{
  // La primera vez, o el caso de que el destino este vacio. No es un error: el
  // resultado tiene que ser el estado local intacto, no una union con vacio que
  // se lleve lo que hay.
  const { resumen, paquete } = fusionarPaquetes(local, null)
  ok('conserva lo local', paquete.registros.length === 1 && paquete.registros[0].id === 'a')
  ok('no inventa entradas', resumen.registros.entraron === 0)
  ok('no reporta cambios', resumen.registros.pisados === 0)
  ok('cuenta lo que habra que enviar', resumen.enviados === 1, `${resumen.enviados}`)
}

console.log('3. Traer datos de otro dispositivo')
{
  const { resumen, paquete } = fusionarPaquetes(local, desdePaquete(paqueteDe()))
  ok('entra lo que no teniamos', resumen.registros.entraron === 1, `${resumen.registros.entraron}`)
  ok('la union tiene los dos', paquete.registros.length === 2)
  // `a` estaba solo aqui, asi que forma parte de lo que hay que enviar. Contarlo
  // como enviado y no como perdida es justo el matiz de `enviables`.
  ok('cuenta lo que se envia', resumen.enviados === 1, `${resumen.enviados}`)
  ok('no se pierde lo local', paquete.registros.some((r) => r.id === 'a'))
}

console.log('4. Editar el mismo registro en los dos sitios')
{
  const remoto = paqueteDe({ registros: [reg('a', '2026-10-01T12:00:00Z', 999)] })
  const { resumen, paquete } = fusionarPaquetes(local, desdePaquete(remoto))
  const fusionado = paquete.registros.find((r) => r.id === 'a')
  ok('gana la version mas nueva', fusionado?.presionSis === 999, `${fusionado?.presionSis}`)
  ok('y se avisa de que se ha cambiado', resumen.registros.pisados === 1)
  // Lo que se guarda tiene que ser la version que ha ganado, no la que habia.
  ok('el paquete lleva la version ganadora', paquete.registros.every((r) => r.id !== 'a' || r.presionSis === 999))
}

console.log('4b. Y al reves, cuando el local es el mas nuevo')
{
  // Sin este caso, una regla mal escrita que siempre dejara ganar al remoto
  // pasaria la prueba anterior. Los dos sentidos tienen que comprobarse.
  const localNuevo: EstadoLocal = { ...local, registros: [reg('a', '2026-10-01T15:00:00Z', 111)] }
  const { resumen, paquete } = fusionarPaquetes(localNuevo, desdePaquete(paqueteDe({ registros: [reg('a', '2026-10-01T12:00:00Z', 999)] })))
  ok('gana el local', paquete.registros.find((r) => r.id === 'a')?.presionSis === 111)
  ok('y se cuenta como actualizado', resumen.registros.pisados === 1)
}

console.log('5. Un borrado del otro dispositivo no resucita')
{
  const paquete = paqueteDe()
  paquete.borrados = [{ ambito: 'registros', id: 'a', borradoAt: '2026-10-01T13:00:00.000Z' }]
  const { resumen, paquete: fusionado } = fusionarPaquetes(local, desdePaquete(paquete))
  ok('el registro desaparece', fusionado.registros.every((r) => r.id !== 'a'))
  ok('y se cuenta como borrado', resumen.registros.borradosAplicados === 1, `${resumen.registros.borradosAplicados}`)
  ok('la marca de borrado se propaga', (fusionado.borrados ?? []).some((b) => b.id === 'a'))
  // Sin esto, el registro volveria en el siguiente ciclo.
  const otra = fusionarPaquetes(local, desdePaquete(fusionado))
  ok('y tampoco en el ciclo siguiente', otra.paquete.registros.every((r) => r.id !== 'a'))
}

console.log('6. Fusionar dos veces no inventa nada')
{
  const uno = fusionarPaquetes(local, desdePaquete(paqueteDe()))
  // Se fusiona otra vez con lo ya fusionado, que es lo que pasara al sincronizar
  // dos veces seguidas sin que nada haya cambiado en medio.
  const estado: EstadoLocal = {
    registros: uno.paquete.registros,
    visitas: uno.paquete.visitas,
    pacientes: uno.paquete.pacientes,
    borrados: uno.paquete.borrados ?? [],
    ajustes: uno.paquete.ajustes ?? ajustes,
    marcas: uno.paquete.marcas ?? marcasVacias,
  }
  const dos = fusionarPaquetes(estado, uno.paquete)
  ok('no aparecen datos nuevos', dos.resumen.registros.entraron === 0, `${dos.resumen.registros.entraron}`)
  ok('no se pisa nada', dos.resumen.registros.pisados === 0)
  ok('no se borra nada', dos.resumen.registros.borradosAplicados === 0)
  ok('el contenido no cambia', JSON.stringify(dos.paquete.registros) === JSON.stringify(uno.paquete.registros))
}

console.log('7. Las marcas de borrado viejas se purgan')
{
  // La ventana existe para que las marcas no crezcan sin limite. Si un tombstone
  // se purga antes de tiempo, el registro que borro vuelve en el siguiente
  // ciclo; por eso se comprueban los dos lados de la ventana.
  const viejo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString()
  const reciente = new Date().toISOString()
  const conViejo: EstadoLocal = {
    ...local,
    registros: [reg('c', '2026-10-01T09:00:00Z'), reg('d', '2026-10-01T09:00:00Z')],
    borrados: [
      { ambito: 'registros', id: 'c', borradoAt: viejo },
      { ambito: 'registros', id: 'd', borradoAt: reciente },
    ],
  }
  const { paquete } = fusionarPaquetes(conViejo, null)
  ok('la marca vieja se va', !(paquete.borrados ?? []).some((b) => b.id === 'c'))
  ok('la reciente se queda', (paquete.borrados ?? []).some((b) => b.id === 'd'))
  ok('y el borrado viejo reaparece', paquete.registros.some((r) => r.id === 'c'))
  ok('el reciente no', !paquete.registros.some((r) => r.id === 'd'))
}

console.log('8. Ajustes compartidos, sin arrastrar lo del dispositivo')
{
  const remoto = paqueteDe()
  remoto.ajustes = { ...ajustes, umbral: { ...ajustes.umbral, o2Min: 88 } }
  remoto.marcas = { umbral: '2026-10-01T14:00:00.000Z' }
  const { paquete } = fusionarPaquetes(local, desdePaquete(remoto))
  ok('entra el umbral remoto mas nuevo', paquete.ajustes?.umbral.o2Min === 88, `${paquete.ajustes?.umbral.o2Min}`)
  ok('el paquete no lleva tema ni pacienteActivo', !('tema' in (paquete.ajustes ?? {})) && !('pacienteActivo' in (paquete.ajustes ?? {})))
}

console.log('9. Resumen legible para la persona')
{
  const { resumen } = fusionarPaquetes(local, desdePaquete(paqueteDe()))
  const texto = resumirCambios(resumen)
  ok('menciona los datos nuevos', /datos nuevos/.test(texto ?? ''), String(texto))
  const vacio = { ...resumen, registros: { ...resumen.registros, entraron: 0 }, enviados: 0 }
  ok('avisa cuando no hay nada que hacer', resumirCambios(vacio) === 'Todo ya estaba sincronizado')
}

console.log('10. Un backup con ajustes raros no rompe la app')
{
  // `leerBackup` es el unico lector, y alimenta tanto "Restaurar" como la replica.
  // Si un `umbral` llega como cadena, `ajustes.umbral.o2Min` revienta al pintar.
  const base = { app: 'signos-vitales', version: 3, registros: [reg('a', '2026-10-01T09:00:00Z')] }
  const r1 = leerBackup(JSON.stringify({ ...base, ajustes: { umbral: 'hola' } }))
  ok('descarta un umbral que no es un registro de numeros', r1.ajustes === null, JSON.stringify(r1.ajustes))
  const r2 = leerBackup(JSON.stringify({ ...base, ajustes: { umbral: { ...ajustes.umbral, o2Min: 91 } } }))
  ok('conserva un umbral valido', r2.ajustes?.umbral.o2Min === 91)
  const r3 = leerBackup(JSON.stringify({ ...base, ajustes: { umbral: { o2Min: 'mucho' } } }))
  ok('descarta un umbral con un campo que no es numero', r3.ajustes === null, JSON.stringify(r3.ajustes))
  const r4 = leerBackup(JSON.stringify({ ...base, ajustes: { umbral: 'hola', plantillas: [{ id: 'p', texto: 'x', activa: true }] } }))
  ok('conserva el campo bueno y tira del malo', r4.ajustes?.plantillas.length === 1 && r4.ajustes?.umbral === undefined, JSON.stringify(r4.ajustes))
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

console.log('11. Un backup que solo trae borrados es valido')
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

console.log(fallos === 0 ? '\nTODO CORRECTO' : `\n${fallos} FALLOS de ${total}`)
if (fallos > 0) process.exit(1)