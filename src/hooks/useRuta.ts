/**
 * Enrutado por hash.
 *
 * Una app de 5 pestanas no necesita react-router: el hash permite usar los
 * botones atras/adelante del navegador y abrir enlaces directos ("#/historial")
 * sin anadir ~8 kB de libreria al bundle.
 */

import { useCallback, useEffect, useState } from 'react'

/** Rutas de la aplicacion. */
export type Ruta = 'inicio' | 'registrar' | 'historial' | 'graficas' | 'reportes' | 'ajustes'

export const RUTAS: { id: Ruta; etiqueta: string }[] = [
  { id: 'inicio', etiqueta: 'Inicio' },
  { id: 'registrar', etiqueta: 'Registrar' },
  { id: 'historial', etiqueta: 'Historial' },
  { id: 'graficas', etiqueta: 'Graficas' },
  { id: 'reportes', etiqueta: 'Reportes' },
  { id: 'ajustes', etiqueta: 'Ajustes' },
]

const esRuta = (v: string): v is Ruta => RUTAS.some((r) => r.id === v)

/** Lee la ruta del hash actual; si no es valida devuelve 'inicio'. */
export function leerRuta(): Ruta {
  const bruto = window.location.hash.replace(/^#\/?/, '').split('?')[0]
  return esRuta(bruto) ? bruto : 'inicio'
}

/**
 * Navegacion por hash. Mantiene sincronizado el hash con el estado para que
 * el historial del navegador funcione (Atras vuelve a la pestana anterior).
 */
export function useRuta(): [Ruta, (r: Ruta) => void] {
  const [ruta, setRuta] = useState<Ruta>(() => leerRuta())

  useEffect(() => {
    const alCambiar = () => setRuta(leerRuta())
    window.addEventListener('hashchange', alCambiar)
    return () => window.removeEventListener('hashchange', alCambiar)
  }, [])

  const navegar = useCallback((nueva: Ruta) => {
    if (leerRuta() === nueva) return
    window.location.hash = `/${nueva}`
    // En movil la vista debe volver al inicio al cambiar de pestana.
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [])

  return [ruta, navegar]
}