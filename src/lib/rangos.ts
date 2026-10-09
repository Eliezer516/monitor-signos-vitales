/**
 * Umbrales clinicos y validacion de rangos.
 *
 * Se separan dos conceptos que a menudo se confunden:
 *  - `LIMITES_POR_DEFECTO`: admision de datos. Fuera de esto el numero es un
 *    error de tecleo y se bloquea el guardado.
 *  - `UMBRALES_POR_DEFECTO`:Aviso medico. El valor es plausible pero exige
 *    atencion (p. ej. sistolica de 100 no es un error de tecleo, es hipotension).
 */

import type { Ajustes, Limites, Nivel, PresionHabitual, Registro, Umbrales } from './tipos'

/** Limites de entrada: bloquean el guardado si se superan. */
export const LIMITES_POR_DEFECTO: Limites = {
  presionSisMin: 60,
  presionSisMax: 200,
  presionDiaMin: 40,
  presionDiaMax: 130,
  o2Min: 70,
  // La hemoglobina no puede estar mas saturada al 100%, asi que un pulso
  // oximetro que marca 101-102% esta midiendo fuera de rango por calibracion,
  // no por estado del paciente. Aun asi se admiten esos valores hasta 102 para
  // no bloquear un dato que el aparato ha dado: negar el registro empujaria a
  // anotar "100" a mano, que si es un dato falso. Por encima de 102 casi
  // siempre es una errata y si se rechaza.
  o2Max: 102,
  bpmMin: 40,
  bpmMax: 180,
  sondaMin: 0,
  sondaMax: 3000,
}

/**
 * Umbrales de alerta. Se separan en dos niveles porque no todas las desviaciones
 * son igual de urgentes: `aviso` marca atencion, `alerta` marca urgencia.
 */
export const UMBRALES_POR_DEFECTO: Umbrales = {
  presionSisMin: 80,
  presionSisMax: 160,
  presionDiaMin: 50,
  presionDiaMax: 100,
  o2Min: 92,
  o2Max: 100,
  bpmMin: 50,
  bpmMax: 120,
  sondaMin: 0,
  sondaMax: 3000,
}

/**
 * Presion habitual por defecto cuando ni el paciente ni los ajustes definen
 * otra. Corresponde a una persona adulta sana.
 */
export const PRESION_HABITUAL_POR_DEFECTO: PresionHabitual = { sis: 120, dia: 80 }

/**
 * Margen que se considera "igual que siempre" alrededor de la presion habitual.
 *
 * Valores habituales: se considera normal una variacion de hasta 20 mmHg
 * sistolicos y 10 diastolicos sobre la habitual. Mas alla de eso ya no es ruido
 * de medicion, sino un cambio respecto a su propio estado, que es lo que
 * interesa detectar en un paciente cronico.
 *
 * Los limites de `alerta` NO se derivan de aqui: siguen siendo absolutos y
 * editables, para que un valor objetivamente peligroso se avise siempre.
 */
export const TOLERANCIA_SIS = 20
export const TOLERANCIA_DIA = 10

/**
 * Banda "normal" derivada de la presion habitual.
 *
 * Se recorta para que nunca invada la zona de `alerta`: si la habitual es 90/60,
 * la bandaaria de 70 a 110, pero como la alerta empieza en 80, el limite
 * inferior se queda en 81. De lo contrario un valor de 78 a la vez "normal para
 * el" y "en alerta", que es una contradiccion incomprensible para quien lee.
 */
export function bandaNormal(
  habitual: PresionHabitual = PRESION_HABITUAL_POR_DEFECTO,
  u: Umbrales = UMBRALES_POR_DEFECTO,
): { sis: [number, number]; dia: [number, number] } {
  return {
    sis: [
      Math.max(u.presionSisMin + 1, habitual.sis - TOLERANCIA_SIS),
      Math.min(u.presionSisMax - 1, habitual.sis + TOLERANCIA_SIS),
    ],
    dia: [
      Math.max(u.presionDiaMin + 1, habitual.dia - TOLERANCIA_DIA),
      Math.min(u.presionDiaMax - 1, habitual.dia + TOLERANCIA_DIA),
    ],
  }
}

/** Rangos considered "normales" para oxigeno y pulso, fijos segun referencia clinica. */
export const RANGO_NORMAL = {
  o2: [95, 100],
  bpm: [60, 100],
} as const

const redondear = (n: number, d = 0) => {
  const f = 10 ** d
  return Math.round(n * f) / f
}

/**
 * Evalua un valor contra los umbrales de alerta.
 * Devuelve `ok` dentro del rango, `aviso` en la zonawarning y `alerta` fuera.
 */
export function evaluar(
  valor: number | null,
  min: number,
  max: number,
  margenAviso = 5,
): Nivel {
  if (valor === null || Number.isNaN(valor)) return 'ok'
  if (valor < min || valor > max) return 'alerta'
  if (valor < min + margenAviso || valor > max - margenAviso) return 'aviso'
  return 'ok'
}

/** Nivel de un valor de saturacion de oxigeno (sin margen de aviso: 95-100 es normal). */
export function evaluarO2(valor: number | null, u: Umbrales): Nivel {
  if (valor === null || Number.isNaN(valor)) return 'ok'
  if (valor < u.o2Min) return 'alerta'
  if (valor < 95) return 'aviso'
  // Por encima de 100 no se marca nada: es saturacion imposible y por tanto
  // un fallo del aparato, no un sintoma. Avisar en ambar de un "102%" haria que
  // el cuidador ignore tambien los avisos que si importan.
  return 'ok'
}

/**
 * Nivel de la presion sistolica.
 *
 * `alerta` usa los limites absolutos de `u`; `aviso` usa la banda normal de la
 * presion habitual del paciente.
 */
export function evaluarSis(
  valor: number | null,
  u: Umbrales,
  habitual: PresionHabitual = PRESION_HABITUAL_POR_DEFECTO,
): Nivel {
  if (valor === null || Number.isNaN(valor)) return 'ok'
  if (valor < u.presionSisMin || valor > u.presionSisMax) return 'alerta'
  const [min, max] = bandaNormal(habitual, u).sis
  if (valor < min || valor > max) return 'aviso'
  return 'ok'
}

/** Nivel de la presion diastolica. Mismo criterio que la sistolica. */
export function evaluarDia(
  valor: number | null,
  u: Umbrales,
  habitual: PresionHabitual = PRESION_HABITUAL_POR_DEFECTO,
): Nivel {
  if (valor === null || Number.isNaN(valor)) return 'ok'
  if (valor < u.presionDiaMin || valor > u.presionDiaMax) return 'alerta'
  const [min, max] = bandaNormal(habitual, u).dia
  if (valor < min || valor > max) return 'aviso'
  return 'ok'
}

/** Nivel de la frecuencia cardiaca. */
export function evaluarBpm(valor: number | null, u: Umbrales): Nivel {
  if (valor === null || Number.isNaN(valor)) return 'ok'
  if (valor < u.bpmMin || valor > u.bpmMax) return 'alerta'
  if (valor < RANGO_NORMAL.bpm[0] || valor > RANGO_NORMAL.bpm[1]) return 'aviso'
  return 'ok'
}

/** Nivel global de un registro: el peor de todos sus valores. */
export function nivelRegistro(
  registro: Registro,
  u: Umbrales,
  habitual: PresionHabitual = PRESION_HABITUAL_POR_DEFECTO,
): Nivel {
  const niveles: Nivel[] = [
    evaluarSis(registro.presionSis, u, habitual),
    evaluarDia(registro.presionDia, u, habitual),
    evaluarO2(registro.o2, u),
    evaluarBpm(registro.bpm, u),
  ]
  if (niveles.includes('alerta')) return 'alerta'
  if (niveles.includes('aviso')) return 'aviso'
  return 'ok'
}

/** Colores y textos por nivel, para mantener consistencia visual. */
export const ESTILO_NIVEL: Record<Nivel, { clase: string; punto: string; texto: string }> =
  {
    ok: {
      clase: 'bg-ok-suave text-ok border-ok/20',
      punto: 'bg-ok',
      texto: 'text-ok',
    },
    aviso: {
      clase: 'bg-aviso-suave text-aviso border-aviso/25',
      punto: 'bg-aviso',
      texto: 'text-aviso',
    },
    alerta: {
      clase: 'bg-alerta-suave text-alerta border-alerta/25',
      punto: 'bg-alerta',
      texto: 'text-alerta',
    },
  }

/**
 * Borrador de registro tal y como llega del formulario.
 * A diferencia de `Registro`, aqui los campos numericos pueden venir vacios
 * (`null`), que es el estado normal mientras el cuidador escribe.
 */
export type Borrador = Omit<Partial<Registro>, 'presionSis' | 'presionDia' | 'o2' | 'bpm'> & {
  presionSis: number | null
  presionDia: number | null
  o2: number | null
  bpm: number | null
}

/**
 * Valida los campos de un registro contra los limites de entrada.
 * Devuelve errores por campo; los campos vacios o ausentes no se consideran
 * error aqui (lo comprueba el formulario segun si son obligatorios).
 */
export function validarRegistro(
  datos: Borrador,
  limites: Limites = LIMITES_POR_DEFECTO,
): { errores: Record<string, string> } {
  const errores: Record<string, string> = {}

  const rango = (
    campo: string,
    etiqueta: string,
    v: number | null | undefined,
    min: number,
    max: number,
    unidad: string,
  ) => {
    // `undefined` = campo ausente en la validacion; `null` = campo vacio.
    if (v === null || v === undefined) return
    const n = Number(v)
    if (Number.isNaN(n)) {
      errores[campo] = `${etiqueta}: numero no valido`
    } else if (n < min || n > max) {
      errores[campo] = `${etiqueta}: debe estar entre ${min} y ${max} ${unidad}`
    }
  }

  rango('presionSis', 'Presion sistolica', datos.presionSis, limites.presionSisMin, limites.presionSisMax, 'mmHg')
  rango('presionDia', 'Presion diastolica', datos.presionDia, limites.presionDiaMin, limites.presionDiaMax, 'mmHg')
  rango('o2', 'Oxigeno', datos.o2, limites.o2Min, limites.o2Max, '%')
  rango('bpm', 'Pulso', datos.bpm, limites.bpmMin, limites.bpmMax, 'lpm')

  if (!datos.fecha) errores.fecha = 'Indica la fecha'
  if (!datos.hora) errores.hora = 'Indica la hora'

  return { errores }
}

/** Colores de las series de graficas. */
export const COLORES_SERIE = {
  sis: '#dc2626',
  dia: '#2563eb',
  o2: '#0891b2',
  bpm: '#db2777',
  sonda: '#7c3aed',
  referencia: '#94a3b8',
} as const

/** Ajustes por defecto para una instalacion nueva. */
export const AJUSTES_POR_DEFECTO: Ajustes = {
  tema: 'sistema',
  pacienteActivo: null,
  umbral: UMBRALES_POR_DEFECTO,
  limites: LIMITES_POR_DEFECTO,
  presionHabitual: PRESION_HABITUAL_POR_DEFECTO,
  plantillas: [
    { id: 'p1', texto: 'Despues de furosemida', activa: true },
    { id: 'p2', texto: 'Antes de furosemida', activa: true },
    { id: 'p3', texto: 'Despues de nebulizacion', activa: true },
    { id: 'p4', texto: 'Antes de nebulizacion', activa: true },
  ],
  recordatorio: {
    intervaloMin: 240,
    inicioSilencio: 1320,
    finSilencio: 420,
    notificar: false,
  },
  ultimoBackup: null,
}

/**
 * Plantillas sugeridas segun los habitos de registro. Se fusionan con las
 * guardadas para que una app existente no pierda sus plantillas propias.
 */
export const PLANTILLAS_SUGERIDAS = [
  'Despues de furosemida',
  'Antes de furosemida',
  'Despues de nebulizacion',
  'Antes de nebulizacion',
  'Despues de la comida',
  'Antes de la comida',
  'Dificultad para respirar',
  'Hinchazon en piernas',
  'Cansancio',
]

export { redondear }
