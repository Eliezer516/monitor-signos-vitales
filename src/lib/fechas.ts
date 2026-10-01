/**
 * Utilidades de fecha y hora, todas en hora local del dispositivo.
 *
 * El helper central es `claveDia`, que convierte un instante a "YYYY-MM-DD"
 * local. Todo el agrupamiento por dia depende de el; usar `toISOString()`
 * (que convierte a UTC) desplazaria los registros nocturnos de dia.
 */

import type { FechaISO, Hora, Periodo } from './tipos'

const DOS_DIGITOS = (n: number) => String(n).padStart(2, '0')

/** Fecha local actual como "YYYY-MM-DD". */
export function claveDia(d: Date): FechaISO {
  return `${d.getFullYear()}-${DOS_DIGITOS(d.getMonth() + 1)}-${DOS_DIGITOS(d.getDate())}`
}

/** Hora local actual como "HH:MM". */
export function claveHora(d: Date): Hora {
  return `${DOS_DIGITOS(d.getHours())}:${DOS_DIGITOS(d.getMinutes())}`
}

/**
 * "HH:MM" en formato de 12 horas, como "8:05 AM" o "1:30 PM".
 *
 * Se guarda siempre en 24 horas (`Hora` es "HH:MM") y se convierte solo al
 * mostrar: asi el orden lexicografico, los calculos y los ficheros exportados
 * siguen siendo correctos, y quien lleva el dato lo ve como lo lee en un reloj
 * de pared o en un reloj digital de pulsera.
 *
 * "AM"/"PM" en mayusculas y sin puntos: es la forma que se reconoce de un
 * vistazo, y evita que el punto se confunda con parte de la cifra en textos
 * pequeños (tablas, etiquetas de graficas).
 *
 * Devuelve cadena vacia si la hora no es valida, para poder mostrar un guion en
 * su lugar sin tener que comprobarlo en cada sitio.
 */
export function hora12(hora: Hora | undefined): string {
  if (!hora) return ''
  const m = /^(\d{2}):(\d{2})$/.exec(hora)
  if (!m) return ''
  const h = Number(m[1])
  const min = m[2]
  // "25:99" tiene forma de hora pero no lo es: sin esta comprobacion salia
  // "1:99 PM", que no es una hora que pueda existir.
  if (h > 23 || Number(min) > 59) return ''
  // 00 -> 12 AM, 12 -> 12 PM, 13 -> 1 PM, 23 -> 11 PM.
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${min} ${h < 12 ? 'AM' : 'PM'}`
}

/** Convierte "YYYY-MM-DD" + "HH:MM" en un Date local. */
export function aDate(fecha: FechaISO, hora: Hora = '00:00'): Date {
  const [a, m, d] = fecha.split('-').map(Number)
  const [h, min] = hora.split(':').map(Number)
  return new Date(a, (m ?? 1) - 1, d ?? 1, h ?? 0, min ?? 0, 0, 0)
}

/** Instante del registro, para ordenar y comparar. */
export const instanteDe = (r: { fecha: FechaISO; hora: Hora }) => aDate(r.fecha, r.hora)

/** Suma dias a una fecha ISO, devolviendo otra fecha ISO. */
export function sumarDias(fecha: FechaISO, dias: number): FechaISO {
  const d = aDate(fecha)
  d.setDate(d.getDate() + dias)
  return claveDia(d)
}

/** Dias entre dos fechas ISO (b - a). */
export function diasEntre(a: FechaISO, b: FechaISO): number {
  const ms = aDate(b).getTime() - aDate(a).getTime()
  return Math.round(ms / 86_400_000)
}

/** Rango de fechas ISO que cubre un periodo terminando en `fin`. */
export function rangoPeriodo(fin: FechaISO, periodo: Periodo): { desde: FechaISO; hasta: FechaISO } {
  switch (periodo) {
    case 'dia':
      return { desde: fin, hasta: fin }
    case 'semana':
      return { desde: sumarDias(fin, -6), hasta: fin }
    case 'mes':
      return { desde: sumarDias(fin, -29), hasta: fin }
  }
}

/**
 * Inicio de la semana (lunes) de la fecha dada.
 * Se usa lunes como arranque porque es la convencion en los reportes clinicos
 * europeos y evita cutting semanas a mitad.
 */
export function inicioSemana(fecha: FechaISO): FechaISO {
  const d = aDate(fecha)
  const dow = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dow)
  return claveDia(d)
}

const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']
const DIAS_LARGOS = [
  'domingo',
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
]
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/** "sabado" en minuscula, sin acentos (facil de comparar y de buscar). */
export const nombreDia = (fecha: FechaISO) => DIAS_LARGOS[aDate(fecha).getDay()]
export const nombreDiaCorto = (fecha: FechaISO) => DIAS_CORTOS[aDate(fecha).getDay()]
export const nombreMes = (fecha: FechaISO) => MESES[aDate(fecha).getMonth()]

/** "30 sep 2026" */
export function fechaCorta(fecha: FechaISO): string {
  const d = aDate(fecha)
  return `${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`
}

/** "Sabado 30 de septiembre" */
export function fechaLarga(fecha: FechaISO): string {
  const d = aDate(fecha)
  const dia = DIAS_LARGOS[d.getDay()]
  const mes = MESES[d.getMonth()]
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} ${d.getDate()} de ${mes}`
}

/** "Sabado 30 de septiembre de 2026" */
export function fechaCompleta(fecha: FechaISO): string {
  return `${fechaLarga(fecha)} de ${aDate(fecha).getFullYear()}`
}

/** Etiqueta para el eje X segun el periodo. */
export function etiquetaEje(fecha: FechaISO, periodo: Periodo): string {
  if (periodo === 'mes') {
    const d = aDate(fecha)
    return `${MESES[d.getMonth()].slice(0, 3)} ${String(d.getFullYear()).slice(2)}`
  }
  if (periodo === 'semana') return `${nombreDiaCorto(fecha)} ${aDate(fecha).getDate()}`
  return `${aDate(fecha).getDate()} ${MESES[aDate(fecha).getMonth()].slice(0, 3)}`
}

/** Etiqueta relativa util para el encabezado ("Hoy", "Ayer", "Sabado 30"). */
export function etiquetaRelativa(fecha: FechaISO, hoy: FechaISO = claveDia(new Date())): string {
  const diff = diasEntre(fecha, hoy)
  if (diff === 0) return 'Hoy'
  if (diff === -1) return 'Ayer'
  if (diff === -2) return 'Anteayer'
  if (diff === 1) return 'Manana'
  return fechaLarga(fecha)
}

/** Registros de las ultimas 24 horas respecto a `ahora`, en orden cronologico. */
export function ultimas24h<T extends { fecha: FechaISO; hora: Hora }>(
  registros: T[],
  ahora: Date = new Date(),
): T[] {
  const limite = ahora.getTime() - 24 * 3_600_000
  return registros
    .filter((r) => {
      const t = aDate(r.fecha, r.hora).getTime()
      return t >= limite && t <= ahora.getTime() + 60_000
    })
    .sort((a, b) => instanteDe(b).getTime() - instanteDe(a).getTime())
}

/** ¿Esta el dispositivo en horario de verano? No usado directamente, informativo. */
export function esHoy(fecha: FechaISO, hoy: FechaISO = claveDia(new Date())): boolean {
  return fecha === hoy
}

/** Minutos desde medianoche, para el registro en la tabla. */
export function minutosDesdeMedianoche(hora: Hora): number {
  const [h, m] = hora.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/** Resta entre dos horas "HH:MM" -> "1h 25min". */
export function diferenciaHoras(ini: Hora, fin: Hora): string {
  const d = minutosDesdeMedianoche(fin) - minutosDesdeMedianoche(ini)
  if (d <= 0) return ''
  const h = Math.floor(d / 60)
  const m = d % 60
  return h ? `${h}h ${m}min` : `${m}min`
}

/** Cuenta atras legible desde "ahora" ("hace 12 min", "hace 3 h"). */
export function haceCuanto(fecha: FechaISO, hora: Hora, ahora: Date = new Date()): string {
  const min = Math.max(0, Math.round((ahora.getTime() - aDate(fecha, hora).getTime()) / 60_000))
  if (min < 1) return 'ahora mismo'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return `hace ${d} d`
}
