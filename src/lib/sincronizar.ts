/**
 * Ciclo de sincronizacion con Drive.
 *
 * La propiedad de seguridad de todo este modulo, y lo unico que hay que
 * conservar por encima de todo lo demas:
 *
 *   **Lo local es la fuente de verdad y NUNCA se sobrescribe con lo remoto.**
 *
 * El fichero de Drive es un objetivo de fusion, no una copia que se restaure
 * encima. La diferencia importa cuando dos dispositivos escriben a la vez: el
 * perdedor conserva todo en su IndexedDB y lo vuelve a subir en el siguiente
 * ciclo, de modo que no hay perdida permanente. Si esto se cambiara por un
 * "descargar y sustituir", dos sincronizaciones simultaneas destruirian datos sin
 * avisar.
 *
 * Y como Drive v3 no tiene escritura condicional, el ciclo es siempre
 * leer -> fusionar -> escribir. No se puede hacer en una sola operacion atomica
 * porque la API no la ofrece.
 */

import { construirBackup, leerBackup, type Backup } from './exportar'
import * as drive from './drive'
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
  Visita,
} from './tipos'

/** Lo que hay en este dispositivo antes de sincronizar. */
export interface EstadoLocal {
  registros: Registro[]
  visitas: Visita[]
  pacientes: Paciente[]
  borrados: Borrado[]
  ajustes: AjustesCompartidos
  marcas: MarcasCompartidas
}

/** Contenido de un fichero de Drive ya validado. */
type Remoto = {
  registros: Registro[]
  visitas: Visita[]
  pacientes: Paciente[]
  borrados: Borrado[]
  ajustes: Partial<AjustesCompartidos> | null
  marcas: MarcasCompartidas
}

/** Lo que ha cambiado en la ultima sincronizacion, para contarselo al usuario. */
export interface ResumenSincronizacion {
  registros: ResultadoFusion<Registro>
  visitas: ResultadoFusion<Visita>
  pacientes: ResultadoFusion<Paciente>
  /** Campos de ajustes compartidos que han cambiado de verdad. */
  ajustes: number
  /** Datos que estaban solo aqui y se han subido. */
  enviados: number
  /** Si el fichero no existia en Drive y se acaba de crear. */
  creado: boolean
  /** Epoch en ms de la subida. */
  cuando: number
}

/** Las colecciones que puede traer un paquete, y que tienen que ser listas. */
const COLECCIONES = ['registros', 'visitas', 'pacientes', 'borrados'] as const

/**
 * Comprueba que un fichero descargado es nuestro y tiene la forma esperada antes
 * de fiarse de el.
 *
 * No basta con mirar `app` y `version`. Un fichero con `registros` como cadena,
 * o con `borrados` de objetos sin `id`, pasaria una comprobacion superficial y
 * luego `leerBackup` lo devolveria tal cual: los tombstones basura acabarian
 * escritos en el almacen y `fusionarAjustes` compararia marcas que no son
 * fechas. Como el fichero de Drive es lo unico que separa los dos dispositivos,
 * esto es lo que evita que un fichero damaged toque datos clinicos.
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
      if (marca.ambito !== 'registros' && marca.ambito !== 'visitas' && marca.ambito !== 'pacientes')
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

/** Error de un fichero remoto que existe pero no se puede usar. */
export class RemotoDanado extends Error {
  constructor() {
    super(
      'La copia de Drive esta danada y no se ha tocado nada. Puedes borrar esa copia con "Olvidar copia de Drive" y volver a sincronizar.',
    )
    this.name = 'RemotoDanado'
  }
}

/** Descarga y valida el fichero de Drive. `null` si no hay todavia. */
async function descargarRemoto(token: string): Promise<Remoto | null> {
  const fichero = await drive.descargar(token)
  if (!fichero) return null

  if (!esPaqueteValido(fichero.texto)) {
    // Aqui se lanza error en lugar de tratar el fichero como si no existiera.
    // Sobrescribirlo perderia lo que contuviera sin que nadie se entere, y un
    // backup puede ser la unica copia de unos datos que todavia no estan en este
    // dispositivo. `olvidarRemoto` es la salida, y es una decision de la
    // persona, no un efecto secundario de haber pulsado sincronizar.
    throw new RemotoDanado()
  }

  // Se reutiliza el lector del backup: es el mismo formato y no tiene sentido
  // tener dos reglas de validacion que se puedan desincronizar.
  const leido = leerBackup(fichero.texto)
  return {
    registros: leido.registros,
    visitas: leido.visitas,
    pacientes: leido.pacientes,
    borrados: leido.borrados,
    ajustes: leido.ajustes,
    marcas: leido.marcas,
  }
}

/**
 * Ejecuta una sincronizacion completa y devuelve el paquete ya fusionado.
 *
 * El token se le pasa ya caducado o vigente porque la decision de reautentificar
 * es de la UI, que es quien puede exigir el clic que Google necesita.
 *
 * Si el fichero remoto esta danado, lanza `RemotoDanado` sin subir nada. Los
 * datos locales no se tocan nunca antes de que la subida haya terminado bien.
 */
export async function sincronizar(
  local: EstadoLocal,
  token: string,
): Promise<{ resumen: ResumenSincronizacion; paquete: Backup }> {
  const remoto = await descargarRemoto(token)

  const borrados = fusionarBorrados(local.borrados, remoto?.borrados ?? [])
  const registros = emparejar(local.registros, remoto?.registros ?? [], borrados, 'registros')
  const visitas = emparejar(local.visitas, remoto?.visitas ?? [], borrados, 'visitas')
  const pacientes = emparejar(local.pacientes, remoto?.pacientes ?? [], borrados, 'pacientes')
  const ajustes = fusionarAjustes(
    local.ajustes,
    remoto?.ajustes ?? local.ajustes,
    local.marcas,
    remoto?.marcas ?? {},
  )

  // Se sube lo ya fusionado y no lo que habia antes: el fichero de Drive tiene
  // que dejar de ser la foto de un dispositivo para pasar a ser la union. Si se
  // subiera lo local sin fusionar, cada ciclo perderia lo del otro.
  const paquete = construirBackup({
    registros: registros.fusionados,
    visitas: visitas.fusionados,
    pacientes: pacientes.fusionados,
    borrados,
    ajustes: ajustes.ajustes,
    marcas: ajustes.marcas,
  })
  const { nuevo } = await drive.guardar(token, JSON.stringify(paquete, null, 2))

  return {
    paquete,
    resumen: {
      registros,
      visitas,
      pacientes,
      ajustes: ajustes.pisados,
      enviados:
        registros.enviables + visitas.enviables + pacientes.enviables,
      creado: nuevo,
      cuando: Date.now(),
    },
  }
}

/**
 * Borra el fichero de Drive.
 *
 * Solo para el boton de "olvidar la copia remota". Los datos locales no se tocan:
 * esto olvida la copia de Drive, no los datos del dispositivo.
 */
export async function olvidarRemoto(token: string): Promise<void> {
  const id = await drive.buscarFichero(token)
  if (id) await drive.borrar(token, id)
}

/** Texto corto con lo que ha cambiado, para el aviso de la UI. */
export function resumirCambios(r: ResumenSincronizacion): string {
  const partes: string[] = []
  const nuevos = r.registros.entraron + r.visitas.entraron + r.pacientes.entraron
  if (nuevos) partes.push(`${nuevos} datos nuevos`)

  const actualizados =
    r.registros.pisados + r.visitas.pisados + r.pacientes.pisados + r.ajustes
  if (actualizados) partes.push(`${actualizados} actualizados`)

  const borrados = r.registros.borradosAplicados + r.visitas.borradosAplicados
  if (borrados) partes.push(`${borrados} borrados en el otro dispositivo`)

  if (r.enviados) partes.push(`${r.enviados} enviados`)
  return partes.length ? partes.join(', ') : 'Todo ya estaba sincronizado'
}
