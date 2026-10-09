/**
 * Fusion de datos entre dispositivos.
 *
 * Aqui ya no vive ningun transporte: no hay red, ni tokens, ni peticiones. Solo
 * queda la parte que decide que version de un dato gana cuando dos dispositivos
 * han escrito lo mismo, y esa parte es la que hay que conservar por encima de
 * todo lo demas:
 *
 *   **Lo local es la fuente de verdad y NUNCA se sobrescribe con lo remoto.**
 *
 * Lo que viene de fuera es un objetivo de fusion, no una copia que se restaure
 * encima. La diferencia importa cuando dos dispositivos escriben a la vez: el
 * perdedor conserva todo en su IndexedDB y lo vuelve a subir en el siguiente
 * ciclo, de modo que no hay perdida permanente. Si esto se cambiara por un
 * "descargar y sustituir", dos sincronizaciones simultaneas destruirian datos sin
 * avisar.
 *
 * El transporte es lo unico que se cambia: la replica contra Turso ya no pasa
 * por un fichero JSON unico sino por filas en una base de datos, pero las reglas
 * de aqui son las mismas y no hay que volver a escribirlas.
 */

import { construirBackup, type Backup } from './exportar'
import {
  CAMPOS_COMPARTIDOS,
  emparejar,
  fusionarAjustes,
  fusionarBorrados,
  type ResultadoFusion,
} from './fusion'
import type {
  AjustesCompartidos,
  Borrado,
  CampoCompartido,
  MarcasCompartidas,
  Paciente,
  Registro,
  Sonda,
  Visita,
} from './tipos'

/** Lo que hay en este dispositivo antes de sincronizar. */
export interface EstadoLocal {
  registros: Registro[]
  visitas: Visita[]
  sondas: Sonda[]
  pacientes: Paciente[]
  borrados: Borrado[]
  ajustes: AjustesCompartidos
  marcas: MarcasCompartidas
}

/**
 * Lo que viene de fuera, ya leido y con la forma que sea.
 *
 * `ajustes` y las colecciones pueden faltar porque el otro lado es una version
 * antigua o todavia no ha enviado nada: `null` significa "no hay", no "vacio".
 * En eso se distingue de `EstadoLocal`, donde todo existe siempre.
 */
export interface EstadoRemoto {
  registros?: Registro[]
  visitas?: Visita[]
  sondas?: Sonda[]
  pacientes?: Paciente[]
  borrados?: Borrado[]
  ajustes?: Partial<AjustesCompartidos> | null
  marcas?: MarcasCompartidas
}

/** Lo que ha cambiado en la ultima fusion, para contarselo a la persona. */
export interface ResumenSincronizacion {
  registros: ResultadoFusion<Registro>
  visitas: ResultadoFusion<Visita>
  sondas: ResultadoFusion<Sonda>
  pacientes: ResultadoFusion<Paciente>
  /** Campos de ajustes compartidos que han cambiado de verdad. */
  ajustes: number
  /**
   * Datos que estaban solo en este dispositivo y por tanto hay que enviar.
   *
   * Contarlos como enviados y no como perdida es el matiz de `enviables`: no se
   * ha perdido nada, simplemente esta parte todavia no ha salido del telefono.
   */
  enviados: number
}

/** Las colecciones que puede traer un paquete, y que tienen que ser listas. */
const COLECCIONES = ['registros', 'visitas', 'sondas', 'pacientes', 'borrados'] as const

/**
 * Comprueba que un texto es un paquete nuestro y tiene la forma esperada antes
 * de fiarse de el.
 *
 * No basta con mirar `app` y `version`. Un paquete con `registros` como cadena,
 * o con `borrados` de objetos sin `id`, pasaria una comprobacion superficial y
 * luego `leerBackup` lo devolveria tal cual: los tombstones basura acabarian
 * escritos en el almacen y `fusionarAjustes` compararia marcas que no son
 * fechas. Como lo que llega de fuera es lo unico que separa los dos
 * dispositivos, esto es lo que evita que un paquete danado toque datos clinicos.
 */
export function esPaqueteValido(bruto: string): boolean {
  if (!bruto.trim()) return false
  let datos: unknown
  try {
    datos = JSON.parse(bruto)
  } catch {
    return false
  }
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return false
  const d = datos as Record<string, unknown>
  if (d.app !== 'signos-vitales') return false
  if (d.version !== 1 && d.version !== 2 && d.version !== 3) return false

  // Lo que este presente tiene que estar bien. Lo que falte se rellena con
  // vacio: un backup de la version 1 no tiene `borrados` ni `ajustes`, y eso es
  // legitimo, no esta roto.
  for (const clave of COLECCIONES) {
    if (d[clave] !== undefined && !Array.isArray(d[clave])) return false
  }
  if (d.ajustes !== undefined && !esAjustesCompartidos(d.ajustes)) return false
  if (d.marcas !== undefined && !esMarcas(d.marcas)) return false
  // Cada tombstone necesita ambito, id e instante. Un `{}` aqui se guardaria en
  // el almacen y no borraria nada, pero contaminaria la union para siempre.
  if (Array.isArray(d.borrados)) {
    for (const b of d.borrados as unknown[]) {
      if (!b || typeof b !== 'object') return false
      const marca = b as Record<string, unknown>
      if (typeof marca.ambito !== 'string' || typeof marca.id !== 'string') return false
      if (marca.ambito !== 'registros' && marca.ambito !== 'visitas' && marca.ambito !== 'pacientes' && marca.ambito !== 'sondas')
        return false
      if (typeof marca.borradoAt !== 'string') return false
    }
  }

  // Un `{}` con la marca correcta pasaria y fusionaria contra listas vacias, que
  // es justo el caso que no debe ocurrir: no distingue "no hay datos" de "no se
  // ha leido bien". Un paquete solo de ajustes o solo de borrados si es valido.
  return COLECCIONES.some((c) => Array.isArray(d[c])) || d.ajustes !== undefined
}

/** `marcas` tiene que ser un objeto plano de fechas, que es como se comparan. */
function esMarcas(valor: unknown): boolean {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false
  const marcas = valor as Record<string, unknown>
  // Solo claves conocidas: una marca inventada no se compararia con nada y
  // acabaria guardada para siempre.
  if (!Object.keys(marcas).every((c) => CAMPOS_COMPARTIDOS.includes(c as CampoCompartido)))
    return false
  // Los valores tienen que ser instantes reales. `fusionarAjustes` los ordena
  // como texto para no depender del reloj, asi que un "ayer" no fallaria al
  // pintar pero haria que el campo ganara o perdiera de forma arbitraria, y
  // ademas se guardaria como marca definitiva.
  return Object.values(marcas).every(
    (v) => typeof v === 'string' && v.length > 0 && Number.isFinite(Date.parse(v)),
  )
}

/**
 * Cada campo compartido presente tiene que ser un objeto (o una lista, para
 * `plantillas`). No se comprueba el contenido: eso lo normaliza `leerBackup`.
 * Lo que importa es no dejar que un string o un numero llegue a `setAjuste` y
 * rompa la app al pintar `ajustes.umbral.o2Min`.
 */
function esAjustesCompartidos(valor: unknown): boolean {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false
  const ajustes = valor as Record<string, unknown>
  return CAMPOS_COMPARTIDOS.every((campo) => {
    if (ajustes[campo] === undefined) return true
    if (campo === 'plantillas') return Array.isArray(ajustes[campo])
    return !!ajustes[campo] && typeof ajustes[campo] === 'object' && !Array.isArray(ajustes[campo])
  })
}

/**
 * Une lo local con lo de fuera y devuelve el paquete resultante.
 *
 * Funcion pura: no lee ni escribe nada, y no depende de donde vengan los datos
 * de fuera. Devuelve el paquete ya fusionado, que es lo que hay que guardar en
 * el destino y a la vez dejar en pantalla.
 *
 * Lo que se devuelve es lo ya fusionado y no lo que habia antes: el destino tiene
 * que dejar de ser la foto de un dispositivo para pasar a ser la union. Si se
 * guardara lo local sin fusionar, cada ciclo perderia lo del otro.
 *
 * `remoto` en `null` significa que el otro lado aun no tiene nada, que es lo que
 * pasa la primera vez. No es un error: el resultado es el estado local intacto.
 */
export function fusionarPaquetes(
  local: EstadoLocal,
  remoto: EstadoRemoto | null,
): { resumen: ResumenSincronizacion; paquete: Backup } {
  const borrados = fusionarBorrados(local.borrados, remoto?.borrados ?? [])
  const registros = emparejar(local.registros, remoto?.registros ?? [], borrados, 'registros')
  const visitas = emparejar(local.visitas, remoto?.visitas ?? [], borrados, 'visitas')
  const sondas = emparejar(local.sondas, remoto?.sondas ?? [], borrados, 'sondas')
  const pacientes = emparejar(local.pacientes, remoto?.pacientes ?? [], borrados, 'pacientes')
  const ajustes = fusionarAjustes(
    local.ajustes,
    remoto?.ajustes ?? local.ajustes,
    local.marcas,
    remoto?.marcas ?? {},
  )

  const paquete = construirBackup({
    registros: registros.fusionados,
    visitas: visitas.fusionados,
    sondas: sondas.fusionados,
    pacientes: pacientes.fusionados,
    borrados,
    ajustes: ajustes.ajustes,
    marcas: ajustes.marcas,
  })

  return {
    paquete,
    resumen: {
      registros,
      visitas,
      sondas,
      pacientes,
      ajustes: ajustes.pisados,
      enviados: registros.enviables + visitas.enviables + sondas.enviables + pacientes.enviables,
    },
  }
}

/** Texto corto con lo que ha cambiado, para el aviso de quien lo ve. */
export function resumirCambios(r: ResumenSincronizacion): string {
  const partes: string[] = []
  const nuevos = r.registros.entraron + r.visitas.entraron + r.sondas.entraron + r.pacientes.entraron
  if (nuevos) partes.push(`${nuevos} datos nuevos`)

  const actualizados =
    r.registros.pisados + r.visitas.pisados + r.sondas.pisados + r.pacientes.pisados + r.ajustes
  if (actualizados) partes.push(`${actualizados} actualizados`)

  const borrados = r.registros.borradosAplicados + r.visitas.borradosAplicados + r.sondas.borradosAplicados
  if (borrados) partes.push(`${borrados} borrados en el otro dispositivo`)

  if (r.enviados) partes.push(`${r.enviados} enviados`)
  return partes.length ? partes.join(', ') : 'Todo ya estaba sincronizado'
}