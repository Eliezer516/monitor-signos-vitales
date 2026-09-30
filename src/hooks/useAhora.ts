/**
 * Reloj para vistas que necesitan el instante actual.
 *
 * Sirve para lo que depende de "ahora": la ventana deslizante de "ultimas 24
 * horas" y los textos tipo "hace 5 minutos". Sin esto, un dashboard abierto
 * toda la tarde seguiria diciendo "hace 1 minuto" a la hora de la cena.
 *
 * Se guarda en `state` y no en una ref para que React pueda repintar de forma
 * predecible; ademas `Date.now()` en el inicializador solo se ejecuta al
 * montar, no en cada render.
 */

import { useEffect, useState } from 'react'

export function useAhora(intervaloMs = 60_000): number {
  const [ahora, setAhora] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), intervaloMs)
    return () => clearInterval(id)
  }, [intervaloMs])

  return ahora
}