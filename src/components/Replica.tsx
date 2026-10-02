/**
 * El boton de sincronizar y lo que se ve de el.
 *
 * Se ofrece siempre el boton manual aunque la copia sea automatica, y por un motivo
 * concreto: es la unica forma de que alguien sepa si lo que ve esta guardado. Si
 * solo sube solo, un fallo de red se manifesta como datos que en otro sitio no
 * aparecen, y no hay nada que pulsar. Con el boton, la pregunta tiene respuesta.
 *
 * No se ensena nada si no hay base configurada. Es preferible a mostrar un boton
 * que nunca hace nada.
 */

import { fechaCorta, hora12, claveDia, claveHora } from '../lib/fechas'
import { useReplica } from '../context/ContextoReplica'
import { Boton } from './UI'
import { IconoActualizar } from './Iconos'

/** "hoy, a las 10:24" / "ayer, a las 22:03" / "3 oct, a las 08:00". */
function cuando(iso: string): string {
  const f = new Date(iso)
  if (Number.isNaN(f.getTime())) return 'sin fecha'
  const dia = claveDia(f)
  const hoy = claveDia(new Date())
  const ayer = claveDia(new Date(Date.now() - 86_400_000))
  const fecha =
    dia === hoy ? 'hoy' : dia === ayer ? 'ayer' : fechaCorta(dia)
  return `${fecha}, a las ${hora12(claveHora(f))}`
}

export function PanelReplica() {
  const { disponible, estado, ultima, error, aviso, ahora } = useReplica()

  if (!disponible) return null

  const pulsar = () => {
    void ahora()
  }

  return (
    <div className="tarjeta space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-texto">Copia en la nube</p>
          <p className="text-xs text-texto-suave">
            {estado === 'sincronizando'
              ? 'Sincronizando...'
              : ultima
                ? `Ultima vez: ${cuando(ultima)}`
                : 'Todavia no se ha sincronizado'}
          </p>
        </div>
        <Boton
          variante="secundario"
          onClick={pulsar}
          disabled={estado === 'sincronizando'}
          icono={<IconoActualizar width={18} height={18} />}
        >
          {estado === 'sincronizando' ? 'Sincronizando' : 'Sincronizar ahora'}
        </Boton>
      </div>

      {/* El error se ensena en pantalla y no solo en la consola. Un fallo de red
          silencioso es indistinguible de "no ha pasado nada", y quien use esto para
          llevar un control clinico necesita poder distinguirlo. */}
      {error && (
        <p className="rounded-lg bg-aviso-suave px-3 py-2 text-xs text-aviso">
          No se ha podido sincronizar: {error}. Tus datos siguen aqui y en cuanto
          vuelva la conexion se volveran a subir solos.
        </p>
      )}

      {/* El aviso normal, que no es un error: lo que entro, lo que salio, o la ficha
          que se ha creado. */}
      {!error && aviso && estado !== 'sincronizando' && (
        <p className="text-xs text-texto-suave">{aviso}</p>
      )}

      <p className="text-xs text-texto-suave">
        Se sube solo cada vez que anades o cambias algo, y tambien al abrir la app. Si dos
        dispositivos cambian lo mismo, se queda el cambio mas reciente y el otro se
        conserva en el telefono hasta que suba.
      </p>
    </div>
  )
}
