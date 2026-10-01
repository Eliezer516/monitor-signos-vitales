/**
 * Formulario de registro.
 *
 * Diseno pensado para un cuidador mayor en un movil:
 *  - Campos numericos con `inputMode` y fuente grande (teclado nativo, sin
 *    controles especiales que puedan fallar).
 *  - Boton "Ahora" que fija la hora actual, que es el 90% de los casos.
 *  - Plantillas de notas como botones de un toque.
 *  - Validacion en vivo: el borde del campo se pinta segun el estado del valor,
 *    sin necesidad de pulsar "Guardar" para saber si algo va mal.
 *  - Al guardar, los valores quedan puestos para la siguiente toma y solo se
 *    vacia la hora, permitiendo registrar varias tomas seguidas.
 */

import { useMemo, useState, type ChangeEvent } from 'react'
import { useRegistros } from '../context/ContextoRegistros'
import { useAjustes } from '../context/ContextoAjustes'
import { useAvisos } from './Avisos'
import { claveDia, claveHora, fechaCorta, hora12 } from '../lib/fechas'
import {
  PRESION_HABITUAL_POR_DEFECTO,
  UMBRALES_POR_DEFECTO,
  evaluarBpm,
  evaluarDia,
  evaluarO2,
  evaluarSis,
  validarRegistro,
  type Borrador,
} from '../lib/rangos'
import type { Nivel, PresionHabitual, Registro, Umbrales } from '../lib/tipos'
import { Boton, Campo, CampoNumero, Entrada, AreaTexto, Insignia, Tarjeta, cx } from './UI'
import { IconoCheck, IconoFlechaIzq, IconoMas, IconoReloj } from './Iconos'
import { useHoy } from '../hooks/useHoy'

/** Traduce el nombre interno del estado al nombre clinico que espera `estadoValor`. */
const NOMBRE_CAMPO = {
  presionSis: 'Sistolica',
  presionDia: 'Diastolica',
  o2: 'Oxigeno',
  bpm: 'Pulso',
} as const

/** Estado del formulario. Todos los campos numericos son cadenas para poder
 *  dejar el campo vacio mientras se escribe. */
interface Estado {
  fecha: string
  hora: string
  presionSis: string
  presionDia: string
  o2: string
  bpm: string
  orina: string
  notas: string
}

const vacio = (fecha: string, hora: string): Estado => ({
  fecha,
  hora,
  presionSis: '',
  presionDia: '',
  o2: '',
  bpm: '',
  orina: '',
  notas: '',
})

/** Convierte el estado del formulario en un borrador validable.
 *  Los campos numericos vacios se traducen a `null`, que es el estado
 *  "aun no rellenado" que maneja `validarRegistro`. */
const aBorrador = (e: Estado): Borrador => ({
  fecha: e.fecha,
  hora: e.hora,
  presionSis: e.presionSis === '' ? null : Number(e.presionSis),
  presionDia: e.presionDia === '' ? null : Number(e.presionDia),
  o2: e.o2 === '' ? null : Number(e.o2),
  bpm: e.bpm === '' ? null : Number(e.bpm),
  orina: e.orina === '' ? null : Number(e.orina),
  notas: e.notas.trim(),
})

// ---------------------------------------------------------------------------
// Formulario completo (pantalla Registrar)
// ---------------------------------------------------------------------------

export function FormularioRegistro({ registroEditando, onCancelar }: {
  registroEditando?: Registro | null
  onCancelar?: () => void
}) {
  const { agregar, actualizar } = useRegistros()
  const { ajustes, presionHabitual: habitual } = useAjustes()
  const { aviso } = useAvisos()
  const hoy = useHoy()

  const [estado, setEstado] = useState<Estado>(() =>
    registroEditando
      ? {
          fecha: registroEditando.fecha,
          hora: registroEditando.hora,
          presionSis: String(registroEditando.presionSis),
          presionDia: String(registroEditando.presionDia),
          o2: String(registroEditando.o2),
          bpm: String(registroEditando.bpm),
          orina: registroEditando.orina === null ? '' : String(registroEditando.orina),
          notas: registroEditando.notas,
        }
      : vacio(hoy, claveHora(new Date())),
  )
  const [tocado, setTocado] = useState<Record<string, boolean>>({})

  const errores = useMemo(
    () => validarRegistro(aBorrador(estado), ajustes.limites).errores,
    [estado, ajustes.limites],
  )

  // Los cuatro signos son obligatorios: sin ellos la medicion no sirve.
  const faltaAlgo =
    estado.presionSis === '' ||
    estado.presionDia === '' ||
    estado.o2 === '' ||
    estado.bpm === ''

  const cambiar = (campo: keyof Estado) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setEstado((prev) => ({ ...prev, [campo]: e.target.value }))
    setTocado((prev) => ({ ...prev, [campo]: true }))
  }

  const ponerAhora = () => {
    const d = new Date()
    setEstado((prev) => ({ ...prev, fecha: claveDia(d), hora: claveHora(d) }))
    setTocado((prev) => ({ ...prev, fecha: true, hora: true }))
  }

  const guardar = (e: React.FormEvent) => {
    e.preventDefault()
    setTocado({
      fecha: true,
      hora: true,
      presionSis: true,
      presionDia: true,
      o2: true,
      bpm: true,
      orina: true,
    })

    const borrador = aBorrador(estado)
    if (Object.keys(validarRegistro(borrador, ajustes.limites).errores).length > 0) {
      aviso('Revisa los campos marcados en rojo', 'error')
      return
    }
    if (faltaAlgo) {
      aviso('Completa presion, oxigeno y pulso', 'error')
      return
    }

    const comunes = {
      fecha: borrador.fecha!,
      hora: borrador.hora!,
      presionSis: Number(borrador.presionSis),
      presionDia: Number(borrador.presionDia),
      o2: Number(borrador.o2),
      bpm: Number(borrador.bpm),
      orina: borrador.orina === null ? null : Number(borrador.orina),
      notas: borrador.notas ?? '',
    }

    if (registroEditando) {
      actualizar({ ...registroEditando, ...comunes })
      aviso('Medicion actualizada')
      onCancelar?.()
      return
    }

    const ok = agregar(comunes)
    if (!ok) {
      aviso('Ya existe una medicion con esos valores a esa hora', 'error')
      return
    }
    aviso('Medicion guardada')
    // Se conservan los valores de los signos para registrar la siguiente toma
    // cambiando solo la hora: es el flujo mas comun (varias tomas al dia).
    setEstado((prev) => ({ ...prev, ...vacio(hoy, claveHora(new Date())), notas: '' }))
  }

  const numero = (campo: keyof Estado) => Number(estado[campo]) || null

  return (
    <form onSubmit={guardar} className="space-y-4" noValidate>
      {registroEditando && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-marca-suave px-3.5 py-2.5">
          <span className="text-sm font-medium text-marca">
            Editando medicion de las {hora12(registroEditando.hora)}
          </span>
          <button
            type="button"
            onClick={onCancelar}
            className="flex items-center gap-1 text-sm font-medium text-marca hover:underline"
          >
            <IconoFlechaIzq width={16} height={16} />
            Cancelar
          </button>
        </div>
      )}

      {/* Fecha y hora */}
      <Tarjeta className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-texto">Cuando</h2>
          {!registroEditando && (
            <button
              type="button"
              onClick={ponerAhora}
              className="flex min-h-9 items-center gap-1.5 rounded-lg bg-marca-suave px-3 text-sm font-medium text-marca active:scale-95"
            >
              <IconoReloj width={16} height={16} />
              Ahora
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo
            etiqueta="Fecha"
            requerido
            error={tocado.fecha ? errores.fecha : undefined}
          >
            <Entrada type="date" value={estado.fecha} onChange={cambiar('fecha')} max={hoy} />
          </Campo>
          <Campo etiqueta="Hora" requerido error={tocado.hora ? errores.hora : undefined}>
            <Entrada type="time" value={estado.hora} onChange={cambiar('hora')} />
          </Campo>
        </div>
      </Tarjeta>

      {/* Signos vitales */}
      <Tarjeta className="space-y-4">
        <h2 className="text-sm font-semibold text-texto">Signos vitales</h2>

        <div className="grid grid-cols-2 gap-3">
          <CampoNumeroConEstado
            etiqueta="Sistolica"
            unidad="mmHg"
            ayuda={`${ajustes.limites.presionSisMin}-${ajustes.limites.presionSisMax}`}
            campo="Sistolica"
            umbral={ajustes.umbral}
            habitual={habitual}
            valor={numero('presionSis')}
            error={tocado.presionSis ? errores.presionSis : undefined}
          >
            {(props) => (
              <CampoNumero {...props} value={estado.presionSis} onChange={cambiar('presionSis')} />
            )}
          </CampoNumeroConEstado>

          <CampoNumeroConEstado
            etiqueta="Diastolica"
            unidad="mmHg"
            ayuda={`${ajustes.limites.presionDiaMin}-${ajustes.limites.presionDiaMax}`}
            campo="Diastolica"
            umbral={ajustes.umbral}
            habitual={habitual}
            valor={numero('presionDia')}
            error={tocado.presionDia ? errores.presionDia : undefined}
          >
            {(props) => (
              <CampoNumero {...props} value={estado.presionDia} onChange={cambiar('presionDia')} />
            )}
          </CampoNumeroConEstado>

          <CampoNumeroConEstado
            etiqueta="Oxigeno"
            unidad="%"
            ayuda={`${ajustes.limites.o2Min}-${ajustes.limites.o2Max}`}
            campo="Oxigeno"
            umbral={ajustes.umbral}
            valor={numero('o2')}
            error={tocado.o2 ? errores.o2 : undefined}
          >
            {(props) => <CampoNumero {...props} value={estado.o2} onChange={cambiar('o2')} />}
          </CampoNumeroConEstado>

          <CampoNumeroConEstado
            etiqueta="Pulso"
            unidad="lpm"
            ayuda={`${ajustes.limites.bpmMin}-${ajustes.limites.bpmMax}`}
            campo="Pulso"
            umbral={ajustes.umbral}
            valor={numero('bpm')}
            error={tocado.bpm ? errores.bpm : undefined}
          >
            {(props) => <CampoNumero {...props} value={estado.bpm} onChange={cambiar('bpm')} />}
          </CampoNumeroConEstado>
        </div>

        <Campo
          etiqueta="Orina"
          ayuda="Opcional. Dejalo vacio si no la mediste."
          error={tocado.orina ? errores.orina : undefined}
        >
          <CampoNumero
            value={estado.orina}
            onChange={cambiar('orina')}
            placeholder="0"
            unidad="ml"
            min={ajustes.limites.orinaMin}
            max={ajustes.limites.orinaMax}
            step={10}
          />
        </Campo>
      </Tarjeta>

      {/* Notas */}
      <Tarjeta className="space-y-3">
        <h2 className="text-sm font-semibold text-texto">Notas</h2>
        <PlantillasNota valor={estado.notas} onChange={(v) => setEstado((p) => ({ ...p, notas: v }))} />
        <AreaTexto
          value={estado.notas}
          onChange={cambiar('notas')}
          placeholder="Medicamentos, actividades, sintomas..."
          rows={3}
          aria-label="Notas de la medicion"
        />
      </Tarjeta>

      {/* Guardar */}
      <div className="sticky bottom-20 z-20 lg:bottom-4">
        <Boton type="submit" tamano="lg" ancho icono={<IconoCheck width={20} height={20} />}>
          {registroEditando ? 'Guardar cambios' : 'Guardar medicion'}
        </Boton>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Campo numerico con indicador de estado
// ---------------------------------------------------------------------------

/**
 * Envuelve un campo numerico y le anade el borde de color segun el nivel
 * clinico del valor. El color se acompana de texto (el `ayuda` con el rango
 * normal), para no depender solo del color, que no distinguen todos los usuarios.
 */
function CampoNumeroConEstado({
  etiqueta,
  unidad,
  ayuda,
campo,
  umbral,
  habitual = PRESION_HABITUAL_POR_DEFECTO,
  valor,
  error,
  children,
}: {
  etiqueta: string
  unidad: string
  ayuda: string
campo: 'Sistolica' | 'Diastolica' | 'Oxigeno' | 'Pulso'
  umbral: Umbrales
  habitual?: PresionHabitual
  valor: number | null
  error?: string
  children: (props: { 'aria-label': string; 'aria-invalid': boolean }) => React.ReactNode
}) {
  const nivel = estadoValor(valor, campo, umbral, habitual)
  const critico = Boolean(error) || nivel === 'alerta'
  const borde = error || nivel === 'alerta' ? 'ring-alerta/25' : nivel === 'aviso' ? 'ring-aviso/25' : ''

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-texto">
        {etiqueta}
        <span className="ml-1 text-alerta">*</span>
      </span>
      <div className={cx('rounded-xl', borde && `ring-2 ${borde}`)}>
        {children({ 'aria-label': `${etiqueta} en ${unidad}`, 'aria-invalid': Boolean(error) })}
      </div>
      {error ? (
        <span className="mt-1 block text-xs font-medium text-alerta">{error}</span>
      ) : (
        <span
          className={cx(
            'mt-1 flex items-center justify-between text-[0.7rem]',
            nivel === 'alerta'
              ? 'text-alerta'
              : nivel === 'aviso'
                ? 'text-aviso'
                : 'text-texto-suave',
          )}
        >
          <span>{ayuda}</span>
          {nivel !== 'ok' && (
            <span className="font-medium">
              {critico ? 'Fuera de rango' : 'Revisar'}
            </span>
          )}
        </span>
      )}
    </div>
  )
}

/**
 * Determina el nivel clinico de un valor. Delega en los evaluadores de
 * `rangos.ts` para que el formulario y el historial no puedan discrepar: antes
 * esta funcion duplicaba los rangos, con lo que un cambio en un sitio no se
 * reflejaba en el otro.
 */
export function estadoValor(
  valor: number | null,
  campo: 'Sistolica' | 'Diastolica' | 'Oxigeno' | 'Pulso',
  u: Umbrales = UMBRALES_POR_DEFECTO,
  habitual: PresionHabitual = PRESION_HABITUAL_POR_DEFECTO,
): Nivel {
  switch (campo) {
    case 'Sistolica':
      return evaluarSis(valor, u, habitual)
    case 'Diastolica':
      return evaluarDia(valor, u, habitual)
    case 'Oxigeno':
      return evaluarO2(valor, u)
    case 'Pulso':
      return evaluarBpm(valor, u)
  }
}

// ---------------------------------------------------------------------------
// Plantillas de notas
// ---------------------------------------------------------------------------

export function PlantillasNota({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  const { ajustes, agregarPlantilla, plantillasActivas } = useAjustes()
  const [nueva, setNueva] = useState('')
  const plantillas = plantillasActivas()

  const alternar = (texto: string) => {
    // Pulsar una plantilla ya aplicada la quita: permite corregir sin borrar.
    if (valor.includes(texto)) {
      onChange(
        valor
          .replace(texto, '')
          .replace(/,\s*,/g, ',')
          .replace(/^,\s*|\s*,\s*$/g, '')
          .trim(),
      )
    } else {
      onChange(valor ? `${valor.replace(/,\s*$/, '')}, ${texto}` : texto)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {plantillas.map((p) => {
          const activa = valor.includes(p)
          return (
            <button
              key={p}
              type="button"
              onClick={() => alternar(p)}
              aria-pressed={activa}
              className={cx(
                'min-h-9 rounded-full px-3 text-xs font-medium transition active:scale-95',
                activa
                  ? 'bg-marca text-white'
                  : 'bg-superficie-3 text-texto-suave hover:text-texto',
              )}
            >
              {p}
            </button>
          )
        })}
        {plantillas.length === 0 && (
          <p className="text-xs text-texto-suave">
            No hay plantillas. Anadelas desde Ajustes.
          </p>
        )}
      </div>

      {/* Anadir plantilla nueva sin salir del formulario */}
      <details className="group">
        <summary className="cursor-pointer text-xs text-texto-suave hover:text-texto">
          + Anadir plantilla
        </summary>
        <div className="mt-2 flex gap-2">
          <Entrada
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            placeholder="Despues de..."
            className="min-h-9 text-sm"
            aria-label="Nueva plantilla de nota"
          />
          <Boton
            type="button"
            tamano="sm"
            variante="secundario"
            disabled={!nueva.trim()}
            onClick={() => {
              const texto = nueva.trim()
              if (!texto) return
              agregarPlantilla(texto)
              alternar(texto)
              setNueva('')
            }}
          >
            <IconoMas width={16} height={16} />
          </Boton>
        </div>
      </details>
      {ajustes.plantillas.length === 0 && (
        <Insignia className="bg-aviso-suave text-aviso">
          Sin plantillas configuradas
        </Insignia>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Formulario rapido (embebido en Inicio)
// ---------------------------------------------------------------------------

/**
 * Version reducida para el dashboard: solo la hora y los cuatro signos, con la
 * orina en un desplegable. Su proposito es permitir un registro en segundos
 * sin navegar a otra pantalla.
 */
export function FormularioRapido() {
  const { agregar } = useRegistros()
  const { ajustes, presionHabitual: habitual } = useAjustes()
  const { aviso } = useAvisos()
  const [abierto, setAbierto] = useState(false)
  const hoy = useHoy()
  const [estado, setEstado] = useState(() => vacio(claveDia(new Date()), claveHora(new Date())))
  const [verOrina, setVerOrina] = useState(false)
  const [verNotas, setVerNotas] = useState(false)

  const errores = validarRegistro(aBorrador(estado), ajustes.limites).errores
  const listo =
    estado.presionSis !== '' && estado.presionDia !== '' && estado.o2 !== '' && estado.bpm !== ''

  const guardar = () => {
    if (!listo || Object.keys(errores).length > 0) {
      aviso('Completa todos los campos obligatorios', 'error')
      return
    }
    const ok = agregar({
      fecha: estado.fecha,
      hora: estado.hora,
      presionSis: Number(estado.presionSis),
      presionDia: Number(estado.presionDia),
      o2: Number(estado.o2),
      bpm: Number(estado.bpm),
      orina: estado.orina === '' ? null : Number(estado.orina),
      notas: estado.notas.trim(),
    })
    if (!ok) {
      aviso('Ya existe una medicion con esos valores a esa hora', 'error')
      return
    }
    aviso('Medicion guardada')
    setEstado(vacio(claveDia(new Date()), claveHora(new Date())))
    setVerOrina(false)
    setVerNotas(false)
  }

  /**
 * Props de un campo controlado del formulario rapido.
 *
 * `T` se fija a `HTMLInputElement` por defecto y se cambia a
 * `HTMLTextAreaElement` en el area de notas, porque el tipo de evento que
 * espera cada componente es distinto y TypeScript no admite asignar un
 * manejador de la union a un manejador de un solo elemento.
 */
  const campo = <T extends HTMLInputElement | HTMLTextAreaElement = HTMLInputElement>(
    nombre: keyof Estado,
  ): { value: string; onChange: (e: ChangeEvent<T, T>) => void } => ({
    value: estado[nombre],
    onChange: (e) => setEstado((p) => ({ ...p, [nombre]: e.target.value })),
  })

/**
   * Borde del campo segun el valor tecleado.
   *
   * Toma los limites de Ajustes en vez de valores fijos: antes el formulario
   * rapido colorea siempre con 60-200 aunque el cuidador haya cambiado el
   * limite, y ademas marco el O2 por encima de 100 cuando ya se admite hasta
   * 102. El estado amber sale del nivel clinico, que ya tiene en cuenta la
   * presion habitual del paciente.
   */
  const colorBorde = (campo: 'presionSis' | 'presionDia' | 'o2' | 'bpm') => {
    const bruto = estado[campo]
    if (!bruto) return ''
    const v = Number(bruto)
    if (Number.isNaN(v)) return ''

    const l = ajustes.limites
    const rango = {
      presionSis: [l.presionSisMin, l.presionSisMax],
      presionDia: [l.presionDiaMin, l.presionDiaMax],
      o2: [l.o2Min, l.o2Max],
      bpm: [l.bpmMin, l.bpmMax],
    }[campo]
    if (v < rango[0] || v > rango[1]) return 'ring-2 ring-alerta/25 border-alerta'

    const nivel = estadoValor(v, NOMBRE_CAMPO[campo], ajustes.umbral, habitual)
    return nivel === 'aviso' ? 'ring-2 ring-aviso/25' : ''
  }

  return (
    <Tarjeta className="space-y-3">
      <button
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span>
          <span className="block text-base font-semibold text-texto">Registro rapido</span>
          {/* El formulario rapido siempre guarda con la fecha de hoy: se dice
              explicitamente para que nadie anote una medicion creyendo que es
              de ayer. */}
          <span className="block text-xs text-texto-suave">{fechaCorta(hoy)}</span>
        </span>
        <span className="text-sm font-medium text-marca">{abierto ? 'Ocultar' : 'Abrir'}</span>
      </button>

      {abierto && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Hora">
              <Entrada type="time" {...campo('hora')} />
            </Campo>
            <Campo etiqueta="Sistolica" ayuda="mmHg">
              <CampoNumero
                {...campo('presionSis')}
                placeholder="120"
                unidad="mmHg"
                className={colorBorde('presionSis')}
                aria-label="Sistolica en mmHg"
              />
            </Campo>
            <Campo etiqueta="Diastolica" ayuda="mmHg">
              <CampoNumero
                {...campo('presionDia')}
                placeholder="80"
                unidad="mmHg"
                className={colorBorde('presionDia')}
                aria-label="Diastolica en mmHg"
              />
            </Campo>
            <Campo etiqueta="Oxigeno" ayuda="%">
              <CampoNumero
                {...campo('o2')}
                placeholder="98"
                unidad="%"
                className={colorBorde('o2')}
                aria-label="Oxigeno en porcentaje"
              />
            </Campo>
            <Campo etiqueta="Pulso" ayuda="lpm">
              <CampoNumero
                {...campo('bpm')}
                placeholder="70"
                unidad="lpm"
                className={colorBorde('bpm')}
                aria-label="Pulso en latidos por minuto"
              />
            </Campo>
          </div>

          {/* Campos opcionales, plegados para no cargar la vista */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setVerOrina((v) => !v)}
              className="min-h-9 rounded-lg bg-superficie-3 px-3 text-xs font-medium text-texto-suave"
            >
              {verOrina ? 'Ocultar' : '+'} Orina
            </button>
            <button
              type="button"
              onClick={() => setVerNotas((v) => !v)}
              className="min-h-9 rounded-lg bg-superficie-3 px-3 text-xs font-medium text-texto-suave"
            >
              {verNotas ? 'Ocultar' : '+'} Notas
            </button>
          </div>

          {verOrina && (
            <Campo etiqueta="Orina" ayuda="Opcional">
              <CampoNumero
                {...campo('orina')}
                placeholder="0"
                unidad="ml"
                step={10}
                max={ajustes.limites.orinaMax}
                aria-label="Orina en mililitros"
              />
            </Campo>
          )}
          {verNotas && <AreaTexto {...campo<HTMLTextAreaElement>('notas')} rows={2} placeholder="Notas..." aria-label="Notas" />}

          <Boton
            onClick={guardar}
            ancho
            tamano="lg"
            disabled={!listo}
            icono={<IconoCheck width={20} height={20} />}
          >
            Guardar
          </Boton>
        </div>
      )}
    </Tarjeta>
  )
}