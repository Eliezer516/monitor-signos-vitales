/**
 * Contexto de sondas: los vaciados de la bolsa.
 *
 * Viven aparte de los registros de signos vitales porque son datos de naturaleza
 * distinta: la sonda se vacia cuando toca, no cuando se mide la tension. Si
 * fueran un campo mas del registro, cada medicion obligaria a inventarse un
 * volumen o a dejar la medicion a medias.
 *
 * Sigue el patron de `ContextoVisitas`: Context + useReducer, carga al montar y
 * persistencia en cada cambio (IndexedDB con espejo en localStorage).
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
import type { Borrado, FechaISO, Sonda } from '../lib/tipos'
import {
  cargarBorrados,
  cargarSondas,
  guardarSondas,
  nuevoId,
  ordenarSondas,
  fusionarBorradosGuardados,
  registrarBorrado,
} from '../lib/db'
import { emparejar, type ResultadoFusion } from '../lib/fusion'
import { claveDia, claveHora } from '../lib/fechas'

/** Datos que se piden al crear una sonda; las marcas de tiempo las pone el contexto. */
export type DatosSonda = Omit<Sonda, 'id' | 'createdAt' | 'updatedAt'>

type Accion =
  | { tipo: 'cargar'; sondas: Sonda[] }
  | { tipo: 'agregar'; sonda: Sonda }
  | { tipo: 'actualizar'; sonda: Sonda }
  | { tipo: 'eliminar'; id: string }
  | { tipo: 'fusionar'; sondas: Sonda[]; borrados: Borrado[] }
  | { tipo: 'vaciar' }

function reducer(estado: Sonda[], accion: Accion): Sonda[] {
  switch (accion.tipo) {
    case 'cargar':
      return ordenarSondas(accion.sondas)
    case 'agregar':
      return ordenarSondas([...estado, accion.sonda])
    case 'actualizar':
      // `id` y `createdAt` los pone el estado, no quien llama: asi ningun
      // formulario puede reescribirlos por descuido al extender el objeto.
      return ordenarSondas(
        estado.map((s) =>
          s.id === accion.sonda.id
            ? { ...s, ...accion.sonda, id: s.id, createdAt: s.createdAt }
            : s,
        ),
      )
    case 'eliminar':
      return estado.filter((s) => s.id !== accion.id)
    case 'fusionar':
      // Last-write-wins por identificador, no "anadir solo lo que falte".
      return ordenarSondas(emparejar(estado, accion.sondas, accion.borrados, 'sondas').fusionados)
    case 'vaciar':
      return []
  }
}

export interface ValorSondas {
  sondas: Sonda[]
  cargando: boolean
  crear: (datos: DatosSonda) => Sonda
  agregar: (datos: DatosSonda) => Sonda
  actualizar: (sonda: Sonda) => void
  eliminar: (id: string) => void
  /** Sustituye todas las sondas (restauracion de backup). */
  reemplazar: (sondas: Sonda[]) => void
  /** Fusiona con last-write-wins; `borrados` es opcional. */
  fusionar: (sondas: Sonda[], borrados?: Borrado[]) => Promise<ResultadoFusion<Sonda>>
  /** Marcas de lo borrado en este dispositivo. */
  borrados: Borrado[]
  vaciar: () => void
  delDia: (fecha: FechaISO) => Sonda[]
}

const ContextoSondas = createContext<ValorSondas | null>(null)

export function ProveedorSondas({ children }: { children: ReactNode }) {
  const [sondas, dispatch] = useReducer(reducer, [] as Sonda[])
  const [cargando, setCargando] = useState(true)
  // Igual que en registros: sin esto, el primer render persistiria la lista
  // vacia y borraria lo que hubiera guardado.
  const listoParaGuardar = useRef(false)
  // Las marcas viven en su propio almacen para no alterar el estado visible.
  const [marcas, setMarcas] = useState<Borrado[]>([])

  // Ver la nota de `ContextoRegistros`: una sincronizacion tarda segundos, y sin
  // esto un vaciado anadido mientras tanto desapareceria al aplicar el resultado.
  const sondasActuales = useRef(sondas)
  // En un efecto y no durante el render: ver la nota de `ContextoRegistros`.
  useEffect(() => {
    sondasActuales.current = sondas
  })

  useEffect(() => {
    let cancelado = false
    void cargarSondas().then((cargadas) => {
      if (cancelado) return
      dispatch({ tipo: 'cargar', sondas: cargadas })
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
    void guardarSondas(sondas)
  }, [sondas])

  const crear = useCallback(
    (datos: DatosSonda): Sonda => {
      const ahora = new Date().toISOString()
      return { ...datos, id: nuevoId(), createdAt: ahora, updatedAt: ahora }
    },
    [],
  )

  const valor = useMemo<ValorSondas>(
    () => ({
      sondas,
      cargando,
      crear,
      agregar: (datos) => {
        const nueva = crear(datos)
        dispatch({ tipo: 'agregar', sonda: nueva })
        return nueva
      },
      // La marca se pone aqui y no en el formulario, que solo ve datos.
      actualizar: (sonda) =>
        dispatch({
          tipo: 'actualizar',
          sonda: { ...sonda, updatedAt: new Date().toISOString() },
        }),
      eliminar: (id) => {
        dispatch({ tipo: 'eliminar', id })
        // Sin la marca, la sonda volveria al sincronizar desde el otro
        // dispositivo, que sigue teniendola.
        void registrarBorrado('sondas', id).then(setMarcas)
      },
      reemplazar: (nuevas) => dispatch({ tipo: 'cargar', sondas: nuevas }),
      fusionar: async (nuevas, borrados) => {
        // Ver la nota en ContextoRegistros: la union se resuelve en db para
        // no perder marcas de los demas ambitos.
        const unidas = await fusionarBorradosGuardados(borrados ?? [])
        // Del ref, no del cierre: ver la nota de `sondasActuales`.
        const resultado = emparejar(sondasActuales.current, nuevas, unidas, 'sondas')
        setMarcas(unidas)
        dispatch({ tipo: 'fusionar', sondas: nuevas, borrados: unidas })
        return resultado
      },
      borrados: marcas,
      vaciar: () => dispatch({ tipo: 'vaciar' }),
      delDia: (fecha) =>
        sondas
          .filter((s) => s.fecha === fecha)
          .sort((a, b) => a.hora.localeCompare(b.hora)),
    }),
    [sondas, cargando, crear, marcas],
  )

  return <ContextoSondas.Provider value={valor}>{children}</ContextoSondas.Provider>
}

/** Acceso a las sondas. Lanza error si se usa fuera del proveedor. */
export function useSondas(): ValorSondas {
  const valor = useContext(ContextoSondas)
  if (!valor) throw new Error('useSondas debe usarse dentro de <ProveedorSondas>')
  return valor
}

/** Fecha y hora actuales para rellenar el formulario de vaciado. */
export function valoresSondaIniciales(): { fecha: FechaISO; hora: string } {
  const ahora = new Date()
  return { fecha: claveDia(ahora), hora: claveHora(ahora) }
}
