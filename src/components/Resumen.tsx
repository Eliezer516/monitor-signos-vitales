/**
 * Componentes de resumen reutilizados por Inicio, Reportes y Graficas:
 * tarjetas de metricas, tabla de mediciones y panel de alertas.
 */

import { useMemo } from 'react'
import type { Alerta, Nivel, PresionHabitual, Registro, ResumenDia, Umbrales } from '../lib/tipos'
import {
  ESTILO_NIVEL,
  PRESION_HABITUAL_POR_DEFECTO,
  evaluarBpm,
  evaluarDia,
  evaluarO2,
  evaluarSis,
} from '../lib/rangos'
import { haceCuanto, hora12, nombreDiaCorto } from '../lib/fechas'
import { Insignia, PuntoEstado, Vacio, cx } from './UI'
import { IconoAlerta, IconoCopiar, IconoCorazon, IconoGota, IconoOximetro, IconoPulso, IconoReloj } from './Iconos'

// ---------------------------------------------------------------------------
// Tarjeta de metrica
// ---------------------------------------------------------------------------

/**
 * Tarjeta de una metrica del dia con su indicador de color.
 * `principal` destaca la que mas importa en cada pantalla.
 */
export function TarjetaMetrica({
  etiqueta,
  valor,
  unidad,
  detalle,
  nivel = 'ok',
  icono,
  principal,
}: {
  etiqueta: string
  valor: string
  unidad?: string
  detalle?: string
  nivel?: Nivel
  icono?: React.ReactNode
  principal?: boolean
}) {
  return (
    <div
      className={cx(
        'tarjeta flex flex-col gap-1 p-3.5',
        principal && 'sm:p-4',
      )}
    >
      <div className="flex items-center gap-1.5">
        {icono && <span className={cx('text-texto-suave', principal && 'size-5')}>{icono}</span>}
        <span className="text-xs font-medium text-texto-suave">{etiqueta}</span>
        {nivel !== 'ok' && (
          <span className="ml-auto" title={nivel === 'alerta' ? 'Fuera de rango' : 'Revisar'}>
            <PuntoEstado className={ESTILO_NIVEL[nivel].punto} />
          </span>
        )}
      </div>
      <p className={cx('font-semibold tabular-nums text-texto', principal ? 'text-2xl' : 'text-xl')}>
        {valor}
        {unidad && <span className="ml-1 text-sm font-normal text-texto-suave">{unidad}</span>}
      </p>
      {detalle && <p className="text-xs text-texto-suave">{detalle}</p>}
    </div>
  )
}

/** Formatea un valor nullable mostrando un guion cuando no hay datos. */
export const n = (v: number | null | undefined, dec = 0) =>
  v === null || v === undefined || Number.isNaN(v) ? '-' : v.toFixed(dec).replace(/\.0$/, '')

// ---------------------------------------------------------------------------
// Tabla de mediciones
// ---------------------------------------------------------------------------

/**
 * Lista cronologica de mediciones. En movil cada fila es una tarjeta apilada
 * (una tabla de 7 columnas es ilegible en una pantalla pequena); en escritorio
 * se convierte en una tabla real con las mismas cifras.
 */
export function ListaMediciones({
  registros,
  umbral,
  habitual,
  onEditar,
  onEliminar,
  onCopiar,
  compacta,
  clase,
  sinCabecera,
  className,
}: {
  registros: Registro[]
  umbral: Umbrales
  /** Presion habitual del paciente, para evaluar la presion. */
  habitual?: PresionHabitual
  onEditar?: (r: Registro) => void
  onEliminar?: (r: Registro) => void
  /** Copia la medicion como texto al portapapeles. */
  onCopiar?: (r: Registro) => void
  /** `compacta` oculta las notas (dashboard). */
  compacta?: boolean
  /** `clase` fuerza a mostrar la fecha junto a la hora (historial). */
  clase?: 'con-fecha' | 'solo-hora'
  /**
   * Oculta la fila de titulos de columnas. En el historial la lista se pinta
   * una vez por dia, ya con un encabezado de grupo encima, y repetir la misma
   * cabecera de columnas en cada grupo solo ocupa sitio.
   */
  sinCabecera?: boolean
  className?: string
}) {
  if (!registros.length) {
    return <Vacio icono={<IconoReloj width={32} height={32} />} titulo="Sin mediciones" descripcion="Todavia no hay registros en este periodo." />
  }

  return (
    <div className={className}>
      {/* Vista de escritorio */}
      <table className="hidden w-full text-sm md:table">
        {!sinCabecera && (
          <thead>
            <tr className="border-b border-borde text-left text-xs text-texto-suave">
              <th className="py-2 pr-2 font-medium">{clase === 'con-fecha' ? 'Fecha' : 'Hora'}</th>
              <th className="py-2 pr-2 font-medium">Presion</th>
              <th className="py-2 pr-2 font-medium">O2</th>
              <th className="py-2 pr-2 font-medium">Pulso</th>
              <th className="py-2 pr-2 font-medium">Orina</th>
              {!compacta && <th className="py-2 pr-2 font-medium">Notas</th>}
              {(onEditar || onEliminar || onCopiar) && <th className="py-2 font-medium" />}
            </tr>
          </thead>
        )}
        <tbody>
          {registros.map((r) => (
            <FilaMedicion
              key={r.id}
              registro={r}
              umbral={umbral}
              habitual={habitual}
              onEditar={onEditar}
              onEliminar={onEliminar}
              onCopiar={onCopiar}
              compacta={compacta}
              clase={clase}
            />
          ))}
        </tbody>
      </table>

      {/* Vista movil */}
      <ul className="space-y-2 md:hidden">
        {registros.map((r) => (
          <TarjetaMedicion
            key={r.id}
            registro={r}
            umbral={umbral}
            habitual={habitual}
            onEditar={onEditar}
            onEliminar={onEliminar}
            onCopiar={onCopiar}
            compacta={compacta}
            clase={clase}
          />
        ))}
      </ul>
    </div>
  )
}

/** Nivel de cada valor de un registro, para colorear celda a celda. */
function nivelesDe(r: Registro, u: Umbrales, habitual: PresionHabitual) {
  return {
    sis: evaluarSis(r.presionSis, u, habitual),
    dia: evaluarDia(r.presionDia, u, habitual),
    o2: evaluarO2(r.o2, u),
    bpm: evaluarBpm(r.bpm, u),
  }
}

/** Color de texto segun nivel. */
const colorNivel = (nivel: Nivel) =>
  nivel === 'alerta' ? 'text-alerta font-semibold' : nivel === 'aviso' ? 'text-aviso' : 'text-texto'

function FilaMedicion({
  registro: r,
  umbral,
  habitual = PRESION_HABITUAL_POR_DEFECTO,
  onEditar,
  onEliminar,
  onCopiar,
  compacta,
  clase,
}: {
  registro: Registro
  umbral: Umbrales
  habitual?: PresionHabitual
  onEditar?: (r: Registro) => void
  onEliminar?: (r: Registro) => void
  onCopiar?: (r: Registro) => void
  compacta?: boolean
  clase?: 'con-fecha' | 'solo-hora'
}) {
  const nv = nivelesDe(r, umbral, habitual)
  return (
    <tr className="border-b border-borde/60 last:border-0 hover:bg-superficie-2">
      <td className="py-2.5 pr-2 whitespace-nowrap">
        {clase === 'con-fecha' && (
          <span className="mr-2 text-texto-suave">{r.fecha.slice(8)}/{r.fecha.slice(5, 7)}</span>
        )}
        <span className="font-medium tabular-nums">{hora12(r.hora)}</span>
      </td>
      <td className="py-2.5 pr-2 tabular-nums">
        <span className={colorNivel(nv.sis)}>{r.presionSis}</span>
        <span className="text-texto-suave">/</span>
        <span className={colorNivel(nv.dia)}>{r.presionDia}</span>
      </td>
      <td className={cx('py-2.5 pr-2 font-medium tabular-nums', colorNivel(nv.o2))}>{r.o2}%</td>
      <td className={cx('py-2.5 pr-2 font-medium tabular-nums', colorNivel(nv.bpm))}>{r.bpm}</td>
      <td className="py-2.5 pr-2 tabular-nums">
        {r.orina === null ? (
          <span className="text-texto-suave">-</span>
        ) : (
          <>
            <span className="font-medium">{r.orina}</span>
            <span className="text-xs text-texto-suave"> ml</span>
          </>
        )}
      </td>
      {!compacta && (
        <td className="max-w-56 truncate py-2.5 pr-2 text-texto-suave" title={r.notas}>
          {r.notas || '-'}
        </td>
      )}
      {(onEditar || onEliminar || onCopiar) && (
        <td className="py-1.5 text-right">
          <div className="flex justify-end gap-1">
            {onEditar && (
              <BotonIcono onClick={() => onEditar(r)} titulo="Editar" icono="editar" />
            )}
            {onEliminar && (
              <BotonIcono onClick={() => onEliminar(r)} titulo="Eliminar" icono="borrar" peligro />
            )}
            {onCopiar && (
              <BotonIcono onClick={() => onCopiar(r)} titulo="Copiar medicion" icono="copiar" />
            )}
          </div>
        </td>
      )}
    </tr>
  )
}

function BotonIcono({
  onClick,
  titulo,
  icono,
  peligro,
}: {
  onClick: () => void
  titulo: string
  icono: 'editar' | 'borrar' | 'copiar'
  peligro?: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-label={titulo}
      title={titulo}
      className={cx(
        'grid size-9 place-items-center rounded-lg transition',
        peligro
          ? 'text-texto-suave hover:bg-alerta-suave hover:text-alerta'
          : 'text-texto-suave hover:bg-superficie-3 hover:text-texto',
      )}
    >
      {icono === 'editar' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6" />
          <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
        </svg>
      ) : icono === 'copiar' ? (
        <IconoCopiar width={16} height={16} />
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 6h18M8 6V4.5a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 1 16 4.5V6" />
          <path d="M18.5 6 18 19.6a1.5 1.5 0 0 1-1.5 1.4h-9A1.5 1.5 0 0 1 6 19.6L5.5 6" />
        </svg>
      )}
    </button>
  )
}

function TarjetaMedicion({
  registro: r,
  umbral,
  habitual = PRESION_HABITUAL_POR_DEFECTO,
  onEditar,
  onEliminar,
  onCopiar,
  compacta,
  clase,
}: {
  registro: Registro
  umbral: Umbrales
  habitual?: PresionHabitual
  onEditar?: (r: Registro) => void
  onEliminar?: (r: Registro) => void
  onCopiar?: (r: Registro) => void
  compacta?: boolean
  clase?: 'con-fecha' | 'solo-hora'
}) {
  const nv = nivelesDe(r, umbral, habitual)
  return (
    <li className="tarjeta p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold tabular-nums text-texto">
          {clase === 'con-fecha' && (
            <span className="mr-1.5 text-sm font-normal text-texto-suave">
              {r.fecha.slice(8)}/{r.fecha.slice(5, 7)}
            </span>
          )}
          {hora12(r.hora)}
        </span>
        <div className="flex items-center gap-1">
          {(onEditar || onEliminar || onCopiar) && (
            <>
              {onEditar && <BotonIcono onClick={() => onEditar(r)} titulo="Editar" icono="editar" />}
              {onEliminar && (
                <BotonIcono onClick={() => onEliminar(r)} titulo="Eliminar" icono="borrar" peligro />
              )}
              {onCopiar && <BotonIcono onClick={() => onCopiar(r)} titulo="Copiar medicion" icono="copiar" />}
            </>
          )}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1 text-center">
        <Celda etiqueta="Presion" valor={`${r.presionSis}/${r.presionDia}`} nivel={peor(nv.sis, nv.dia)} />
        <Celda etiqueta="O2" valor={`${r.o2}%`} nivel={nv.o2} />
        <Celda etiqueta="Pulso" valor={String(r.bpm)} nivel={nv.bpm} />
        <Celda etiqueta="Orina" valor={r.orina === null ? '-' : String(r.orina)} nivel="ok" />
      </div>
      {!compacta && r.notas && (
        <p className="mt-2 border-t border-borde pt-2 text-xs text-texto-suave">{r.notas}</p>
      )}
    </li>
  )
}

const peor = (a: Nivel, b: Nivel): Nivel =>
  a === 'alerta' || b === 'alerta' ? 'alerta' : a === 'aviso' || b === 'aviso' ? 'aviso' : 'ok'

function Celda({ etiqueta, valor, nivel }: { etiqueta: string; valor: string; nivel: Nivel }) {
  return (
    <div>
      <p className="text-[0.65rem] uppercase tracking-wide text-texto-suave">{etiqueta}</p>
      <p className={cx('text-sm font-semibold tabular-nums', colorNivel(nivel))}>{valor}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panel de alertas
// ---------------------------------------------------------------------------

const ICONO_ALERTA = {
  alerta: IconoAlerta,
  aviso: IconoAlerta,
  gota: IconoGota,
  oximetro: IconoOximetro,
  corazon: IconoCorazon,
}

export function PanelAlertas({ alertas, className }: { alertas: Alerta[]; className?: string }) {
  if (!alertas.length) {
    return (
      <div className={cx('tarjeta flex items-center gap-3 p-4', className)}>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ok-suave text-ok">
          <IconoPulso />
        </span>
        <div>
          <p className="text-sm font-medium text-texto">Todo dentro de rango</p>
          <p className="text-xs text-texto-suave">No hay valores que requieran atencion.</p>
        </div>
      </div>
    )
  }

  // Las mas graves primero.
  const ordenadas = [...alertas].sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'alerta' ? -1 : 1))

  return (
    <ul className={cx('space-y-2', className)}>
      {ordenadas.map((a) => {
        const Icono = ICONO_ALERTA[a.icono] ?? IconoAlerta
        return (
          <li
            key={a.id}
            className={cx(
              'flex items-start gap-3 rounded-2xl border p-3.5',
              a.nivel === 'alerta' ? ESTILO_NIVEL.alerta.clase : ESTILO_NIVEL.aviso.clase,
            )}
          >
            <Icono className="mt-0.5 shrink-0" width={20} height={20} />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{a.titulo}</p>
              <p className="mt-0.5 text-xs opacity-90">{a.detalle}</p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Resumen del dia
// ---------------------------------------------------------------------------

/** Fila compacta de resumen usada en varias pantallas. */
export function ResumenDiaFila({ resumen }: { resumen: ResumenDia }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
      <CeldaResumen
        etiqueta="Tomas"
        valor={String(resumen.registros.length)}
        icono={<IconoReloj width={14} height={14} />}
      />
      <CeldaResumen
        etiqueta="Orina"
        valor={`${resumen.totalOrina}`}
        sufijo="ml"
        icono={<IconoGota width={14} height={14} />}
      />
      <CeldaResumen
        etiqueta="Presion"
        valor={`${n(resumen.promedioPresionSis)}/${n(resumen.promedioPresionDia)}`}
        icono={<IconoPulso width={14} height={14} />}
      />
      <CeldaResumen
        etiqueta="O2 min"
        valor={n(resumen.minO2)}
        sufijo="%"
        icono={<IconoOximetro width={14} height={14} />}
      />
    </div>
  )
}

function CeldaResumen({
  etiqueta,
  valor,
  sufijo,
  icono,
}: {
  etiqueta: string
  valor: string
  sufijo?: string
  icono?: React.ReactNode
}) {
  return (
    <div className="rounded-xl bg-superficie-2 px-2 py-2.5">
      <p className="flex items-center justify-center gap-1 text-[0.7rem] text-texto-suave">
        {icono}
        {etiqueta}
      </p>
      <p className="mt-0.5 font-semibold tabular-nums text-texto">
        {valor}
        {sufijo && <span className="ml-0.5 text-xs font-normal text-texto-suave">{sufijo}</span>}
      </p>
    </div>
  )
}

/** Etiqueta de dia de la semana para tablas de resumen. */
export const EtiquetaDia = ({ fecha }: { fecha: string }) => (
  <Insignia>{nombreDiaCorto(fecha)}</Insignia>
)

/** Tiempo transcurrido desde la ultima medicion. */
export function useUltimaMedicion(registros: Registro[]): string {
  return useMemo(() => {
    if (!registros.length) return 'sin datos'
    const [ultimo] = registros
    return haceCuanto(ultimo.fecha, ultimo.hora)
  }, [registros])
}
