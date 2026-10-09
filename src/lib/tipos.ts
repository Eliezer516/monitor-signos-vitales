/**
 * Tipos de dominio de la aplicacion.
 *
 * Convencion de fechas: los registros guardan `fecha` como ISO corto local
 * ("YYYY-MM-DD") y `hora` como "HH:MM" (24h). Se evita `Date` completo porque
 * al serializar a JSON un Date se vuelve UTC y desplaza el dia del paciente
 * (un registro de las 23:50 en un huso negativo pasaria al dia siguiente).
 *
 * Las 24 horas son solo el formato de guardado, por lo que las horas ordenan y
 * se calculan bien: la interfaz las muestra en 12 horas con `hora12` de
 * `lib/fechas`, porque es como las leen las personas.
 */

/** Fecha en formato ISO corto local, p. ej. "2026-09-30". */
export type FechaISO = string
/** Hora en formato 24h, p. ej. "23:15". Se muestra con `hora12`. */
export type Hora = string

/**
 * Base de todo lo que viaja entre dispositivos.
 *
 * Sin una marca de modificacion no hay forma de saber cual de dos versiones es
 * la buena, asi que al restaurar un backup "gana lo que ya esta en el
 * dispositivo" y una edicion hecha en otro movil se pierde en silencio. Por eso
 * los tres campos son opcionales: los datos guardados antes de existir esto no
 * los tienen, y `lib/fusion` los trata como si su `updatedAt` fuese su
 * `createdAt`.
 */
export interface Sincronizable {
  id: string
  /** ISO completo de creacion, para ordenar y depurar. */
  createdAt: string
  /** ISO de la ultima modificacion. Ausente en datos anteriores a la sincronizacion. */
  updatedAt?: string
}

/** Ambito de datos al que pertenece un borrado. */
export type Ambito = 'registros' | 'visitas' | 'pacientes' | 'sondas'

/**
 * Marca de que algo se borro, para que el borrado tambien viaje a los demas
 * dispositivos.
 *
 * Se guarda en un almacen aparte y no marcandolo sobre el propio registro, para
 * que ningun `useRegistros().registros` cambie de comportamiento: un registro
 * borrado desaparece de la interfaz igual que hasta ahora, y ademas queda la
 * marca para que no reaparezca al sincronizar desde el otro dispositivo.
 */
export interface Borrado {
  ambito: Ambito
  id: string
  /** ISO del borrado. Decide quien gana, igual que `updatedAt` en un registro. */
  borradoAt: string
}

/** Un registro de signos vitales. */
export interface Registro extends Sincronizable {
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
  /** Notas libres: medicamentos, actividades, sintomas. */
  notas: string
  /** Marca los registros cargados desde los datos de ejemplo. */
  ejemplo?: boolean
}

/**
 * Vaciado de la bolsa de la sonda.
 *
 * Es una entidad propia y no un campo del registro de signos vitales, y esa
 * separacion es la que pide el caso de uso: la sonda se vacia cuando toca, no
 * cuando se mide la tension, y mezclarlas obligaria a elegir entre dejar la
 * medicion a medias o inventarse un volumen de orina.
 *
 * Lo que se anota es el volumen que habia en la bolsa en ese momento. Sumando
 * los vaciados de un dia se obtiene el total drenado, que es el dato que le
 * interesa al medico, pero sin perder el detalle de cuantas veces y cuando se
 * vacio, que es lo que permite ver si la sonda se esta obstruyendo.
 */
export interface Sonda extends Sincronizable {
  /** Dia local del vaciado. */
  fecha: FechaISO
  /** Hora local del vaciado, "HH:MM". */
  hora: Hora
  /** Volumen que habia en la bolsa, en ml. */
  volumen: number
  /** Notas libres: color, aspecto, si costaba vaciar. */
  notas: string
  /** Marca las sondas cargadas desde los datos de ejemplo. */
  ejemplo?: boolean
}

/** Resumen agregado de los vaciados de un dia. */
export interface SondaDia {
  fecha: FechaISO
  /** Total drenado ese dia, en ml. */
  totalVolumen: number
  /** Cuantas veces se vacio. */
  vaciados: number
  sondas: Sonda[]
}

/** Nivel de severidad de un valor o de un conjunto de valores. */
export type Nivel = 'ok' | 'aviso' | 'alerta'

/** Resumen agregado de un dia. */
export interface ResumenDia {
  fecha: FechaISO
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
export interface Paciente extends Sincronizable {
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
  /**
   * Si este paciente lleva sonda. Los pacientes sin sonda no anotan vaciados:
   * la caracteristica entera (formulario, metricas, grafica y seccion del
   * reporte) se oculta. Es propia de la ficha y no de la app, porque unos
   * pacientes la necesitan y otros no.
   *
   * Ausente en datos antiguos: en ese caso se considera activa. `normalizarPaciente`
   * y `filaAPaciente` lo rellenan con `true`.
   */
  sonda?: boolean
}

/** Donde se produjo el encuentro con el profesional sanitario. */
export type TipoVisita = 'consulta' | 'domicilio'

/**
 * Visita del medico o del profesional sanitario.
 *
 * No es lo mismo que un registro de signos vitales: las mediciones describen el
 * estado del paciente entre visitas, y esta entidad deja constancia de quien
 * le vio, cuando, por que y que le indico. Sin ella, el informe que lleva el
 * paciente al centro medico cuenta solo numeros y no cuenta la evolucion
 * clinica.
 *
 * Se distingue consulta de visita a domicilio porque el domicilio suele ser
 * donde el profesional ajusta el tratamiento en vivo (una hipotension que baja
 * al levantarse se ve ahi y no en consulta), mientras que la consulta aporta
 * pruebas y recetas.
 */
export interface Visita extends Sincronizable {
  /** Dia local de la visita. */
  fecha: FechaISO
  /** Hora local de la visita, "HH:MM". Opcional: muchas se rescriben a posteriori. */
  hora?: Hora
  tipo: TipoVisita
  /** Motivo principal de la visita. */
  motivo: string
  /** Profesional o centro que realizo la visita. */
  profesional: string
  /** Indicaciones o tratamiento acordados en esa visita. */
  indicaciones: string
  /** Notas libres de la visita. */
  notas: string
  /** Marca las visitas cargadas desde los datos de ejemplo. */
  ejemplo?: boolean
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
  /** Volumen admitido en un vaciado de sonda, en ml. */
  sondaMin: number
  sondaMax: number
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
  /** Volumen admitido en un vaciado de sonda, en ml. */
  sondaMin: number
  sondaMax: number
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

/**
 * Parte de los ajustes que si significa lo mismo en todos los dispositivos.
 *
 * `Ajustes` entero NO se sincroniza, y no por capricho: mezcla lo compartido con
 * lo que es de cada pantalla. `tema`, `recordatorio` y sobre todo
 * `pacienteActivo` son de la maquina que esta delante de la pantalla, y
 * sincronizarlos haria que el paciente seleccionado saltase de un dispositivo a
 * otro. Ademas, el bloque entero con last-write-wins haria que dos dispositivos
 * ajustando umbrales distintos se pisasen en silencio. Por eso se sincroniza
 * campo a campo, no como un bloque.
 */
export interface AjustesCompartidos {
  umbral: Umbrales
  limites: Limites
  presionHabitual: PresionHabitual
  plantillas: PlantillaNota[]
}

/** Campo de `AjustesCompartidos` sujeto a last-write-wins. */
export type CampoCompartido = keyof AjustesCompartidos

/** Ultima modificacion de cada campo compartido, ISO por clave de campo. */
export type MarcasCompartidas = Partial<Record<CampoCompartido, string>>

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
