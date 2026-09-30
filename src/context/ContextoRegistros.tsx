/**
 * Contexto de registros: fuente unica de verdad para los datos del paciente.
 *
 * Se usa Context + useReducer en lugar de una libreria de estado porque el
 * arbol de la app es pequeño y asi se evita una dependencia extra en un
 * proyecto sensible al peso del bundle.
 *
 * Los registros viven en memoria durante la sesion y se persisten en cada
 * cambio (IndexedDB con espejo en localStorage).
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
import type { FechaISO, Registro } from '../lib/tipos'
import {
  cargarRegistros,
  esDuplicado,
  guardarRegistros,
  nuevoId,
  ordenar,
} from '../lib/db'
import { claveDia, claveHora } from '../lib/fechas'

/** Acciones del reducer. Cada una produce un nuevo array de registros. */
type Accion =
  | { tipo: 'cargar'; registros: Registro[] }
  | { tipo: 'agregar'; registro: Registro }
  | { tipo: 'actualizar'; registro: Registro }
  | { tipo: 'eliminar'; id: string }
  | { tipo: 'fusionar'; registros: Registro[] }
  | { tipo: 'vaciar' }

function reducer(estado: Registro[], accion: Accion): Registro[] {
  switch (accion.tipo) {
    case 'cargar':
      return ordenar(accion.registros)
    case 'agregar':
      // Un registro identico en la misma fecha/hora es un doble pulsacion del
      // boton Guardar; se ignora en lugar de crear una fila repetida.
      if (esDuplicado(accion.registro, estado)) return estado
      return ordenar([...estado, accion.registro])
    case 'actualizar':
      return ordenar(estado.map((r) => (r.id === accion.registro.id ? accion.registro : r)))
    case 'eliminar':
      return estado.filter((r) => r.id !== accion.id)
    case 'fusionar':
      // Al restaurar un backup se conserva lo existente y se anade lo que falte.
      return ordenar([...estado, ...accion.registros.filter((nuevo) => !estado.some((r) => r.id === nuevo.id))])
    case 'vaciar':
      return []
  }
}

export interface ValorRegistros {
  registros: Registro[]
  cargando: boolean
  /** Crea un registro con id y marcas de tiempo ya puestos. */
  crear: (datos: Omit<Registro, 'id' | 'createdAt'>) => Registro
  agregar: (datos: Omit<Registro, 'id' | 'createdAt'>) => boolean
  actualizar: (registro: Registro) => void
  eliminar: (id: string) => void
  /** Sustituye todos los registros (restauracion de backup). */
  reemplazar: (registros: Registro[]) => void
  /** Añade registros conservando los existentes. */
  fusionar: (registros: Registro[]) => void
  vaciar: () => void
  /** Registros de un dia, ordenados. */
  delDia: (fecha: FechaISO) => Registro[]
}

const ContextoRegistros = createContext<ValorRegistros | null>(null)

export function ProveedorRegistros({ children }: { children: ReactNode }) {
  const [registros, dispatch] = useReducer(reducer, [] as Registro[])
  const [cargando, setCargando] = useState(true)
  // Se evita persistir en el primer render, antes de que IndexedDB responda,
  // para no sobrescribir los datos guardados con un array vacio.
  const listoParaGuardar = useRef(false)

  useEffect(() => {
    let cancelado = false
    void cargarRegistros().then((cargados) => {
      if (cancelado) return
      dispatch({ tipo: 'cargar', registros: cargados })
      setCargando(false)
      listoParaGuardar.current = true
    })
    return () => {
      cancelado = true
    }
  }, [])

  useEffect(() => {
    if (!listoParaGuardar.current) return
    void guardarRegistros(registros)
  }, [registros])

  const crear = useCallback(
    (datos: Omit<Registro, 'id' | 'createdAt'>): Registro => ({
      ...datos,
      id: nuevoId(),
      createdAt: new Date().toISOString(),
    }),
    [],
  )

  const valor = useMemo<ValorRegistros>(
    () => ({
      registros,
      cargando,
      crear,
      agregar: (datos) => {
        const nuevo = crear(datos)
        // Se comprueba el duplicado antes de despachar para poder avisar.
        if (esDuplicado(nuevo, registros)) return false
        dispatch({ tipo: 'agregar', registro: nuevo })
        return true
      },
      actualizar: (registro) => dispatch({ tipo: 'actualizar', registro }),
      eliminar: (id) => dispatch({ tipo: 'eliminar', id }),
      reemplazar: (nuevos) => dispatch({ tipo: 'cargar', registros: nuevos }),
      fusionar: (nuevos) => dispatch({ tipo: 'fusionar', registros: nuevos }),
      vaciar: () => dispatch({ tipo: 'vaciar' }),
      delDia: (fecha) =>
        registros
          .filter((r) => r.fecha === fecha)
          .sort((a, b) => (a.fecha === b.fecha ? a.hora.localeCompare(b.hora) : 0)),
    }),
    [registros, cargando, crear],
  )

  return <ContextoRegistros.Provider value={valor}>{children}</ContextoRegistros.Provider>
}

/** Acceso a los registros. Lanza error si se usa fuera del proveedor. */
export function useRegistros(): ValorRegistros {
  const valor = useContext(ContextoRegistros)
  if (!valor) throw new Error('useRegistros debe usarse dentro de <ProveedorRegistros>')
  return valor
}

/** Valores iniciales del formulario con la fecha y hora actuales. */
export function valoresIniciales(): Pick<Registro, 'fecha' | 'hora'> {
  const ahora = new Date()
  return { fecha: claveDia(ahora), hora: claveHora(ahora) }
}