/** Pruebas rapidas de la logica pura: se ejecutan con tsx/ts sin navegador. */
import { crearRegistrosDemo } from '../src/lib/demo'
import { evaluarO2, evaluarDia, evaluarSis, validarRegistro } from '../src/lib/rangos'
import { PRESION_HABITUAL_POR_DEFECTO, bandaNormal } from '../src/lib/rangos'
import { claveDia, sumarDias, aDate, claveHora, inicioSemana } from '../src/lib/fechas'
import { UMBRALES_POR_DEFECTO, LIMITES_POR_DEFECTO } from '../src/lib/rangos'
import { resumenDia, alertasDelDia, seriePorPeriodo, compararPeriodos } from '../src/lib/resumen'
import { leerBackup } from '../src/lib/exportar'

let fallos = 0
function ok(nombre: string, cond: boolean, extra = '') {
  if (!cond) { fallos++; console.log('  FALLO:', nombre, extra) }
  else console.log('  ok:', nombre)
}

console.log('1. O2 por encima de 100 (sensor sobredimensionado)')
const base = { fecha: claveDia(new Date()), hora: '10:00', presionSis: 120, presionDia: 80, o2: 100, bpm: 70, orina: null, notas: '' }
// `errores` es un objeto campo -> mensaje, no una lista.
const nErrores = (o: Partial<typeof base> & { o2?: number }) =>
  Object.keys(validarRegistro({ ...base, ...o } as never, LIMITES_POR_DEFECTO).errores).length

ok('100% se guarda', nErrores({}) === 0)
ok('101% no bloquea el guardado', nErrores({ o2: 101 }) === 0)
ok('101% no genera alerta', evaluarO2(101, UMBRALES_POR_DEFECTO) === 'ok')
ok('150% si se rechaza (errata)', nErrores({ o2: 150 }) > 0)
ok('89% da alerta', evaluarO2(89, UMBRALES_POR_DEFECTO) === 'alerta')
ok('92% da aviso', evaluarO2(92, UMBRALES_POR_DEFECTO) === 'aviso')

console.log('2. Fechas locales')
ok('sumarDias cruza meses', sumarDias('2026-01-31', 1) === '2026-02-01')
ok('sumarDias cruza a�os', sumarDias('2025-12-31', 1) === '2026-01-01')
ok('aDate reconstruye en local', aDate('2026-03-15', '08:30').getHours() === 8)
ok('claveDia coincide con aDate', claveDia(aDate('2026-07-04', '23:59')) === '2026-07-04')
ok('claveHora', claveHora(aDate('2026-07-04', '07:05')) === '07:05')
ok('inicioSemana es lunes', inicioSemana('2026-09-30').endsWith('-28'))

console.log('3. Datos de ejemplo y resumen')
const demo = crearRegistrosDemo(new Date('2026-09-30T12:00:00'))
ok('genera 12 registros', demo.length === 12, `(${demo.length})`)
ok('sin o2 fuera de rango', demo.every(r => r.o2 >= 70 && r.o2 <= 102))
ok('sin Orphan en 1500ml', demo.every(r => r.orina === null || r.orina <= 3000))
const hoy = '2026-09-30'
const resumen = resumenDia(demo, hoy)
ok('resumen cuenta los de hoy', resumen.registros.length === 4, `(${resumen.registros.length})`)
ok('detecta alerta por O2 baja', alertasDelDia(demo, hoy, UMBRALES_POR_DEFECTO, false).length > 0)
const serie = seriePorPeriodo(demo, hoy, 'semana')
ok('serie devuelve 7 dias', serie.length === 7, `(${serie.length})`)
const comp = compararPeriodos(demo, hoy, 'semana')
ok('comparativa tiene ambos periodos', comp.actual.desde <= comp.actual.hasta && comp.anterior.hasta < comp.actual.desde)

console.log('4. Presion habitual por paciente')
const baja90 = { sis: 90, dia: 60 }
const normal120 = { sis: 120, dia: 80 }

// El caso que motiva la funcionalidad: con 90/60 de costumbre, una tension de
// 90 no debe marcarse como baja aunque el umbral generico sea 100.
ok('90/60 es "ok" con referencia 90/60', evaluarSis(90, UMBRALES_POR_DEFECTO, baja90) === 'ok')
ok('90/60 da aviso con el default 120/80', evaluarSis(90, UMBRALES_POR_DEFECTO, normal120) === 'aviso')
ok('60 diastolica es "ok" con referencia 90/60', evaluarDia(60, UMBRALES_POR_DEFECTO, baja90) === 'ok')
ok('120/80 es "ok" con referencia 120/80', evaluarSis(120, UMBRALES_POR_DEFECTO, normal120) === 'ok')
ok('120/80 da aviso con referencia 90/60', evaluarSis(120, UMBRALES_POR_DEFECTO, baja90) === 'aviso')

// La banda no puede desbordar los limites absolutos de alerta, o una
// referencia muy baja convertiria en "alerta" algo que el umbral marca como ok.
ok('la banda sis respeta el minimo de alerta', bandaNormal(baja90, UMBRALES_POR_DEFECTO).sis[0] > UMBRALES_POR_DEFECTO.presionSisMin)
ok('la banda dia respeta el minimo de alerta', bandaNormal(baja90, UMBRALES_POR_DEFECTO).dia[0] > UMBRALES_POR_DEFECTO.presionDiaMin)
ok('la banda sis respeta el maximo de alerta', bandaNormal({ sis: 150, dia: 95 }, UMBRALES_POR_DEFECTO).sis[1] < UMBRALES_POR_DEFECTO.presionSisMax)
ok('banda con 120/80 es 100-140 / 70-90', bandaNormal(normal120, UMBRALES_POR_DEFECTO).sis.join() === '100,140' && bandaNormal(normal120, UMBRALES_POR_DEFECTO).dia.join() === '70,90')
// Con 90/60 la banda de sistolica se recorta contra el limite de alerta (159),
// no contra 109: el tope es 90+20=110 y el minimo queda en 81 (algo por encima
// del umbral de 80), asi que el rango real es 81-110.
ok('banda con 90/60 es 81-110 / 51-70', bandaNormal(baja90, UMBRALES_POR_DEFECTO).sis.join() === '81,110' && bandaNormal(baja90, UMBRALES_POR_DEFECTO).dia.join() === '51,70')

// Una referencia propia no puede silenciar una alerta absoluta: 70 mmHg es
// hipotension sea cual sea la costumbre del paciente.
ok('70 sis sigue siendo alerta con 90/60', evaluarSis(70, UMBRALES_POR_DEFECTO, baja90) === 'alerta')
ok('45 dia sigue siendo alerta con 90/60', evaluarDia(45, UMBRALES_POR_DEFECTO, baja90) === 'alerta')
ok('170 sis sigue siendo alerta con 120/80', evaluarSis(170, UMBRALES_POR_DEFECTO, normal120) === 'alerta')

// Sin referencia explicita se usa el default global, no una excepcion.
ok('el default es 120/80', PRESION_HABITUAL_POR_DEFECTO.sis === 120 && PRESION_HABITUAL_POR_DEFECTO.dia === 80)
ok('sin habitual, 90 sis da aviso (default 120/80)', evaluarSis(90, UMBRALES_POR_DEFECTO) === 'aviso')
ok('sin habitual, 90 sis da ok con banda por defecto', bandaNormal(PRESION_HABITUAL_POR_DEFECTO, UMBRALES_POR_DEFECTO).sis[0] === 100)
ok('el habitual no altera O2', evaluarO2(95, UMBRALES_POR_DEFECTO) === 'ok')

console.log('5. Backup: datos sucios')
const sucio = JSON.stringify({ version: 1, app: 'signos-vitales', registros: [
  { fecha: '2026-09-30', hora: '08:00', presionSis: 120, presionDia: 80, o2: '', bpm: 70, orina: '' },
  { fecha: '2026-09-30', hora: '08:05', presionSis: '   ', presionDia: 80, o2: 98, bpm: 70 },
  { fecha: 'basura', hora: '08:00', presionSis: 1, presionDia: 1, o2: 1, bpm: 1 },
  { fecha: '2026-09-30', hora: 'no-es-hora', presionSis: 120, presionDia: 80, o2: 98, bpm: 70 },
  { fecha: '2026-09-29', hora: '09:00', presionSis: 130, presionDia: 85, o2: 97, bpm: 72 },
], pacientes: [{ id: 'x', nombre: 'Ana', nacimiento: '1940-01-01', notas: '', creadoAt: '2026-01-01' }] })
const leido = leerBackup(sucio)
// De los 5 registros del archivo solo el ultimo es valido en todos sus campos.
ok('descarta los 4 registros corruptos y conserva el bueno', leido.registros.length === 1, `(${leido.registros.length})`)
ok('conserva la fecha del bueno', leido.registros[0]?.fecha === '2026-09-29')
ok('descarta hora invalida', leido.registros.every(r => /^\d{2}:\d{2}$/.test(r.hora)))
ok('descarta campos numericos vacios (no los convierte en 0)', leido.registros.every(r => r.o2 > 0 && r.presionSis > 0))
ok('orina ausente queda null', leido.registros.every(r => r.orina === null))
ok('genera id si falta', leido.registros.every(r => typeof r.id === 'string' && r.id.length > 0))
ok('conserva pacientes', leido.pacientes.length === 1)

console.log(fallos === 0 ? '\nTODO CORRECTO' : `\n${fallos} FALLOS`)
