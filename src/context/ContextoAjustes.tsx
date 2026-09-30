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
  useState,
  type ReactNode,
} from 'react'
import type { Ajustes, Paciente, PresionHabitual } from '../lib/tipos'
import { AJUSTES_POR_DEFECTO, PLANTILLAS_SUGERIDAS } from '../lib/rangos'
import { cargarAjustes, cargarPacientes, guardarAjustes, guardarPacientes, nuevoId } from '../lib/db'

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
  guardarPaciente: (datos: Omit<Paciente, 'id' | 'creadoAt'> & { id?: string }) => void
  eliminarPaciente: (id: string) => void
  /**
   * Anade los pacientes de un backup sin tocar los que ya estan. Si no hay
   * ninguno activo, se deja activo el primero de los importados, porque un
   * backup recien restaurado debe abrirse con datos visibles y no en blanco.
   */
  fusionarPacientes: (entrantes: Paciente[]) => number
  plantillasActivas: () => string[]
  agregarPlantilla: (texto: string) => void
  alternarPlantilla: (id: string) => void
  eliminarPlantilla: (id: string) => void
}

const ContextoAjustes = createContext<ValorAjustes | null>(null)

export function ProveedorAjustes({ children }: { children: ReactNode }) {
  const [ajustes, setAjustes] = useState<Ajustes>(AJUSTES_POR_DEFECTO)
  const [pacientes, setPacientes] = useState<Paciente[]>([])
  const [cargando, setCargando] = useState(true)
  const [sistemaOscuro, setSistemaOscuro] = useState(
    () =>
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches,
  )

  // Carga inicial.
  useEffect(() => {
    let cancelado = false
    void Promise.all([cargarAjustes(), cargarPacientes()]).then(([a, p]) => {
      if (cancelado) return
      setAjustes(a)
      setPacientes(p)
      setCargando(false)
    })
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

  const setAjuste = useCallback(<K extends keyof Ajustes>(clave: K, valor: Ajustes[K]) => {
    setAjustes((prev) => ({ ...prev, [clave]: valor }))
  }, [])

  const alternarTema = useCallback(() => {
    setAjustes((prev) => ({ ...prev, tema: prev.tema === 'oscuro' ? 'claro' : 'oscuro' }))
  }, [])

  const guardarPaciente = useCallback<ValorAjustes['guardarPaciente']>(
    (datos) => {
      if (datos.id) {
        setPacientes((prev) => prev.map((p) => (p.id === datos.id ? { ...p, ...datos } : p)))
        return
      }
      const nuevo: Paciente = {
        ...datos,
        id: nuevoId(),
        creadoAt: new Date().toISOString(),
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
  }, [])

  /**
   * Fusiona pacientes de un backup. Se compara por `id` y, a falta de `id`,
   * por nombre en minusculas: los identificadores cambian entre instalaciones
   * si el backup se genero en otro dispositivo, y duplicar el mismo paciente
   * por nombre seria confuso.
   */
  const fusionarPacientes = useCallback((entrantes: Paciente[]) => {
    if (!entrantes.length) return 0
    let anadidos = 0

    setPacientes((prev) => {
      const vistos = new Set(prev.map((p) => `${p.id}|${p.nombre.toLowerCase()}`))
      const nuevos = entrantes.filter((p) => {
        const clave = `${p.id}|${p.nombre.toLowerCase()}`
        if (vistos.has(clave)) return false
        vistos.add(clave)
        anadidos++
        return true
      })
      return nuevos.length ? [...prev, ...nuevos] : prev
    })

    setAjustes((a) =>
      a.pacienteActivo ? a : { ...a, pacienteActivo: entrantes[0]?.id ?? null },
    )

    return anadidos
  }, [])

  // La habitual del paciente manda sobre la global: cada persona tiene la suya,
  // y el ajuste global esta para no tener que repetirla en las fichas que no la
  // necesitan.
  const presionHabitual: PresionHabitual =
    pacientes.find((p) => p.id === ajustes.pacienteActivo)?.presionHabitual ??
    ajustes.presionHabitual

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
      plantillasActivas: () =>
        ajustes.plantillas.filter((p) => p.activa).map((p) => p.texto),
      agregarPlantilla: (texto) =>
        setAjustes((a) =>
          a.plantillas.some((p) => p.texto.toLowerCase() === texto.toLowerCase())
            ? a
            : {
                ...a,
                plantillas: [...a.plantillas, { id: nuevoId(), texto, activa: true }],
              },
        ),
      alternarPlantilla: (id) =>
        setAjustes((a) => ({
          ...a,
          plantillas: a.plantillas.map((p) => (p.id === id ? { ...p, activa: !p.activa } : p)),
        })),
      eliminarPlantilla: (id) =>
        setAjustes((a) => ({ ...a, plantillas: a.plantillas.filter((p) => p.id !== id) })),
    }),
    [ajustes, pacientes, cargando, temaEfectivo, presionHabitual, setAjuste, alternarTema, guardarPaciente, eliminarPaciente, fusionarPacientes],
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