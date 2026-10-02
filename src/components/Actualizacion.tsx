/**
 * Aviso de version nueva disponible.
 *
 * Se monta dentro de `Estructura`, encima del contenido y por debajo de la
 * cabecera. Va en el flujo normal y no como elemento fijo a proposito: la barra
 * inferior movil y el boton flotante de Inicio ya ocupan la parte de abajo, y
 * un aviso flotando encima de ellos taparia justo lo que mas se usa.
 *
 * Mientras que el usuario no acepta, el aviso se puede apartar: el worker viejo
 * sigue sirviendo su propia cache, asi que la version en pantalla nunca queda
 * sin los archivos que necesita. Ajustes deja la opcion de instalarla.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { useAvisos } from './Avisos'
import { IconoActualizar } from './Iconos'
import { Boton } from './UI'
import {
  activarActualizacion,
  buscarActualizacion,
  silenciarActualizacion,
  estadoActual,
  suscribirEstado,
} from '../lib/actualizacion'

export function AvisoActualizacion() {
  const { aviso } = useAvisos()
  const estado = useSyncExternalStore(suscribirEstado, estadoActual)

  const instalar = useCallback(() => {
    aviso('Actualizando…', 'info')
    void activarActualizacion()
  }, [aviso])

  if (!estado.avisar) return null

  return (
    <div
      // `role="status"` para que el lector de pantalla lo anuncie sin robarle
      // el foco a quien esta escribiendo un registro.
      role="status"
      className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-marca/30 bg-marca-suave px-3.5 py-3"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-texto">
        <IconoActualizar width={18} height={18} className="shrink-0 text-marca" />
        <span>Hay una versión nueva disponible</span>
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <Boton variante="primario" tamano="sm" onClick={instalar}>
          Actualizar
        </Boton>
        <Boton variante="fantasma" tamano="sm" onClick={silenciarActualizacion}>
          Ahora no
        </Boton>
      </div>
    </div>
  )
}

/** Boton de comprobacion manual para Ajustes. */
export function BotonBuscarActualizacion() {
  const { aviso } = useAvisos()
  const estado = useSyncExternalStore(suscribirEstado, estadoActual)

  const buscar = useCallback(async () => {
    await buscarActualizacion()
    // El componente ya se vuelve a pintar con el estado nuevo; el aviso solo
    // deja constancia en pantalla de lo que ha pasado.
    const pendiente = estadoActual().pendiente
    aviso(
      pendiente ? 'Hay una versión nueva. Actualiza para instalarla.' : 'Ya tienes la última versión.',
      pendiente ? 'info' : 'exito',
    )
  }, [aviso])

  const instalar = useCallback(() => {
    void activarActualizacion()
  }, [])

  if (estado.pendiente) {
    return (
      <Boton variante="primario" ancho onClick={instalar} icono={<IconoActualizar width={18} height={18} />}>
        Instalar la versión nueva
      </Boton>
    )
  }

  return (
    <Boton
      variante="secundario"
      ancho
      onClick={buscar}
      disabled={estado.comprobacion === 'buscando'}
      icono={<IconoActualizar width={18} height={18} />}
    >
      {estado.comprobacion === 'buscando' ? 'Buscando…' : 'Buscar actualizaciones'}
    </Boton>
  )
}