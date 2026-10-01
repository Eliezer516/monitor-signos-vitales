/**
 * Agregaciones: resumenes por dia, series por periodo y comparativas.
 * Todas las funciones son puras y toleran listas vacias devolviendo `null`
 * en lugar de `NaN`, para que la UI pueda distinguirlos.
 */

import {
  claveDia,
  diasEntre,
  etiquetaEje,
  instanteDe,
  inicioSemana,
  rangoPeriodo,
  sumarDias,
} from './fechas'
import {
  PRESION_HABITUAL_POR_DEFECTO,
  bandaNormal,
  evaluarBpm,
  evaluarDia,
  evaluarO2,
  evaluarSis,
  redondear,
} from './rangos'
import { hora12 } from './fechas'
import type {
  Alerta,
  FechaISO,
  Nivel,
  Periodo,
  PresionHabitual,
  PuntoSerie,
  Registro,
  ResumenDia,
  Umbrales,
} from './tipos'

const promedio = (xs: number[]) =>
  xs.length ? redondear(xs.reduce((a, b) => a + b, 0) / xs.length, 1) : null

/** Registros de un dia, en orden cronologico ascendente. */
export const registrosDe = (registros: Registro[], fecha: FechaISO): Registro[] =>
  registros
    .filter((r) => r.fecha === fecha)
    .sort((a, b) => instanteDe(a).getTime() - instanteDe(b).getTime())

/** Resumen agregado de un dia. */
export function resumenDia(registros: Registro[], fecha: FechaISO): ResumenDia {
  const rs = registrosDe(registros, fecha)
  const o2 = rs.map((r) => r.o2).filter((n) => Number.isFinite(n))
  const orina = rs
    .map((r) => r.orina)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))

  return {
    fecha,
    totalOrina: orina.reduce((a, b) => a + b, 0),
    promedioPresionSis: promedio(rs.map((r) => r.presionSis)),
    promedioPresionDia: promedio(rs.map((r) => r.presionDia)),
    minO2: o2.length ? Math.min(...o2) : null,
    maxO2: o2.length ? Math.max(...o2) : null,
    promedioBPM: promedio(rs.map((r) => r.bpm)),
    registros: rs,
  }
}

/** Nivel global del dia: el peor de sus promedios y del volumen de orina. */
export function nivelDia(
  resumen: ResumenDia,
  u: Umbrales,
  diaCompleto = false,
  habitual: PresionHabitual = PRESION_HABITUAL_POR_DEFECTO,
): Nivel {
  const niveles: Nivel[] = []
  if (resumen.promedioPresionSis !== null) {
    niveles.push(evaluarSis(resumen.promedioPresionSis, u, habitual))
    niveles.push(evaluarDia(resumen.promedioPresionDia, u, habitual))
  }
  if (resumen.minO2 !== null) niveles.push(evaluarO2(resumen.minO2, u))
  if (resumen.promedioBPM !== null) niveles.push(evaluarBpm(resumen.promedioBPM, u))
  // El volumen de orina solo se juzga al cierre del dia: a las 10 de la manana
  // un volumen bajo es normal, no una alerta.
  if (diaCompleto || resumen.registros.length > 0) {
    if (resumen.registros.length > 0 && resumen.totalOrina > 0 && resumen.totalOrina < u.orinaMin) {
      niveles.push('aviso')
    }
    if (resumen.totalOrina > u.orinaMax) niveles.push('aviso')
  }
  if (niveles.includes('alerta')) return 'alerta'
  if (niveles.includes('aviso')) return 'aviso'
  return 'ok'
}

/** Dias con registros, ordenados del mas reciente al mas antiguo. */
export function diasConRegistros(registros: Registro[]): FechaISO[] {
  return [...new Set(registros.map((r) => r.fecha))].sort().reverse()
}

/**
 * Serie temporal para las graficas: un punto por dia dentro del periodo,
 * incluidos los dias sin registros (con valores `null`) para que la linea
 * no "salte" dias vacios y el eje X mantenga la escala temporal real.
 */
export function seriePorPeriodo(
  registros: Registro[],
  fin: FechaISO,
  periodo: Periodo,
): PuntoSerie[] {
  const { desde, hasta } = rangoPeriodo(fin, periodo)
  const puntos: PuntoSerie[] = []
  const totalDias = diasEntre(desde, hasta)

  // Recorre dia a dia entre desde y hasta (ambos inclusive) usando `sumarDias`
  // en lugar de aritmetica con `new Date(iso)`, que interpretaria la fecha como
  // UTC y desplazaria el recorrido en husos negativos.
  for (let i = 0; i <= totalDias; i++) {
    const actual = sumarDias(desde, i)
    const resumen = resumenDia(registros, actual)
    const rs = resumen.registros
    const o2 = rs.map((r) => r.o2)
    puntos.push({
      clave: actual,
      etiqueta: etiquetaEje(actual, periodo),
      presionSis: promedio(rs.map((r) => r.presionSis)),
      presionDia: promedio(rs.map((r) => r.presionDia)),
      promedioO2: promedio(o2),
      minO2: o2.length ? Math.min(...o2) : null,
      maxO2: o2.length ? Math.max(...o2) : null,
      promedioBPM: promedio(rs.map((r) => r.bpm)),
      totalOrina: resumen.totalOrina,
      registros: rs,
    })
  }
  return puntos
}

/** Variacion porcentual entre dos valores, tolerando division por cero. */
export function variacion(actual: number, anterior: number): number | null {
  if (!anterior) return null
  return redondear(((actual - anterior) / anterior) * 100, 1)
}

/** Numero de dias que cubre cada periodo. */
const DIAS_POR_PERIODO: Record<Periodo, number> = { dia: 1, semana: 7, mes: 30 }

/**
 * Comparativa entre dos periodos consecutivos del mismo tamaño
 * (esta semana vs. la anterior, este mes vs. el anterior).
 */
export function compararPeriodos(
  registros: Registro[],
  fin: FechaISO,
  periodo: Periodo,
  longitud: number = DIAS_POR_PERIODO[periodo],
) {
  const actual = resumenRango(registros, sumarDias(fin, -(longitud - 1)), fin)
  const anterior = resumenRango(
    registros,
    sumarDias(fin, -(longitud * 2 - 1)),
    sumarDias(fin, -longitud),
  )
  return {
    actual,
    anterior,
    cambios: {
      totalOrina: variacion(actual.totalOrina, anterior.totalOrina),
      promedioPresionSis: variacion(
        actual.promedioPresionSis ?? 0,
        anterior.promedioPresionSis ?? 0,
      ),
      promedioPresionDia: variacion(
        actual.promedioPresionDia ?? 0,
        anterior.promedioPresionDia ?? 0,
      ),
      promedioO2: variacion(actual.promedioO2 ?? 0, anterior.promedioO2 ?? 0),
      promedioBPM: variacion(actual.promedioBPM ?? 0, anterior.promedioBPM ?? 0),
    },
  }
}

/** Resumen agregado de un rango de dias (inclusive). */
export function resumenRango(
  registros: Registro[],
  desde: FechaISO,
  hasta: FechaISO,
) {
  const rs = registros.filter((r) => r.fecha >= desde && r.fecha <= hasta)
  const o2 = rs.map((r) => r.o2)
  const orina = rs
    .map((r) => r.orina)
    .filter((n): n is number => typeof n === 'number')
  return {
    desde,
    hasta,
    cantidad: rs.length,
    dias: diasUnicos(registros, desde, hasta),
    totalOrina: orina.reduce((a, b) => a + b, 0),
    promedioPresionSis: promedio(rs.map((r) => r.presionSis)),
    promedioPresionDia: promedio(rs.map((r) => r.presionDia)),
    promedioO2: promedio(o2),
    minO2: o2.length ? Math.min(...o2) : null,
    promedioBPM: promedio(rs.map((r) => r.bpm)),
    registros: rs,
  }
}

function diasUnicos(registros: Registro[], desde: FechaISO, hasta: FechaISO): number {
  const set = new Set(
    registros.filter((r) => r.fecha >= desde && r.fecha <= hasta).map((r) => r.fecha),
  )
  return set.size
}

/**
 * Alertas del dia en curso: valores fuera de umbral y avisos de contexto.
 * `diaCompleto` activa el juicio del volumen de orina diario.
 */
export function alertasDelDia(
  registros: Registro[],
  fecha: FechaISO,
  u: Umbrales,
  diaCompleto = false,
  habitual: PresionHabitual = PRESION_HABITUAL_POR_DEFECTO,
): Alerta[] {
  const resumen = resumenDia(registros, fecha)
  const rs = resumen.registros
  const alertas: Alerta[] = []

  // Valores criticos en registros individuales (solo los 3 mas recientes).
  for (const r of [...rs].reverse().slice(0, 3)) {
    // En 12 horas: es un texto para leer de un vistazo, y quien lo lee no
    // deberia tener que convertir la hora mentalmente.
    const hora = hora12(r.hora)
    if (r.presionSis < u.presionSisMin || r.presionSis > u.presionSisMax) {
      alertas.push({
        id: `ps-${r.id}`,
        nivel: 'alerta',
        titulo: `Presion sistolica ${r.presionSis} mmHg`,
        detalle: `Fuera de rango (${u.presionSisMin}-${u.presionSisMax}) a las ${hora}.`,
        icono: 'alerta',
      })
    }
    if (r.presionDia < u.presionDiaMin || r.presionDia > u.presionDiaMax) {
      alertas.push({
        id: `pd-${r.id}`,
        nivel: 'alerta',
        titulo: `Presion diastolica ${r.presionDia} mmHg`,
        detalle: `Fuera de rango (${u.presionDiaMin}-${u.presionDiaMax}) a las ${hora}.`,
        icono: 'alerta',
      })
    }
    if (r.o2 < u.o2Min) {
      alertas.push({
        id: `o2-${r.id}`,
        nivel: 'alerta',
        titulo: `Oxigeno ${r.o2}%`,
        detalle: `Por debajo de ${u.o2Min}% a las ${hora}.`,
        icono: 'oximetro',
      })
    }
    if (r.bpm < u.bpmMin || r.bpm > u.bpmMax) {
      alertas.push({
        id: `bpm-${r.id}`,
        nivel: 'alerta',
        titulo: `Pulso ${r.bpm} lpm`,
        detalle: `Fuera de rango (${u.bpmMin}-${u.bpmMax}) a las ${hora}.`,
        icono: 'corazon',
      })
    }
  }

  // Volumen de orina acumulado.
  if (resumen.totalOrina > u.orinaMax) {
    alertas.push({
      id: 'orina-alta',
      nivel: 'aviso',
      titulo: `Orina alta: ${resumen.totalOrina} ml`,
      detalle: `Por encima de ${u.orinaMax} ml hoy. Revisa la diuresis.`,
      icono: 'gota',
    })
  } else if (diaCompleto && rs.length > 0 && resumen.totalOrina < u.orinaMin) {
    alertas.push({
      id: 'orina-baja',
      nivel: 'aviso',
      titulo: `Orina baja: ${resumen.totalOrina} ml`,
      detalle: `Por debajo de ${u.orinaMin} ml. Considera consultar si continua.`,
      icono: 'gota',
    })
  }

  // Presion media desviada de la habitual del paciente.
  //
  // Los umbrales absolutos de arriba solo saltan ante valores peligrosos para
  // cualquiera. Este aviso cubre el otro caso: un paciente que vive con 90/60
  // puede subir a 130 sin salir de "rango" y aun asi ser un cambio relevante en
  // el. Se emite uno solo por dia (sobre la media) para no duplicar el aviso
  // que ya pinta cada celda del historial.
  const mediaSis = resumen.promedioPresionSis
  if (mediaSis !== null && diaCompleto) {
    const banda = bandaNormal(habitual, u)
    if (mediaSis < banda.sis[0] || mediaSis > banda.sis[1]) {
      const baja = mediaSis < banda.sis[0]
      alertas.push({
        id: `ps-habitual-${fecha}`,
        nivel: 'aviso',
        titulo: `Presion media ${mediaSis} mmHg ${baja ? 'por debajo' : 'por encima'} de su habitual`,
        detalle: `Su presion habitual es ${habitual.sis}/${habitual.dia} mmHg (banda ${banda.sis[0]}-${banda.sis[1]}).`,
        icono: 'corazon',
      })
    }
  }

  return alertas
}

/**
 * Farmacos detectados en las notas.
 * Se buscan nombres conocidos de forma flexible; lo desconocido se captura
 * con el patron "tras X" / "antes de X" para no perder informacion.
 */
const MEDICAMENTOS_CONOCIDOS = [
  'furosemida',
  'furosemide',
  'torasemida',
  'lasix',
  'nebulizacion',
  'salbutamol',
  'albuterol',
  'ipratropio',
  'prednisona',
  'metformina',
  'atenolol',
  'bisoprolol',
  'amlodipino',
  'losartan',
  'enalapril',
  'ramipril',
  'captopril',
  'digoxina',
  'warfina',
  'apixaban',
  'rivaroxaban',
  'atorvastatina',
  'simvastatina',
  'lixivaptan',
  'tolvaptan',
  'espironolactona',
  'hidroclorotiazida',
  'paracetamol',
  'ibuprofeno',
  'tramadol',
  'morfina',
  'sempaglutida',
]

const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

/**
 * Extrae medicamentos de las notas. Devuelve el conteo por farmaco,
 * ordenados por frecuencia.
 */
export function extraerMedicamentos(notas: string[]): { nombre: string; veces: number }[] {
  const conteo = new Map<string, number>()
  const push = (n: string) => conteo.set(n, (conteo.get(n) ?? 0) + 1)

  for (const nota of notas) {
    const n = normalizar(nota)
    let encontrado = false
    for (const med of MEDICAMENTOS_CONOCIDOS) {
      if (n.includes(med)) {
        push(med)
        encontrado = true
      }
    }
    // Patron generico para farmacos no conocidos: "despues de X", "antes de X".
    if (!encontrado) {
      const m = n.match(/(?:despues|antes)\s+de\s+([a-z0-9]{4,40})/)
      if (m) push(m[1].trim())
    }
  }

  return [...conteo.entries()]
    .map(([nombre, veces]) => ({ nombre, veces }))
    .sort((a, b) => b.veces - a.veces || a.nombre.localeCompare(b.nombre))
}

/** Resumen de la semana agrupado por dia, para el reporte semanal. */
export function resumenSemana(registros: Registro[], fecha: FechaISO): ResumenDia[] {
  const lunes = inicioSemana(fecha)
  return Array.from({ length: 7 }, (_, i) => {
    const d = sumarDias(lunes, i)
    return resumenDia(registros, d)
  })
}

/** Devuelve el rango de fechas que cubren todos los registros. */
export function rangoTotal(registros: Registro[]): { desde: FechaISO; hasta: FechaISO } | null {
  if (!registros.length) return null
  const fechas = registros.map((r) => r.fecha).sort()
  return { desde: fechas[0], hasta: fechas[fechas.length - 1] }
}

/** Ultima fecha con registros, o hoy si no hay ninguno. */
export function ultimaFecha(registros: Registro[]): FechaISO {
  const f = diasConRegistros(registros)[0]
  return f ?? claveDia(new Date())
}

/**
 * Agrupa registros por dia conservando el orden de la lista de entrada.
 *
 * El historial pagina por dias en vez de por filas, asi que el agrupado tiene
 * que ser estable: el orden de los dias lo marca el primer registro que aparece
 * de cada uno, que es justo como llega la lista (ya ordenada por el filtro
 * elegido). Solo agrupar, sin reordenar, evita que "mas antiguos primero"
 * invierta el criterio por accidente.
 */
export function agruparPorDia(
  registros: Registro[],
): { fecha: FechaISO; registros: Registro[] }[] {
  const porDia = new Map<FechaISO, Registro[]>()
  for (const r of registros) {
    const delDia = porDia.get(r.fecha)
    if (delDia) delDia.push(r)
    else porDia.set(r.fecha, [r])
  }
  return [...porDia].map(([fecha, rs]) => ({ fecha, registros: rs }))
}