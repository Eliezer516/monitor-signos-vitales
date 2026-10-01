/** Pruebas rapidas de la logica pura: se ejecutan con tsx/ts sin navegador. */
import { crearRegistrosDemo, crearVisitasDemo } from '../src/lib/demo'
import { evaluarO2, evaluarDia, evaluarSis, validarRegistro } from '../src/lib/rangos'
import { PRESION_HABITUAL_POR_DEFECTO, bandaNormal } from '../src/lib/rangos'
import { claveDia, sumarDias, aDate, claveHora, inicioSemana, hora12 } from '../src/lib/fechas'
import { UMBRALES_POR_DEFECTO, LIMITES_POR_DEFECTO } from '../src/lib/rangos'
import { resumenDia, alertasDelDia, seriePorPeriodo, compararPeriodos } from '../src/lib/resumen'
import { leerBackup, reporteHTML } from '../src/lib/exportar'
import { ordenarVisitas } from '../src/lib/db'
import { aDatosVisita, resumenVisitas, validarVisita } from '../src/lib/visitas'

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
ok('un backup v1 sin clave "visitas" no rompe la lectura', leido.visitas.length === 0)

console.log('6. Visitas del profesional sanitario')
const visitaBuena = { fecha: '2026-09-28', hora: '10:15', tipo: 'consulta' as const, motivo: 'Revision de la tension', profesional: 'Dra. Garcia', indicaciones: '', notas: '' }
const conVisitas = JSON.stringify({ version: 2, app: 'signos-vitales', registros: [], pacientes: [], visitas: [
  visitaBuena,
  { ...visitaBuena, id: 'v2', fecha: '2026-09-29', tipo: 'domicilio' },
  // Se descartan: sin tipo no se sabe si fue consulta o domicilio.
  { fecha: '2026-09-29', motivo: 'Algo' },
  { fecha: 'no-es-fecha', tipo: 'consulta', motivo: 'Algo' },
  { fecha: '2026-09-29', tipo: 'consulta', motivo: '   ' },
  'basura',
] })
const leidoConVisitas = leerBackup(conVisitas)
ok('descarta las visitas mal formadas y conserva las 2 buenas', leidoConVisitas.visitas.length === 2, `(${leidoConVisitas.visitas.length})`)
ok('descarta la visita sin tipo', leidoConVisitas.visitas.every(v => v.tipo === 'consulta' || v.tipo === 'domicilio'))
ok('descarta el motivo en blanco', leidoConVisitas.visitas.every(v => v.motivo.trim() !== ''))
ok('rellena los textos ausentes con cadena vacia', leidoConVisitas.visitas.every(v => typeof v.profesional === 'string' && typeof v.indicaciones === 'string' && typeof v.notas === 'string'))
ok('descarta una hora invalida en vez de importarla', leidoConVisitas.visitas.every(v => v.hora === undefined || /^\d{2}:\d{2}$/.test(v.hora)))
ok('genera id si falta', leidoConVisitas.visitas.every(v => typeof v.id === 'string' && v.id.length > 0))

// La hora vacia debe guardarse como `undefined`, no como '': `ordenarVisitas`
// coloca las visitas sin hora antes que las que si la tienen del mismo dia.
ok('sin hora queda undefined, no cadena vacia', aDatosVisita({ ...visitaBuena, hora: '' }).hora === undefined)
ok('con hora se respeta', aDatosVisita(visitaBuena).hora === '10:15')
ok('recorta los espacios de los textos', aDatosVisita({ ...visitaBuena, motivo: '  Revision  ' }).motivo === 'Revision')

// Solo el motivo es obligatorio: no todo el mundo recuerda la hora exacta de una
// visita a domicilio, y obligar a inventarla seria peor que dejar el hueco vacio.
ok('sin motivo da error', Boolean(validarVisita({ ...visitaBuena, motivo: '  ' }).motivo))
ok('sin profesional NO da error', !validarVisita({ ...visitaBuena, profesional: '' }).profesional)
ok('sin hora NO da error', !validarVisita({ ...visitaBuena, hora: '' }).hora)
ok('fecha invalida da error', Boolean(validarVisita({ ...visitaBuena, fecha: 'ayer' }).fecha))
ok('hora invalida da error', Boolean(validarVisita({ ...visitaBuena, hora: '9' }).hora))

const demoVisitas = crearVisitasDemo(new Date('2026-09-30T12:00:00'))
ok('las visitas de ejemplo tienen id y fecha valida', demoVisitas.every(v => v.id.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(v.fecha)))
ok('las visitas de ejemplo mezclan consulta y domicilio', new Set(demoVisitas.map(v => v.tipo)).size === 2)
ok('las visitas de ejemplo van de mas antigua a mas reciente', demoVisitas.every((v, i) => i === 0 || demoVisitas[i - 1].fecha <= v.fecha))

// `ordenarVisitas` es la misma logica que usa la base de datos para cargar.
const ordenadas = ordenarVisitas([
  { ...visitaBuena, id: 'a', fecha: '2026-09-01', hora: '10:00' },
  { ...visitaBuena, id: 'b', fecha: '2026-09-02', hora: undefined },
  { ...visitaBuena, id: 'c', fecha: '2026-09-01', hora: undefined },
  { ...visitaBuena, id: 'd', fecha: '2026-09-01', hora: '18:00' },
])
ok('ordena por fecha descendente', ordenadas[0].id === 'b')
ok('a igual fecha, la hora mas tarde primero', ordenadas.slice(1).map(v => v.id).join() === 'd,a,c')
// Sin hora no consta cuando ocurrio, asi que queda al final del dia, no al
// principio: en un listado de mas reciente a mas antiguo no tiene sentido
// insinuar que fue lo primero que paso.
ok('sin hora queda al final de su dia', ordenadas[1].id === 'd' && ordenadas[3].id === 'c')

const cuenta = resumenVisitas(demoVisitas)
ok('resumen cuenta el total', cuenta.total === demoVisitas.length)
ok('resumen reparte consulta y domicilio', cuenta.consultas + cuenta.domicilios === cuenta.total)
ok('resumen detecta visitas sin profesional', cuenta.sinProfesional === demoVisitas.filter(v => !v.profesional).length)

// La tabla de visitas del informe medico debe llevar las del periodo y solo esas.
const htmlConVisitas = reporteHTML([], {
  desde: '2026-09-01', hasta: '2026-09-29',
  umbral: UMBRALES_POR_DEFECTO,
  visitas: [
    { ...visitaBuena, id: 'x', fecha: '2026-09-28' },
    { ...visitaBuena, id: 'y', fecha: '2026-09-30' },
  ],
})
ok('el informe recoge la visita del periodo', htmlConVisitas.includes('28/09/2026'))
ok('el informe excluye la visita fuera de periodo', !htmlConVisitas.includes('30/09/2026'))
ok('el informe escapa el HTML de los textos', !reporteHTML([], {
  desde: '2026-09-01', hasta: '2026-09-30',
  umbral: UMBRALES_POR_DEFECTO,
  visitas: [{ ...visitaBuena, fecha: '2026-09-28', motivo: '<script>alerta(1)</script>' }],
}).includes('<script>'))

console.log('7. Hora en 12 horas')
ok('medianoche es 12 AM, no 0', hora12('00:00') === '12:00 AM')
ok('la primera hora de la manana es 12 AM', hora12('00:45') === '12:45 AM')
ok('mediodia es 12 PM, no 0', hora12('12:00') === '12:00 PM')
ok('la una de la tarde es 1 PM', hora12('13:00') === '1:00 PM')
ok('la una y veinte de la tarde', hora12('13:20') === '1:20 PM')
ok('la una de la manana es 1 AM', hora12('01:00') === '1:00 AM')
ok('las 11 de la manana siguen siendo AM', hora12('11:59') === '11:59 AM')
ok('las 11 de la noche pasan a PM', hora12('23:59') === '11:59 PM')
ok('las 12 de la noche no son 12 PM', hora12('00:00') !== '12:00 PM')
ok('las 12 del mediodia no son 12 AM', hora12('12:00') !== '12:00 AM')
// Sin hora (visita a domicilio de la que no se sabe el momento) no se inventa.
ok('sin hora devuelve cadena vacia', hora12(undefined) === '')
ok('una hora invalida devuelve cadena vacia', hora12('25:99') === '')
ok('un texto vacio devuelve cadena vacia', hora12('') === '')
// Los minutos se conservan tal cual, con los dos digitos de siempre.
ok('conserva el cero de los minutos', hora12('09:05') === '9:05 AM')

// El informe impreso va en 12 h, pero el CSV sigue en 24 h: en una hoja de
// calculo "8:05 AM" es texto y no se puede ordenar ni filtrar por hora.
const conAlerta = reporteHTML(
  [{ ...crearRegistrosDemo(new Date('2026-09-30T12:00:00'))[0], fecha: '2026-09-28', hora: '21:15', o2: 88 }],
  { desde: '2026-09-01', hasta: '2026-09-30', umbral: { ...UMBRALES_POR_DEFECTO, o2Min: 90 } },
)
ok('el informe muestra la hora en 12 h', conAlerta.includes('9:15 PM') && !conAlerta.includes('21:15'))

console.log(fallos === 0 ? '\nTODO CORRECTO' : `\n${fallos} FALLOS`)
