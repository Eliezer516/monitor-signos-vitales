/**
 * Dashboard: la pantalla que se abre al entrar.
 *
 * Prioridad de lectura, de arriba abajo:
 *  1. Alertas que requieren atencion (si hay).
 *  2. Totales del dia (orina acumulada y promedios).
 *  3. Movimientos de las ultimas 24 horas.
 *
 * El registro va en un boton flotante en la esquina inferior derecha: es la
 * accion mas frecuente y asi no empuja hacia abajo el contenido que se lee de
 * un vistazo.
 */

import { useMemo, useState } from 'react'
import { useRegistros } from '../context/ContextoRegistros'
import { useAjustes } from '../context/ContextoAjustes'
import { alertasDelDia, resumenDia, nivelDia } from '../lib/resumen'
import { aDate, etiquetaRelativa, fechaCorta, haceCuanto, hora12 } from '../lib/fechas'
import { evaluarBpm, evaluarDia, evaluarO2, evaluarSis } from '../lib/rangos'
import type { Nivel } from '../lib/tipos'
import { ListaMediciones, PanelAlertas, TarjetaMetrica, n } from '../components/Resumen'
import { BotonFlotante, Insignia, Tarjeta, cx } from '../components/UI'
import { IconoGota, IconoOximetro, IconoPulso, IconoCorazon, IconoMas } from '../components/Iconos'
import { Calendario } from '../components/Calendario'
import { FormularioRapido } from '../components/FormularioRapido'
import { useHoy } from '../hooks/useHoy'
import { useAhora } from '../hooks/useAhora'

export function PaginaInicio({ onIrRegistrar }: { onIrRegistrar: () => void }) {
  const { registros, eliminar, cargando } = useRegistros()
  const { ajustes, paciente, presionHabitual } = useAjustes()
  const hoy = useHoy()
  const ahora = useAhora()

  const [diaSeleccionado, setDiaSeleccionado] = useState<string>(hoy)

  const resumen = useMemo(
    () => resumenDia(registros, diaSeleccionado),
    [registros, diaSeleccionado],
  )
  const esHoy = diaSeleccionado === hoy
const nivel = nivelDia(resumen, ajustes.umbral, !esHoy, presionHabitual)
  const alertas = useMemo(
    () => alertasDelDia(registros, diaSeleccionado, ajustes.umbral, !esHoy, presionHabitual),
    [registros, diaSeleccionado, ajustes.umbral, esHoy, presionHabitual],
  )

const ultimas24 = useMemo(() => {
    // `useAhora` mantiene la ventana deslizante al dia sin consultar la hora del
    // sistema durante el render.
    const limite = ahora - 24 * 3_600_000
    return registros
      .filter((r) => {
        const t = aDate(r.fecha, r.hora).getTime()
        return t >= limite && t <= ahora
      })
      .sort((x, y) =>
        x.fecha === y.fecha ? y.hora.localeCompare(x.hora) : y.fecha.localeCompare(x.fecha),
      )
  }, [registros, ahora])

  const ultimaMedicion = ultimas24[0]

  if (cargando) return <Cargando />

return (
    // El `pb` de abajo es para que la ultima tarjeta se pueda dejar por debajo
    // del boton flotante al hacer scroll; el boton es fijo y no arrastra.
    <div className="space-y-4 pb-10 lg:pb-16">
      {/* Alertas del dia seleccionado */}
      {alertas.length > 0 && (
        <section aria-label="Alertas">
          <PanelAlertas alertas={alertas} />
        </section>
      )}

      {/* Selector de dia + resumen */}
      <Tarjeta className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-texto">
              {etiquetaRelativa(diaSeleccionado, hoy)}
            </h2>
            <p className="text-xs text-texto-suave">
              {resumen.registros.length}{' '}
              {resumen.registros.length === 1 ? 'medicion' : 'mediciones'}
              {ultimaMedicion && esHoy && ` · ultima ${haceCuanto(ultimaMedicion.fecha, ultimaMedicion.hora)}`}
            </p>
          </div>
          {paciente?.nombre && (
            <Insignia className="max-w-[9rem] truncate">{paciente.nombre}</Insignia>
          )}
        </div>

        <Calendario
          valor={diaSeleccionado}
          onChange={setDiaSeleccionado}
          diasConDatos={new Set(registros.map((r) => r.fecha))}
        />

        {/* Metricas del dia. La orina va primera: es el dato que mas se mira. */}
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <TarjetaMetrica
            principal
            etiqueta="Orina total"
            valor={String(resumen.totalOrina)}
            unidad="ml"
            icono={<IconoGota width={16} height={16} />}
            // El volumen bajo solo es preocupaante cuando el dia ya ha
            // terminado; a media manana es normal no haber orinado aun.
            nivel={resumen.totalOrina > ajustes.umbral.orinaMax ? 'aviso' : 'ok'}
            detalle={`Objetivo ${ajustes.umbral.orinaMin}-${ajustes.umbral.orinaMax} ml`}
          />
          <TarjetaMetrica
            etiqueta="Presion media"
            valor={
              resumen.promedioPresionSis === null
                ? '-'
                : `${n(resumen.promedioPresionSis)}/${n(resumen.promedioPresionDia)}`
            }
            unidad="mmHg"
            icono={<IconoPulso width={16} height={16} />}
            nivel={peor(
evaluarSis(resumen.promedioPresionSis, ajustes.umbral, presionHabitual),
              evaluarDia(resumen.promedioPresionDia, ajustes.umbral, presionHabitual),
            )}
          />
          <TarjetaMetrica
            etiqueta="Oxigeno min"
            valor={n(resumen.minO2)}
            unidad="%"
            icono={<IconoOximetro width={16} height={16} />}
            nivel={evaluarO2(resumen.minO2, ajustes.umbral)}
            detalle={resumen.maxO2 !== null && resumen.minO2 !== resumen.maxO2 ? `max ${resumen.maxO2}%` : undefined}
          />
          <TarjetaMetrica
            etiqueta="Pulso medio"
            valor={n(resumen.promedioBPM)}
            unidad="lpm"
            icono={<IconoCorazon width={16} height={16} />}
            nivel={evaluarBpm(resumen.promedioBPM, ajustes.umbral)}
          />
        </div>

        {/* Franja de estado: una lectura rapida del dia completo. */}
        <EstadoDelDia nivel={nivel} />
      </Tarjeta>

      {/* Mini formulario: permite registrar sin salir de Inicio */}
      <FormularioRapido />

      {/* Ultimas 24 horas */}
      <Tarjeta className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-texto">Ultimas 24 horas</h2>
          {ultimas24.length > 0 && (
            <span className="text-xs text-texto-suave">{ultimas24.length} mediciones</span>
          )}
        </div>
<ListaMediciones
          registros={ultimas24}
          umbral={ajustes.umbral}
          habitual={presionHabitual}
          compacta
onEliminar={(r) => {
            if (
              confirm(
                `Eliminar la medicion de las ${hora12(r.hora)} del ${fechaCorta(r.fecha)}?`,
              )
            ) {
              eliminar(r.id)
            }
          }}
        />
      </Tarjeta>

      {/* Registro en una sola pantalla: alinee con el borde inferior para que el
          boton siga siendo alcanzable con el pulgar y no tape la barra inferior. */}
      <BotonFlotante
        onClick={onIrRegistrar}
        icono={<IconoMas width={24} height={24} />}
        title="Registrar medicion ahora"
      >
        Registrar
      </BotonFlotante>
    </div>
  )
}

/** Nivel combinado: el peor de los dos valores (p. ej. sistolica/diastolica). */
const peor = (a: Nivel, b: Nivel): Nivel =>
  a === 'alerta' || b === 'alerta' ? 'alerta' : a === 'aviso' || b === 'aviso' ? 'aviso' : 'ok'

/** Franja con el veredicto global del dia. */
function EstadoDelDia({ nivel }: { nivel: 'ok' | 'aviso' | 'alerta' }) {
  const texto = {
    ok: { titulo: 'Dia estable', desc: 'Todos los valores dentro de rango' },
    aviso: { titulo: 'Revisar', desc: 'Hay valores fuera del rango normal' },
    alerta: { titulo: 'Atencion', desc: 'Valores fuera de rango: consultar al medico' },
  }[nivel]

  const color = { ok: 'bg-ok', aviso: 'bg-aviso', alerta: 'bg-alerta' }[nivel]

  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-superficie-2 px-3.5 py-3">
      <span className={cx('size-2.5 shrink-0 rounded-full', color)} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-texto">{texto.titulo}</p>
        <p className="truncate text-xs text-texto-suave">{texto.desc}</p>
      </div>
    </div>
  )
}

function Cargando() {
  return (
    <div className="space-y-4">
      <div className="h-16 animate-pulse rounded-2xl bg-superficie-3" />
      <div className="h-64 animate-pulse rounded-2xl bg-superficie-3" />
      <div className="h-40 animate-pulse rounded-2xl bg-superficie-3" />
    </div>
  )
}