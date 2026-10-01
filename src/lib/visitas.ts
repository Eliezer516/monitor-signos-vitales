/**
 * Logica pura de las visitas del profesional sanitario.
 *
 * Se separa de la pagina para poder comprobarla sin navegador ni React, igual
 * que `rangos.ts` para las mediciones.
 */

import type { TipoVisita, Visita } from './tipos'

/** Etiqueta legible de cada tipo de visita. */
export const ETIQUETA_VISITA: Record<TipoVisita, string> = {
  consulta: 'Consulta medica',
  domicilio: 'Visita a domicilio',
}

/** Etiqueta corta para la insignia de la tarjeta. */
export const ETIQUETA_CORTA: Record<TipoVisita, string> = {
  consulta: 'Consulta',
  domicilio: 'Domicilio',
}

/** Campos que guarda el formulario de visita. */
export interface BorradorVisita {
  fecha: string
  hora: string
  tipo: TipoVisita
  motivo: string
  profesional: string
  indicaciones: string
  notas: string
}

/** Longitudes maximas: evitan que un texto pegado enorme reviente el backup. */
export const MAX_PROFESIONAL = 120
export const MAX_TEXTO = 2000

/**
 * Comprueba el borrador de una visita.
 *
 * Solo el motivo es obligatorio. El resto son datos que el cuidador no siempre
 * tiene a mano (no todo el mundo recuerda la hora exacta de una visita a
 * domicilio ni el nombre del profesional que vino), y bloquear el guardado los
 * obligaria a inventarlos, que es peor que dejar el hueco vacio.
 */
export function validarVisita(b: BorradorVisita): Partial<Record<keyof BorradorVisita, string>> {
  const errores: Partial<Record<keyof BorradorVisita, string>> = {}

  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.fecha)) errores.fecha = 'Fecha no valida'
  if (b.hora && !/^\d{2}:\d{2}$/.test(b.hora)) errores.hora = 'Hora no valida'
  if (!b.motivo.trim()) errores.motivo = 'Escribe el motivo de la visita'
  if (b.profesional.length > MAX_PROFESIONAL) errores.profesional = 'Demasiado largo'
  if (b.indicaciones.length > MAX_TEXTO) errores.indicaciones = 'Demasiado largo'
  if (b.notas.length > MAX_TEXTO) errores.notas = 'Demasiado largo'

  return errores
}

/** Convierte un borrador validado en los datos que espera el contexto. */
export function aDatosVisita(b: BorradorVisita): Omit<Visita, 'id' | 'createdAt'> {
  return {
    fecha: b.fecha,
    // Sin hora se guarda `undefined` y no una cadena vacia: asi se distingue
    // "no consta la hora" de una visita escrita a las 00:00, y el orden la
    // coloca al final de su dia.
    hora: b.hora || undefined,
    tipo: b.tipo,
    motivo: b.motivo.trim(),
    profesional: b.profesional.trim(),
    indicaciones: b.indicaciones.trim(),
    notas: b.notas.trim(),
  }
}

/** Cabecera del CSV y de la hoja de Excel, en el orden de `filaVisita`. */
export const CABECERA_VISITAS: string[] = [
  'Fecha',
  'Hora',
  'Tipo',
  'Motivo',
  'Profesional',
  'Indicaciones',
  'Notas',
]

/** Fila de una visita en el mismo orden que `CABECERA_VISITAS`. */
export function filaVisita(v: Visita): (string | number)[] {
  return [
    v.fecha,
    v.hora ?? '',
    ETIQUETA_VISITA[v.tipo],
    v.motivo,
    v.profesional,
    v.indicaciones,
    v.notas,
  ]
}

/**
 * Cuantas visitas hubo de cada tipo y cuantas no tienen profesional registrado.
 * Se muestra en la pagina para que el cuidador vea si el historial le sirve o
 * le faltan datos.
 */
export function resumenVisitas(visitas: Visita[]): {
  total: number
  consultas: number
  domicilios: number
  sinProfesional: number
} {
  return {
    total: visitas.length,
    consultas: visitas.filter((v) => v.tipo === 'consulta').length,
    domicilios: visitas.filter((v) => v.tipo === 'domicilio').length,
    sinProfesional: visitas.filter((v) => !v.profesional).length,
  }
}