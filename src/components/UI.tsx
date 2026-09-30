/**
 * Componentes de interfaz reutilizables.
 *
 * Criterios de diseno aplicados:
 *  - Objetivo tactil minimo de 44x44 px (recomendacion de accesibilidad y uso
 *    con manos temblorosas, habitual en cuidadores mayores).
 *  - Tipografia de 16 px o mas en los campos para que iOS no aplique zoom.
 *  - Los estados de foco y deshabilitado son visibles, no solo de color.
 */

import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { IconoCerrar } from './Iconos'

/** Une clases ignorando valores falsy. Sustituye a `clsx` para no anadir dependencia. */
export function cx(...partes: (string | false | null | undefined)[]): string {
  return partes.filter(Boolean).join(' ')
}

// ---------------------------------------------------------------------------
// Boton
// ---------------------------------------------------------------------------

interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: 'primario' | 'secundario' | 'fantasma' | 'peligro'
  tamano?: 'sm' | 'md' | 'lg'
  /** Ocupa todo el ancho disponible (util en la vista movil). */
  ancho?: boolean
  icono?: ReactNode
}

const VARIANTES = {
  primario: 'bg-marca text-white hover:opacity-90 active:opacity-80 shadow-sm',
  secundario:
    'bg-superficie text-texto border border-borde hover:bg-superficie-3 active:bg-superficie-3',
  fantasma: 'text-texto-suave hover:bg-superficie-3 active:bg-superficie-3',
  peligro: 'bg-alerta-suave text-alerta border border-alerta/30 hover:bg-alerta/10',
}

const TAMANOS = {
  sm: 'min-h-9 px-3 text-sm gap-1.5',
  md: 'min-h-11 px-4 text-[0.95rem] gap-2',
  lg: 'min-h-14 px-5 text-base gap-2.5',
}

export function Boton({
  variante = 'primario',
  tamano = 'md',
  ancho,
  icono,
  className,
  children,
  ...props
}: BotonProps) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center rounded-xl font-medium transition',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTES[variante],
        TAMANOS[tamano],
        ancho && 'w-full',
        className,
      )}
      {...props}
    >
      {icono}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Campos de formulario
// ---------------------------------------------------------------------------

interface CampoProps {
  etiqueta: string
  /** Texto de ayuda bajo el campo. */
  ayuda?: string
  /** Mensaje de error; replaces ayuda mientras exista. */
  error?: string
  /** Mensaje de aviso no bloqueante (valor fuera del rango normal). */
  aviso?: string
  requerido?: boolean
  className?: string
  children: ReactNode
}

export function Campo({ etiqueta, ayuda, error, aviso, requerido, className, children }: CampoProps) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 flex items-baseline gap-1.5">
        <span className="text-sm font-medium text-texto">{etiqueta}</span>
        {requerido && (
          <span className="text-[0.7rem] font-medium text-alerta" aria-hidden>
            *
          </span>
        )}
        {ayuda && !error && <span className="ml-auto text-xs text-texto-suave">{ayuda}</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-xs font-medium text-alerta">{error}</span>}
      {!error && aviso && <span className="mt-1 block text-xs font-medium text-aviso">{aviso}</span>}
    </label>
  )
}

const estiloEntrada =
  'w-full min-h-11 rounded-xl border border-borde bg-superficie px-3 text-texto ' +
  'placeholder:text-texto-suave/70 focus:border-marca focus:outline-none focus:ring-2 focus:ring-marca/25 ' +
  'disabled:opacity-60'

export function Entrada({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(estiloEntrada, className)} {...props} />
}

export function AreaTexto({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(estiloEntrada, 'py-2.5 min-h-20 resize-y', className)} {...props} />
}

export function Selector({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(estiloEntrada, 'appearance-none pr-9', className)} {...props}>
      {children}
    </select>
  )
}

/**
 * Campo numerico con teclado movil adecuado.
 * `inputMode="numeric"` muestra el teclado numerico sin los signos +/-, que no
 * tienen sentido en estos datos, y `inputMode="decimal"` permite decimales en
 * los promedios de resumen.
 */
interface CampoNumeroProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  unidad?: string
}

export function CampoNumero({ unidad, className, ...props }: CampoNumeroProps) {
  return (
    <div className="relative">
      <input
        type="number"
        inputMode="decimal"
        className={cx(estiloEntrada, 'pr-14 text-lg font-semibold tabular-nums', className)}
        {...props}
      />
      {unidad && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-texto-suave">
          {unidad}
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tarjeta, insignia, indicador
// ---------------------------------------------------------------------------

export function Tarjeta({
  className,
  children,
  ...props
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('tarjeta p-4', className)} {...props}>
      {children}
    </div>
  )
}

/** Etiqueta pequena de estado. */
export function Insignia({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        className ?? 'bg-superficie-3 text-texto-suave',
      )}
    >
      {children}
    </span>
  )
}

/** Punto de color que representa el estado de un valor. */
export function PuntoEstado({ className }: { className: string }) {
  return <span className={cx('inline-block size-2 rounded-full', className)} />
}

// ---------------------------------------------------------------------------
// Segmentado (selector de periodo / tema)
// ---------------------------------------------------------------------------

interface SegmentadoProps<T extends string> {
  valor: T
  opciones: { valor: T; etiqueta: string }[]
  onChange: (v: T) => void
  className?: string
}

export function Segmentado<T extends string>({ valor, opciones, onChange, className }: SegmentadoProps<T>) {
  return (
    <div
      role="tablist"
      className={cx('inline-flex rounded-xl bg-superficie-3 p-1', className)}
    >
      {opciones.map((o) => (
        <button
          key={o.valor}
          role="tab"
          aria-selected={valor === o.valor}
          onClick={() => onChange(o.valor)}
          className={cx(
            'min-h-9 flex-1 rounded-lg px-3 text-sm font-medium transition',
            valor === o.valor
              ? 'bg-superficie text-texto shadow-sm'
              : 'text-texto-suave hover:text-texto',
          )}
        >
          {o.etiqueta}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Interruptor
// ---------------------------------------------------------------------------

export function Interruptor({
  activo,
  onChange,
  etiqueta,
  descripcion,
  disabled,
}: {
  activo: boolean
  onChange: (v: boolean) => void
  etiqueta: string
  descripcion?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      disabled={disabled}
      onClick={() => onChange(!activo)}
      className={cx(
        'flex w-full items-center gap-3 rounded-xl py-2 text-left disabled:opacity-50',
        'disabled:cursor-not-allowed',
      )}
    >
      <span
        className={cx(
          'relative h-6 w-11 shrink-0 rounded-full transition',
          activo ? 'bg-marca' : 'bg-borde',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
            activo ? 'left-[1.375rem]' : 'left-0.5',
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-texto">{etiqueta}</span>
        {descripcion && <span className="block text-xs text-texto-suave">{descripcion}</span>}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Modal / hoja inferior
// ---------------------------------------------------------------------------

interface ModalProps {
  abierto: boolean
  onCerrar: () => void
  titulo: string
  children: ReactNode
  /** Ancho maximo en movil; por defecto ocupa casi toda la pantalla. */
  ancho?: 'sm' | 'md' | 'lg'
}

const ANCHOS = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-3xl' }

/**
 * Dialogo que en movil aparece como hoja inferior y en escritorio como modal
 * centrado. Se cierra con Escape y con el fondo, y bloquea el scroll de fondo.
 */
export function Modal({ abierto, onCerrar, titulo, children, ancho = 'md' }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar()
    }
    document.addEventListener('keydown', alPulsar)
    const overflowAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // El foco pasa al dialogo para que la navegacion por teclado empiece dentro.
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', alPulsar)
      document.body.style.overflow = overflowAnterior
    }
  }, [abierto, onCerrar])

  if (!abierto) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onCerrar}
        aria-hidden
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        tabIndex={-1}
        className={cx(
          'tarjeta relative flex max-h-[90vh] w-full flex-col rounded-b-none sm:rounded-2xl',
          ANCHOS[ancho],
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-borde p-4">
          <h2 className="text-base font-semibold text-texto">{titulo}</h2>
          <button
            onClick={onCerrar}
            aria-label="Cerrar"
            className="-mr-1 grid size-11 place-items-center rounded-xl text-texto-suave hover:bg-superficie-3"
          >
            <IconoCerrar />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Estados vacios y de carga
// ---------------------------------------------------------------------------

export function Vacio({
  icono,
  titulo,
  descripcion,
  accion,
}: {
  icono?: ReactNode
  titulo: string
  descripcion?: string
  accion?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      {icono && <div className="mb-1 text-texto-suave/60">{icono}</div>}
      <p className="font-medium text-texto">{titulo}</p>
      {descripcion && <p className="max-w-xs text-sm text-texto-suave">{descripcion}</p>}
      {accion && <div className="mt-3">{accion}</div>}
    </div>
  )
}

/** Esqueleto de carga con animacion suave. */
export function Esqueleto({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-superficie-3', className)} />
}