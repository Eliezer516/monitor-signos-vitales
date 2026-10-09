/**
 * Registro de vaciados de la sonda.
 *
 * La sonda se vacia cuando toca, no cuando se mide la tension, asi que tiene su
 * propio formulario y su propio historial en vez de ser un campo del registro de
 * signos vitales. Se anota el volumen que habia en la bolsa; sumando los vaciados
 * del dia sale el total drenado, que es el dato que le interesa al medico.
 *
 * El boton se pliega como el registro rapido: la accion es puntual y no debe
 * empujar hacia abajo el resumen del dia, que es lo que se lee de un vistazo.
 */

import { useMemo, useState } from 'react'
import { useSondas, valoresSondaIniciales } from '../context/ContextoSondas'
import { useAjustes } from '../context/ContextoAjustes'
import { useAvisos } from './Avisos'
import { fechaCorta, hora12 } from '../lib/fechas'
import type { Sonda } from '../lib/tipos'
import { AreaTexto, Boton, Campo, CampoNumero, Entrada, Insignia, Tarjeta, Vacio } from './UI'
import { IconoBorrar, IconoCheck, IconoGota } from './Iconos'
import { useHoy } from '../hooks/useHoy'

export function FormularioSonda() {
  const { sondas, agregar, eliminar } = useSondas()
  const { ajustes } = useAjustes()
  const { aviso } = useAvisos()
  const hoy = useHoy()

  const [abierto, setAbierto] = useState(false)
  const inicial = valoresSondaIniciales()
  const [fecha, setFecha] = useState(inicial.fecha)
  const [hora, setHora] = useState(inicial.hora)
  const [volumen, setVolumen] = useState('')
  const [notas, setNotas] = useState('')

  const limites = ajustes.limites
  const vol = volumen === '' ? null : Number(volumen)
  const errorVolumen =
    vol === null
      ? undefined
      : Number.isNaN(vol)
        ? 'Numero no valido'
        : vol < limites.sondaMin || vol > limites.sondaMax
          ? `Debe estar entre ${limites.sondaMin} y ${limites.sondaMax} ml`
          : undefined

  const listo = fecha !== '' && hora !== '' && vol !== null && !Number.isNaN(vol) && !errorVolumen

  const guardar = () => {
    if (!listo || vol === null) {
      aviso('Completa el volumen del vaciado', 'error')
      return
    }
    agregar({ fecha, hora, volumen: Math.round(vol), notas: notas.trim() })
    aviso('Vaciado registrado')
    const ahora = valoresSondaIniciales()
    setFecha(ahora.fecha)
    setHora(ahora.hora)
    setVolumen('')
    setNotas('')
  }

  // Los ultimos vaciados, sin filtrar por dia: es el contexto inmediato de quien
  // acaba de vaciar la bolsa y quiere ver cuanto llevaba.
  const recientes = useMemo(() => sondas.slice(0, 5), [sondas])

  const totalHoy = useMemo(
    () => sondas.filter((s) => s.fecha === hoy).reduce((a, s) => a + s.volumen, 0),
    [sondas, hoy],
  )

  const borrar = (s: Sonda) => {
    if (confirm(`Eliminar el vaciado de las ${hora12(s.hora)} del ${fechaCorta(s.fecha)}?`)) {
      eliminar(s.id)
    }
  }

  return (
    <Tarjeta className="space-y-3">
      <button
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-marca-suave text-marca">
            <IconoGota width={16} height={16} />
          </span>
          <span>
            <span className="block text-base font-semibold text-texto">Sonda</span>
            <span className="block text-xs text-texto-suave">
              {totalHoy > 0 ? `${totalHoy} ml hoy` : 'Sin vaciados hoy'}
            </span>
          </span>
        </span>
        <span className="text-sm font-medium text-marca">
          {abierto ? 'Ocultar' : 'Registrar vaciado'}
        </span>
      </button>

      {abierto && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Fecha">
              <Entrada
                type="date"
                value={fecha}
                max={hoy}
                onChange={(e) => setFecha(e.target.value)}
              />
            </Campo>
            <Campo etiqueta="Hora">
              <Entrada type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </Campo>
          </div>

          <Campo
            etiqueta="Volumen"
            requerido
            ayuda={`${limites.sondaMin}-${limites.sondaMax} ml`}
            error={errorVolumen}
          >
            <CampoNumero
              value={volumen}
              onChange={(e) => setVolumen(e.target.value)}
              placeholder="0"
              unidad="ml"
              min={limites.sondaMin}
              max={limites.sondaMax}
              step={10}
              aria-label="Volumen del vaciado en mililitros"
            />
          </Campo>

          <Campo etiqueta="Notas" ayuda="Opcional">
            <AreaTexto
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
              placeholder="Color, aspecto, si costaba vaciar..."
              aria-label="Notas del vaciado"
            />
          </Campo>

          <Boton ancho onClick={guardar} disabled={!listo} icono={<IconoCheck width={20} height={20} />}>
            Guardar vaciado
          </Boton>
        </div>
      )}

      {sondas.length === 0 ? (
        <Vacio
          titulo="Sin vaciados registrados"
          descripcion="Anota aqui cada vez que vacies la bolsa de la sonda."
        />
      ) : (
        <ul className="space-y-1.5">
          {recientes.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded-lg border border-borde bg-superficie-2 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm">
                  <span className="font-semibold tabular-nums text-texto">{s.volumen} ml</span>
                  <span className="text-xs text-texto-suave">
                    {fechaCorta(s.fecha)} · {hora12(s.hora)}
                  </span>
                </p>
                {s.notas && <p className="truncate text-xs text-texto-suave">{s.notas}</p>}
              </div>
              {s.ejemplo && <Insignia>Ejemplo</Insignia>}
              <button
                onClick={() => borrar(s)}
                aria-label={`Eliminar el vaciado de las ${hora12(s.hora)}`}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-texto-suave hover:bg-alerta-suave hover:text-alerta"
              >
                <IconoBorrar width={16} height={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  )
}
