/**
 * Contexto de ajustes: tema, umbrales clinicos, plantillas, recordatorios,
 * datos del paciente y preferencias de exportacion.
 *
 * El tema se aplica tambien desde `index.html` antes del primer pintado para
 * evitar el parpadeo blanco al recargar en modo oscuro.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  Ajustes,
  AjustesCompartidos,
  Borrado,
  CampoCompartido,
  MarcasCompartidas,
  Paciente,
  PresionHabitual,
} from '../lib/tipos'
import { AJUSTES_POR_DEFECTO, PLANTILLAS_SUGERIDAS } from '../lib/rangos'
import {
  cargarAjustes,
  cargarMarcas,
  cargarPacientes,
  guardarAjustes,
  guardarMarcas,
  guardarPacientes,
  nuevoId,
  fusionarBorradosGuardados,
  registrarBorrado,
} from '../lib/db'
import { CAMPOS_COMPARTIDOS, emparejar, fusionarAjustes, marcarAhora, type ResultadoFusion } from '../lib/fusion'

export interface ValorAjustes {
  ajustes: Ajustes
  pacientes: Paciente[]
  cargando: boolean
  /** Tema efectivo ya resuelto ('claro' | 'oscuro'), sin 'sistema'. */
  temaEfectivo: 'claro' | 'oscuro'
  setAjuste: <K extends keyof Ajustes>(clave: K, valor: Ajustes[K]) => void
  alternarTema: () => void
  /** Paciente activo; `null` si no se ha configurado ninguno. */
  paciente: Paciente | null
  /**
   * Presion habitual ya resuelta: la del paciente si la tiene definida, y si no
   * la global de Ajustes. Se resuelve aqui para que ningun punto de la app tenga
   * que decidir cual de las dos aplicar.
   */
  presionHabitual: PresionHabitual
  guardarPaciente: (datos: Omit<Paciente, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => void
  eliminarPaciente: (id: string) => void
  /**
   * Fusiona con last-write-wins. Si no hay ningun paciente activo, se deja
   * activo el primero de los importados, porque un backup recien restaurado debe
   * abrirse con datos visibles y no en blanco.
   */
  fusionarPacientes: (entrantes: Paciente[], borrados?: Borrado[]) => Promise<ResultadoFusion<Paciente>>
  /** Parte de los ajustes que es igual en todos los dispositivos. */
  ajustesCompartidos: AjustesCompartidos
  /** Ultima modificacion de cada campo compartido, ISO. */
  marcas: MarcasCompartidas
  /**
   * Fusiona ajustes venidos de otro dispositivo, campo a campo. Devuelve
   * cuantos campos se han sustituido, que solo puede ser mas de cero si el otro
   * dispositivo habia cambiado algo que aqui no se habia tocado.
   */
  aplicarAjustesRemotos: (
    remotos: Partial<AjustesCompartidos>,
    marcasRemotas: MarcasCompartidas,
  ) => number
  plantillasActivas: () => string[]
  agregarPlantilla: (texto: string) => void
  alternarPlantilla: (id: string) => void
  eliminarPlantilla: (id: string) => void
}

const ContextoAjustes = createContext<ValorAjustes | null>(null)

export function ProveedorAjustes({ children }: { children: ReactNode }) {
  const [ajustes, setAjustes] = useState<Ajustes>(AJUSTES_POR_DEFECTO)
  const [pacientes, setPacientes] = useState<Paciente[]>([])
  // Ver la nota de `ContextoRegistros`: sin esto, un paciente creado durante una
  // sincronizacion se perderia al aplicar su resultado.
  const pacientesActuales = useRef(pacientes)
  // En un efecto y no durante el render: ver la nota de `ContextoRegistros`.
  useEffect(() => {
    pacientesActuales.current = pacientes
  })
  const [cargando, setCargando] = useState(true)
  // Ultima modificacion de cada campo compartido, para decidir sin consultar
  // nada mas que version gana al fusionar.
  const [marcas, setMarcas] = useState<MarcasCompartidas>({})
  const [sistemaOscuro, setSistemaOscuro] = useState(
    () =>
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches,
  )

  // Carga inicial.
  useEffect(() => {
    let cancelado = false
    void Promise.all([cargarAjustes(), cargarPacientes(), Promise.resolve(cargarMarcas())]).then(
      ([a, p, m]) => {
        if (cancelado) return
        setAjustes(a)
        setPacientes(p)
        setMarcas(m)
        setCargando(false)
      },
    )
    return () => {
      cancelado = true
    }
  }, [])

  // Persistencia de ajustes y pacientes.
  useEffect(() => {
    if (cargando) return
    void guardarAjustes(ajustes)
  }, [ajustes, cargando])

  useEffect(() => {
    if (cargando) return
    void guardarPacientes(pacientes)
  }, [pacientes, cargando])

  useEffect(() => {
    if (cargando) return
    guardarMarcas(marcas)
  }, [marcas, cargando])

  /** La parte de los ajustes que es igual en todos los dispositivos. */
  const ajustesCompartidos: AjustesCompartidos = useMemo(
    () => ({
      umbral: ajustes.umbral,
      limites: ajustes.limites,
      presionHabitual: ajustes.presionHabitual,
      plantillas: ajustes.plantillas,
    }),
    [ajustes.umbral, ajustes.limites, ajustes.presionHabitual, ajustes.plantillas],
  )

  // Reacciona al cambio de tema del sistema cuando el usuario eligio 'sistema'.
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const alCambiar = (e: MediaQueryListEvent) => setSistemaOscuro(e.matches)
    mq.addEventListener('change', alCambiar)
    return () => mq.removeEventListener('change', alCambiar)
  }, [])

  const temaEfectivo: 'claro' | 'oscuro' =
    ajustes.tema === 'sistema' ? (sistemaOscuro ? 'oscuro' : 'claro') : ajustes.tema

  // Sincroniza la clase `dark` con el tema efectivo.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', temaEfectivo === 'oscuro')
  }, [temaEfectivo])

  // Solo se marca lo que de verdad se comparte. `tema`, `recordatorio`,
  // `pacienteActivo` y `ultimoBackup` son de este dispositivo y no deben
  // viajar: si se marcaran, el otro dispositivo podria pisarlos con su valor.
  const marcarCompartido = useCallback((clave: keyof Ajustes) => {
    if (!CAMPOS_COMPARTIDOS.includes(clave as CampoCompartido)) return
    setMarcas((prev) => marcarAhora(prev, clave as CampoCompartido))
  }, [])

  const setAjuste = useCallback(
    <K extends keyof Ajustes>(clave: K, valor: Ajustes[K]) => {
      setAjustes((prev) => ({ ...prev, [clave]: valor }))
      marcarCompartido(clave)
    },
    [marcarCompartido],
  )

  const alternarTema = useCallback(() => {
    setAjustes((prev) => ({ ...prev, tema: prev.tema === 'oscuro' ? 'claro' : 'oscuro' }))
  }, [])

  const guardarPaciente = useCallback<ValorAjustes['guardarPaciente']>(
    (datos) => {
      if (datos.id) {
        // La marca se pone aqui y no en el formulario: quien llama solo ve
        // datos y no puede olvidarse de actualizarla.
        setPacientes((prev) =>
          prev.map((p) =>
            p.id === datos.id
              ? { ...p, ...datos, id: p.id, createdAt: p.createdAt, updatedAt: new Date().toISOString() }
              : p,
          ),
        )
        return
      }
      const ahora = new Date().toISOString()
      const nuevo: Paciente = {
        ...datos,
        id: nuevoId(),
        createdAt: ahora,
        updatedAt: ahora,
      }
      setPacientes((prev) => [...prev, nuevo])
      // El primer paciente se activa automaticamente para que el reporte
      // siempre tenga un nombre. Se lee `pacienteActivo` desde una funcion de
      // actualizacion pura en lugar de cerrar sobre el valor del render.
      setAjustes((a) => (a.pacienteActivo === null ? { ...a, pacienteActivo: nuevo.id } : a))
    },
    [],
  )

  const eliminarPaciente = useCallback((id: string) => {
    setPacientes((prev) => prev.filter((p) => p.id !== id))
    setAjustes((a) => (a.pacienteActivo === id ? { ...a, pacienteActivo: null } : a))
    // Sin esta marca, la ficha reaparece al sincronizar desde el otro
    // dispositivo, que sigue teniendola.
    void registrarBorrado('pacientes', id)
  }, [])

  /**
   * Fusiona pacientes de un backup. Se compara por `id` y, a falta de `id`,
   * por nombre en minusculas: los identificadores cambian entre instalaciones
   * si el backup se genero en otro dispositivo, y duplicar el mismo paciente
   * por nombre seria confuso.
   */
  const fusionarPacientes = useCallback(
    async (entrantes: Paciente[], borrados?: Borrado[]) => {
      // La union de marcas se resuelve en `db` y no con la lista que llega, por
      // el mismo motivo que en registros: un paciente borrado aqui hace tiempo y
      // cuyo tombstone no viaja en este backup volveria a aparecer, porque aqui
      // no hay ninguna copia en memoria que lo recuerde.
      const unidas = await fusionarBorradosGuardados(borrados ?? [])
      // El resultado se calcula aqui, y no solo dentro de `setPacientes`, porque
      // quien llama lo necesita para contar y no puede sacarlo de un actualizador
      // de estado. Es la misma llamada que haria el calculo, no hay doble trabajo
      // real porque el reducer no existe en este contexto.
      const resultado = emparejar(pacientesActuales.current, entrantes, unidas, 'pacientes')
      setPacientes(resultado.fusionados)
      if (!entrantes.length) return resultado
      setAjustes((a) => (a.pacienteActivo ? a : { ...a, pacienteActivo: entrantes[0]?.id ?? null }))
return resultado
    },
    // Sin dependencias: la lista llega del ref y el resto del cuerpo usa
    // actualizadores funcionales de `setAjustes`. Asi la funcion no cambia de
    // identidad en cada alta de paciente.
    [],
  )

  // La habitual del paciente manda sobre la global: cada persona tiene la suya,
  // y el ajuste global esta para no tener que repetirla en las fichas que no la
  // necesitan.
  const presionHabitual: PresionHabitual =
    pacientes.find((p) => p.id === ajustes.pacienteActivo)?.presionHabitual ??
    ajustes.presionHabitual

  const aplicarAjustesRemotos = useCallback(
    (remotos: Partial<AjustesCompartidos>, marcasRemotas: MarcasCompartidas) => {
      // La fusion se calcula con la foto de este render y el resultado se
      // aplica al estado. Se hace asi y no con un `setAjustes` que calcule
      // dentro, porque dos sincronizaciones seguidas deben partir del mismo
      // punto de partida y no encadenar sobre datos yamergeados a medias.
      const resultado = fusionarAjustes(ajustesCompartidos, remotos, marcas, marcasRemotas)
      if (resultado.pisados > 0) {
        setAjustes((a) => ({ ...a, ...resultado.ajustes }))
      }
      setMarcas(resultado.marcas)
      return resultado.pisados
    },
    [ajustesCompartidos, marcas],
  )

  const valor = useMemo<ValorAjustes>(
    () => ({
      ajustes,
      pacientes,
      cargando,
      temaEfectivo,
      presionHabitual,
      setAjuste,
      alternarTema,
      paciente: pacientes.find((p) => p.id === ajustes.pacienteActivo) ?? null,
      guardarPaciente,
      eliminarPaciente,
      fusionarPacientes,
      ajustesCompartidos,
      marcas,
      aplicarAjustesRemotos,
      plantillasActivas: () =>
        ajustes.plantillas.filter((p) => p.activa).map((p) => p.texto),
      // Las tres modifican `plantillas` por dentro con `setAjustes` en vez de
      // pasar por `setAjuste`, asi que la marca se pone a mano. Van juntas en
      // un array porque comparten el mismo campo que hay que marcar.
      agregarPlantilla: (texto) => {
        setAjustes((a) =>
          a.plantillas.some((p) => p.texto.toLowerCase() === texto.toLowerCase())
            ? a
            : {
                ...a,
                plantillas: [...a.plantillas, { id: nuevoId(), texto, activa: true }],
              },
        )
        marcarCompartido('plantillas')
      },
      alternarPlantilla: (id) => {
        setAjustes((a) => ({
          ...a,
          plantillas: a.plantillas.map((p) => (p.id === id ? { ...p, activa: !p.activa } : p)),
        }))
        marcarCompartido('plantillas')
      },
      eliminarPlantilla: (id) => {
        setAjustes((a) => ({ ...a, plantillas: a.plantillas.filter((p) => p.id !== id) }))
        marcarCompartido('plantillas')
      },
    }),
    [ajustes, pacientes, cargando, temaEfectivo, presionHabitual, setAjuste, alternarTema, guardarPaciente, eliminarPaciente, fusionarPacientes, ajustesCompartidos, marcas, aplicarAjustesRemotos, marcarCompartido],
  )

  return <ContextoAjustes.Provider value={valor}>{children}</ContextoAjustes.Provider>
}

/** Acceso a los ajustes. Lanza error si se usa fuera del proveedor. */
export function useAjustes(): ValorAjustes {
  const valor = useContext(ContextoAjustes)
  if (!valor) throw new Error('useAjustes debe usarse dentro de <ProveedorAjustes>')
  return valor
}

/** Plantillas sugeridas que aun no estan en las del usuario. */
export function plantillasSugeridas(ajustes: Ajustes): string[] {
  const actuales = new Set(ajustes.plantillas.map((p) => p.texto.toLowerCase()))
  return PLANTILLAS_SUGERIDAS.filter((s) => !actuales.has(s.toLowerCase()))
}