/**
 * Contexto de visitas del profesional sanitario.
 *
 * Las visitas se guardan aparte de los registros de signos vitales porque son
 * datos de naturaleza distinta: las mediciones describen el estado entre
 * visitas, y la visita deja constancia de quien le vio, por que y que le
 * indico. Mezclarlas en un unico array haria imposible listar el historial
 * clinico sin filtrar, y el informe medico necesita las dos cosas.
 *
 * Sigue el patron de `ContextoRegistros`: Context + useReducer, carga al
 * montar y persistencia en cada cambio (IndexedDB con espejo en localStorage).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { FechaISO, Visita } from '../lib/tipos'
import { cargarVisitas, guardarVisitas, nuevoId, ordenarVisitas } from '../lib/db'
import { claveDia, claveHora } from '../lib/fechas'

/** Datos que se piden al crear una visita; `id` y `createdAt` los pone el contexto. */
export type DatosVisita = Omit<Visita, 'id' | 'createdAt'>

type Accion =
  | { tipo: 'cargar'; visitas: Visita[] }
  | { tipo: 'agregar'; visita: Visita }
  | { tipo: 'actualizar'; visita: Visita }
  | { tipo: 'eliminar'; id: string }
  | { tipo: 'fusionar'; visitas: Visita[] }
  | { tipo: 'vaciar' }

function reducer(estado: Visita[], accion: Accion): Visita[] {
  switch (accion.tipo) {
    case 'cargar':
      return ordenarVisitas(accion.visitas)
    case 'agregar':
      return ordenarVisitas([...estado, accion.visita])
    case 'actualizar':
      return ordenarVisitas(estado.map((v) => (v.id === accion.visita.id ? accion.visita : v)))
    case 'eliminar':
      return estado.filter((v) => v.id !== accion.id)
    case 'fusionar':
      // Al restaurar un backup se conserva lo existente y se anade lo que falte.
      return ordenarVisitas([
        ...estado,
        ...accion.visitas.filter((nueva) => !estado.some((v) => v.id === nueva.id)),
      ])
    case 'vaciar':
      return []
  }
}

export interface ValorVisitas {
  visitas: Visita[]
  cargando: boolean
  crear: (datos: DatosVisita) => Visita
  agregar: (datos: DatosVisita) => Visita
  actualizar: (visita: Visita) => void
  eliminar: (id: string) => void
  /** Sustituye todas las visitas (uso interno y restauracion completa). */
  reemplazar: (visitas: Visita[]) => void
  /** Anade visitas conservando las existentes. */
  fusionar: (visitas: Visita[]) => void
  vaciar: () => void
  delDia: (fecha: FechaISO) => Visita[]
}

const ContextoVisitas = createContext<ValorVisitas | null>(null)

export function ProveedorVisitas({ children }: { children: ReactNode }) {
  const [visitas, dispatch] = useReducer(reducer, [] as Visita[])
  const [cargando, setCargando] = useState(true)
  // Igual que en registros: sin esto, el primer render persistiria la lista
  // vacia y borraria lo que hubiera guardado.
  const listoParaGuardar = useRef(false)

  useEffect(() => {
    let cancelado = false
    void cargarVisitas().then((cargadas) => {
      if (cancelado) return
      dispatch({ tipo: 'cargar', visitas: cargadas })
      setCargando(false)
      listoParaGuardar.current = true
    })
    return () => {
      cancelado = true
    }
  }, [])

  useEffect(() => {
    if (!listoParaGuardar.current) return
    void guardarVisitas(visitas)
  }, [visitas])

  const crear = useCallback(
    (datos: DatosVisita): Visita => ({
      ...datos,
      id: nuevoId(),
      createdAt: new Date().toISOString(),
    }),
    [],
  )

  const valor = useMemo<ValorVisitas>(
    () => ({
      visitas,
      cargando,
      crear,
      agregar: (datos) => {
        const nueva = crear(datos)
        dispatch({ tipo: 'agregar', visita: nueva })
        return nueva
      },
      actualizar: (visita) => dispatch({ tipo: 'actualizar', visita }),
      eliminar: (id) => dispatch({ tipo: 'eliminar', id }),
      reemplazar: (nuevas) => dispatch({ tipo: 'cargar', visitas: nuevas }),
      fusionar: (nuevas) => dispatch({ tipo: 'fusionar', visitas: nuevas }),
      vaciar: () => dispatch({ tipo: 'vaciar' }),
      delDia: (fecha) =>
        visitas
          .filter((v) => v.fecha === fecha)
          .sort((a, b) => (a.hora ?? '').localeCompare(b.hora ?? '')),
    }),
    [visitas, cargando, crear],
  )

  return <ContextoVisitas.Provider value={valor}>{children}</ContextoVisitas.Provider>
}

/** Acceso a las visitas. Lanza error si se usa fuera del proveedor. */
export function useVisitas(): ValorVisitas {
  const valor = useContext(ContextoVisitas)
  if (!valor) throw new Error('useVisitas debe usarse dentro de <ProveedorVisitas>')
  return valor
}

/**
 * Fecha y hora actuales para rellenar el formulario.
 *
 * Devuelve la hora como cadena aunque en `Visita` sea opcional: la hora real
 * siempre existe, es el guardado el que decide si se conserva.
 */
export function valoresVisitaIniciales(): { fecha: FechaISO; hora: string } {
  const ahora = new Date()
  return { fecha: claveDia(ahora), hora: claveHora(ahora) }
}