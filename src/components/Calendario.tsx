/**
 * Calendario compacto para navegar entre dias.
 *
 * No se usa un componente de calendario completo: el cuidador solo necesita
 * saltar a un dia concreto y ver de un vistazo que dias tienen registros. Esta
 * version es una tira horizontal de 7 dias con el mes Above, cabe en pantalla
 * y los botones son grandes.
 *
 * Se muestra un punto en los dias con mediciones para orientar la navegacion
 * sin tener que abrir cada dia.
 */

import { useMemo, useState } from 'react'
import { fechaLarga, nombreDiaCorto, sumarDias } from '../lib/fechas'
import type { FechaISO } from '../lib/tipos'
import { useHoy } from '../hooks/useHoy'
import { IconoCalendario, IconoFlechaDer, IconoFlechaIzq } from './Iconos'
import { cx } from './UI'

export function Calendario({
  valor,
  onChange,
  diasConDatos,
}: {
  valor: FechaISO
  onChange: (fecha: FechaISO) => void
  diasConDatos: Set<FechaISO>
}) {
  // `hoy` viene del hook porque el calendario se puede quedar abierto de noche.
  const hoy = useHoy()
  // Semana visible centrada en el dia seleccionado.
  const [ancla, setAncla] = useState<FechaISO>(() => valor)

  // Si el valor cambia desde fuera (por ejemplo, el boton "Hoy"), se recentra.
  const dias = useMemo(() => {
    const base = valor !== ancla ? valor : ancla
    // Lunes de la semana que contiene `base`.
    const d = new Date(base)
    const dow = (d.getDay() + 6) % 7
    const lunes = sumarDias(base, -dow)
    return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i))
  }, [valor, ancla])

  const mesVisible = dias[3] ?? valor
  const mostrarMes = dias[0].slice(0, 7) !== dias[6].slice(0, 7)

  const irSemana = (delta: number) => setAncla(sumarDias(ancla, delta * 7))

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={() => irSemana(-1)}
          aria-label="Semana anterior"
          className="grid size-9 place-items-center rounded-lg text-texto-suave hover:bg-superficie-3"
        >
          <IconoFlechaIzq width={18} height={18} />
        </button>
        <button
          onClick={() => {
            onChange(hoy)
            setAncla(hoy)
          }}
          className="flex items-center gap-1.5 text-sm font-medium text-texto-suave hover:text-texto"
        >
          <IconoCalendario width={16} height={16} />
          {mostrarMes ? `${etiquetaMes(dias[0])} - ${etiquetaMes(dias[6])}` : etiquetaMes(mesVisible)}
        </button>
        <button
          onClick={() => irSemana(1)}
          aria-label="Semana siguiente"
          className="grid size-9 place-items-center rounded-lg text-texto-suave hover:bg-superficie-3"
        >
          <IconoFlechaDer width={18} height={18} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {dias.map((d) => {
          const seleccionado = d === valor
          const esHoy = d === hoy
          const tieneDatos = diasConDatos.has(d)
          return (
            <button
              key={d}
              onClick={() => {
                onChange(d)
                setAncla(d)
              }}
              aria-label={fechaLarga(d)}
              aria-pressed={seleccionado}
              className={cx(
                'relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-xs transition',
                seleccionado
                  ? 'bg-marca font-semibold text-white'
                  : esHoy
                    ? 'bg-marca-suave font-medium text-marca'
                    : 'text-texto-suave hover:bg-superficie-3',
              )}
            >
              <span className="uppercase tracking-wide opacity-80">{nombreDiaCorto(d)}</span>
              <span className="text-base font-semibold tabular-nums">{Number(d.slice(8))}</span>
              {tieneDatos && (
                <span
                  className={cx(
                    'size-1.5 rounded-full',
                    seleccionado ? 'bg-white' : 'bg-marca',
                  )}
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function etiquetaMes(fecha: FechaISO): string {
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const m = meses[Number(fecha.slice(5, 7)) - 1]
  return `${m} ${fecha.slice(0, 4)}`
}