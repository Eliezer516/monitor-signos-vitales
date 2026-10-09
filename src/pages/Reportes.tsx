/**
 * Reportes: diario, semanal y comparativa entre periodos.
 *
 * El reporte medico se genera como HTML con estilos de impresion y se abre en
 * una pestana nueva; desde ahi el navegador produce el PDF con "Guardar como
 * PDF". Da mejor resultado tipografico y con menos peso en la app que incrustar
 * un generador de PDF, y el cuidador ya sabe usar el menu de imprimir del
 * telefono.
 */

import { useMemo, useState } from 'react'
import { useRegistros } from '../context/ContextoRegistros'
import { useVisitas } from '../context/ContextoVisitas'
import { useSondas } from '../context/ContextoSondas'
import { useAjustes } from '../context/ContextoAjustes'
import { useAvisos } from '../components/Avisos'
import {
  alertasDelDia,
  compararPeriodos,
  extraerMedicamentos,
  rangoTotal,
  resumenDia,
  resumenSemana,
  resumenSondaDia,
} from '../lib/resumen'
import { claveDia, fechaCompleta, fechaCorta, hora12, inicioSemana, sumarDias } from '../lib/fechas'
import { compartirReporte, imprimirReporte, reporteHTML } from '../lib/exportar'
import { ETIQUETA_CORTA } from '../lib/visitas'
import type { Periodo, Registro, Umbrales, Visita } from '../lib/tipos'
import { ListaMediciones, PanelAlertas, ResumenDiaFila, n } from '../components/Resumen'
import { Boton, Segmentado, Tarjeta, Vacio, cx } from '../components/UI'
import {
  IconoAlerta,
  IconoCalendario,
  IconoFlechaDer,
  IconoFlechaIzq,
  IconoReporte,
  IconoWhatsapp,
} from '../components/Iconos'
import { Calendario } from '../components/Calendario'
import { useHoy } from '../hooks/useHoy'

type Vista = 'diario' | 'semanal' | 'comparativa'

const VISTAS: { valor: Vista; etiqueta: string }[] = [
  { valor: 'diario', etiqueta: 'Diario' },
  { valor: 'semanal', etiqueta: 'Semanal' },
  { valor: 'comparativa', etiqueta: 'Comparativa' },
]

export function PaginaReportes() {
  const { registros } = useRegistros()
  const { visitas } = useVisitas()
  const { sondas } = useSondas()
  const { ajustes, paciente, presionHabitual } = useAjustes()
  const { aviso } = useAvisos()

  const [vista, setVista] = useState<Vista>('diario')
  const [dia, setDia] = useState(() => claveDia(new Date()))
  const [periodo, setPeriodo] = useState<Periodo>('semana')
  const hoy = useHoy()

  const rango = useMemo(() => rangoTotal(registros), [registros])

  // Los hooks se ejecutan siempre, antes de cualquier retorno temprano: un
  // `return` condicional antes de un hook rompe el orden de llamadas.
  const { desde, hasta } = useMemo(() => {
    if (vista === 'diario') return { desde: dia, hasta: dia }
    if (vista === 'semanal') {
      const lunes = inicioSemana(dia)
      return { desde: lunes, hasta: sumarDias(lunes, 6) }
    }
    const largo = periodo === 'semana' ? 7 : 30
    return { desde: sumarDias(hoy, -(largo - 1)), hasta: hoy }
  }, [vista, dia, periodo, hoy])

const registrosPeriodo = useMemo(
    () => registros.filter((r) => r.fecha >= desde && r.fecha <= hasta),
    [registros, desde, hasta],
  )

  // Las visitas del mismo periodo se pasan al reporte: el medico necesita ver
  // tambien lo que se decidio en las consultas de esos dias. Igual con los
  // vaciados de la sonda, que van en una seccion propia del informe.
  const visitasPeriodo = useMemo(
    () => visitas.filter((v) => v.fecha >= desde && v.fecha <= hasta),
    [visitas, desde, hasta],
  )

  const sondasPeriodo = useMemo(
    () => sondas.filter((s) => s.fecha >= desde && s.fecha <= hasta),
    [sondas, desde, hasta],
  )

  // Sin sonda no se pinta su seccion en el informe generado: pasarla como
  // lista vacia diria "Total drenado: 0 ml", que es el dato que no procede.
  const sondaActiva = paciente?.sonda ?? true
  const sondasParaReporte = sondaActiva ? sondasPeriodo : undefined

// Se sale solo si no hay nada de nada: tener visitas pero no mediciones tambien
  // permite generar informe, y es el caso tipico cuando se ajusta el tratamiento.
  if (!registros.length && !visitas.length) {
    return (
      <Vacio
        icono={<IconoReporte width={36} height={36} />}
        titulo="Sin datos para el reporte"
        descripcion="Los reportes se generan automaticamente a partir de los registros y las visitas."
      />
    )
  }

const generarReporte = () => {
    // Un periodo puede tener visitas sin mediciones, y el informe sigue siendo
    // util: es justo el caso de un paciente al que le ajustan el tratamiento.
    if (!registrosPeriodo.length && !visitasPeriodo.length) {
      aviso('No hay datos en este periodo', 'error')
      return
    }
const html = reporteHTML(registrosPeriodo, {
      paciente: paciente ?? undefined,
      desde,
      hasta,
      umbral: ajustes.umbral,
      presionHabitual,
      visitas: visitasPeriodo,
      sondas: sondasParaReporte,
    })
    if (!imprimirReporte(html)) {
      aviso('El navegador bloqueo la ventana de impresion', 'error')
      return
    }
    aviso('Reporte generado. Elige "Guardar como PDF"')
  }

const compartir = async () => {
    if (!registrosPeriodo.length && !visitasPeriodo.length) {
      aviso('No hay datos en este periodo', 'error')
      return
    }
    const html = reporteHTML(registrosPeriodo, {
      paciente: paciente ?? undefined,
      desde,
      hasta,
      umbral: ajustes.umbral,
      presionHabitual,
      visitas: visitasPeriodo,
      sondas: sondasParaReporte,
    })
    const resultado = await compartirReporte(html, `reporte-${desde}-${hasta}`)
    if (resultado === 'no-soportado') {
      aviso('Este dispositivo no permite compartir. Usa el boton de PDF.', 'error')
    }
  }

  return (
    <div className="space-y-4">
      <Segmentado valor={vista} opciones={VISTAS} onChange={setVista} className="w-full" />

      <Tarjeta className="space-y-3">
        {vista === 'diario' && (
          <Calendario
            valor={dia}
            onChange={setDia}
            diasConDatos={new Set([
                ...registros.map((r) => r.fecha),
                // Los dias con visita se marcan tambien: si no, el calendario
                // pareceria un dia en blanco cuando lo que hay es una consulta.
                ...visitas.map((v) => v.fecha),
              ])}
          />
        )}

        {vista === 'semanal' && <NavegacionSemana dia={dia} onChange={setDia} />}

        {vista === 'comparativa' && (
          <Segmentado
            valor={periodo}
            opciones={[
              { valor: 'semana', etiqueta: 'Semana' },
              { valor: 'mes', etiqueta: 'Mes' },
            ]}
            onChange={(p) => setPeriodo(p as Periodo)}
            className="w-full"
          />
        )}

        <div className="flex items-center justify-between gap-2 text-xs text-texto-suave">
          <span>
            {fechaCorta(desde)} &ndash; {fechaCorta(hasta)}
          </span>
          <span>
            {registrosPeriodo.length}{' '}
            {registrosPeriodo.length === 1 ? 'medicion' : 'mediciones'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <Boton
            onClick={generarReporte}
            disabled={!registrosPeriodo.length}
            icono={<IconoReporte width={18} height={18} />}
          >
            Reporte PDF
          </Boton>
          <Boton
            variante="secundario"
            onClick={() => void compartir()}
            disabled={!registrosPeriodo.length}
            icono={<IconoWhatsapp width={18} height={18} />}
          >
            Compartir
          </Boton>
        </div>

        {rango && (
          <p className="text-center text-[0.7rem] text-texto-suave">
            Datos disponibles: {fechaCorta(rango.desde)} &ndash; {fechaCorta(rango.hasta)}
          </p>
        )}
      </Tarjeta>

      {vista === 'diario' && (
<ReporteDiario
          fecha={dia}
          registros={registrosPeriodo}
          visitas={visitasPeriodo}
          esHoy={dia === hoy}
          umbral={ajustes.umbral}
        />
      )}
      {vista === 'semanal' && (
        <ReporteSemanal dia={dia} umbral={ajustes.umbral} sondaActiva={sondaActiva} />
      )}
      {vista === 'comparativa' && <ReporteComparativo periodo={periodo} umbral={ajustes.umbral} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reporte diario
// ---------------------------------------------------------------------------

function ReporteDiario({
  fecha,
  registros,
  visitas,
  esHoy,
  umbral,
}: {
  fecha: string
  registros: Registro[]
  visitas: Visita[]
  esHoy: boolean
  umbral: Umbrales
}) {
  // La presion habitual se lee del contexto porque depende del paciente activo,
  // que no tiene sentido pasar como prop desde el padre.
  const { presionHabitual } = useAjustes()
  const resumen = useMemo(() => resumenDia(registros, fecha), [registros, fecha])
  const alertas = useMemo(
    () => alertasDelDia(registros, fecha, umbral, !esHoy, presionHabitual),
    [registros, fecha, umbral, esHoy, presionHabitual],
  )

  return (
    <div className="space-y-4">
      <Tarjeta className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-texto">{fechaCompleta(fecha)}</h2>
          <p className="text-xs text-texto-suave">
            {esHoy ? 'Dia en curso' : 'Dia completo'} · {resumen.registros.length} mediciones
          </p>
        </div>
        <ResumenDiaFila resumen={resumen} />
      </Tarjeta>

      {alertas.length > 0 && (
        <Tarjeta className="space-y-3">
          <h3 className="text-sm font-semibold text-texto">Alertas del dia</h3>
          <PanelAlertas alertas={alertas} />
        </Tarjeta>
      )}

{visitas.length > 0 && (
        <Tarjeta className="space-y-3">
          <h3 className="text-sm font-semibold text-texto">Visitas del dia</h3>
          <ul className="space-y-2">
            {visitas.map((v) => {
              const domicilio = v.tipo === 'domicilio'
              return (
                <li
                  key={v.id}
                  className="rounded-xl border border-borde bg-superficie-2 p-3"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium text-texto">{v.motivo}</span>
                    <span
                      className={cx(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        domicilio ? 'bg-aviso-suave text-aviso' : 'bg-marca-suave text-marca',
                      )}
                    >
                      {ETIQUETA_CORTA[v.tipo]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-texto-suave">
                    {hora12(v.hora) ? `A las ${hora12(v.hora)}` : 'Hora no consta'}
                    {v.profesional && ` · ${v.profesional}`}
                  </p>
                  {v.indicaciones && (
                    <p className="mt-2 whitespace-pre-line rounded-lg bg-ok-suave px-2.5 py-1.5 text-xs text-ok">
                      {v.indicaciones}
                    </p>
                  )}
                  {v.notas && (
                    <p className="mt-1.5 whitespace-pre-line text-xs text-texto-suave">{v.notas}</p>
                  )}
                </li>
              )
            })}
          </ul>
        </Tarjeta>
      )}

      <Tarjeta className="space-y-3">
        <h3 className="text-sm font-semibold text-texto">Detalle de mediciones</h3>
        <ListaMediciones registros={resumen.registros} umbral={umbral} habitual={presionHabitual} />
      </Tarjeta>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reporte semanal
// ---------------------------------------------------------------------------

function ReporteSemanal({
  dia,
  umbral,
  sondaActiva,
}: {
  dia: string
  umbral: Umbrales
  sondaActiva: boolean
}) {
  const { registros } = useRegistros()
  const { visitas } = useVisitas()
  const { sondas } = useSondas()
  const dias = useMemo(() => resumenSemana(registros, dia), [registros, dia])
  const diasConDatos = dias.filter((d) => d.registros.length > 0)

  const lunes = inicioSemana(dia)
  const visitasSemana = useMemo(
    () => visitas.filter((v) => v.fecha >= lunes && v.fecha <= sumarDias(lunes, 6)),
    [visitas, lunes],
  )

  const sondasSemana = useMemo(
    () => sondas.filter((s) => s.fecha >= lunes && s.fecha <= sumarDias(lunes, 6)),
    [sondas, lunes],
  )
  const totalSonda = sondasSemana.reduce((a, s) => a + s.volumen, 0)
  const diasConVaciados = new Set(sondasSemana.map((s) => s.fecha)).size
  const mediaDiaria = diasConVaciados ? Math.round(totalSonda / diasConVaciados) : 0
  const minO2 = diasConDatos.length ? Math.min(...diasConDatos.map((d) => d.minO2 ?? 100)) : null

  const meds = useMemo(
    () => extraerMedicamentos(diasConDatos.flatMap((d) => d.registros.map((r) => r.notas))),
    [diasConDatos],
  )

  return (
    <div className="space-y-4">
      <Tarjeta className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-texto">
            Semana del {fechaCorta(inicioSemana(dia))}
          </h2>
          <p className="text-xs text-texto-suave">
            {diasConDatos.length} dias con datos
          </p>
        </div>

<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {sondaActiva && <Metrica etiqueta="Sonda total" valor={String(totalSonda)} unidad="ml" />}
          <Metrica etiqueta="Dias con datos" valor={String(diasConDatos.length)} unidad="de 7" />
          {sondaActiva && (
            <Metrica etiqueta="Media diaria" valor={mediaDiaria ? String(mediaDiaria) : '-'} unidad="ml/dia" />
          )}
          <Metrica etiqueta="O2 mas bajo" valor={n(minO2)} unidad="%" />
        </div>
      </Tarjeta>

      <Tarjeta className="space-y-3">
        <h3 className="text-sm font-semibold text-texto">Resumen por dia</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-borde text-left text-xs text-texto-suave">
<th className="py-2 pr-2 font-medium">Dia</th>
                <th className="py-2 pr-2 font-medium">Tomas</th>
                {sondaActiva && <th className="py-2 pr-2 font-medium">Sonda</th>}
                <th className="py-2 pr-2 font-medium">Presion</th>
                <th className="py-2 pr-2 font-medium">O2</th>
                <th className="py-2 pr-2 font-medium">Pulso</th>
              </tr>
            </thead>
            <tbody>
              {dias.map((d) => (
                <tr
                  key={d.fecha}
                  className={cx(
                    'border-b border-borde/60 last:border-0',
                    d.registros.length === 0 && 'opacity-40',
                  )}
                >
                  <td className="py-2.5 pr-2 font-medium">{fechaCorta(d.fecha).slice(0, 6)}</td>
<td className="py-2.5 pr-2 tabular-nums">
                  {d.registros.length || '-'}
                </td>
                  {sondaActiva && (
                    <td className="py-2.5 pr-2 tabular-nums">
                      {(() => {
                        const t = resumenSondaDia(sondas, d.fecha).totalVolumen
                        return t > 0 ? `${t} ml` : '-'
                      })()}
                    </td>
                  )}
                  <td className="py-2.5 pr-2 tabular-nums">
                    {d.promedioPresionSis === null
                      ? '-'
                      : `${n(d.promedioPresionSis)}/${n(d.promedioPresionDia)}`}
                  </td>
                  <td
                    className={cx(
                      'py-2.5 pr-2 tabular-nums',
                      d.minO2 !== null && d.minO2 < umbral.o2Min && 'font-semibold text-alerta',
                    )}
                  >
                    {d.minO2 ?? '-'}
                  </td>
                  <td className="py-2.5 pr-2 tabular-nums">{n(d.promedioBPM)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>

{visitasSemana.length > 0 && (
        <Tarjeta className="space-y-3">
          <h3 className="text-sm font-semibold text-texto">Visitas de la semana</h3>
          <ul className="space-y-2">
            {visitasSemana.map((v) => (
              <li key={v.id} className="border-b border-borde/60 pb-2 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-xs text-texto-suave">{fechaCorta(v.fecha)}</span>
                  <span className="font-medium text-texto">{v.motivo}</span>
                  <span
                    className={cx(
                      'rounded-full px-2 py-0.5 text-xs font-medium',
                      v.tipo === 'domicilio'
                        ? 'bg-aviso-suave text-aviso'
                        : 'bg-marca-suave text-marca',
                    )}
                  >
                    {ETIQUETA_CORTA[v.tipo]}
                  </span>
                </div>
                {v.indicaciones && (
                  <p className="mt-1 whitespace-pre-line text-xs text-texto-suave">{v.indicaciones}</p>
                )}
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      <Tarjeta className="space-y-3">
        <h3 className="text-sm font-semibold text-texto">Medicamentos y actividades</h3>
        <p className="text-xs text-texto-suave">
          Detectados automaticamente a partir de las notas de la semana.
        </p>
        {meds.length === 0 ? (
          <p className="text-sm text-texto-suave">Sin notas con medicamentos esta semana.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {meds.map((m) => (
              <li
                key={m.nombre}
                className="flex items-center gap-1.5 rounded-full bg-marca-suave px-3 py-1.5 text-xs font-medium text-marca"
              >
                {m.nombre}
                <span className="rounded-full bg-marca/15 px-1.5 text-[0.65rem]">{m.veces}x</span>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

{sondaActiva && mediaDiaria > 0 && mediaDiaria < umbral.sondaMin && (
        <Tarjeta className="flex items-start gap-2.5 border-aviso/30 bg-aviso-suave">
          <span className="shrink-0 text-aviso">
            <IconoAlerta width={20} height={20} />
          </span>
          <p className="text-sm text-aviso">
            La media drenada por la sonda ({mediaDiaria} ml) esta por debajo del minimo configurado (
            {umbral.sondaMin} ml).
          </p>
        </Tarjeta>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Comparativa entre periodos
// ---------------------------------------------------------------------------

function ReporteComparativo({ periodo, umbral }: { periodo: Periodo; umbral: Umbrales }) {
  const { registros } = useRegistros()
  const hoy = useHoy()
  const { actual, anterior, cambios } = useMemo(
    () => compararPeriodos(registros, hoy, periodo),
    [registros, hoy, periodo],
  )

  const etiqueta = periodo === 'mes' ? 'Este mes' : 'Esta semana'

  return (
    <div className="space-y-4">
      <Tarjeta className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-texto">{etiqueta} vs. periodo anterior</h2>
          <p className="text-xs text-texto-suave">
            {fechaCorta(actual.desde)}&ndash;{fechaCorta(actual.hasta)} frente a{' '}
            {fechaCorta(anterior.desde)}&ndash;{fechaCorta(anterior.hasta)}
          </p>
        </div>

<div className="space-y-2.5">
          <FilaComparativa
            etiqueta="Presion sistolica media"
            actual={`${n(actual.promedioPresionSis)} mmHg`}
            anterior={`${n(anterior.promedioPresionSis)} mmHg`}
            cambio={cambios.promedioPresionSis}
          />
          <FilaComparativa
            etiqueta="Presion diastolica media"
            actual={`${n(actual.promedioPresionDia)} mmHg`}
            anterior={`${n(anterior.promedioPresionDia)} mmHg`}
            cambio={cambios.promedioPresionDia}
          />
          <FilaComparativa
            etiqueta="Oxigeno medio"
            actual={`${n(actual.promedioO2)}%`}
            anterior={`${n(anterior.promedioO2)}%`}
            cambio={cambios.promedioO2}
          />
          <FilaComparativa
            etiqueta="Pulso medio"
            actual={`${n(actual.promedioBPM)} lpm`}
            anterior={`${n(anterior.promedioBPM)} lpm`}
            cambio={cambios.promedioBPM}
          />
        </div>

        <p className="text-xs text-texto-suave">
          {actual.cantidad} mediciones en el periodo actual frente a {anterior.cantidad} en el
          anterior. Diferencias de menos del 5% suelen ser ruido de medicion.
        </p>
      </Tarjeta>

      {periodo === 'semana' && (
        <Tarjeta className="space-y-3">
          <h3 className="text-sm font-semibold text-texto">Dia a dia</h3>
          <TablaComparativaSemanal umbral={umbral} />
        </Tarjeta>
      )}
    </div>
  )
}

/** Fila con valor actual, anterior y variacion porcentual. */
function FilaComparativa({
  etiqueta,
  actual,
  anterior,
  cambio,
}: {
  etiqueta: string
  actual: string
  anterior: string
  cambio: number | null
}) {
  const subio = (cambio ?? 0) > 0
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-superficie-2 px-3 py-2.5">
      <span className="min-w-0 text-sm text-texto">{etiqueta}</span>
      <span className="flex shrink-0 items-baseline gap-2">
        <span className="text-xs text-texto-suave line-through">{anterior}</span>
        <span className="text-sm font-semibold tabular-nums text-texto">{actual}</span>
        {cambio !== null && Math.abs(cambio) >= 1 && (
          <span
            className={cx(
              'text-xs font-medium tabular-nums',
              // Solo se marca en ambar cuando el aumento es grande: un cambio
              // pequeno suele ser ruido, y un color de alerta constante
              // acabaria ignorandose.
              subio && cambio > 10 ? 'text-aviso' : 'text-texto-suave',
            )}
          >
            {subio ? '+' : ''}
            {cambio}%
          </span>
        )}
      </span>
    </div>
  )
}

/** Tabla que enfrenta dia a dia los dos periodos. */
function TablaComparativaSemanal({ umbral }: { umbral: Umbrales }) {
  const { registros } = useRegistros()
  const lunes = inicioSemana(useHoy())

  const filas = Array.from({ length: 7 }, (_, i) => {
    const fecha = sumarDias(lunes, i)
    return {
      fecha,
      actual: resumenDia(registros, fecha),
      anterior: resumenDia(registros, sumarDias(fecha, -7)),
    }
  })

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] text-sm">
<thead>
          <tr className="border-b border-borde text-left text-xs text-texto-suave">
            <th className="py-2 pr-2 font-medium">Dia</th>
            <th className="py-2 pr-2 font-medium">Presion act/ant</th>
            <th className="py-2 pr-2 font-medium">O2 min</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.fecha} className="border-b border-borde/60 last:border-0">
              <td className="py-2.5 pr-2 font-medium">{fechaCorta(f.fecha).slice(0, 6)}</td>
              <td className="py-2.5 pr-2 tabular-nums">
                {f.actual.promedioPresionSis === null ? (
                  <span className="text-texto-suave">-</span>
                ) : (
                  <>
                    <span className="font-medium">
                      {n(f.actual.promedioPresionSis)}/{n(f.actual.promedioPresionDia)}
                    </span>
                    <span className="text-texto-suave">
                      {' '}
                      / {n(f.anterior.promedioPresionSis)}/{n(f.anterior.promedioPresionDia)}
                    </span>
                  </>
                )}
              </td>
              <td className="py-2.5 pr-2 tabular-nums">
                {f.actual.minO2 === null ? (
                  '-'
                ) : (
                  <span
                    className={cx(f.actual.minO2 < umbral.o2Min && 'font-semibold text-alerta')}
                  >
                    {f.actual.minO2}%
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Piezas auxiliares
// ---------------------------------------------------------------------------

function Metrica({ etiqueta, valor, unidad }: { etiqueta: string; valor: string; unidad?: string }) {
  return (
    <div className="rounded-xl bg-superficie-2 px-3 py-2.5">
      <p className="text-[0.7rem] text-texto-suave">{etiqueta}</p>
      <p className="mt-0.5 font-semibold tabular-nums text-texto">
        {valor}
        {unidad && <span className="ml-1 text-xs font-normal text-texto-suave">{unidad}</span>}
      </p>
    </div>
  )
}

/** Navegacion entre semanas completas (lunes a domingo). */
function NavegacionSemana({ dia, onChange }: { dia: string; onChange: (d: string) => void }) {
  const hoy = useHoy()
  const lunes = inicioSemana(dia)
  const lunesActual = inicioSemana(hoy)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => onChange(sumarDias(lunes, -7))}
          aria-label="Semana anterior"
          className="grid size-11 place-items-center rounded-xl border border-borde text-texto-suave"
        >
          <IconoFlechaIzq />
        </button>
        <span className="text-center text-sm font-medium text-texto">
          {fechaCorta(lunes)} &ndash; {fechaCorta(sumarDias(lunes, 6))}
        </span>
        <button
          onClick={() => onChange(sumarDias(lunes, 7))}
          disabled={lunes >= lunesActual}
          aria-label="Semana siguiente"
          className="grid size-11 place-items-center rounded-xl border border-borde text-texto-suave disabled:opacity-40"
        >
          <IconoFlechaDer />
        </button>
      </div>
      <button
        onClick={() => onChange(hoy)}
        disabled={dia === hoy}
        className="mx-auto flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-marca disabled:opacity-40"
      >
        <IconoCalendario width={14} height={14} />
        Ir a la semana actual
      </button>
    </div>
  )
}