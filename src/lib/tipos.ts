/**
 * Tipos de dominio de la aplicacion.
 *
 * Convencion de fechas: los registros guardan `fecha` como ISO corto local
 * ("YYYY-MM-DD") y `hora` como "HH:MM" (24h). Se evita `Date` completo porque
 * al serializar a JSON un Date se vuelve UTC y desplaza el dia del paciente
 * (un registro de las 23:50 en un huso negativo pasaria al dia siguiente).
 */

/** Fecha en formato ISO corto local, p. ej. "2026-09-30". */
export type FechaISO = string
/** Hora en formato 24h, p. ej. "23:15". */
export type Hora = string

/** Un registro de signos vitales. */
export interface Registro {
  id: string
  /** Dia local al que pertenece la medicion. */
  fecha: FechaISO
  /** Hora local de la medicion, "HH:MM". */
  hora: Hora
  /** Presion arterial sistolica en mmHg. */
  presionSis: number
  /** Presion arterial diastolica en mmHg. */
  presionDia: number
  /** Saturacion de oxigeno SpO2 en porcentaje. */
  o2: number
  /** Frecuencia cardiaca en latidos por minuto. */
  bpm: number
  /** Volumen de orina en ml. `null` cuando no se midio en esa toma. */
  orina: number | null
  /** Notas libres: medicamentos, actividades, sintomas. */
  notas: string
  /** ISO completo de creacion, para ordenar y depurar. */
  createdAt: string
  /** Marca los registros cargados desde los datos de ejemplo. */
  ejemplo?: boolean
}

/** Nivel de severidad de un valor o de un conjunto de valores. */
export type Nivel = 'ok' | 'aviso' | 'alerta'

/** Resumen agregado de un dia. */
export interface ResumenDia {
  fecha: FechaISO
  totalOrina: number
  promedioPresionSis: number | null
  promedioPresionDia: number | null
  minO2: number | null
  maxO2: number | null
  promedioBPM: number | null
  registros: Registro[]
}

/** Periodo de agrupacion para las graficas. */
export type Periodo = 'dia' | 'semana' | 'mes'

/** Un punto de la serie temporal, ya agregado por periodo. */
export interface PuntoSerie {
  /** Etiqueta del eje X ("30 sep", "Lun 29", "sep 2026"). */
  etiqueta: string
  /** Clave unica y ordenable del punto. */
  clave: FechaISO
  presionSis: number | null
  presionDia: number | null
  promedioO2: number | null
  minO2: number | null
  maxO2: number | null
  promedioBPM: number | null
  totalOrina: number
  registros: Registro[]
}

/**
 * Presion arterial habitual del paciente: el valor con el que se encuentra bien.
 *
 * No es lo mismo que "rango normal de la poblacion". Una persona mayor que
 * vive con 90/60 tiene una hipotension cronica asintomatica; si la app la marcase
 * comoOutside de rango en cada toma, el aviso dejaria de significar nada y el
 * cuidador acabaria ignorar todos los avisos, incluidos los importantes.
 */
export interface PresionHabitual {
  /** Sistolica habitual en mmHg. */
  sis: number
  /** Diastolica habitual en mmHg. */
  dia: number
}

/** Datosbasicos del paciente. Opcional para permitir uno solo. */
export interface Paciente {
  id: string
  nombre: string
  /** Fecha de nacimiento "YYYY-MM-DD". */
  nacimiento?: FechaISO
  /** Notas de contexto que aparecen en los reportes. */
  notas?: string
  /**
   * Presion habitual de este paciente. Si no se define, se usa la global de
   * Ajustes, para no tener que repetirla en cada ficha.
   */
  presionHabitual?: PresionHabitual
  creadoAt: string
}

/** Plantilla de nota rapida. */
export interface PlantillaNota {
  id: string
  texto: string
  /** Si esta activa aparece como boton rapido en el formulario. */
  activa: boolean
}

/** Configuracion de recordatorios. */
export interface Recordatorio {
  /** Minutos entre avisos para volver a registrar. `0` desactiva. */
  intervaloMin: number
  /** Minutos tras la hora de dormir para no molestar de noche. */
  inicioSilencio: number
  /** Minutos tras inicioSilencio para volver a permitir avisos. */
  finSilencio: number
  /** Pedir permiso de notificaciones del navegador. */
  notificar: boolean
  /** Avisar cuando la orina acumulada aun no llega al minimo diario. */
  avisarOrinaBaja: boolean
}

/** Umbrales clinicos, editables desde Ajustes. */
export interface Umbrales {
  presionSisMin: number
  presionSisMax: number
  presionDiaMin: number
  presionDiaMax: number
  o2Min: number
  o2Max: number
  bpmMin: number
  bpmMax: number
  /** Volumen diario de orina en ml. */
  orinaMin: number
  orinaMax: number
}

/** Limites de entrada: valores fuera de rango no se pueden guardar. */
export interface Limites {
  presionSisMin: number
  presionSisMax: number
  presionDiaMin: number
  presionDiaMax: number
  o2Min: number
  o2Max: number
  bpmMin: number
  bpmMax: number
  orinaMin: number
  orinaMax: number
}

/** Ajustes persistentes de la app. */
export interface Ajustes {
  tema: 'claro' | 'oscuro' | 'sistema'
  pacienteActivo: string | null
  umbral: Umbrales
  limites: Limites
  /** Presion habitual por defecto, usada si el paciente no define la suya. */
  presionHabitual: PresionHabitual
  plantillas: PlantillaNota[]
  recordatorio: Recordatorio
  /** Ultimo backup automatico, ISO. */
  ultimoBackup: string | null
}

/** Alerta emitida al revisar un registro o el resumen de un dia. */
export interface Alerta {
  id: string
  nivel: Nivel
  titulo: string
  detalle: string
  /** Icono SVG a mostrar. */
  icono: 'alerta' | 'aviso' | 'gota' | 'oximetro' | 'corazon'
}

/** Resultado de validar un formulario. */
export interface ValidacionFormulario {
  valido: boolean
  errores: Record<string, string>
  avisos: Record<string, string>
}
