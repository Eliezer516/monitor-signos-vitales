/**
 * Acceso al fichero de datos en la carpeta oculta de Google Drive.
 *
 * Se usa `appDataFolder` y no una carpeta normal de "Mi Drive" porque es el
 * alcance mas estrecho que permite una copia sincronizada: la app solo ve su
 * propia carpeta y no puede leer ni escribir nada mas de la cuenta. El fichero
 * no aparece en el Drive del usuario, asi que no puede compartirse por error con
 * otra persona.
 *
 * El precio de esa privacidad son dos limitaciones que hay que respetar:
 *
 * - Google **borra la carpeta si se desinstala la app** desde Drive. Por eso la
 *   copia local es siempre la fuente de verdad y nunca se sobrescribe con lo
 *   que hay aqui, y por eso la UI ofrece siempre descargar una copia.
 * - Los ficheros de `appDataFolder` **no admiten papelera**: `files.update` con
 *   `trashed: true` no los aplica, hay que borrarlos con `files.delete`.
 *
 * Drive v3 tampoco ofrece escritura condicional: no existe `If-Match` ni nada
 * equivalente. Por eso el ciclo de `lib/sincronizar` es siempre leer, fusionar y
 * escribir, y nunca escribir a ciegas.
 */

const API = 'https://www.googleapis.com/drive/v3'
const SUBIDA = 'https://www.googleapis.com/upload/drive/v3'

/**
 * Clave de `appProperties` con la que se localiza el fichero.
 *
 * Se busca por esta marca y no por nombre: el nombre lo puede cambiar el
 * usuario desde la interfaz de Drive, y en cuanto cambia el nombre, un
 * `q=name='...'` dejaria de encontrar el fichero y crearia un segundo, con lo
 * que la sincronizacion empezaria a dar datos contradictorios.
 *
 * Ojo al limite de 124 bytes por valor de `appProperties`: aqui solo va un
 * numero de version, no estado ni nada mas.
 */
const CLAVE_PROPIEDAD = 'msv'
const VALOR_PROPIEDAD = '1'

const NOMBRE_FICHERO = 'datos.json'

/** Error de Drive con un mensaje legible, en vez del JSON crudo de la API. */
export class ErrorDrive extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorDrive'
  }
}

/** Traduce los errores reales de la API a algo que se pueda mostrar. */
async function errorDe(respuesta: Response): Promise<ErrorDrive> {
  let detalle = ''
  try {
    const cuerpo = (await respuesta.json()) as { error?: { message?: string } }
    detalle = cuerpo.error?.message ?? ''
  } catch {
    // La respuesta no era JSON.
  }
  switch (respuesta.status) {
    case 401:
      return new ErrorDrive('La sesion de Google ha caducado. Vuelve a conectar.')
    case 403:
      return new ErrorDrive('Google no permite esta operacion con los permisos concedidos')
    case 404:
      return new ErrorDrive('No se encuentra el archivo de datos en Drive')
    default:
      return new ErrorDrive(
        respuesta.status === 0 || !navigator.onLine
          ? 'Sin conexion con Drive'
          : `Drive respondio ${respuesta.status}${detalle ? `: ${detalle}` : ''}`,
      )
  }
}

/** Ejecuta una peticion de Drive y devuelve el JSON, o lanza con mensaje claro. */
async function pedir<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  let respuesta: Response
  try {
    respuesta = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    })
  } catch {
    // `fetch` solo lanza asi cuando no hay red o se corto la conexion.
    throw new ErrorDrive('Sin conexion: no se ha podido hablar con Drive')
  }
  if (!respuesta.ok) throw await errorDe(respuesta)
  if (respuesta.status === 204) return undefined as T
  return (await respuesta.json()) as T
}

interface Fichero {
  id: string
  name: string
  appProperties?: Record<string, string>
}

/** Id del fichero de datos, o `null` si todavia no existe. */
export async function buscarFichero(token: string): Promise<string | null> {
  const q = encodeURIComponent(
    `appProperties has { key='${CLAVE_PROPIEDAD}' and value='${VALOR_PROPIEDAD}' }`,
  )
  const url = `${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,name)&pageSize=10`
  const datos = await pedir<{ files: Fichero[] }>(url, token)
  // Si hubiera mas de uno, de uno solo se queda el mas reciente segun el
  // nombre, que lleva la fecha. Es el caso de una restauracion con dos
  // dispositivos escribiendo a la vez.
  const ficheros = datos.files ?? []
  if (ficheros.length === 0) return null
  return [...ficheros].sort((a, b) => b.name.localeCompare(a.name))[0].id
}

/** Descarga el contenido del fichero. `null` si todavia no existe. */
export async function descargar(token: string): Promise<{ id: string; texto: string } | null> {
  const id = await buscarFichero(token)
  if (!id) return null
  let respuesta: Response
  try {
    respuesta = await fetch(`${API}/files/${id}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    throw new ErrorDrive('Sin conexion: no se ha podido descargar de Drive')
  }
  if (!respuesta.ok) throw await errorDe(respuesta)
  return { id, texto: await respuesta.text() }
}

/** Crea el fichero de datos con el contenido dado. */
export async function crear(token: string, contenido: string): Promise<string> {
  const cuerpo = {
    name: NOMBRE_FICHERO,
    parents: ['appDataFolder'],
    appProperties: { [CLAVE_PROPIEDAD]: VALOR_PROPIEDAD },
  }
  // Subida multipart: en `files.create` el archivo va como `media` dentro del
  // propio POST, y el `uploadType` se pasa por la query.
  const respuesta = await pedir<Fichero>(
    `${SUBIDA}/files?uploadType=multipart&fields=id`,
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/related; boundary=paquete' },
      body: multipart(cuerpo, contenido),
    },
  )
  return respuesta.id
}

/** Sustituye el contenido del fichero existente. */
export async function actualizar(token: string, id: string, contenido: string): Promise<void> {
  // Aqui si hace falta `uploadType=media`: un PATCH con el JSON plano ya es el
  // contenido entero, porque el formato v3 no admite actualizacion parcial de
  // un campo `media` dentro de metadatos.
  await pedir<void>(`${SUBIDA}/files/${id}?uploadType=media&fields=id`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: contenido,
  })
}

/** Crea o actualiza segun exista, y devuelve el id resultante. */
export async function guardar(token: string, contenido: string): Promise<{ id: string; nuevo: boolean }> {
  const id = await buscarFichero(token)
  if (!id) return { id: await crear(token, contenido), nuevo: true }
  await actualizar(token, id, contenido)
  return { id, nuevo: false }
}

/**
 * Elimina el fichero de la cuenta.
 *
 * Es la unica forma de borrarlo: los ficheros de `appDataFolder` no tienen
 * papelera, asi que `trashed: true` no serviria de nada.
 */
export async function borrar(token: string, id: string): Promise<void> {
  await pedir<void>(`${API}/files/${id}`, token, { method: 'DELETE' })
}

/**
 * Monta el cuerpo `multipart/related` que espera la subida.
 *
 * A mano y no con `FormData` porque Drive exige este tipo concreto, con dos
 * partes `application/json`, y no el `multipart/form-data` de un formulario.
 */
function multipart(metadatos: object, contenido: string): Blob {
  const limite = 'paquete'
  const cuerpo = [
    `--${limite}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadatos),
    `--${limite}`,
    'Content-Type: application/json',
    '',
    contenido,
    `--${limite}--`,
    '',
  ].join('\r\n')
  return new Blob([cuerpo], { type: `multipart/related; boundary=${limite}` })
}
