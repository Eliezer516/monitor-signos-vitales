/**
 * Pruebas de la fusion entre dispositivos.
 *
 *   npm run test:fusion
 *
 * Aqui no se prueba que la app funcione, sino que dos dispositivos que
 * sincronizan en distinto orden acaban con lo mismo. Es la parte donde un
 * fallo no se ve en pantalla: se ve semanas despues, cuando una medicion ha
 * desaparecido y no se sabe cual de los dos moviles la borro.
 */

import {
  DIAS_TOMBSTONE,
  emparejar,
  fusionarAjustes,
  fusionarBorrados,
  purgarBorrados,
} from '../src/lib/fusion'
import type { AjustesCompartidos, Borrado, MarcasCompartidas, Registro } from '../src/lib/tipos'

let fallos = 0
let total = 0
function ok(nombre: string, cond: boolean, extra = '') {
  total++
  if (!cond) {
    fallos++
    console.log('  FALLO:', nombre, extra)
  } else console.log('  ok:', nombre)
}

const AHORA = new Date('2026-10-02T12:00:00Z').getTime()

/** Registro minimo con la marca de modificacion que interesa a cada prueba. */
function reg(id: string, updatedAt: string | undefined, extra: Partial<Registro> = {}): Registro {
  const base: Registro = {
    id,
    fecha: '2026-10-01',
    hora: '08:00',
    presionSis: 120,
    presionDia: 80,
    o2: 97,
    bpm: 70,
    notas: '',
    createdAt: '2026-10-01T08:00:00.000Z',
  }
  return updatedAt === undefined ? { ...base, ...extra } : { ...base, ...extra, updatedAt }
}

const marca = (b: Borrado): string => `${b.ambito}:${b.id}`

console.log('1. Last-write-wins por identificador')
{
  const localViejo = reg('a', '2026-10-01T09:00:00Z', { presionSis: 120 })
  const remotoNuevo = reg('a', '2026-10-01T10:00:00Z', { presionSis: 130 })
  const r = emparejar([localViejo], [remotoNuevo], [], 'registros', AHORA)
  ok('gana la version mas nueva', r.fusionados[0]?.presionSis === 130, JSON.stringify(r.fusionados))
  ok('cuenta un pisado', r.pisados === 1)
  ok('no cuenta entrada ni subida', r.entraron === 0 && r.enviables === 0)

  const r2 = emparejar([remotoNuevo], [localViejo], [], 'registros', AHORA)
  ok('da igual el orden de los parametros', r2.fusionados[0]?.presionSis === 130)
}

console.log('2. Recuentos de entrada y subida')
{
  const soloLocal = reg('l', '2026-10-01T09:00:00Z')
  const soloRemoto = reg('r', '2026-10-01T09:00:00Z')
  const comunIgual = reg('c', '2026-10-01T09:00:00Z')
  const r = emparejar([soloLocal, comunIgual], [soloRemoto, comunIgual], [], 'registros', AHORA)
  ok('cuenta lo que entra', r.entraron === 1, `${r.entraron}`)
  // Estar solo en local es lo pendiente de enviar, nunca una perdida.
  ok('cuenta lo pendiente de subir', r.enviables === 1, `${r.enviables}`)
  ok('lista identica no cuenta pisados', r.pisados === 0, `${r.pisados}`)
  ok('no marca nada como borrado', r.borradosAplicados === 0)
  ok('mantiene los tres', r.fusionados.length === 3)
}

console.log('3. Datos antiguos sin `updatedAt`')
{
  // Es el caso real: backups v1/v2 y registros ya guardados no tienen la marca.
  const viejo = reg('a', undefined, { presionSis: 120 })
  const nuevo = reg('a', '2026-10-01T10:00:00Z', { presionSis: 130 })
  ok('sin updatedAt, createdAt decide', emparejar([viejo], [nuevo], [], 'registros', AHORA).fusionados[0]?.presionSis === 130)
  ok('y al reves tambien', emparejar([nuevo], [viejo], [], 'registros', AHORA).fusionados[0]?.presionSis === 130)
  const dosViejos = emparejar([viejo], [reg('a', undefined, { presionSis: 999 })], [], 'registros', AHORA)
  ok('empate exacto gana el local', dosViejos.fusionados[0]?.presionSis === 120, JSON.stringify(dosViejos.fusionados))
  // Las dos versiones difieren de verdad, asi que avisar de pisado es lo
  // correcto: el codigo de los 999 se pierde y el usuario debe saberlo.
  ok('un empate con contenido distinto si avisa', dosViejos.pisados === 1, `${dosViejos.pisados}`)
  const identicos = emparejar([viejo], [viejo], [], 'registros', AHORA)
  ok('empate con contenido igual no avisa', identicos.pisados === 0, `${identicos.pisados}`)
}

console.log('4. El orden de las claves no inventa cambios')
{
  // Mismo dato, distinto orden de claves: daria un falso "pisa el local" con un
  // JSON.stringify a pelo, que es justo lo que hacia este aviso inútil.
  const a = { id: 'a', fecha: '2026-10-01', presionSis: 120 }
  const b = { presionSis: 120, fecha: '2026-10-01', id: 'a' }
  const r = emparejar([a as Registro], [b as Registro], [], 'registros', AHORA)
  ok('no cuenta pisado', r.pisados === 0, `${r.pisados}`)
}

console.log('5. Tombstones')
{
  const borrado: Borrado = { ambito: 'registros', id: 'x', borradoAt: '2026-10-01T12:00:00Z' }
  const r = emparejar([reg('x', '2026-10-01T09:00:00Z')], [reg('x', '2026-10-01T13:00:00Z')], [borrado], 'registros', AHORA)
  ok('el borrado gana a un registro mas nuevo', r.fusionados.length === 0, JSON.stringify(r.fusionados))
  ok('no cuenta como entrada', r.entraron === 0 && r.pisados === 0)
  // Es lo unico que hace desaparecer informacion de la pantalla, asi que tiene
  // que poder contarse por separado para poder avisar al usuario.
  ok('cuenta lo que se borro en el otro dispositivo', r.borradosAplicados === 1, `${r.borradosAplicados}`)

  // Y al reves: el registro mas nuevo ya no debe resucitarlo.
  const r2 = emparejar([reg('x', '2026-10-01T13:00:00Z')], [], [borrado], 'registros', AHORA)
  ok('tampoco al reves', r2.fusionados.length === 0)
  ok('y tambien se cuenta', r2.borradosAplicados === 1)
}

console.log('6. El borrado viaja en las dos direcciones')
{
  const borradoRemoto: Borrado = { ambito: 'registros', id: 'x', borradoAt: '2026-10-01T12:00:00Z' }
  const r = emparejar([reg('x', '2026-10-01T09:00:00Z')], [], [], 'registros', AHORA)
  ok('sin marca, el registro sigue', r.fusionados.length === 1)
  const unidas = fusionarBorrados([], [borradoRemoto])
  ok('la marca remota se recoge', unidas.length === 1)
  ok('con la marca, desaparece', emparejar(r.fusionados, [], unidas, 'registros', AHORA).fusionados.length === 0)
}

console.log('7. Un id igual en ambitos distintos no se confunde')
{
  // El mismo UUID puede existir como registro y como visita; un borrado de uno
  // no debe arrastrar al otro.
  const b: Borrado[] = [{ ambito: 'registros', id: 'mismo', borradoAt: '2026-10-01T12:00:00Z' }]
  const r = emparejar([reg('mismo', '2026-10-01T09:00:00Z')], [], b, 'visitas', AHORA)
  ok('el borrado de registros no afecta a visitas', r.fusionados.length === 1)
  ok('la marca se conserva para su ambito', r.borrados.length === 1)
}

console.log('8. Marcas mas nuevas que la ventana de purgado')
{
  const viejo: Borrado = {
    ambito: 'registros',
    id: 'x',
    borradoAt: new Date(AHORA - (DIAS_TOMBSTONE + 1) * 86_400_000).toISOString(),
  }
  const reciente: Borrado = {
    ambito: 'registros',
    id: 'y',
    borradoAt: new Date(AHORA - 86_400_000).toISOString(),
  }
  ok('purga la antigua', purgarBorrados([viejo, reciente], AHORA).length === 1)
  ok('conserva la reciente', purgarBorrados([viejo, reciente], AHORA)[0]?.id === 'y')
  ok('una marca invalida no rompe', purgarBorrados([{ ambito: 'registros', id: 'z', borradoAt: '' }], AHORA).length === 0)
  ok('emparejar purga tambien', emparejar([], [], [viejo, reciente], 'registros', AHORA).borrados.length === 1)
}

console.log('9. Idempotencia y simetria')
{
  // Sin esto, cada sincronizacion inventaria cambios y el ciclo no pararia.
  const locales = [reg('a', '2026-10-01T09:00:00Z', { presionSis: 120 }), reg('b', '2026-10-01T09:00:00Z')]
  const remotos = [reg('a', '2026-10-01T10:00:00Z', { presionSis: 130 }), reg('c', '2026-10-01T09:00:00Z')]
  const una = emparejar(locales, remotos, [], 'registros', AHORA)
  const dos = emparejar(una.fusionados, remotos, una.borrados, 'registros', AHORA)
  const tres = emparejar(dos.fusionados, remotos, dos.borrados, 'registros', AHORA)

  // Lo que importa no es que los recuentos sean cero, sino que sean estables:
  // `b` sigue estando solo en local porque todavia no se ha subido, y eso no es
  // un cambio. Si variaran, cada ciclo de sincronizacion moveria datos sin
  // motivo y no se podria saber si hay novedades de verdad.
  ok('no inventa entradas nuevas', dos.entraron === 0 && tres.entraron === 0)
  ok('no inventa pisados', dos.pisados === 0 && tres.pisados === 0)
  ok('no inventa borrados', dos.borradosAplicados === 0 && tres.borradosAplicados === 0)
  ok('lo pendiente de subir es estable', dos.enviables === 1 && tres.enviables === 1, `${dos.enviables}/${tres.enviables}`)
  ok('y el contenido no cambia', JSON.stringify(tres.fusionados) === JSON.stringify(dos.fusionados))
  ok('conserva la version mas nueva', una.fusionados.find((e) => e.id === 'a')?.presionSis === 130)

  const sim = emparejar(remotos, locales, [], 'registros', AHORA)
  ok('el contenido no depende del orden', sim.fusionados.length === una.fusionados.length)
}

console.log('10. Ajustes compartidos, campo a campo')
{
  const base: AjustesCompartidos = {
    umbral: { presionSisMin: 90, presionSisMax: 130, presionDiaMin: 50, presionDiaMax: 85, o2Min: 92, bpmMin: 50, bpmMax: 100, sondaMin: 0, sondaMax: 2000 },
    limites: { presionSisMin: 50, presionSisMax: 250, presionDiaMin: 30, presionDiaMax: 150, o2Min: 70, o2Max: 100, bpmMin: 30, bpmMax: 220, sondaMin: 0, sondaMax: 3000 },
    presionHabitual: { sis: 125, dia: 78 },
    plantillas: [{ id: 'p1', texto: 'Tras la cena', activa: true }],
  }
  const remotoUmb = { ...base, umbral: { ...base.umbral, o2Min: 90 } }
  const marcasLoc: MarcasCompartidas = { umbral: '2026-10-01T09:00:00Z', presionHabitual: '2026-10-01T09:00:00Z' }
  const marcasRem: MarcasCompartidas = { umbral: '2026-10-01T10:00:00Z' }

  const r = fusionarAjustes(base, remotoUmb, marcasLoc, marcasRem)
  ok('el campo remoto mas nuevo entra', r.ajustes.umbral.o2Min === 90)
  ok('los campos sin tocar no se mueven', r.ajustes.presionHabitual.sis === 125)
  ok('cuenta un pisado', r.pisados === 1, `${r.pisados}`)
  ok('guarda la marca ganadora', r.marcas.umbral === '2026-10-01T10:00:00Z')

  // Un dispositivo que nunca toco los ajustes no debe pisarlos con sus valores
  // por defecto, que es el fallo clasico de mandar el bloque entero.
  const marcasVacias: MarcasCompartidas = {}
  const r2 = fusionarAjustes(base, remotoUmb, marcasVacias, marcasVacias)
  ok('sin marcas gana lo local', r2.ajustes.umbral.o2Min === base.umbral.o2Min)
  ok('y no se cuenta como pisado', r2.pisados === 0, `${r2.pisados}`)

  const remotoViejo = { ...base, umbral: { ...base.umbral, o2Min: 70 } }
  const r3 = fusionarAjustes(base, remotoViejo, marcasLoc, { umbral: '2026-10-01T08:00:00Z' })
  ok('una marca remota mas vieja no pisa', r3.ajustes.umbral.o2Min === base.umbral.o2Min)
}

console.log('11. Las marcas de borrado se contienen entre si')
{
  const b: Borrado = { ambito: 'visitas', id: 'v1', borradoAt: '2026-10-01T12:00:00Z' }
  ok('sin repetidos', fusionarBorrados([b], [b]).length === 1)
  ok('marca vacia no borra la buena', fusionarBorrados([b], [{ ...b, borradoAt: '' }])[0]?.borradoAt === b.borradoAt)
  ok('clave de ambito', marca(b) === 'visitas:v1')
}

console.log(fallos === 0 ? '\nTODO CORRECTO' : `\n${fallos} FALLOS de ${total}`)
if (fallos > 0) process.exit(1)
