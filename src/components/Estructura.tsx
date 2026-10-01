/**
 * Estructura general de la aplicacion.
 *
 * Diseno movil-first: en telefono la navegacion es una barra inferior fija con
 * botones grandes (la forma mas comoda de usar la app con una sola mano), y en
 * escritorio pasa a una barra lateral. El boton "Registrar" se destaca en el
 * centro porque es la accion mas frecuente.
 */

import type { ReactNode } from 'react'
import { RUTAS, type Ruta } from '../hooks/useRuta'
import { cx } from './UI'
import { IconoAjustes, IconoCasa, IconoGrafica, IconoHistorial, IconoMas, IconoMedico, IconoReporte } from './Iconos'
import { useAjustes } from '../context/ContextoAjustes'
import { useRegistros } from '../context/ContextoRegistros'
import { resumenDia } from '../lib/resumen'
import { useHoy } from '../hooks/useHoy'

const ICONOS: Record<Ruta, (p: { width?: number; height?: number }) => ReactNode> = {
  inicio: (p) => <IconoCasa {...p} />,
  registrar: (p) => <IconoMas {...p} />,
  historial: (p) => <IconoHistorial {...p} />,
  visitas: (p) => <IconoMedico {...p} />,
  graficas: (p) => <IconoGrafica {...p} />,
  reportes: (p) => <IconoReporte {...p} />,
  ajustes: (p) => <IconoAjustes {...p} />,
}

/** Etiqueta legible de una ruta. */
const etiquetaDe = (r: Ruta) => RUTAS.find((x) => x.id === r)?.etiqueta ?? r

/** Pestanas de la barra inferior. "Ajustes" queda en la barra superior. */
const PRINCIPALES: Ruta[] = ['inicio', 'registrar', 'historial', 'graficas']

export function Estructura({
  ruta,
  onNavegar,
  children,
}: {
  ruta: Ruta
  onNavegar: (r: Ruta) => void
  children: ReactNode
}) {
  const { registros } = useRegistros()
  const hoy = useHoy()
  const hayAlerta = resumenDia(registros, hoy).registros.some(
    (r) => r.o2 < 92 || r.presionSis < 80 || r.presionSis > 160,
  )

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl lg:gap-6 lg:px-4">
      {/* Barra lateral (solo escritorio). */}
      <aside className="no-imprimir sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 py-5 lg:flex">
        <Marca />
        <nav className="mt-6 flex flex-col gap-1" aria-label="Navegacion principal">
          {RUTAS.map((r) => (
            <BotonNav
              key={r.id}
              ruta={r.id}
              activo={ruta === r.id}
              onClick={() => onNavegar(r.id)}
            />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Encabezado ruta={ruta} onNavegar={onNavegar} />

        <main className="flex-1 px-3 pt-3 pb-28 sm:px-4 lg:px-0 lg:pb-8">{children}</main>
      </div>

      {/* Barra inferior movil. */}
      <nav
        aria-label="Navegacion principal"
        className="no-imprimir fixed inset-x-0 bottom-0 z-40 border-t border-borde bg-superficie/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="mx-auto flex max-w-lg items-stretch">
          {PRINCIPALES.map((r) => {
            const activo = ruta === r
            // El registro es la accion principal: boton grande y destacado.
            if (r === 'registrar') {
              return (
                <li key={r} className="flex-1">
                  <button
                    onClick={() => onNavegar(r)}
                    aria-current={activo ? 'page' : undefined}
                    className={cx(
                      'flex min-h-16 w-full flex-col items-center justify-center gap-0.5',
                      'text-[0.7rem] font-medium transition',
                      activo ? 'text-marca' : 'text-texto-suave',
                    )}
                  >
                    <span
                      className={cx(
                        'grid size-9 place-items-center rounded-full text-white transition',
                        activo ? 'bg-marca' : 'bg-marca/85',
                      )}
                    >
                      <IconoMas width={22} height={22} />
                    </span>
                    Registrar
                  </button>
                </li>
              )
            }
            return (
              <li key={r} className="flex-1">
                <button
                  onClick={() => onNavegar(r)}
                  aria-current={activo ? 'page' : undefined}
                  className={cx(
                    'flex min-h-16 w-full flex-col items-center justify-center gap-1 text-[0.7rem] font-medium transition',
                    activo ? 'text-marca' : 'text-texto-suave',
                  )}
                >
                  <span className="relative">
                    {ICONOS[r]({ width: 22, height: 22 })}
                    {r === 'inicio' && hayAlerta && (
                      <span
                        className="absolute -right-1 -top-0.5 size-2.5 rounded-full bg-alerta ring-2 ring-superficie"
                        aria-label="Hay valores fuera de rango"
                      />
                    )}
                  </span>
                  {etiquetaDe(r)}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}

function Marca() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <span className="grid size-9 place-items-center rounded-xl bg-marca text-white">
        <IconoPulsoLinea />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-texto">Signos Vitales</span>
        <span className="block text-xs text-texto-suave">Control del paciente</span>
      </span>
    </div>
  )
}

function IconoPulsoLinea() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12h4l2.5-7 4 14 2.5-7h7" />
    </svg>
  )
}

function BotonNav({
  ruta,
  activo,
  onClick,
}: {
  ruta: Ruta
  activo: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-current={activo ? 'page' : undefined}
      className={cx(
        'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition',
        activo ? 'bg-marca-suave text-marca' : 'text-texto-suave hover:bg-superficie-3',
      )}
    >
      {ICONOS[ruta]({ width: 20, height: 20 })}
      {etiquetaDe(ruta)}
    </button>
  )
}

function Encabezado({ ruta, onNavegar }: { ruta: Ruta; onNavegar: (r: Ruta) => void }) {
  const { paciente } = useAjustes()
  const titulo = etiquetaDe(ruta)

  return (
    <header className="no-imprimir sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-borde bg-superficie/90 px-3 backdrop-blur sm:px-4 lg:hidden">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold text-texto">{titulo}</h1>
        {paciente?.nombre && (
          <p className="truncate text-xs text-texto-suave">{paciente.nombre}</p>
        )}
      </div>
      <button
        onClick={() => onNavegar('ajustes')}
        aria-label="Ajustes"
        className={cx(
          'grid size-11 shrink-0 place-items-center rounded-xl transition',
          ruta === 'ajustes' ? 'bg-marca-suave text-marca' : 'text-texto-suave hover:bg-superficie-3',
        )}
      >
        <IconoAjustes />
      </button>
    </header>
  )
}