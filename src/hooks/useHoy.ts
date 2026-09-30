/**
 * Devuelve la fecha local de hoy como `YYYY-MM-DD`.
 *
 * No se usa `new Date().toISOString().slice(0, 10)` a pelo: `toISOString()`
 * convierte a UTC, asi que cerca de medianoche devolveria el dia equivocado
 * (en Espana, entre las 00:00 y las 02:00, "hoy" seria ayer).
 *
 * Ademas, la app suele quedarse abierta many horas como PWA. El valor se
 * recalcula cuando la pestana vuelve a primer plano, de forma que si el
 * dispositivo pasa la noche en la mesa de noche la pantalla de inicio pase a
 * mostrar el dia nuevo sin necesidad de recargar.
 */

import { useEffect, useState } from 'react'
import { claveDia } from '../lib/fechas'

export function useHoy(): string {
  const [hoy, setHoy] = useState(() => claveDia(new Date()))

  useEffect(() => {
    const alVolver = () => {
      const actual = claveDia(new Date())
      // Solo se actualiza si el dia cambio, para no renderizar en cada cambio
      // de pestana.
      setHoy((prev) => (prev === actual ? prev : actual))
    }

    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', alVolver)
    return () => {
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('focus', alVolver)
    }
  }, [])

  return hoy
}