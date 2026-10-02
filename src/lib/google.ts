/**
 * Autenticacion con Google para la sincronizacion.
 *
 * Aqui esta toda la parte incomoda de usar Google sin backend, y conviene
 * dejarla escrita porque las limitaciones no son evidentemente culpa nuestra:
 *
 * - Google Identity Services (GIS) no emite refresh token. El token de acceso
 *   dura una hora y punto. No hay forma de renovarlo en segundo plano.
 * - GIS solo admite el flujo de dialogo (popup). El flujo por redireccion, que si
 *   admite refresh token, esta marcado como obsoleto y no tiene equivalente en
 *   GIS. No hay alternativa.
 * - `requestAccessToken()` solo se puede llamar desde un clic del usuario. Ni
 *   desde un temporizador, ni al cargar la pagina, ni desde el service worker.
 * - En una PWA instalada el popup puede no llegar a completarse si el sistema la
 *   trata como ventana sin interfaz. No hay forma de detectarlo antes, solo se
 *   ve que no ha llegado el token.
 *
 * Consecuencia de todo lo anterior: la sincronizacion es a peticion y hay que
 * reautentificar mas o menos cada hora. Es exactamente lo que la UI de
 * Ajustes refleja, sin prometer nada que no se pueda cumplir.
 */

const GIS_URL = 'https://accounts.google.com/gsi/client'

/**
 * Scope de la carpeta oculta de la app.
 *
 * `drive.appdata` es el mas estrecho que permite una copia sincronizada: da
 * acceso solo a la carpeta que la propia app crea en el Drive del usuario, sin
 * poder ver ni tocar el resto de sus archivos. Es un scope NO sensible, asi que
 * no hace falta pasar la verificacion de Google que si exigen los scopes que dan
 * acceso a archivos del usuario.
 *
 * A cambio, la carpeta es invisible y Google la borra si se desinstala la app,
 * por lo que la copia local sigue siendo la fuente de verdad y nunca se
 * sobrescribe con lo que hay alla.
 */
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata'

/** Margen de seguridad antes de la caducidad real del token. */
const MARGEN_S = 60

/** Token de acceso en curso. Vive en `sessionStorage`, no en `localStorage`. */
interface TokenGuardado {
  token: string
  /** Epoch en segundos. */
  expira: number
}

// ---------------------------------------------------------------------------
// GIS
// ---------------------------------------------------------------------------

/** Subconjunto de la API de GIS que usa la app, para no depender de sus tipos. */
interface TokenClient {
  requestAccessToken: (opts?: { prompt?: string; hint?: string; email?: string }) => void
}
interface Gis {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: {
        client_id: string
        scope: string
        callback: (r: RespuestaToken) => void
        error_callback?: (e: { type?: string; message?: string }) => void
      }) => TokenClient
      revoke: (token: string, done?: () => void) => void
    }
  }
}

interface RespuestaToken {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

declare global {
  interface Window {
    google?: Gis
  }
}

let cargando: Promise<Gis> | null = null

/** El client ID, o cadena vacia si la app se desplego sin configurar Drive. */
export function clientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
}

/** Si falta el client ID, la parte de Drive se oculta en vez de romperse. */
export function driveConfigurado(): boolean {
  return clientId() !== ''
}

const CLAVE_TOKEN = 'msv:token-google'

/** Carga el script de GIS una sola vez y reutiliza la promesa. */
function cargarGis(): Promise<Gis> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('La sincronizacion solo funciona en el navegador'))
  }
  if (window.google?.accounts) return Promise.resolve(window.google)
  if (cargando) return cargando

  cargando = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = GIS_URL
    s.async = true
    s.defer = true
    s.onload = () =>
      window.google?.accounts
        ? resolve(window.google)
        : reject(new Error('No se pudo cargar la libreria de Google'))
    s.onerror = () => reject(new Error('Sin conexion para cargar Google'))
    document.head.appendChild(s)
  })
  return cargando
}

// ---------------------------------------------------------------------------
// Estado del token
// ---------------------------------------------------------------------------

function leerToken(): TokenGuardado | null {
  try {
    const bruto = sessionStorage.getItem(CLAVE_TOKEN)
    return bruto ? (JSON.parse(bruto) as TokenGuardado) : null
  } catch {
    return null
  }
}

/** Token guardado y aun vigente. `sessionStorage` muere con la pestana. */
export function tokenVigente(): TokenGuardado | null {
  const t = leerToken()
  if (!t?.token) return null
  if (Date.now() / 1000 >= t.expira - MARGEN_S) return null
  return t
}

// ---------------------------------------------------------------------------
// Estado del token
// ---------------------------------------------------------------------------
// Pedir y revocar el token
// ---------------------------------------------------------------------------

/** Error de autorizacion con un mensaje pensado para/leer por la persona. */
export class ErrorGoogle extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorGoogle'
  }
}

/**
 * Pide un token de acceso. **Solo puede llamarse desde un clic del usuario.**
 *
 * Se rechaza con un mensaje concreto en cada fallo, en vez de devolver un error
 * generico, porque los casos se dan la vuelta: popup bloqueado en PWA instalada,
 * usuario que cancela, o popup que se queda colgado sin cerrar. Sin esto la
 * aplicacion se quedaria con un spinner eterno sin explicar nada.
 */
export function pedirToken(): Promise<TokenGuardado> {
  if (!driveConfigurado()) {
    return Promise.reject(new ErrorGoogle('La sincronizacion no esta configurada en este despliegue'))
  }

  return cargarGis().then(
    (gis) =>
      new Promise<TokenGuardado>((resolve, reject) => {
        let cliente: TokenClient
        try {
          cliente = gis.accounts.oauth2.initTokenClient({
            client_id: clientId(),
            scope: SCOPE,
            callback: (r: RespuestaToken) => {
              if (r.error || !r.access_token) {
                reject(
                  new ErrorGoogle(
                    r.error === 'access_denied'
                      ? 'Has cancelado el acceso a Google'
                      : 'Google no ha concedido acceso',
                  ),
                )
                return
              }
              const guardado: TokenGuardado = {
                token: r.access_token,
                expira: Math.floor(Date.now() / 1000) + (r.expires_in ?? 3600),
              }
              try {
                sessionStorage.setItem(CLAVE_TOKEN, JSON.stringify(guardado))
              } catch {
                // Sin sessionStorage el token sirve para esta accion y ya.
              }
              resolve(guardado)
            },
            // Se invoca cuando el popup se cierra sin completar. Es el caso
            // tipico en PWA instalada, y sin este manejador la promesa se
            // quedaria esperando para siempre.
            error_callback: (e) =>
              reject(
                new ErrorGoogle(
                  e?.type === 'popup_closed'
                    ? 'La ventana de Google se cerro antes de terminar. Prueba otra vez.'
                    : 'No se pudo abrir la ventana de Google',
                ),
              ),
          })
        } catch {
          reject(new ErrorGoogle('La libreria de Google no se cargo bien'))
          return
        }
        try {
          cliente.requestAccessToken()
        } catch {
          reject(new ErrorGoogle('El navegador ha bloqueado la ventana de Google'))
        }
      }),
  )
}

/**
 * Revoca el token y lo olvida.
 *
 * La revocacion es la parte que importa de verdad: sin ella sigue habiendo un
 * token valido en la sesion de Google de este dispositivo, que puede dar acceso
 * a la carpeta hasta que caduque, y el usuario creeria que lo ha cerrado.
 */
export function desconectar(): void {
  const t = leerToken()
  try {
    sessionStorage.removeItem(CLAVE_TOKEN)
  } catch {
    // Nada que limpiar.
  }
  if (!t?.token) return
  void cargarGis()
    .then((gis) => {
      gis.accounts.oauth2.revoke(t.token, () => {})
    })
    .catch(() => {
      // Si no se puede revocar en linea, el token caduca en una hora igualmente.
    })
}
