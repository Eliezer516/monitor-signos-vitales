/**
 * Avisos efimeros (toasts).
 *
 * El cuidador necesita confirmacion de "guardado" sin leer, y confirmar
 * acciones destructivas. Se montan sobre el contenido con `aria-live` para que
 * un lector de pantalla los anuncie.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { cx } from './UI'
import { IconoAlerta, IconoCheck } from './Iconos'

export type TipoAviso = 'exito' | 'error' | 'info'

interface Aviso {
  id: number
  tipo: TipoAviso
  texto: string
}

interface ValorAvisos {
  aviso: (texto: string, tipo?: TipoAviso) => void
}

const ContextoAvisos = createContext<ValorAvisos | null>(null)

let contador = 0

export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([])

  const aviso = useCallback((texto: string, tipo: TipoAviso = 'exito') => {
    const id = ++contador
    setAvisos((prev) => [...prev, { id, texto, tipo }])
    setTimeout(() => {
      setAvisos((prev) => prev.filter((a) => a.id !== id))
    }, tipo === 'error' ? 5000 : 2600)
  }, [])

  const valor = useMemo(() => ({ aviso }), [aviso])

  return (
    <ContextoAvisos.Provider value={valor}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4 no-imprimir"
      >
        {avisos.map((a) => (
          <div
            key={a.id}
            className={cx(
              'pointer-events-auto flex max-w-sm items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium shadow-lg',
              'animate-in slide-in-from-top-2',
              a.tipo === 'exito' && 'bg-ok text-white',
              a.tipo === 'error' && 'bg-alerta text-white',
              a.tipo === 'info' && 'bg-superficie text-texto border border-borde',
            )}
          >
            {a.tipo === 'exito' ? <IconoCheck width={18} height={18} /> : null}
            {a.tipo === 'error' ? <IconoAlerta width={18} height={18} /> : null}
            <span>{a.texto}</span>
          </div>
        ))}
      </div>
    </ContextoAvisos.Provider>
  )
}

export function useAvisos(): ValorAvisos {
  const valor = useContext(ContextoAvisos)
  if (!valor) throw new Error('useAvisos debe usarse dentro de <ProveedorAvisos>')
  return valor
}