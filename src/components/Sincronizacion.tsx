/**
 * Seccion de sincronizacion con Google Drive, dentro de Ajustes.
 *
 * El texto esta escrito a proposito sin prometer sincronizacion automatica: no la
 * hay, y la app no tiene backend donde guardar un refresh token. Cada boton dice
 * lo que hace y cuando hay que usarlo, para que pulsarlo y esperar no parezca un
 * fallo.
 */

import { useState } from 'react'
import { Boton } from './UI'
import { IconoActualizar, IconoCerrar, IconoDescargar } from './Iconos'
import { useAvisos } from './Avisos'
import { useRegistros } from '../context/ContextoRegistros'
import { useVisitas } from '../context/ContextoVisitas'
import { useAjustes } from '../context/ContextoAjustes'
import { desconectar, driveConfigurado, pedirToken, tokenVigente } from '../lib/google'
import {
  RemotoDanado,
  olvidarRemoto,
  resumirCambios,
  sincronizar,
  type EstadoLocal,
} from '../lib/sincronizar'
import { exportarBackup } from '../lib/exportar'
import { claveDia, claveHora, fechaCorta, hora12 } from '../lib/fechas'

/** Cuando se sincronizo por ultima vez. Solo informativo y local. */
const CLAVE_ULTIMA = 'msv:ultima-sync'

function leerUltima(): string | null {
  try {
    return localStorage.getItem(CLAVE_ULTIMA)
  } catch {
    return null
  }
}

export function SeccionSincronizacion() {
  const { registros, fusionar: fusionarRegistros, borrados } = useRegistros()
  const { visitas, fusionar: fusionarVisitas } = useVisitas()
  const { pacientes, fusionarPacientes, ajustesCompartidos, marcas, aplicarAjustesRemotos } =
    useAjustes()
  const { aviso } = useAvisos()

  const [ocupado, setOcupado] = useState(false)
  const [ultima, setUltima] = useState<string | null>(leerUltima)
  const [conectado, setConectado] = useState(() => tokenVigente() !== null)
  // Si Drive devuelve un fichero danado, sincronizar falla siempre y no hay forma
  // de salir. Se recuerda para ofrecer la unica salida: borrar esa copia.
  const [remotoDanado, setRemotoDanado] = useState(false)

  // `EstadoLocal` y no `DatosBackup`: aqui todas las listas existen siempre,
  // mientras que en un backup pueden faltar si es de una version antigua.
  const datos: EstadoLocal = {
    registros,
    visitas,
    pacientes,
    borrados,
    ajustes: ajustesCompartidos,
    marcas,
  }

  /**
   * Sincroniza. Se declara como funcion normal y no con `useCallback` a
   * proposito: `datos` se reconstruye en cada render, y envolverlo solo
   * obligaria a recrear la funcion igual. Ademas asi el boton nunca llama a una
   * version cerrada sobre datos viejos.
   */
  async function sincronizarAhora() {
    setOcupado(true)
    try {
      const { token } = await pedirToken()
      const { resumen, paquete } = await sincronizar(datos, token)

      // Los resultados se aplican a los contextos despues del ciclo completo y
      // no durante, para que un fallo a mitad no deje la pantalla con datos que
      // en Drive no estan. El paquete ya viene fusionado, que es justo lo que hay
      // que dejar en la pantalla.
      //
      // Van en orden y no en paralelo: las tres comparten el store de borrados y
      // encadenarlas garantiza que la ultima ve la union completa. La espera
      // importa; sin `await` el aviso contaria una promesa, que siempre es
      // "cierta", y diria que entraban datos que no han entrado.
      const marcasBorrado = paquete.borrados ?? []
      await fusionarRegistros(paquete.registros, marcasBorrado)
      await fusionarVisitas(paquete.visitas ?? [], marcasBorrado)
      await fusionarPacientes(paquete.pacientes, marcasBorrado)
      if (paquete.ajustes) aplicarAjustesRemotos(paquete.ajustes, paquete.marcas ?? {})

      aviso(resumirCambios(resumen))
      setRemotoDanado(false)

      const ahora = new Date().toISOString()
      setUltima(ahora)
      setConectado(true)
      try {
        localStorage.setItem(CLAVE_ULTIMA, ahora)
      } catch {
        // Solo es informativo: si no se guarda, la fecha no se muestra.
      }
    } catch (e) {
      // El mensaje ya viene escrito para que la persona lo entienda. Un
      // "Error desconocido" aqui no aportaria nada.
      if (e instanceof RemotoDanado) setRemotoDanado(true)
      aviso(e instanceof Error ? e.message : 'No se ha podido sincronizar', 'error')
      setConectado(tokenVigente() !== null)
    } finally {
      setOcupado(false)
    }
  }

  if (!driveConfigurado()) {
    return (
      <div className="tarjeta space-y-2 p-3">
        <p className="text-sm font-medium text-texto">Sincronizacion con Drive</p>
        <p className="text-xs text-texto-suave">
          Este despliegue no tiene la sincronizacion configurada: necesita una clave de cliente de
          OAuth de Google en <code className="rounded bg-superficie px-1">VITE_GOOGLE_CLIENT_ID</code>.
          Los datos se siguen guardando en este dispositivo y se puede descargar un backup desde la
          seccion de Datos.
        </p>
      </div>
    )
  }

  return (
    <div className="tarjeta space-y-2.5 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-texto">Sincronizacion con Drive</p>
        <p className="shrink-0 text-xs text-texto-suave">
          {conectado ? 'Conectado' : 'Sin conectar'}
        </p>
      </div>

      <Boton
        ancho
        onClick={() => void sincronizarAhora()}
        disabled={ocupado}
        icono={<IconoActualizar width={18} height={18} />}
      >
        {ocupado ? 'Sincronizando...' : 'Sincronizar ahora'}
      </Boton>

      {ultima && (
        <p className="text-center text-xs text-texto-suave">
          Ultima sincronizacion: {fechaCorta(claveDia(new Date(ultima)))} a las{' '}
          {hora12(claveHora(new Date(ultima)))}
        </p>
      )}

      <p className="text-xs text-texto-suave">
        Los datos van a una carpeta oculta de Drive que solo ve esta aplicacion y que no se puede
        compartir con nadie. Al sincronizar se fusiona lo de los dos dispositivos y no se borra
        nada.
      </p>

      {/* Google no concede tokens de larga duracion sin un servidor, asi que hay
          que autorizar otra vez cada hora. Decirlo aqui evita que parezca un
          fallo de la app. */}
      <p className="text-xs text-texto-suave">
        No es automatico: Google solo permite autorizar con un toque y el permiso caduca cada hora.
        Pulsa el boton despues de anadir datos desde el otro dispositivo.
      </p>

      {conectado && (
        <Boton
          ancho
          variante="secundario"
          onClick={() => {
            desconectar()
            setConectado(false)
            aviso('Cuenta de Google desconectada')
          }}
          icono={<IconoCerrar width={18} height={18} />}
        >
          Desconectar
        </Boton>
      )}

      {/* Solo aparece cuando Drive ha devuelto un fichero que no se puede usar.
          Borrar la copia es la unica salida, y no se ofrece antes de tiempo
          porque es la accion que descarta datos remotos sin avisar. */}
      {remotoDanado && (
        <div className="space-y-1.5 rounded-lg border border-peligro/40 bg-peligro/10 p-2.5">
          <p className="text-xs text-texto">
            La copia de Drive no se puede leer. Tus datos de este dispositivo siguen intactos y no
            se ha subido nada.
          </p>
          <Boton
            ancho
            variante="secundario"
            onClick={async () => {
              setOcupado(true)
              try {
                const { token } = await pedirToken()
                await olvidarRemoto(token)
                setRemotoDanado(false)
                aviso('Copia de Drive borrada. Ya puedes sincronizar otra vez')
              } catch (e) {
                aviso(e instanceof Error ? e.message : 'No se ha podido borrar', 'error')
              } finally {
                setOcupado(false)
              }
            }}
            icono={<IconoCerrar width={18} height={18} />}
          >
            Olvidar copia de Drive
          </Boton>
        </div>
      )}

      {/* La carpeta oculta la borra Google al desinstalar la aplicacion, asi que
          tener una copia en la mano no es un extra: es la unica red de
          seguridad si alguien reinstala el movil. */}
      <Boton
        ancho
        variante="secundario"
        onClick={() => {
          exportarBackup(datos)
          aviso('Copia descargada')
        }}
        icono={<IconoDescargar width={18} height={18} />}
      >
        Descargar copia de seguridad
      </Boton>

      <p className="text-xs text-texto-suave">
        Si desinstalas la aplicacion, Google puede borrar la carpeta de Drive. Descarga una copia de
        vez en cuando y guardala en un sitio seguro.
      </p>
    </div>
  )
}
