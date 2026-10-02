/**
 * La replica en la app: cuando subir, cuando bajar, y que se le diga a quien lo usa.
 *
 *   Se guarda en el telefono -> se sube a la base -> lo que llega de fuera se
 *   fusiona en pantalla.
 *
 * Va por debajo de `ProveedorRegistros`, `ProveedorVisitas` y `ProveedorAjustes`
 * porque necesita leer los tres para saber que hay que subir. Al fusionar lo que
 * llega llama a las mismas funciones de fusion que usa "Restaurar", y no a una via
 * propia: si la copia manual y la automatica tuvieran reglas distintas,
 * restauraria una cosa y sincronizando otra, y eso no se podria reproducir.
 *
 * **El bucle infinito es el riesgo de este fichero.**
 *
 * Bajar datos cambia el estado local, el estado local es lo que dispara la subida,
 * y la subida vuelve a bajar. Es un circulo cerrado, y lo unico que lo corta es
 * saber si lo que ha cambiado es algo que guarda este dispositivo o algo que acaba
 * de llegar de fuera. De ahi la firma de mas abajo: no se pregunta "ha cambiado",
 * se pregunta "es distinto de lo que habia cuando se termino la ultima
 * sincronizacion". Cuando la respuesta es que no, no se sube nada y el circulo se
 * para solo.
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
import { resumirCambios } from '../lib/sincronizar'
import { tursoConfigurado } from '../lib/turso/cliente'
import { sincronizar, type EstadoReplicable } from '../lib/turso/replica'
import type { Borrado, MarcasCompartidas } from '../lib/tipos'
import { useAjustes } from './ContextoAjustes'
import { useRegistros } from './ContextoRegistros'
import { useVisitas } from './ContextoVisitas'

/** Cuanto se espera antes de subir. */
const ESPERA = 1500

export type EstadoReplica = 'inactiva' | 'sincronizando' | 'al-dia' | 'error'

export interface ValorReplica {
  /** Si hay base configurada. Si no, no se ofrece nada. */
  disponible: boolean
  estado: EstadoReplica
  /** Ultima vez que se sincronizo, ISO. */
  ultima: string | null
  /** Ultimo error, para poder ensenarlo en vez de perderlo en la consola. */
  error: string | null
  /** Lo que cambio la ultima vez, o el aviso de la ficha creada. */
  aviso: string | null
  /** Sincroniza ya, sin esperar. Es el boton manual. */
  ahora: () => Promise<void>
  /** Sube sin esperar al temporizador, para lo que no pasa por un cambio de estado. */
  marcarCambio: () => void
}

const ContextoReplica = createContext<ValorReplica | null>(null)

/**
 * Firma del estado local.
 *
 * Solo con identificador y `updatedAt` de cada fila. Es lo justo para saber si algo
 * cambio de verdad, y no el contenido entero: comparar tambien las notas y los
 * numeros haria que la firma creciera con cada medicion sin ganar nada, porque
 * cualquier cambio real ya toca `updatedAt`.
 */
function firmaDe(estado: {
  registros: { id: string; updatedAt?: string }[]
  visitas: { id: string; updatedAt?: string }[]
  pacientes: { id: string; updatedAt?: string }[]
  borrados: Borrado[]
  marcas: MarcasCompartidas
}): string {
  const linea = (f: { id: string; updatedAt?: string }) => `${f.id}@${f.updatedAt ?? ''}`
  return JSON.stringify({
    registros: estado.registros.map(linea).sort(),
    visitas: estado.visitas.map(linea).sort(),
    pacientes: estado.pacientes.map(linea).sort(),
    // Los borrados van ordenados porque los dos lados los acumulan en orden
    // distinto, y que no coincidan no significa que haya cambiado nada.
    borrados: estado.borrados.map((b) => `${b.ambito}:${b.id}:${b.borradoAt}`).sort(),
    marcas: estado.marcas,
  })
}

export function ProveedorReplica({ children }: { children: ReactNode }) {
  const disponible = tursoConfigurado()

  const { registros, fusionar, borrados: borradosR, cargando: cargandoR } = useRegistros()
  const { visitas, fusionar: fusionarVisitas, borrados: borradosV, cargando: cargandoV } =
    useVisitas()
  const {
    pacientes,
    fusionarPacientes,
    ajustesCompartidos,
    marcas,
    aplicarAjustesRemotos,
    paciente,
    cargando: cargandoA,
  } = useAjustes()

  const [estado, setEstado] = useState<EstadoReplica>('inactiva')
  const [ultima, setUltima] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  /** Sincronizacion en curso, para no solaparlas. */
  const enCurso = useRef(false)
  /** Referencia al temporizador, para poder cancelarlo. */
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Firma del estado en el momento en que se termino la ultima sincronizacion.
   *
   * Es lo que corta el bucle. Se guarda DESPUES de aplicar lo que venia de fuera,
   * y para eso se calcula a partir del paquete que devuelve `sincronizar` y no de
   * lo que hay en pantalla: el estado de React todavia no esta actualizado cuando
   * se resuelve la promesa, asi que leerlo dari el valor viejo y el ciclo no
   * pararia nunca.
   */
  const firmaSincronizada = useRef<string | null>(null)

  const local = useMemo<EstadoReplicable>(
    () => ({
      registros,
      visitas,
      pacientes,
      borrados: [...borradosR, ...borradosV],
      ajustes: ajustesCompartidos,
      marcas,
      // El paciente activo es un ajuste de este dispositivo, no algo que se replique.
      // Solo se necesita su identificador, para saber a quien atribuir las filas
      // nuevas que aun no estan en la base.
      pacienteActivo: paciente?.id ?? null,
    }),
    [registros, visitas, pacientes, borradosR, borradosV, ajustesCompartidos, marcas, paciente],
  )

  const firma = useMemo(() => firmaDe(local), [local])

  // Los tres contextos tienen que haber leido del almacen. Con solo uno cargado, la
  // subida mandaria una lista vacia por la que no esta vacia de verdad, y la fusion
  // dari por borrado lo que solo estaba sin leer.
  const cargandoTodo = cargandoR || cargandoV || cargandoA

  const sincronizarAhora = useCallback(async () => {
    if (!disponible || enCurso.current) return
    enCurso.current = true
    setEstado('sincronizando')
    setError(null)
    try {
      const r = await sincronizar(local)

      // Lo que llega de fuera se fusiona con las mismas funciones que usa
      // "Restaurar". Los tombstones van dentro porque sin ellos los otros
      // dispositivos no se enterarian de lo que se borro aqui.
      await Promise.all([
        fusionar(r.paquete.registros, r.paquete.borrados),
        fusionarVisitas(r.paquete.visitas ?? [], r.paquete.borrados),
        fusionarPacientes(r.paquete.pacientes, r.paquete.borrados),
      ])
      if (r.paquete.ajustes) {
        aplicarAjustesRemotos(r.paquete.ajustes, r.paquete.marcas ?? {})
      }

      // La firma del paquete, no la del estado. El estado ya fusionado deberia
      // coincidir con ella; si por lo que sea no coincide, el ciclo que se dispare
      // despues es uno de mas y se estabiliza, porque un paquete fusionado contra
      // si mismo ya no cambia.
      firmaSincronizada.current = firmaDe({
        registros: r.paquete.registros,
        visitas: r.paquete.visitas ?? [],
        pacientes: r.paquete.pacientes,
        borrados: r.paquete.borrados ?? [],
        marcas: r.paquete.marcas ?? {},
      })

      setUltima(new Date().toISOString())
      setEstado('al-dia')

      // Crear una ficha con nombre "Paciente 1" no debe pasar sin avisar: le pone
      // nombre a unas mediciones que la persona ya tenia.
      if (r.pacienteCreado) {
        setAviso(`Se ha creado la ficha "${r.pacienteCreado.nombre}" para tus datos`)
      } else if (r.movidos > 0) {
        setAviso(
          `${r.movidos} mediciones han cambiado de ficha porque la suya se habia borrado en otro dispositivo`,
        )
      } else {
        setAviso(resumirCambios(r.resumen))
      }
    } catch (e) {
      // Un fallo aqui no es una perdida: lo local esta intacto y se reintentara la
      // proxima vez que cambie algo. El motivo se guarda para poder ensenarlo.
      setError(e instanceof Error ? e.message : 'No se ha podido sincronizar')
      setEstado('error')
    } finally {
      enCurso.current = false
    }
  }, [
    disponible,
    local,
    fusionar,
    fusionarVisitas,
    fusionarPacientes,
    aplicarAjustesRemotos,
  ])

  /**
   * La ultima version de `sincronizarAhora`, siempre al dia.
   *
   * Va por ref y no directamente en los efectos, y no por gusto: la funcion cambia
   * en cada render porque lee el estado, asi que ponerla en una lista de
   * dependencias haria que los efectos se relanzaran en cada render. Con el ref, el
   * efecto corre cuando toca y cuando se dispara llama a la version mas reciente,
   * que es ademas la unica correcta: mandar el estado de un render antiguo
   * sobreescribiria en la base cambios que ya estan en pantalla.
   */
  const actual = useRef(sincronizarAhora)
  // Se escribe en un efecto y no durante el render: leer un ref mientras se renderiza
  // hace que React no sepa que ese valor participa en lo que se ve. Va declarado antes
  // que los efectos que lo usan para que, cuando corran, ya tenga la version al dia.
  useEffect(() => {
    actual.current = sincronizarAhora
  })

  // Cambiar algo en este telefono sube, pero no de golpe.
  //
  // El temporizador se cancela y se vuelve a poner en cada cambio, de modo que quien
  // teclee veinte mediciones seguidas hace una sola subida en vez de veinte.
  useEffect(() => {
    if (!disponible || cargandoTodo) return
    // Hasta que no haya habido una sincronizacion no se sube nada: la primera es la
    // que establece el punto de partida, y va por su via.
    if (firmaSincronizada.current === null) return
    if (firma === firmaSincronizada.current) return

    if (temporizador.current) clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => {
      void actual.current()
    }, ESPERA)
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [firma, disponible, cargandoTodo])

  /**
   * Al abrir y al volver a la pantalla.
   *
   * El pull al abrir es lo que hace que dos telefonos converjan sin que nadie pulse
   * nada. El del foco esta por lo mismo: una app de signos vitales se usa cuando
   * alguien se acuerda de apuntar algo, y muchas veces se coge el telefono que
   * llevaba semanas sin abrir.
   */
  const alVolver = useCallback(() => {
    if (!disponible || cargandoTodo) return
    if (document.visibilityState !== 'visible') return
    void actual.current()
  }, [disponible, cargandoTodo])

  useEffect(() => {
    if (!disponible || cargandoTodo) return
    void actual.current()

    window.addEventListener('focus', alVolver)
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      window.removeEventListener('focus', alVolver)
      document.removeEventListener('visibilitychange', alVolver)
    }
    // Ni `sincronizarAhora` ni `actual` van en la lista a proposito, y por lo que
    // explica `actual`. Asi este efecto solo corre al montar, y cuando cambia si hay
    // base o si ya se ha terminado de leer del almacen.
  }, [disponible, cargandoTodo, alVolver])

  /**
   * Sube ya, saltandose el temporalizador.
   *
   * Para lo que cambia datos sin pasar por el estado: restaurar un backup, o
   * vaciar. No es un caso especial de la replica, es otro cambio mas, pero si
   * esperase al temporalizador habria un rato en que lo restaurado solo existia en
   * este telefono, que es justo el rato que se quiere evitar.
   */
  const marcarCambio = useCallback(() => {
    if (temporizador.current) clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => {
      void actual.current()
    }, 0)
  }, [])

  const valor = useMemo<ValorReplica>(
    () => ({ disponible, estado, ultima, error, aviso, ahora: sincronizarAhora, marcarCambio }),
    [disponible, estado, ultima, error, aviso, sincronizarAhora, marcarCambio],
  )

  return <ContextoReplica.Provider value={valor}>{children}</ContextoReplica.Provider>
}

export function useReplica(): ValorReplica {
  const valor = useContext(ContextoReplica)
  if (!valor) throw new Error('useReplica necesita a ProveedorReplica')
  return valor
}
