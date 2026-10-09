/**
 * Graficas de tendencias.
 *
 * Tres graficas cubren las preguntas que se hace el cuidador:
 *  1. ¿Como evoluciona la presion? (sistolica y diastolica, con banda de rango)
 *  2. ¿Como van el oxigeno y el pulso? (ejes independientes)
 *  3. ¿Cuanto se ha drenado por la sonda cada dia? (barras, con linea del minimo)
 *
 * Cuando el periodo es "Dia" se muestran las mediciones individuales de ese dia
 * en lugar del promedio diario: a escala de un dia interesan las tomas
 * sueltas, no la media.
 */

import { useMemo, useState } from 'react'
import { useRegistros } from '../context/ContextoRegistros'
import { useSondas } from '../context/ContextoSondas'
import { useAjustes } from '../context/ContextoAjustes'
import { seriePorPeriodo, serieSondaPorPeriodo } from '../lib/resumen'
import { claveDia, fechaCorta, hora12 } from '../lib/fechas'
import { COLORES_SERIE } from '../lib/rangos'
import type {
  Periodo,
  PresionHabitual,
  PuntoSerie,
  Registro,
  Sonda,
  Umbrales,
} from '../lib/tipos'
import { GraficaBarras, GraficaLinea, Leyenda } from '../components/Graficas'
import { Segmentado, Tarjeta, Vacio } from '../components/UI'
import { IconoGrafica } from '../components/Iconos'
import { useHoy } from '../hooks/useHoy'

const PERIODOS: { valor: Periodo; etiqueta: string }[] = [
  { valor: 'dia', etiqueta: 'Dia' },
  { valor: 'semana', etiqueta: '7 dias' },
  { valor: 'mes', etiqueta: '30 dias' },
]

export function PaginaGraficas() {
  const { registros } = useRegistros()
  const { sondas } = useSondas()
  const { ajustes, paciente, presionHabitual } = useAjustes()
  const [periodo, setPeriodo] = useState<Periodo>('semana')
  const hoy = useHoy()
  const [fin, setFin] = useState(() => claveDia(new Date()))

  // Un paciente sin sonda no tiene vaciados que graficar: se oculta la grafica
  // de barras y la del dia, pero se siguen leyendo los datos por si vuelve a
  // activarse.
  const sondaActiva = paciente?.sonda ?? true

  // Para "Dia" se usan las mediciones individuales; para el resto, promedios.
  const registrosDelDia = useMemo(
    () => registros.filter((r) => r.fecha === fin).sort((a, b) => a.hora.localeCompare(b.hora)),
    [registros, fin],
  )

  const sondasDelDia = useMemo(
    () => sondas.filter((s) => s.fecha === fin).sort((a, b) => a.hora.localeCompare(b.hora)),
    [sondas, fin],
  )

  const serie = useMemo(
    () => (periodo === 'dia' ? null : seriePorPeriodo(registros, fin, periodo)),
    [registros, fin, periodo],
  )

  const serieSonda = useMemo(
    () => (periodo === 'dia' ? null : serieSondaPorPeriodo(sondas, fin, periodo)),
    [sondas, fin, periodo],
  )

  const moverDia = (delta: number) => {
    const d = new Date(fin)
    d.setDate(d.getDate() + delta)
    const siguiente = claveDia(d)
    setFin(siguiente)
  }

  if (!registros.length) {
    return (
      <Vacio
        icono={<IconoGrafica width={36} height={36} />}
        titulo="Sin datos para graficar"
        descripcion="Registra algunas mediciones y las tendencias apareceran aqui."
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* Selector de periodo */}
      <Tarjeta className="space-y-3">
        <Segmentado
          valor={periodo}
          opciones={PERIODOS}
          onChange={(p) => setPeriodo(p)}
          className="w-full"
        />

        {periodo === 'dia' ? (
          <div className="flex items-center justify-between">
            <BotonDesplazamiento onClick={() => moverDia(-1)} etiqueta="Dia anterior">
              &larr;
            </BotonDesplazamiento>
            <span className="text-sm font-medium text-texto">{fechaCorta(fin)}</span>
            <BotonDesplazamiento onClick={() => moverDia(1)} etiqueta="Dia siguiente" disabled={fin >= hoy}>
              &rarr;
            </BotonDesplazamiento>
          </div>
        ) : (
          <p className="text-center text-xs text-texto-suave">
            Hasta el {fechaCorta(fin)} · toca la grafica para ver cada punto
          </p>
        )}
      </Tarjeta>

      {periodo === 'dia' ? (
        <GraficasDelDia registros={registrosDelDia} sondas={sondasDelDia} />
      ) : (
        <div className="space-y-4">
          <GraficaPresion serie={serie!} umbral={ajustes.umbral} periodo={periodo} habitual={presionHabitual} />
          <GraficaO2Pulso serie={serie!} umbral={ajustes.umbral} />
          {sondaActiva && <GraficaSonda serie={serieSonda!} umbral={ajustes.umbral} />}
        </div>
      )}
    </div>
  )
}

function BotonDesplazamiento({
  onClick,
  etiqueta,
  disabled,
  children,
}: {
  onClick: () => void
  etiqueta: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={etiqueta}
      className="grid size-11 place-items-center rounded-xl border border-borde text-texto-suave disabled:opacity-40"
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Graficas por periodo
// ---------------------------------------------------------------------------

function GraficaPresion({
  serie,
  umbral,
  periodo,
  habitual,
}: {
  serie: PuntoSerie[]
  umbral: Umbrales
  periodo: Periodo
  habitual: PresionHabitual
}) {
  return (
    <Tarjeta className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-texto">Presion arterial</h2>
        <p className="text-xs text-texto-suave">
          {periodo === 'semana' ? 'Promedio diario' : 'Promedio diario'} · mmHg
        </p>
      </div>
      <GraficaLinea
        series={[
          {
            clave: 'sis',
            etiqueta: 'Sistolica',
            color: COLORES_SERIE.sis,
            valores: serie.map((p) => p.presionSis),
          },
          {
            clave: 'dia',
            etiqueta: 'Diastolica',
            color: COLORES_SERIE.dia,
            valores: serie.map((p) => p.presionDia),
          },
        ]}
        etiquetas={serie.map((p) => p.etiqueta)}
        referencias={[
          { valor: habitual.sis, etiqueta: `habitual ${habitual.sis}` },
          { valor: umbral.presionSisMin, etiqueta: `min ${umbral.presionSisMin}` },
          { valor: umbral.presionSisMax, etiqueta: `max ${umbral.presionSisMax}` },
        ]}
        alto={230}
        vacio="Sin mediciones en este periodo"
      />
      <Leyenda
        items={[
          { etiqueta: 'Sistolica', color: COLORES_SERIE.sis },
          { etiqueta: 'Diastolica', color: COLORES_SERIE.dia },
        ]}
      />
    </Tarjeta>
  )
}

function GraficaO2Pulso({
  serie,
  umbral,
}: {
  serie: PuntoSerie[]
  umbral: Umbrales
}) {
  return (
    <Tarjeta className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-texto">Oxigeno y pulso</h2>
        <p className="text-xs text-texto-suave">
          O2 en % (izquierda) · pulso en lpm (derecha)
        </p>
      </div>
      <GraficaLinea
        series={[
          {
            clave: 'o2',
            etiqueta: 'O2 medio',
            color: COLORES_SERIE.o2,
            valores: serie.map((p) => p.promedioO2),
            banda: {
              min: serie.map((p) => p.minO2),
              max: serie.map((p) => p.maxO2),
            },
            formato: (v) => `${Math.round(v)}%`,
          },
          {
            clave: 'bpm',
            etiqueta: 'Pulso medio',
            color: COLORES_SERIE.bpm,
            valores: serie.map((p) => p.promedioBPM),
            eje: 'derecho',
            formato: (v) => `${Math.round(v)} lpm`,
          },
        ]}
        etiquetas={serie.map((p) => p.etiqueta)}
        // El umbral de O2 se marca sobre el eje izquierdo; el del pulso, sobre
        // el derecho, para que las dos referencias caigan en su escala real.
        referencias={[
          { valor: umbral.o2Min, etiqueta: `O2 min ${umbral.o2Min}%` },
          { valor: umbral.bpmMax, etiqueta: `pulso max ${umbral.bpmMax}`, eje: 'derecho' },
        ]}
        alto={230}
        vacio="Sin mediciones en este periodo"
      />
      <Leyenda
        items={[
          { etiqueta: 'O2 (banda: min-max del dia)', color: COLORES_SERIE.o2 },
          { etiqueta: 'Pulso', color: COLORES_SERIE.bpm },
        ]}
      />
    </Tarjeta>
  )
}

function GraficaSonda({
  serie,
  umbral,
}: {
  serie: { clave: string; etiqueta: string; totalVolumen: number; vaciados: number }[]
  umbral: Umbrales
}) {
  return (
    <Tarjeta className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-texto">Sonda por dia</h2>
        <p className="text-xs text-texto-suave">
          Total drenado · objetivo {umbral.sondaMin}-{umbral.sondaMax} ml
        </p>
      </div>
      <GraficaBarras
        barras={serie.map((p) => ({
          clave: p.clave,
          etiqueta: p.etiqueta,
          valor: p.totalVolumen,
        }))}
        objetivo={umbral.sondaMin}
        etiquetaObjetivo={`min ${umbral.sondaMin} ml`}
        formatoValor={(v) => `${Math.round(v)} ml`}
        alto={210}
        vacio="Sin vaciados en este periodo"
      />
      <p className="text-xs text-texto-suave">
        Las barras en ambar indican dias por debajo del minimo diario.
      </p>
    </Tarjeta>
  )
}

// ---------------------------------------------------------------------------
// Graficas de un solo dia
// ---------------------------------------------------------------------------

/** En vista de un dia se grafican las tomas individuales, no los promedios. */
function GraficasDelDia({
  registros,
  sondas,
}: {
  registros: Registro[]
  sondas: Sonda[]
}) {
  const { ajustes, paciente } = useAjustes()
  const sondaActiva = paciente?.sonda ?? true

  if (!registros.length) {
    return (
      <Tarjeta>
        <Vacio titulo="Sin mediciones ese dia" descripcion="Elige otra fecha en Inicio o registra una nueva." />
      </Tarjeta>
    )
  }

  // Las etiquetas del eje van en 12 horas como el resto de la app. "8:05 AM" es
  // mas ancho que "08:05": el hueco horizontal del eje es el que decide cuantas
  // se dibujan, asi que se deja que el componente las reparta.
  const etiquetas = registros.map((r) => hora12(r.hora))

  return (
    <div className="space-y-4">
      <Tarjeta className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-texto">Presion por toma</h2>
          <p className="text-xs text-texto-suave">mmHg</p>
        </div>
        <GraficaLinea
          series={[
            {
              clave: 'sis',
              etiqueta: 'Sistolica',
              color: COLORES_SERIE.sis,
              valores: registros.map((r) => r.presionSis),
            },
            {
              clave: 'dia',
              etiqueta: 'Diastolica',
              color: COLORES_SERIE.dia,
              valores: registros.map((r) => r.presionDia),
            },
          ]}
          etiquetas={etiquetas}
          alto={210}
        />
        <Leyenda
          items={[
            { etiqueta: 'Sistolica', color: COLORES_SERIE.sis },
            { etiqueta: 'Diastolica', color: COLORES_SERIE.dia },
          ]}
        />
      </Tarjeta>

      <Tarjeta className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-texto">Oxigeno y pulso</h2>
          <p className="text-xs text-texto-suave">O2 en % · pulso en lpm</p>
        </div>
        <GraficaLinea
          series={[
            {
              clave: 'o2',
              etiqueta: 'O2',
              color: COLORES_SERIE.o2,
              valores: registros.map((r) => r.o2),
              formato: (v) => `${Math.round(v)}%`,
            },
            {
              clave: 'bpm',
              etiqueta: 'Pulso',
              color: COLORES_SERIE.bpm,
              valores: registros.map((r) => r.bpm),
              eje: 'derecho',
              formato: (v) => `${Math.round(v)} lpm`,
            },
          ]}
          etiquetas={etiquetas}
          referencias={[
            { valor: ajustes.umbral.o2Min, etiqueta: `O2 min ${ajustes.umbral.o2Min}%` },
          ]}
          alto={210}
        />
        <Leyenda
          items={[
            { etiqueta: 'O2', color: COLORES_SERIE.o2 },
            { etiqueta: 'Pulso', color: COLORES_SERIE.bpm },
          ]}
        />
      </Tarjeta>

      {sondaActiva && (
        <Tarjeta className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-texto">Sonda del dia</h2>
            <p className="text-xs text-texto-suave">
              Total drenado: {sondas.reduce((a, s) => a + s.volumen, 0)} ml ·{' '}
              {sondas.length} {sondas.length === 1 ? 'vaciado' : 'vaciados'}
            </p>
          </div>
          {sondas.length === 0 ? (
            <p className="py-4 text-center text-sm text-texto-suave">
              Sin vaciados registrados este dia
            </p>
          ) : (
            <GraficaBarras
              barras={sondas.map((s) => ({
                clave: s.id,
                etiqueta: hora12(s.hora),
                valor: s.volumen,
              }))}
              formatoValor={(v) => `${Math.round(v)} ml`}
              alto={190}
              vacio="Sin vaciados registrados este dia"
            />
          )}
        </Tarjeta>
      )}
    </div>
  )
}