/**
 * Texto plano de mediciones, para copiar y pegar en un mensaje.
 *
 * Existe porque el uso real del historial no es exportar un fichero, sino
 *mandar "lo de hoy" al familiar o al medico por WhatsApp o por correo. Exportar
 * a CSV o XLSX resuelve el caso de quien se lleva los datos a un PC, pero obliga
 * a quien solo quiere leer cinco cifras a buscar un archivo en el movil.
 *
 * El formato es un bloque por medicion: una linea de encabezado con la fecha
 * (y la hora, si el bloque es una sola toma), una linea en blanco y despues un
 * dato por linea como "Presion: 120/80".
 *
 *   Viernes 2 de octubre de 2026 - 5:40 AM
 *
 *   Presion: 120/80
 *   O2: 100%
 *   Pulso: 90
 *
 * Se elige un dato por linea, y no todo en una linea separada por guiones,
 * porque asi el texto pegado en un chat se lee sintables y porque se puede
 * editar a mano un valor suelto sin rehacer la linea entera, que es lo que
 * acaba haciendo quien lo reenvia a un medico.
 *
 * Las horas van en 12 horas, como en pantalla: el texto esta pensado para
 * leerlo una persona, no para volver a importarlo. Quien necesite los datos
 * tabulares tiene el CSV y el XLSX, que si conservan las 24 horas.
 */

import { fechaCompleta, hora12 } from './fechas'
import type { Registro } from './tipos'

/** Datos de un registro, en el orden en que se leen y con su etiqueta. */
const CAMPOS: { etiqueta: string; valor: (r: Registro) => string }[] = [
  { etiqueta: 'Presion', valor: (r) => `${r.presionSis}/${r.presionDia}` },
  { etiqueta: 'O2', valor: (r) => `${r.o2}%` },
  { etiqueta: 'Pulso', valor: (r) => `${r.bpm}` },
]

/**
 * Cuerpo del bloque: un dato por linea.
 *
 * Las notas van como un dato mas, solo si las hay. Sin ellas, quien lea no
 * puede distinguir si el dato no se midio o si no se anoto nada.
 */
function bloqueDatos(r: Registro): string {
  const lineas = CAMPOS.map((c) => `${c.etiqueta}: ${c.valor(r)}`)
  if (r.notas) lineas.push(`Notas: ${r.notas}`)
  return lineas.join('\n')
}

/** Bloque completo de una medicion, con su fecha y su hora. */
export function textoMedicion(r: Registro): string {
  return `${fechaCompleta(r.fecha)} - ${hora12(r.hora)}\n\n${bloqueDatos(r)}`
}

/**
 * Bloque completo de una medicion sin la fecha en la linea de encabezado.
 *
 * Se usa al copiar un dia entero, donde la fecha ya va una sola vez arriba y
 * repetirla en cada toma solo haria el mensaje mas largo.
 */
function bloqueSinFecha(r: Registro): string {
  return `${hora12(r.hora)}\n${bloqueDatos(r)}`
}

/**
 * Varias mediciones como texto, con un encabezado del periodo y un bloque por
 * toma, separados por una linea en blanco.
 *
 * Con un solo dia, la fecha va una vez en el encabezado y cada bloque lleva
 * solo su hora. Si el conjunto abarca varios dias, cada bloque se cierra con su
 * fecha para que siga leyendose si alguien copia solo un trozo del mensaje.
 */
export function textoMediciones(registros: Registro[]): string {
  if (!registros.length) return ''
  // Una unica medicion no necesita encabezado de periodo: el suyo ya lo es.
  if (registros.length === 1) return textoMedicion(registros[0])

  const dias = [...new Set(registros.map((r) => r.fecha))]
  const unDia = dias.length === 1
  const cabecera = unDia
    ? fechaCompleta(dias[0])
    : `${fechaCompleta(dias[0])} - ${fechaCompleta(dias[dias.length - 1])}`

  const bloques = registros.map((r) => (unDia ? bloqueSinFecha(r) : textoMedicion(r)))
  return [cabecera, ...bloques].join('\n\n')
}

/**
 * Copia texto al portapapeles.
 *
 * `navigator.clipboard` solo existe en contexto seguro y no en todos los
 * navegadores moviles, y esta app se instala como PWA, donde fallar en
 * silencio dejaria al usuario pulsando un boton que no hace nada. Por eso hay
 * un segundo intento con `execCommand`, y si tampoco funciona se devuelve
 * `false` para poder avisar.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  if (!texto) return false

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(texto)
      return true
    } catch {
      // Sin permiso o sin foco. Se intenta el metodo antiguo.
    }
  }

  try {
    // `document.execCommand` esta obsoleto, pero es la unica via en algunos
    // navegadores moviles y necesita un elemento real en el documento.
    const area = document.createElement('textarea')
    area.value = texto
    // Fuera de la vista: si se deja visible saltaria el scroll y en iOS abriria
    // el teclado al pegar.
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '0'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
