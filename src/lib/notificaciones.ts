/**
 * Recordatorios mediante la API de notificaciones del navegador.
 *
 * Limitaciones asumidas:
 *  - Los recordatorios solo se ejecutan mientras la pestana esta abierta: sin un
 *    service worker con push no hay forma de despertar la app en segundo plano.
 *    Por eso el aviso tambien aparece dentro de la propia interfaz.
 *  - Se respetan las horas de silencio configuradas por el cuidador.
 */

import type { Recordatorio } from '../lib/tipos'

/** ¿La API de notificaciones esta disponible y permitida? */
export function notificacionesDisponibles(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

/** Estado actual del permiso: 'default' | 'granted' | 'denied'. */
export function permisoActual(): NotificationPermission | 'no-soportado' {
  return notificacionesDisponibles() ? Notification.permission : 'no-soportado'
}

/** Solicita permiso al usuario. Devuelve el permiso resultante. */
export async function pedirPermiso(): Promise<NotificationPermission | 'no-soportado'> {
  if (!notificacionesDisponibles()) return 'no-soportado'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

/** Muestra una notificacion del sistema, si hay permiso. */
export function notificar(titulo: string, cuerpo: string, tag?: string): void {
  if (permisoActual() !== 'granted') return
  try {
    new Notification(titulo, {
      body: cuerpo,
      // El `tag` agrupa y reemplaza notificaciones identicas en lugar de
      // apilar veinte avisos si el intervalo es corto.
      tag,
      icon: '/icono-192.png',
      badge: '/icono-192.png',
    })
  } catch {
    // En algunos navegadores la constructor falla sin interaccion previa; el
    // aviso dentro de la app sigue funcionando, asi que se ignora el error.
  }
}

/** ¿Esta el momento dentro de las horas de silencio configuradas? */
export function enSilencio(r: Recordatorio, ahora = new Date()): boolean {
  if (!r.inicioSilencio || !r.finSilencio) return false
  const min = ahora.getHours() * 60 + ahora.getMinutes()
  const { inicioSilencio: desde, finSilencio: hasta } = r
  // El intervalo de silencio puede cruzar medianoche (p. ej. 22:00 a 07:00),
  // en cuyo caso la comprobacion tiene dos tramos.
  return desde <= hasta ? min >= desde && min < hasta : min >= desde || min < hasta
}

/**
 * Comprueba si toca avisar y lanza la notificacion.
 * Devuelve `true` si se ha enviado un recordatorio.
 */
export function comprobarRecordatorio(
  r: Recordatorio,
  ultimaMedicionISO: string | null,
  ahora = new Date(),
): boolean {
  if (!r.notificar || !r.intervaloMin) return false
  if (permisoActual() !== 'granted') return false
  if (enSilencio(r, ahora)) return false

  if (!ultimaMedicionISO) {
    notificar(
      'Registra una medicion',
      'Todavia no hay mediciones registradas.',
      'recordatorio',
    )
    return true
  }

  const transcurrido = (ahora.getTime() - new Date(ultimaMedicionISO).getTime()) / 60_000
  if (transcurrido >= r.intervaloMin) {
    const horas = Math.floor(r.intervaloMin / 60)
    const periodo = horas >= 1 ? `cada ${horas} h` : `cada ${r.intervaloMin} min`
    notificar(
      'Hora de registrar',
      `Ha pasado ${periodo} desde la ultima medicion.`,
      'recordatorio',
    )
    return true
  }

  return false
}

/** Texto legible del intervalo configurado. */
export function describirIntervalo(min: number): string {
  if (!min) return 'Desactivado'
  if (min < 60) return `Cada ${min} minutos`
  const h = min / 60
  return h === 1 ? 'Cada hora' : `Cada ${h} horas`
}

/** Convierte minutos desde medianoche en "HH:MM" (para el formulario). */
export function minutosAHora(min: number): string {
  const m = ((min % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Convierte "HH:MM" en minutos desde medianoche. */
export function horaAMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}