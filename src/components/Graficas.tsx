/**
 * Graficas en SVG puro.
 *
 * Decision: no usar Recharts ni Chart.js. Ambas librerias ocupan entre 100 y
 * 180 kB comprimidos y aqui la velocidad de carga es un requisito explicito
 * ("conexiones lentas"). Los dos tipos de grafica que necesita la app se
 * resuelven en unas 300 lineas de SVG, sin bundle extra y con control total
 * sobre el diseno tactil (los puntos de contacto son de 44 px, no de 2).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cx } from './UI'

// ---------------------------------------------------------------------------
// Medidas del contenedor
// ---------------------------------------------------------------------------

/** Observa el ancho disponible para que la grafica sea responsive. */
function useAncho<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [ancho, setAncho] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entrada]) => {
      setAncho(Math.round(entrada.contentRect.width))
    })
    ro.observe(el)
    setAncho(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  return [ref, ancho] as const
}

// ---------------------------------------------------------------------------
// Escalas y ejes
// ---------------------------------------------------------------------------

/** Redondea el dominio a multiplos "bonitos" (1, 2, 5 x 10^n). */
function dominioBonito(min: number, max: number, pasos = 4): { min: number; max: number; ticks: number[] } {
  if (min === max) {
    // Todos los valores son iguales: se abre un margen para que la linea no
    // quede pegada al borde.
    const centro = min
    const margen = Math.max(1, Math.abs(centro) * 0.05)
    min = centro - margen
    max = centro + margen
  }
  const rango = max - min
  const pasoCrudo = rango / pasos
  const magnitud = 10 ** Math.floor(Math.log10(pasoCrudo))
  const normalizado = pasoCrudo / magnitud
  const paso = (normalizado <= 1 ? 1 : normalizado <= 2 ? 2 : normalizado <= 5 ? 5 : 10) * magnitud
  const inicio = Math.floor(min / paso) * paso
  const fin = Math.ceil(max / paso) * paso
  const ticks: number[] = []
  // Se acumula con multiplicacion para evitar errores de coma flotante.
  for (let v = inicio, i = 0; v <= fin + paso / 2 && i < 12; v += paso, i++) {
    ticks.push(Math.round(v * 1000) / 1000)
  }
  return { min: inicio, max: fin, ticks }
}

const MARGENES = { arriba: 12, derecha: 8, abajo: 22, izquierda: 34 }

// ---------------------------------------------------------------------------
// Grafica de lineas
// ---------------------------------------------------------------------------

export interface SerieLinea {
  clave: string
  etiqueta: string
  color: string
  /** Valor por punto; `null` crea un hueco en la linea (dias sin registro). */
  valores: (number | null)[]
  /** Rango sombreado opcional (p. ej. minimo-maximo de O2). */
  banda?: { min: (number | null)[]; max: (number | null)[] } | null
  /** Formatea el valor en el tooltip. Por defecto, redondeo simple. */
  formato?: (v: number) => string
  /** Eje Y propio: permite mezclar escalas (p. ej. O2 en %, pulso en lpm). */
  eje?: 'izquierdo' | 'derecho'
}

interface PropsLinea {
  series: SerieLinea[]
  etiquetas: string[]
  alto?: number
  /** Lineas horizontales de referencia (umbrales), con su etiqueta. */
  referencias?: { valor: number; etiqueta: string; eje?: 'izquierdo' | 'derecho'; color?: string }[]
  formatoY?: (v: number) => string
  /** Mensaje cuando no hay datos suficientes. */
  vacio?: string
  className?: string
}

export function GraficaLinea({
  series,
  etiquetas,
  alto = 220,
  referencias = [],
  formatoY = (v) => String(Math.round(v)),
  vacio = 'Sin datos para mostrar',
  className,
}: PropsLinea) {
  const [ref, ancho] = useAncho<HTMLDivElement>()
  const [activo, setActivo] = useState<number | null>(null)

  const izq = series.filter((s) => s.eje !== 'derecho')
  const der = series.filter((s) => s.eje === 'derecho')

  // Dominio del eje Y: incluye las referencias para que la linea de umbral
  // siempre sea visible dentro del area de trazado.
  const dominio = useMemo(() => {
    const calcular = (lista: SerieLinea[], refs: typeof referencias) => {
      const vals = lista.flatMap((s) => [
        ...s.valores.filter((v): v is number => v !== null && !Number.isNaN(v)),
        ...(s.banda?.min.filter((v): v is number => v !== null) ?? []),
        ...(s.banda?.max.filter((v): v is number => v !== null) ?? []),
      ])
      const refVals = refs.filter((r) => !r.eje || r.eje === 'izquierdo').map((r) => r.valor)
      const todos = [...vals, ...refVals]
      if (!todos.length) return null
      // Se anade un margen del 8% para que los puntos no toquen el borde.
      const min = Math.min(...todos)
      const max = Math.max(...todos)
      const margen = (max - min) * 0.08 || Math.max(1, max * 0.05)
      return dominioBonito(min - margen, max + margen)
    }
    return {
      izq: calcular(izq, referencias),
      der: der.length ? calcular(der, referencias) : null,
    }
  }, [izq, der, referencias])

  const anchoTrama = Math.max(0, ancho - MARGENES.izquierda - MARGENES.derecha)
  const altoTrama = alto - MARGENES.arriba - MARGENES.abajo
  const n = etiquetas.length

  const x = useCallback(
    (i: number) => (n <= 1 ? MARGENES.izquierda + anchoTrama / 2 : MARGENES.izquierda + (i / (n - 1)) * anchoTrama),
    [n, anchoTrama],
  )
  const yIzq = useCallback(
    (v: number) => {
      const d = dominio.izq
      if (!d) return 0
      return MARGENES.arriba + altoTrama - ((v - d.min) / (d.max - d.min || 1)) * altoTrama
    },
    [dominio, altoTrama],
  )
  const yDer = useCallback(
    (v: number) => {
      const d = dominio.der
      if (!d) return 0
      return MARGENES.arriba + altoTrama - ((v - d.min) / (d.max - d.min || 1)) * altoTrama
    },
    [dominio, altoTrama],
  )

  // Toda la zona de trazado detecta el puntero; en movil manda `touch`.
  const alMover = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!n) return
    const caja = e.currentTarget.getBoundingClientRect()
    const xRel = e.clientX - caja.left - MARGENES.izquierda
    const i = n <= 1 ? 0 : Math.round((xRel / (anchoTrama || 1)) * (n - 1))
    setActivo(Math.max(0, Math.min(n - 1, i)))
  }

  const hayDatos = series.some((s) => s.valores.some((v) => v !== null))

  return (
    <div ref={ref} className={cx('relative w-full', className)}>
      {ancho > 0 && hayDatos ? (
        <>
          <svg
            width={ancho}
            height={alto}
            viewBox={`0 0 ${ancho} ${alto}`}
            className="touch-pan-y select-none"
            onPointerDown={alMover}
            onPointerMove={(e) => {
              if (e.buttons > 0 || e.pointerType === 'touch') alMover(e)
            }}
            onPointerLeave={() => setActivo(null)}
            role="img"
            aria-label={`Grafica con ${n} puntos`}
          >
            {/* Rejilla y eje Y izquierdo */}
            {dominio.izq?.ticks.map((t) => (
              <g key={`izq-${t}`}>
                <line
                  x1={MARGENES.izquierda}
                  x2={ancho - MARGENES.derecha}
                  y1={yIzq(t)}
                  y2={yIzq(t)}
                  className="stroke-borde"
                  strokeWidth={1}
                  strokeDasharray={t === 0 ? '0' : '3 3'}
                />
                <text
                  x={MARGENES.izquierda - 6}
                  y={yIzq(t) + 3.5}
                  textAnchor="end"
                  className="fill-texto-suave text-[10px]"
                >
                  {formatoY(t)}
                </text>
              </g>
            ))}

            {/* Eje Y derecho, solo si hay serie con eje propio */}
            {dominio.der?.ticks.map((t) => (
              <text
                key={`der-${t}`}
                x={ancho - 2}
                y={yDer(t) + 3.5}
                textAnchor="end"
                className="fill-texto-suave text-[10px]"
              >
                {formatoY(t)}
              </text>
            ))}

            {/* Etiquetas del eje X, reducidas si hay muchos puntos */}
            {etiquetas.map((et, i) => {
              const salto = Math.ceil(n / (ancho < 380 ? 4 : ancho < 600 ? 6 : 10))
              if (i % salto !== 0 && i !== n - 1) return null
              return (
                <text
                  key={`x-${et}-${i}`}
                  x={x(i)}
                  y={alto - 6}
                  textAnchor="middle"
                  className="fill-texto-suave text-[10px]"
                >
                  {et}
                </text>
              )
            })}

            {/* Bandas min-max */}
            {series.map((s) =>
              s.banda ? (
                <path
                  key={`banda-${s.clave}`}
                  d={construirBanda(s, n, x, s.eje === 'derecho' ? yDer : yIzq)}
                  fill={s.color}
                  opacity={0.13}
                />
              ) : null,
            )}

            {/* Lineas de referencia */}
            {referencias.map((r) => {
              const y = r.eje === 'derecho' ? yDer(r.valor) : yIzq(r.valor)
              if (!Number.isFinite(y)) return null
              return (
                <g key={r.etiqueta}>
                  <line
                    x1={MARGENES.izquierda}
                    x2={ancho - MARGENES.derecha}
                    y1={y}
                    y2={y}
                    stroke={r.color ?? 'currentColor'}
                    strokeWidth={1.2}
                    strokeDasharray="5 4"
                    className="text-texto-suave"
                    opacity={0.8}
                  />
                  <text
                    x={MARGENES.izquierda + 3}
                    y={y - 3}
                    className="fill-texto-suave text-[9px]"
                    opacity={0.9}
                  >
                    {r.etiqueta}
                  </text>
                </g>
              )
            })}

            {/* Series */}
            {series.map((s) => {
              const y = s.eje === 'derecho' ? yDer : yIzq
              return (
                <g key={s.clave}>
                  <path
                    d={construirLinea(s.valores, n, x, y)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Puntos: radio grande al estar activo, pequeno en reposo. */}
                  {s.valores.map((v, i) =>
                    v === null ? null : (
                      <circle
                        key={i}
                        cx={x(i)}
                        cy={y(v)}
                        r={activo === i ? 5 : 2.8}
                        fill={s.color}
                        stroke="var(--color-superficie)"
                        strokeWidth={activo === i ? 2 : 0}
                      />
                    ),
                  )}
                </g>
              )
            })}

            {/* Cursor vertical del punto activo */}
            {activo !== null && (
              <line
                x1={x(activo)}
                x2={x(activo)}
                y1={MARGENES.arriba}
                y2={MARGENES.arriba + altoTrama}
                className="stroke-texto-suave"
                strokeWidth={1}
                strokeDasharray="2 2"
                opacity={0.5}
              />
            )}
          </svg>

          {/* Tooltip. En movil se ancla abajo para no salirse de la pantalla. */}
          {activo !== null && (
            <div
              className="pointer-events-none absolute z-10 min-w-max rounded-xl border border-borde bg-superficie px-2.5 py-2 text-xs shadow-lg"
              style={
                ancho < 420
                  ? { left: 8, right: 8, bottom: 8 }
                  : {
                      left: Math.min(Math.max(x(activo) - 70, 0), Math.max(ancho - 150, 0)),
                      top: MARGENES.arriba,
                    }
              }
            >
              <p className="mb-1 font-semibold text-texto">{etiquetas[activo]}</p>
              {series.map((s) => {
                const v = s.valores[activo]
                return (
                  <p key={s.clave} className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="size-2 rounded-full" style={{ background: s.color }} />
                    <span className="text-texto-suave">{s.etiqueta}:</span>
                    <span className="font-medium tabular-nums text-texto">
                      {v === null || v === undefined ? 'sin dato' : (s.formato ?? ((n) => String(n)))(v)}
                    </span>
                  </p>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <div
          className="flex items-center justify-center rounded-xl bg-superficie-3/50 text-sm text-texto-suave"
          style={{ height: alto }}
        >
          {ancho === 0 ? '' : vacio}
        </div>
      )}
    </div>
  )
}

/**
 * Construye el path de una linea saltando los valores nulos.
 * Los huecos no se conectan: unir un dia sin registro con el siguiente daria
 * una pendiente que no existe en los datos.
 */
function construirLinea(
  valores: (number | null)[],
  n: number,
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  const partes: string[] = []
  let abierto = false
  for (let i = 0; i < n; i++) {
    const v = valores[i]
    if (v === null || v === undefined || Number.isNaN(v)) {
      abierto = false
      continue
    }
    partes.push(`${abierto ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
    abierto = true
  }
  return partes.join(' ')
}

/** Construye el path del area entre dos series (banda min-max). */
function construirBanda(
  s: SerieLinea,
  n: number,
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  if (!s.banda) return ''
  const arriba: string[] = []
  const abajo: string[] = []
  for (let i = 0; i < n; i++) {
    const mx = s.banda.max[i]
    if (mx === null || mx === undefined) continue
    arriba.push(`${arriba.length ? 'L' : 'M'}${x(i).toFixed(1)} ${y(mx).toFixed(1)}`)
  }
  for (let i = n - 1; i >= 0; i--) {
    const mn = s.banda.min[i]
    if (mn === null || mn === undefined) continue
    abajo.push(`L${x(i).toFixed(1)} ${y(mn).toFixed(1)}`)
  }
  return [...arriba, ...abajo, 'Z'].join(' ')
}

// ---------------------------------------------------------------------------
// Grafica de barras
// ---------------------------------------------------------------------------

export function GraficaBarras({
  barras,
  alto = 200,
  objetivo,
  etiquetaObjetivo = '',
  formatoValor = (v) => String(Math.round(v)),
  vacio = 'Sin datos para mostrar',
  className,
}: {
  barras: { etiqueta: string; valor: number; clave: string }[]
  alto?: number
  /** Linea horizontal de objetivo (por ejemplo, minimo diario de orina). */
  objetivo?: number
  etiquetaObjetivo?: string
  formatoValor?: (v: number) => string
  vacio?: string
  className?: string
}) {
  const [ref, ancho] = useAncho<HTMLDivElement>()
  const [activo, setActivo] = useState<string | null>(null)

  const dominio = useMemo(() => {
    const vals = barras.map((b) => b.valor)
    if (objetivo !== undefined) vals.push(objetivo)
    if (!vals.length || vals.every((v) => v === 0)) return null
    return dominioBonito(0, Math.max(...vals))
  }, [barras, objetivo])

  const anchoTrama = Math.max(0, ancho - MARGENES.izquierda - MARGENES.derecha)
  const altoTrama = alto - MARGENES.arriba - MARGENES.abajo

  const anchoTramaBarra = barras.length ? anchoTrama / barras.length : 0
  // La barra ocupa la mitad del hueco, con un minimo para que siga siendo
  // visible en periodos largos.
  const anchoBarra = Math.max(3, Math.min(anchoTramaBarra * 0.55, 56))
  const y = (v: number) =>
    dominio
      ? MARGENES.arriba + altoTrama - (v / (dominio.max || 1)) * altoTrama
      : 0

  const hayDatos = dominio !== null && barras.some((b) => b.valor > 0)

  return (
    <div ref={ref} className={cx('relative w-full', className)}>
      {ancho > 0 && hayDatos && dominio ? (
        <>
          <svg width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={`Barras: ${barras.length}`}>
            {dominio.ticks.map((t) => (
              <g key={t}>
                <line
                  x1={MARGENES.izquierda}
                  x2={ancho - MARGENES.derecha}
                  y1={y(t)}
                  y2={y(t)}
                  className="stroke-borde"
                  strokeWidth={1}
                  strokeDasharray={t === 0 ? '0' : '3 3'}
                />
                <text
                  x={MARGENES.izquierda - 6}
                  y={y(t) + 3.5}
                  textAnchor="end"
                  className="fill-texto-suave text-[10px]"
                >
                  {t >= 1000 ? `${Math.round(t / 100) / 10}k` : t}
                </text>
              </g>
            ))}

            {barras.map((b, i) => {
              const cxBarra = MARGENES.izquierda + i * anchoTramaBarra + anchoTramaBarra / 2
              const alturaBarra = Math.max(0, altoTrama - (y(b.valor) - MARGENES.arriba))
              const bajoObjetivo = objetivo !== undefined && b.valor < objetivo
              return (
                <g key={b.clave}>
                  <rect
                    x={cxBarra - anchoBarra / 2}
                    y={y(b.valor)}
                    width={anchoBarra}
                    height={alturaBarra}
                    rx={Math.min(4, anchoBarra / 2)}
                    fill={bajoObjetivo ? 'var(--color-aviso)' : 'var(--color-marca)'}
                    opacity={activo === b.clave ? 1 : 0.85}
                  />
                  {/* Zona de toque ampliada: el ancho real de la barra es
                      demasiado pequeño para el dedo. */}
                  <rect
                    x={MARGENES.izquierda + i * anchoTramaBarra}
                    y={MARGENES.arriba}
                    width={anchoTramaBarra}
                    height={altoTrama}
                    fill="transparent"
                    onPointerEnter={() => setActivo(b.clave)}
                    onPointerDown={() => setActivo(b.clave)}
                    onPointerLeave={() => setActivo(null)}
                  />
                </g>
              )
            })}

            {objetivo !== undefined && objetivo <= dominio.max && (
              <g>
                <line
                  x1={MARGENES.izquierda}
                  x2={ancho - MARGENES.derecha}
                  y1={y(objetivo)}
                  y2={y(objetivo)}
                  stroke="var(--color-alerta)"
                  strokeWidth={1.4}
                  strokeDasharray="5 4"
                  opacity={0.7}
                />
                {etiquetaObjetivo && (
                  <text
                    x={ancho - MARGENES.derecha}
                    y={y(objetivo) - 4}
                    textAnchor="end"
                    className="fill-alerta text-[9px] font-medium"
                  >
                    {etiquetaObjetivo}
                  </text>
                )}
              </g>
            )}

            {barras.map((b, i) => {
              const salto = Math.ceil(barras.length / (ancho < 380 ? 4 : ancho < 600 ? 7 : 12))
              if (i % salto !== 0 && i !== barras.length - 1) return null
              return (
                <text
                  key={`x-${b.clave}`}
                  x={MARGENES.izquierda + i * anchoTramaBarra + anchoTramaBarra / 2}
                  y={alto - 6}
                  textAnchor="middle"
                  className="fill-texto-suave text-[10px]"
                >
                  {b.etiqueta}
                </text>
              )
            })}
          </svg>

          {activo && (
            <div
              className="pointer-events-none absolute z-10 min-w-max rounded-xl border border-borde bg-superficie px-2.5 py-1.5 text-xs shadow-lg"
              style={{ left: 8, top: 4 }}
            >
              <span className="font-semibold text-texto">
                {barras.find((b) => b.clave === activo)?.etiqueta}:{' '}
              </span>
              <span className="tabular-nums text-texto">
                {formatoValor(barras.find((b) => b.clave === activo)?.valor ?? 0)}
              </span>
            </div>
          )}
        </>
      ) : (
        <div
          className="flex items-center justify-center rounded-xl bg-superficie-3/50 text-sm text-texto-suave"
          style={{ height: alto }}
        >
          {ancho === 0 ? '' : vacio}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Leyenda
// ---------------------------------------------------------------------------

export function Leyenda({ items }: { items: { etiqueta: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((i) => (
        <li key={i.etiqueta} className="flex items-center gap-1.5 text-xs text-texto-suave">
          <span className="size-2.5 rounded-full" style={{ background: i.color }} />
          {i.etiqueta}
        </li>
      ))}
    </ul>
  )
}
