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
import type { Borrado, FechaISO, Registro } from '../lib/tipos'
import {
  cargarBorrados,
  cargarRegistros,
  esDuplicado,
  guardarRegistros,
  nuevoId,
  ordenar,
  fusionarBorradosGuardados,
  registrarBorrado,
} from '../lib/db'
import { emparejar, type ResultadoFusion } from '../lib/fusion'
import { claveDia, claveHora } from '../lib/fechas'

/** Acciones del reducer. Cada una produce un nuevo array de registros. */
type Accion =
  | { tipo: 'cargar'; registros: Registro[] }
  | { tipo: 'agregar'; registro: Registro }
  | { tipo: 'actualizar'; registro: Registro }
  | { tipo: 'eliminar'; id: string }
  | { tipo: 'fusionar'; registros: Registro[]; borrados: Borrado[] }
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
      // `id` y `createdAt` los pone el estado, no quien llama: asi ningun
      // formulario puede reescribirlos por descuido al extender el objeto.
      return ordenar(
        estado.map((r) =>
          r.id === accion.registro.id
            ? { ...r, ...accion.registro, id: r.id, createdAt: r.createdAt }
            : r,
        ),
      )
    case 'eliminar':
      return estado.filter((r) => r.id !== accion.id)
    case 'fusionar':
      // Last-write-wins por identificador, en vez de "anadir solo lo que falte".
      // Antes, un backup con un registro editado mas recientemente se ignoraba
      // en silencio si ese id ya existia aqui, y la edicion se perdia.
      return ordenar(
        emparejar(estado, accion.registros, accion.borrados, 'registros').fusionados,
      )
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
  /**
   * Fusiona con last-write-wins. `borrados` es opcional para no obligar a
   * todos los llamadores a conocerlo, y solo lo necesitan los que restauran o
   * sincronizan un paquete completo. Devuelve el recuento de lo que ha cambiado
   * para poder contarselo al usuario, en vez de fusionar en silencio.
   */
  fusionar: (registros: Registro[], borrados?: Borrado[]) => Promise<ResultadoFusion<Registro>>
  /** Marcas de lo borrado en este dispositivo. */
  borrados: Borrado[]
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
  // Las marcas de borrado viven en su propio almacen, no en el estado de la
  // interfaz: asi el reducer sigue devolviendo solo los registros visibles y
  // ninguna grafica ni resumen se entera de que existe este concepto.
  const [marcas, setMarcas] = useState<Borrado[]>([])

  // `fusionar` se llama desde una sincronizacion, que tarda segundos. Si tomara
  // la lista del render en que se creo la funcion, una medicion anotada mientras
  // tanto se perderia de la pantalla al aplicar el resultado. Este ref siempre
  // tiene el estado de este render, que es el que hay que fusionar.
  const registrosActuales = useRef(registros)
  // Se actualiza en un efecto y no durante el render: escribir un ref mientras
  // se renderiza no es seguro si React interrumpe y vuelve a empezar el render.
  useEffect(() => {
    registrosActuales.current = registros
  })

  useEffect(() => {
    let cancelado = false
    void cargarRegistros().then((cargados) => {
      if (cancelado) return
      dispatch({ tipo: 'cargar', registros: cargados })
      setCargando(false)
      listoParaGuardar.current = true
    })
    void cargarBorrados().then((c) => !cancelado && setMarcas(c))
    return () => {
      cancelado = true
    }
  }, [])

  useEffect(() => {
    if (!listoParaGuardar.current) return
    void guardarRegistros(registros)
  }, [registros])

  const crear = useCallback(
    (datos: Omit<Registro, 'id' | 'createdAt' | 'updatedAt'>): Registro => {
      const ahora = new Date().toISOString()
      // `updatedAt` igual a `createdAt` en el alta: si no, un registro recien
      // creado pareceria anterior a si mismo y el otro dispositivo podria
      // pisar su copia con una version vieja de esos mismos datos.
      return { ...datos, id: nuevoId(), createdAt: ahora, updatedAt: ahora }
    },
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
      // La marca se pone aqui y no en el formulario, que solo ve datos: quien
      // llama no puede olvidarse de actualizarla ni dejarla con un valor viejo.
      actualizar: (registro) =>
        dispatch({
          tipo: 'actualizar',
          registro: { ...registro, updatedAt: new Date().toISOString() },
        }),
      eliminar: (id) => {
        dispatch({ tipo: 'eliminar', id })
        // Sin esta marca, el registro volveria a aparecer al sincronizar desde
        // el otro dispositivo, que sigue teniendolo.
        void registrarBorrado('registros', id).then(setMarcas)
      },
      reemplazar: (nuevos) => dispatch({ tipo: 'cargar', registros: nuevos }),
      fusionar: async (nuevos, borrados) => {
        // La union de marcas se lee y se escribe en `db`: si se hiciera contra
        // la copia en memoria, las marcas que acabe de traer el otro
        // dispositivo se perderian al siguiente borrado de cualquier ambito.
const unidas = await fusionarBorradosGuardados(borrados ?? [])
        // Del ref, no del cierre: ver la nota de `registrosActuales`.
        const resultado = emparejar(registrosActuales.current, nuevos, unidas, 'registros')
        setMarcas(unidas)
        dispatch({ tipo: 'fusionar', registros: nuevos, borrados: unidas })
        return resultado
      },
      borrados: marcas,
      vaciar: () => dispatch({ tipo: 'vaciar' }),
      delDia: (fecha) =>
        registros
          .filter((r) => r.fecha === fecha)
          .sort((a, b) => (a.fecha === b.fecha ? a.hora.localeCompare(b.hora) : 0)),
    }),
    [registros, cargando, crear, marcas],
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