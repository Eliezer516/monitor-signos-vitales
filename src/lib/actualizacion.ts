/**
 * Registro y actualizacion del service worker.
 *
 * El service worker decide que se guarda en la cache del navegador, asi que su
 * unico trabajo aqui es enterarse de si hay uno nuevo pendiente y avisar. Va
 * aparte de la navegacion porque las rutas de la app son por hash: cambiar de
 * pantalla NO genera ninguna peticion a `index.html`, asi que el navegador no
 * tendria ninguna ocasion de comprobar si hay version nueva.
 *
 * Se comprueba en cuatro momentos:
 *  - al registrar, que es cuando el navegador puede estar trayendo un worker
 *    nuevo si el usuario lleva mucho tiempo sin abrir la app;
 *  - al volver a la app, al recuperar la conexion y cada media hora, para que
 *    una app abierta durante mucho tiempo tampoco se quede anclada a la version
 *    con la que arranco.
 *
 * Quien decide SI se actualiza es quien la usa: el worker nuevo se queda en
 * espera y solo se activa cuando se acepta. Ver la nota del `install` en
 * `public/sw.js`, que explica por que es importante que no se active solo.
 */

/** Estado de la comprobacion, independiente de si hay algo que actualizar. */
export type EstadoComprobacion = 'inactivo' | 'al-dia' | 'buscando'

export interface EstadoActualizacion {
  /** Como ha ido la ultima comprobacion. */
  comprobacion: EstadoComprobacion
  /** Hay una version nueva instalada y esperando a que se active. */
  pendiente: boolean
  /** Si el aviso se debe mostrar ahora. */
  avisar: boolean
}

const INICIAL: EstadoActualizacion = { comprobacion: 'inactivo', pendiente: false, avisar: false }

/** Cada cuanto se comprueba si hay version nueva, ademas de al abrir la app. */
const INTERVALO_MS = 30 * 60 * 1000

/** Cuanto se calla el aviso si el usuario lo aparta, para no martillear. */
const SILENCIO_MS = 60 * 60 * 1000

/** Margen para recargar si el worker nuevo no llega a tomar el control. */
const RECARGA_MS = 3000

let registro: ServiceWorkerRegistration | null = null
let snapshot: EstadoActualizacion = INICIAL
let silencioHasta = 0

const oyentes = new Set<() => void>()

/**
 * `useSyncExternalStore` exige que la instantanea sea estable entre cambios: si
 * se creara un objeto nuevo en cada llamada, React veria un cambio en cada
 * render. Por eso solo se reconstruye cuando algo cambia de verdad.
 */
function cambiar(cambio: Partial<EstadoActualizacion>) {
  const siguiente: EstadoActualizacion = { ...snapshot, ...cambio }
  if (
    siguiente.comprobacion === snapshot.comprobacion &&
    siguiente.pendiente === snapshot.pendiente &&
    siguiente.avisar === snapshot.avisar
  ) {
    return
  }
  snapshot = siguiente
  for (const o of oyentes) o()
}

function marcar(comprobacion: EstadoComprobacion) {
  cambiar({ comprobacion })
}

/** El aviso reaparece solo pasado el tiempo de silencio. */
function refrescarAviso() {
  cambiar({ avisar: snapshot.pendiente && Date.now() >= silencioHasta })
}

export function suscribirEstado(fn: () => void): () => void {
  oyentes.add(fn)
  return () => oyentes.delete(fn)
}

export function estadoActual(): EstadoActualizacion {
  return snapshot
}

function marcarPendiente(pendiente: boolean) {
  cambiar({ pendiente })
  refrescarAviso()
}

/**
 * Registra el service worker y se queda escuchando a las versiones nuevas.
 *
 * Devuelve la funcion de limpieza para el efecto que la llama. Es idempotente:
 * si ya hay un registro, montar dos veces el componente no duplica ni
 * escuchas ni temporizadores.
 */
export function registrarActualizacion(): () => void {
  if (registro) return () => {}
  if (!('serviceWorker' in navigator)) return () => {}
  // Solo en produccion: en desarrollo cachearia el bundle del HMR de Vite y
  // recargaria la pagina en bucle.
  if (!import.meta.env.PROD) return () => {}

  let vivo = true

  const comprobar = async () => {
    if (!vivo || !registro) return
    // Comprobar en segundo plano mientras la app esta oculta gasta bateria y
    // el usuario no puede aprovechar el resultado.
    if (document.visibilityState === 'hidden') return
    try {
      await registro.update()
      // `update()` no lanza cuando no hay nada nuevo, asi que no fallar ya es
      // la respuesta. Si mientras tanto llego una version pendiente, su aviso
      // manda sobre este estado.
      if (!snapshot.pendiente) marcar('al-dia')
    } catch {
      // Sin red no se puede saber nada. La app sigue con lo que tiene cacheado
      // y no se molesta al usuario con un aviso que no puede resolver.
    }
  }

  const alVolver = () => {
    if (document.visibilityState !== 'visible') return
    void comprobar()
    // Puede haber segundos sin avisar de algo que se quedó a la espera.
    if (snapshot.pendiente) refrescarAviso()
  }

  navigator.serviceWorker
    // `updateViaCache: 'none'` fuerza a pedir el `sw.js` al servidor sin mirar
    // la cache HTTP. Sin esto, un servidor que lo sirva con un max-age largo
    // puede seguir entregando el mismo archivo mucho despues de publicar una
    // version nueva, y el bug del que se queja el usuario vuelve.
    .register('/sw.js', { updateViaCache: 'none' })
    .then((r) => {
      if (!vivo) return
      registro = r
      vigilarEnEspera(r)
      void comprobar()
    })
    .catch(() => {
      // Sin service worker la app sigue funcionando, solo que sin modo
      // offline. No es motivo para mostrar un error.
    })

  document.addEventListener('visibilitychange', alVolver)
  window.addEventListener('online', alVolver)
  const temporizador = window.setInterval(comprobar, INTERVALO_MS)

  return () => {
    vivo = false
    document.removeEventListener('visibilitychange', alVolver)
    window.removeEventListener('online', alVolver)
    window.clearInterval(temporizador)
  }
}

/**
 * Se fija en el worker que se esta instalando y avisa cuando queda listo.
 *
 * `installed` solo quiere decir "hay version nueva" si ademas hay ya un worker
 * controlando la pagina: sin ese worker previo es la primera instalacion, y no
 * hay nada que actualizar.
 */
function vigilarEnEspera(r: ServiceWorkerRegistration) {
  if (r.waiting) marcarPendiente(true)

  r.addEventListener('updatefound', () => {
    const nuevo = r.installing
    if (!nuevo) return
    nuevo.addEventListener('statechange', () => {
      if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
        marcarPendiente(true)
      }
    })
  })
}

/** Comprobacion a demanda, desde Ajustes. */
export async function buscarActualizacion() {
  if (!registro) return
  marcar('buscando')
  try {
    await registro.update()
  } catch {
    // Sin red no se puede confirmar nada; el estado previo sigue siendo cierto.
  }
  if (!snapshot.pendiente) marcar('al-dia')
}

/**
 * Activa la version que estaba esperando y recarga cuando entre en vigor.
 *
 * La recarga no es un extra: en cuanto el worker nuevo toma el control pasa a
 * servir el bundle cacheado nuevo, asi que sin recargar la pagina seguiria
 * ejecutando el codigo viejo contra los archivos nuevos. Y recargar no pierde
 * nada, porque todos los datos viven en IndexedDB y localStorage.
 */
export function activarActualizacion(): Promise<void> {
  const enEspera = registro?.waiting
  if (!enEspera) {
    window.location.reload()
    return Promise.resolve()
  }

  return new Promise((resolver) => {
    const recargar = () => {
      navigator.serviceWorker.removeEventListener('controllerchange', recargar)
      window.location.reload()
      resolver()
    }
    navigator.serviceWorker.addEventListener('controllerchange', recargar)
    enEspera.postMessage('skip-waiting')
    // Red de seguridad: si el worker no llegara a activarse, el usuario se
    // quedaria mirando un aviso que no se va nunca.
    window.setTimeout(recargar, RECARGA_MS)
  })
}

/**
 * Aparta el aviso un rato sin instalar nada.
 *
 * Es seguro aplazar la actualizacion: mientras no se acepta, el worker viejo
 * sigue controlando la pagina CON su cache, de modo que la version en pantalla
 * y sus archivos siguen siendo coherentes aunque se pierda la conexion.
 */
export function silenciarActualizacion() {
  silencioHasta = Date.now() + SILENCIO_MS
  refrescarAviso()
}