/**
 * Datos de ejemplo.
 *
 * Sirven para dos cosas: que la app no abra en blanco la primera vez (sin
 * registros no se puede ver una gráfica ni entender la interfaz) y para poder
 * probar y depurar sin teclear 200 mediciones a mano.
 *
 * Se ofrecen bajo demanda desde Ajustes ("Cargar datos de ejemplo"), nunca de
 * forma automatica: mezclarlos por sorpresa con los datos de un paciente real
 * seria peligroso. Para deshacerlos esta el "Borrar todos los datos".
 *
 * Los valores se derivan de los mismos umbrales que usa la app, de forma que
 * aparezcan estados "ok", "aviso" y "alerta" a la vez y las gráficas tengan una
 * forma reconocible.
 */

import type { Registro, Visita } from './tipos'
import { claveDia, sumarDias } from './fechas'
import { nuevoId } from './db'

/**
 * Construye 3 dias de mediciones: 4 tomas diarias (8:00, 14:00, 20:00 y una
 * nocturna) con una ligera tendencia y ruido, para que las graficas no salgan
 * planas.
 *
 * El ultimo dia incluye a proposito una desaturacion y una hipotension, para
 * poder comprobar los avisos y las alertas sin esperar a que ocurran de verdad.
 *
 * @param base Fecha de referencia; por defecto hoy.
 */
export function crearRegistrosDemo(base = new Date()): Registro[] {
  const registros: Registro[] = []

  for (let dia = 2; dia >= 0; dia--) {
    const fecha = sumarDias(claveDia(base), -dia)

    for (const [indice, hora] of ['08:00', '14:00', '20:00', '23:30'].entries()) {
      // Deriva suave: la presion sube algo cada dia y la frecuencia baja.
      const tendencia = (2 - dia) * 2
      const ruido = Math.sin(indice + dia) * 3

      const esHoy = dia === 0
      // Solo el dia de hoy lleva un episodio, y no en la primera toma, para
      // que el caregiver vea primero la app "normal".
      const conEpisodio = esHoy && indice >= 2

      const presionSis = conEpisodio ? 88 + ruido : 124 + tendencia + ruido
      const presionDia = conEpisodio ? 56 + ruido : 78 + tendencia * 0.6 + ruido
      const o2 = conEpisodio ? 89 : 97 - Math.abs(ruido) * 0.3
      const bpm = 68 + tendencia * 1.5 + ruido

      registros.push({
        id: nuevoId(),
        fecha,
        hora,
        presionSis: Math.round(presionSis),
        presionDia: Math.round(presionDia),
        o2: Math.round(o2),
        bpm: Math.round(bpm),
        notas:
          conEpisodio && indice === 2
            ? 'Se moria suena. Reposo 15 min y se repite la medicion.'
            : indice === 0
              ? 'Pastilla de la manana y desayuno.'
              : '',
        createdAt: `${fecha}T${hora}:00`,
      })
    }
  }

  return registros
}

/**
 * Visitas de ejemplo: cuatro a lo largo de seis semanas.
 *
 * Mezcla consultas y visitas a domicilio a proposito, e incluye cambios de
 * tratamiento para que se vea como queda el informe cuando las indicaciones
 * importan mas que los numeros.
 */
export function crearVisitasDemo(base = new Date()): Visita[] {
  const hoy = claveDia(base)
  const hace = (dias: number) => sumarDias(hoy, -dias)

  const visitas: Omit<Visita, 'id' | 'createdAt' | 'ejemplo'>[] = [
    {
      fecha: hace(42),
      hora: '10:15',
      tipo: 'consulta',
      motivo: 'Revision de la tension y de la medicacion',
      profesional: 'Dra. Garcia, Centro de salud',
      indicaciones: 'Continuar furosemida 40 mg por la manana. Anadir amlodipino 5 mg por la noche.',
      notas: 'Analiticas pedidas: urea, creatinina e iones. Revisar en 3 meses.',
    },
    {
      fecha: hace(28),
      hora: '',
      tipo: 'domicilio',
      motivo: 'Caida en la noche',
      profesional: 'Enfermeria del centro',
      indicaciones: 'Levantarse despacio. Revision de la toma de la tablet de la tarde.',
      notas: 'No se roto nada. Dormia mal desde hacia dos dias.',
    },
    {
      fecha: hace(14),
      hora: '09:30',
      tipo: 'consulta',
      motivo: 'Revision de tension baja',
      profesional: 'Dra. Garcia, Centro de salud',
      indicaciones: 'Bajar el amlodipino a 2,5 mg. Medir por la manana y por la tarde.',
      notas: 'La familia comenta mareos al levantarse.',
    },
    {
      fecha: hace(3),
      hora: '17:40',
      tipo: 'domicilio',
      motivo: 'Revision de la medicacion en casa',
      profesional: 'Enfermeria del centro',
      indicaciones: 'Todo correcto. Mantener el amlodipino de 2,5 mg.',
      notas: 'La tension de esta tarde fue 108/68, sin mareos.',
    },
  ]

  return visitas.map((v) => ({
    ...v,
    id: nuevoId(),
    createdAt: `${v.fecha}T${v.hora || '12:00'}:00`,
    ejemplo: true,
  }))
}