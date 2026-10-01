/**
 * Ajustes: paciente, umbrales clinicos, plantillas, recordatorios, datos y
 * apariencia.
 *
 * Se mantiene en una sola pantalla con secciones plegables: un cuidador mayor
 * no debe tener que navegar por submenus, pero la pantalla tampoco debe ser
 * un muro de campos.
 */

import { useEffect, useRef, useState } from 'react'
import { useAjustes, plantillasSugeridas } from '../context/ContextoAjustes'
import { useRegistros } from '../context/ContextoRegistros'
import { useVisitas } from '../context/ContextoVisitas'
import { useAvisos } from '../components/Avisos'
import { exportarBackup, leerBackup } from '../lib/exportar'
import { indexedDBDisponible } from '../lib/db'
import { crearRegistrosDemo } from '../lib/demo'
import { claveDia, claveHora, fechaCorta, hora12 } from '../lib/fechas'
import {
  comprobarRecordatorio,
  describirIntervalo,
  enSilencio,
  horaAMinutos,
  minutosAHora,
  pedirPermiso,
  permisoActual,
} from '../lib/notificaciones'
import type { PresionHabitual, Umbrales } from '../lib/tipos'
import {
  LIMITES_POR_DEFECTO,
  PRESION_HABITUAL_POR_DEFECTO,
  UMBRALES_POR_DEFECTO,
  bandaNormal,
} from '../lib/rangos'
import { useHoy } from '../hooks/useHoy'
import {
  Boton,
  Campo,
  Entrada,
  Interruptor,
  Modal,
  Segmentado,
  Selector,
  Tarjeta,
  cx,
} from '../components/UI'
import {
  IconoAjustes,
  IconoCheck,
  IconoDescargar,
  IconoLuna,
  IconoMas,
  IconoSol,
  IconoSubir,
} from '../components/Iconos'

type Seccion = 'paciente' | 'umbrales' | 'notas' | 'recordatorios' | 'datos' | 'apariencia'

const SECCIONES: { id: Seccion; etiqueta: string; icono: React.ReactNode }[] = [
  { id: 'paciente', etiqueta: 'Paciente', icono: <IconoAjustes width={18} height={18} /> },
  { id: 'umbrales', etiqueta: 'Umbrales', icono: <IconoMas width={18} height={18} /> },
  { id: 'notas', etiqueta: 'Plantillas', icono: <IconoCheck width={18} height={18} /> },
  {
    id: 'recordatorios',
    etiqueta: 'Recordatorios',
    icono: <IconoSol width={18} height={18} />,
  },
  { id: 'datos', etiqueta: 'Datos', icono: <IconoDescargar width={18} height={18} /> },
  { id: 'apariencia', etiqueta: 'Apariencia', icono: <IconoLuna width={18} height={18} /> },
]

export function PaginaAjustes() {
  const [abierta, setAbierta] = useState<Seccion | null>('paciente')

  return (
    <div className="space-y-3">
      {SECCIONES.map((s) => (
        <Tarjeta key={s.id} className="overflow-hidden p-0">
          <button
            onClick={() => setAbierta(abierta === s.id ? null : s.id)}
            aria-expanded={abierta === s.id}
            className="flex min-h-14 w-full items-center gap-3 px-4 text-left"
          >
            <span className="text-texto-suave">{s.icono}</span>
            <span className="flex-1 font-medium text-texto">{s.etiqueta}</span>
            <span className="text-texto-suave">{abierta === s.id ? '−' : '+'}</span>
          </button>
          {abierta === s.id && (
            <div className="border-t border-borde p-4">
              {s.id === 'paciente' && <SeccionPaciente />}
              {s.id === 'umbrales' && <SeccionUmbrales />}
              {s.id === 'notas' && <SeccionPlantillas />}
              {s.id === 'recordatorios' && <SeccionRecordatorios />}
              {s.id === 'datos' && <SeccionDatos />}
              {s.id === 'apariencia' && <SeccionApariencia />}
            </div>
          )}
        </Tarjeta>
      ))}

      <p className="px-1 pt-2 text-center text-xs text-texto-suave">
        Los datos se guardan solo en este dispositivo.
        <br />
        Exporta un backup con frecuencia para no perderlos.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Paciente
// ---------------------------------------------------------------------------

function SeccionPaciente() {
  const { pacientes, eliminarPaciente, paciente } = useAjustes()
  const { aviso } = useAvisos()
  const [editando, setEditando] = useState(false)

  return (
    <div className="space-y-4">
      {paciente && !editando ? (
        <div className="space-y-3">
          <div>
            <p className="text-sm text-texto-suave">Paciente activo</p>
            <p className="text-lg font-semibold text-texto">{paciente.nombre}</p>
            {paciente.nacimiento && (
              <p className="text-xs text-texto-suave">
                Nacido el {paciente.nacimiento.split('-').reverse().join('/')}
              </p>
            )}
          </div>
          {paciente.notas && <p className="text-sm text-texto-suave">{paciente.notas}</p>}

          <div className="grid grid-cols-2 gap-2.5">
            <Boton variante="secundario" onClick={() => setEditando(true)}>
              Editar
            </Boton>
            {pacientes.length > 1 && (
              <Boton
                variante="peligro"
                onClick={() => {
                  if (confirm(`Eliminar a ${paciente.nombre}?`)) {
                    eliminarPaciente(paciente.id)
                    aviso('Paciente eliminado')
                  }
                }}
              >
                Eliminar
              </Boton>
            )}
          </div>
        </div>
      ) : (
        <FormularioPaciente onCancelar={() => setEditando(false)} />
      )}

      {/* Selector si hay varios pacientes */}
      {pacientes.length > 1 && !editando && (
        <div>
          <span className="mb-1.5 block text-sm font-medium text-texto">Cambiar de paciente</span>
          <ul className="space-y-1.5">
            {pacientes.map((p) => (
              <li key={p.id}>
                <SelectorPaciente activo={p.id === paciente?.id} id={p.id} nombre={p.nombre} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {!paciente && !editando && <FormularioPaciente />}
    </div>
  )
}

function SelectorPaciente({ activo, id, nombre }: { activo: boolean; id: string; nombre: string }) {
  const { setAjuste } = useAjustes()
  return (
    <button
      onClick={() => setAjuste('pacienteActivo', activo ? null : id)}
      className={cx(
        'flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm transition',
        activo ? 'bg-marca-suave font-medium text-marca' : 'bg-superficie-2 text-texto',
      )}
    >
      {activo && <IconoCheck width={16} height={16} />}
      {nombre}
    </button>
  )
}

function FormularioPaciente({ onCancelar }: { onCancelar?: () => void }) {
  const { guardarPaciente, paciente, ajustes } = useAjustes()
  const { aviso } = useAvisos()
  const [nombre, setNombre] = useState(paciente?.nombre ?? '')
  const [nacimiento, setNacimiento] = useState(paciente?.nacimiento ?? '')
  const [notas, setNotas] = useState(paciente?.notas ?? '')
  // Un paciente sin valor propio hereda el global, por eso la opcion esta
  // apagada aunque el editor muestre valores: se edita solo si se enciende.
  const [habitualPropio, setHabitualPropio] = useState(paciente?.presionHabitual != null)
  const [habitual, setHabitual] = useState<PresionHabitual>(
    paciente?.presionHabitual ?? ajustes.presionHabitual,
  )
  // El selector de fecha nativo usa `AAAA-MM-DD` en hora local, no UTC.
  const hoy = useHoy()

  const guardar = () => {
    if (!nombre.trim()) {
      aviso('Escribe un nombre', 'error')
      return
    }
    if (habitualPropio && habitual.dia >= habitual.sis) {
      aviso('Revisa la presion habitual: la diastolica no puede ser mayor que la sistolica', 'error')
      return
    }
    guardarPaciente({
      id: paciente?.id,
      nombre: nombre.trim(),
      nacimiento: nacimiento || undefined,
      notas: notas.trim() || undefined,
      presionHabitual: habitualPropio ? habitual : undefined,
    })
    aviso(paciente ? 'Paciente actualizado' : 'Paciente anadido')
    onCancelar?.()
  }

  return (
    <div className="space-y-3">
      <Campo etiqueta="Nombre" requerido>
        <Entrada
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre del paciente"
        />
      </Campo>
      <Campo etiqueta="Fecha de nacimiento" ayuda="Opcional">
        <Entrada
          type="date"
          value={nacimiento}
          max={hoy}
          onChange={(e) => setNacimiento(e.target.value)}
        />
      </Campo>

      <div className="rounded-xl border border-borde p-3">
        <Interruptor
          activo={habitualPropio}
          onChange={setHabitualPropio}
          etiqueta="Su presion habitual es distinta"
          descripcion={
            habitualPropio
              ? `Usa ${habitual.sis}/${habitual.dia} mmHg para este paciente.`
              : `Usa el valor global: ${ajustes.presionHabitual.sis}/${ajustes.presionHabitual.dia} mmHg.`
          }
        />
        {habitualPropio && (
          <div className="mt-3">
            <EditorPresionHabitual valor={habitual} onChange={setHabitual} />
          </div>
        )}
      </div>

      <Campo etiqueta="Notas para el medico" ayuda="Alergias, diagnostico, tratamiento...">
        <Entrada
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="Contexto clinico relevante"
        />
      </Campo>
      <div className="grid grid-cols-2 gap-2.5">
        {onCancelar && (
          <Boton variante="secundario" onClick={onCancelar}>
            Cancelar
          </Boton>
        )}
        <Boton onClick={guardar}>{paciente ? 'Guardar' : 'Anadir paciente'}</Boton>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Presion habitual
// ---------------------------------------------------------------------------

/**
 * Valores habituales usados como atajo. Un cuidador mayor teclea peor que un
 * profesional, asi que un boton por valor tipico es mas fiable que dos campos
 * en blanco.
 */
const PRESETS_PRESION: PresionHabitual[] = [
  { sis: 90, dia: 60 },
  { sis: 100, dia: 65 },
  { sis: 110, dia: 70 },
  { sis: 120, dia: 80 },
  { sis: 130, dia: 85 },
  { sis: 140, dia: 90 },
]

/**
 * Editor de la presion habitual de un paciente (o del valor global).
 *
 * Este valor NO cambia los limites de alerta, que siguen siendo absolutos: solo
 * define que se considera "igual que siempre" y por tanto cuando aparece un
 * aviso en ambar. Es lo que permite que alguien que vive con 90/60 no vea su
 * medicion de siempre marcada como anomala.
 */
function EditorPresionHabitual({
  valor,
  onChange,
}: {
  valor: PresionHabitual
  onChange: (v: PresionHabitual) => void
}) {
  const { ajustes } = useAjustes()
  const banda = bandaNormal(valor, ajustes.umbral)

  // Se ignora el valor parcial mientras se escribe: si no, teclear "1" en "120"
  // seeria momentarily 1 mmHg.
  const cambiar = (clave: 'sis' | 'dia', texto: string) => {
    if (texto === '') return
    const n = Number(texto)
    if (Number.isFinite(n)) onChange({ ...valor, [clave]: n })
  }

  const fueraDeLimites =
    valor.sis < ajustes.limites.presionSisMin ||
    valor.sis > ajustes.limites.presionSisMax ||
    valor.dia < ajustes.limites.presionDiaMin ||
    valor.dia > ajustes.limites.presionDiaMax

  const incoherente = valor.dia >= valor.sis

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Sistolica habitual" ayuda="mmHg">
          <Entrada
            type="number"
            inputMode="numeric"
            value={valor.sis}
            onChange={(e) => cambiar('sis', e.target.value)}
            className="tabular-nums"
            aria-label="Sistolica habitual en mmHg"
          />
        </Campo>
        <Campo etiqueta="Diastolica habitual" ayuda="mmHg">
          <Entrada
            type="number"
            inputMode="numeric"
            value={valor.dia}
            onChange={(e) => cambiar('dia', e.target.value)}
            className="tabular-nums"
            aria-label="Diastolica habitual en mmHg"
          />
        </Campo>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PRESETS_PRESION.map((p) => {
          const activo = p.sis === valor.sis && p.dia === valor.dia
          return (
            <button
              key={`${p.sis}/${p.dia}`}
              onClick={() => onChange(p)}
              aria-pressed={activo}
              className={cx(
                'min-h-9 rounded-lg border px-3 text-sm font-medium transition',
                activo
                  ? 'border-marca bg-marca text-white'
                  : 'border-borde text-texto-suave hover:bg-superficie-2',
              )}
            >
              {p.sis}/{p.dia}
            </button>
          )
        })}
      </div>

      {incoherente && (
        <p className="rounded-lg bg-alerta-suave px-3 py-2 text-xs font-medium text-alerta">
          La diastolica ({valor.dia}) no puede ser igual o mayor que la sistolica
          ({valor.sis}).
        </p>
      )}
      {fueraDeLimites && (
        <p className="rounded-lg bg-aviso-suave px-3 py-2 text-xs font-medium text-aviso">
          Este valor esta fuera de los limites de entrada configurados. Puede
          ajustarse, pero no se podrian guardar mediciones fuera de
          {` ${ajustes.limites.presionSisMin}-${ajustes.limites.presionSisMax}`} mmHg.
        </p>
      )}

      {!incoherente && !fueraDeLimites && (
        <p className="rounded-lg bg-superficie-2 px-3 py-2 text-xs text-texto-suave">
          Seconsidera normal entre <strong className="text-texto">{banda.sis[0]}</strong> y{' '}
          <strong className="text-texto">{banda.sis[1]}</strong> mmHg sistolicos y entre{' '}
          <strong className="text-texto">{banda.dia[0]}</strong> y{' '}
          <strong className="text-texto">{banda.dia[1]}</strong> diastolicos. Fuera de esa
          banda aparece un aviso; fuera de los limites de alerta, una alerta.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Umbrales clinicos
// ---------------------------------------------------------------------------

function SeccionUmbrales() {
  const { ajustes, setAjuste } = useAjustes()
  const { aviso } = useAvisos()

  const set = <K extends keyof Umbrales>(clave: K, valor: number) =>
    setAjuste('umbral', { ...ajustes.umbral, [clave]: valor })

  const campos: { clave: keyof Umbrales; etiqueta: string; unidad: string; paso?: number }[] = [
    { clave: 'presionSisMin', etiqueta: 'Sistolica minima', unidad: 'mmHg' },
    { clave: 'presionSisMax', etiqueta: 'Sistolica maxima', unidad: 'mmHg' },
    { clave: 'presionDiaMin', etiqueta: 'Diastolica minima', unidad: 'mmHg' },
    { clave: 'presionDiaMax', etiqueta: 'Diastolica maxima', unidad: 'mmHg' },
    { clave: 'o2Min', etiqueta: 'Oxigeno minimo', unidad: '%' },
    { clave: 'o2Max', etiqueta: 'Oxigeno maximo', unidad: '%' },
    { clave: 'bpmMin', etiqueta: 'Pulso minimo', unidad: 'lpm' },
    { clave: 'bpmMax', etiqueta: 'Pulso maximo', unidad: 'lpm' },
    { clave: 'orinaMin', etiqueta: 'Orina minima diaria', unidad: 'ml', paso: 100 },
    { clave: 'orinaMax', etiqueta: 'Orina maxima diaria', unidad: 'ml', paso: 100 },
  ]

  const incoherente =
    ajustes.umbral.presionSisMin >= ajustes.umbral.presionSisMax ||
    ajustes.umbral.presionDiaMin >= ajustes.umbral.presionDiaMax ||
    ajustes.umbral.bpmMin >= ajustes.umbral.bpmMax ||
    ajustes.umbral.orinaMin >= ajustes.umbral.orinaMax

  return (
    <div className="space-y-4">
      <p className="text-xs text-texto-suave">
        Valores fuera de estos limites generan una alerta. Estos umbrales estan
        pensados para revision medica; consultalos con el profesional que lleva
        el caso.
      </p>

      {incoherente && (
        <p className="rounded-lg bg-alerta-suave px-3 py-2 text-xs font-medium text-alerta">
          Hay un minimo mayor o igual que su maximo. Revisa los valores.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {campos.map((c) => (
          <Campo key={c.clave} etiqueta={c.etiqueta}>
            <div className="relative">
              <Entrada
                type="number"
                inputMode="decimal"
                value={ajustes.umbral[c.clave]}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) set(c.clave, v)
                }}
                step={c.paso ?? 1}
                className="pr-14 tabular-nums"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-texto-suave">
                {c.unidad}
              </span>
            </div>
          </Campo>
        ))}
      </div>

      <div className="border-t border-borde pt-4">
        <h3 className="text-sm font-semibold text-texto">Presion habitual</h3>
        <p className="mb-3 mt-1 text-xs text-texto-suave">
          La presion con la que esta persona se encuentra bien. No cambia los
          limites de alerta, pero si que se considera "normal": con 90/60 una
          medicion de 90 ya no sale marcada como baja, y una subida clara
          respecto a su costumbre si se avisa. Se aplica a los pacientes que no
          tengan un valor propio.
        </p>
        <EditorPresionHabitual
          valor={ajustes.presionHabitual}
          onChange={(v) => setAjuste('presionHabitual', v)}
        />
      </div>

      <Boton
        variante="secundario"
        onClick={() => {
          setAjuste('umbral', UMBRALES_POR_DEFECTO)
          setAjuste('limites', LIMITES_POR_DEFECTO)
          setAjuste('presionHabitual', PRESION_HABITUAL_POR_DEFECTO)
          aviso('Umbrales restablecidos')
        }}
      >
        Restablecer valores por defecto
      </Boton>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plantillas de notas
// ---------------------------------------------------------------------------

function SeccionPlantillas() {
  const { ajustes, agregarPlantilla, alternarPlantilla, eliminarPlantilla } = useAjustes()
  const [nueva, setNueva] = useState('')
  const sugeridas = plantillasSugeridas(ajustes)

  return (
    <div className="space-y-4">
      <p className="text-xs text-texto-suave">
        Las plantillas activas aparecen como botones de un toque al registrar.
      </p>

      <ul className="space-y-1.5">
        {ajustes.plantillas.map((p) => (
          <li
            key={p.id}
            className={cx(
              'flex items-center gap-2 rounded-xl px-3 py-2',
              p.activa ? 'bg-marca-suave' : 'bg-superficie-2',
            )}
          >
            <span className="min-w-0 flex-1 truncate text-sm text-texto">{p.texto}</span>
            <button
              onClick={() => alternarPlantilla(p.id)}
              aria-label={p.activa ? 'Desactivar' : 'Activar'}
              className={cx(
                'min-h-9 rounded-lg px-2.5 text-xs font-medium',
                p.activa ? 'bg-marca text-white' : 'bg-superficie-3 text-texto-suave',
              )}
            >
              {p.activa ? 'Activa' : 'Inactiva'}
            </button>
            <button
              onClick={() => eliminarPlantilla(p.id)}
              aria-label={`Eliminar ${p.texto}`}
              className="grid size-9 place-items-center rounded-lg text-texto-suave hover:bg-alerta-suave hover:text-alerta"
            >
              &times;
            </button>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <Entrada
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          placeholder="Nueva plantilla"
          aria-label="Nueva plantilla de nota"
        />
        <Boton
          variante="secundario"
          disabled={!nueva.trim()}
          onClick={() => {
            agregarPlantilla(nueva.trim())
            setNueva('')
          }}
        >
          <IconoMas width={18} height={18} />
        </Boton>
      </div>

      {sugeridas.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-texto-suave">Sugerencias</p>
          <ul className="flex flex-wrap gap-1.5">
            {sugeridas.map((s) => (
              <li key={s}>
                <button
                  onClick={() => agregarPlantilla(s)}
                  className="min-h-9 rounded-full bg-superficie-3 px-3 text-xs text-texto-suave hover:text-texto"
                >
                  + {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recordatorios
// ---------------------------------------------------------------------------

function SeccionRecordatorios() {
  const { ajustes, setAjuste } = useAjustes()
  const { aviso } = useAvisos()
  const r = ajustes.recordatorio
  const permiso = permisoActual()

  const set = <K extends keyof typeof r>(clave: K, valor: (typeof r)[K]) =>
    setAjuste('recordatorio', { ...r, [clave]: valor })

  return (
    <div className="space-y-4">
      <Interruptor
        activo={r.notificar}
        etiqueta="Activar recordatorios"
        descripcion="Avisar cuando toca registrar una medicion."
        onChange={async (v) => {
          if (v) {
            const resultado = await pedirPermiso()
            if (resultado !== 'granted') {
              aviso('El navegador no permitio las notificaciones', 'error')
              return
            }
          }
          set('notificar', v)
        }}
      />

      {permiso === 'denied' && (
        <p className="rounded-lg bg-aviso-suave px-3 py-2 text-xs text-aviso">
          Las notificaciones estan bloqueadas en el navegador. Activalas desde
          los ajustes del navegador para este sitio.
        </p>
      )}

      <div className="space-y-3">
        <Campo etiqueta="Frecuencia" ayuda={describirIntervalo(r.intervaloMin)}>
          <Selector
            value={String(r.intervaloMin)}
            onChange={(e) => set('intervaloMin', Number(e.target.value))}
            disabled={!r.notificar}
          >
            <option value="0">Desactivado</option>
            <option value="120">Cada 2 horas</option>
            <option value="180">Cada 3 horas</option>
            <option value="240">Cada 4 horas</option>
            <option value="360">Cada 6 horas</option>
            <option value="480">Cada 8 horas</option>
          </Selector>
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Silencio desde" ayuda="No molestar a partir de">
            <Entrada
              type="time"
              value={minutosAHora(r.inicioSilencio)}
              onChange={(e) => set('inicioSilencio', horaAMinutos(e.target.value))}
              disabled={!r.notificar}
            />
          </Campo>
          <Campo etiqueta="Silencio hasta" ayuda="Volver a avisar">
            <Entrada
              type="time"
              value={minutosAHora(r.finSilencio)}
              onChange={(e) => set('finSilencio', horaAMinutos(e.target.value))}
              disabled={!r.notificar}
            />
          </Campo>
        </div>

        {enSilencio(r) && (
          <p className="text-xs text-texto-suave">
            Ahora mismo estas en horario de silencio: no llegaran avisos.
          </p>
        )}
      </div>

      <p className="text-xs text-texto-suave">
        Los recordatorios funcionan mientras la app esta abierta en el navegador.
      </p>
    </div>
  )
}

/**
 * Lanza el recordatorio desde la app mientras esta abierta.
 * Se usa el intervalo mas corto razonable (60 s) en lugar de esperar al
 * intervalo clinico completo, de modo que un aviso no puede emitirse por
 * accidentemente al cambiar de pantalla.
 */
export function useRecordatoriosActivos() {
  const { ajustes } = useAjustes()
  const { registros } = useRegistros()
  const ultimaEnvio = useRef(0)

  useEffect(() => {
    if (!ajustes.recordatorio.notificar) return
    const comprobar = () => {
      // Un envio cada 60 s como maximo evita rafagas de notificaciones.
      if (Date.now() - ultimaEnvio.current < 60_000) return
      const enviado = comprobarRecordatorio(
        ajustes.recordatorio,
        registros[0]?.createdAt ?? null,
      )
      if (enviado) ultimaEnvio.current = Date.now()
    }
    // Se comprueba al montar y luego cada minuto.
    comprobar()
    const intervalo = setInterval(comprobar, 60_000)
    return () => clearInterval(intervalo)
  }, [ajustes.recordatorio, registros])
}

// ---------------------------------------------------------------------------
// Datos y backup
// ---------------------------------------------------------------------------

function SeccionDatos() {
  const { registros, fusionar, vaciar, cargando } = useRegistros()
  const { visitas, fusionar: fusionarVisitas, vaciar: vaciarVisitas } = useVisitas()
  const { pacientes, ajustes, setAjuste, fusionarPacientes } = useAjustes()
  const { aviso } = useAvisos()
  const [confirmando, setConfirmando] = useState(false)
  const refArchivo = useRef<HTMLInputElement>(null)
  const [idb, setIdb] = useState<boolean | null>(null)

  useEffect(() => {
    void indexedDBDisponible().then(setIdb)
  }, [])

  const restaurar = (archivo: File) => {
    const lector = new FileReader()
    lector.onload = () => {
      try {
        const {
          registros: importados,
          pacientes: pacientesImportados,
          visitas: visitasImportadas,
        } = leerBackup(String(lector.result))
        if (!importados.length && !pacientesImportados.length && !visitasImportadas.length) {
          aviso('El archivo no contiene datos validos', 'error')
          return
        }

        if (importados.length) fusionar(importados)
        if (visitasImportadas.length) fusionarVisitas(visitasImportadas)
        const nuevosPacientes = fusionarPacientes(pacientesImportados)

        // Un unico aviso resume la operacion: si se avisa dos veces se puede
        // perder el primero, que es el que confirma que el archivo se leyo.
        const partes = [
          importados.length ? `${importados.length} mediciones` : null,
          visitasImportadas.length ? `${visitasImportadas.length} visitas` : null,
          nuevosPacientes ? `${nuevosPacientes} pacientes` : null,
        ].filter(Boolean)
        aviso(
          partes.length
            ? `Backup restaurado: ${partes.join(', ')}`
            : 'Backup restaurado: todo ya estaba guardado',
        )
      } catch {
        aviso('Archivo ilegible o con formato incorrecto', 'error')
      }
    }
    lector.readAsText(archivo)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2.5">
        <div className="tarjeta p-3 text-center">
          <p className="text-2xl font-semibold tabular-nums text-texto">{registros.length}</p>
          <p className="text-xs text-texto-suave">mediciones</p>
        </div>
        <div className="tarjeta p-3 text-center">
          <p className="text-2xl font-semibold tabular-nums text-texto">{visitas.length}</p>
          <p className="text-xs text-texto-suave">visitas</p>
        </div>
        <div className="tarjeta p-3 text-center">
          <p className="text-2xl font-semibold tabular-nums text-texto">{pacientes.length}</p>
          <p className="text-xs text-texto-suave">pacientes</p>
        </div>
      </div>

      <Boton
        ancho
        onClick={() => {
          exportarBackup(registros, pacientes, visitas)
          setAjuste('ultimoBackup', new Date().toISOString())
          aviso('Backup descargado')
        }}
        icono={<IconoDescargar width={18} height={18} />}
      >
        Descargar backup (JSON)
      </Boton>
      {ajustes.ultimoBackup && (
        <p className="-mt-2 text-center text-xs text-texto-suave">
          Ultimo backup:{' '}
          {/* Se pasa por los helpers de fecha en vez de `toLocaleString`: el
              locale fijado a es-ES daria las 24 horas, y aqui se muestran las
              12 como en el resto de la app. */}
          {fechaCorta(claveDia(new Date(ajustes.ultimoBackup)))} a las{' '}
          {hora12(claveHora(new Date(ajustes.ultimoBackup)))}
        </p>
      )}

      <Boton
        ancho
        variante="secundario"
        onClick={() => refArchivo.current?.click()}
        icono={<IconoSubir width={18} height={18} />}
      >
        Restaurar desde backup
      </Boton>
      <input
        ref={refArchivo}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const archivo = e.target.files?.[0]
          if (archivo) restaurar(archivo)
          // Se limpia el input para poder volver a elegir el mismo archivo.
          e.target.value = ''
        }}
      />

      <p className="text-xs text-texto-suave">
        Al restaurar se anaden las mediciones, las visitas y los pacientes del archivo
        a los existentes; no se borra nada. Si hay datos con el mismo
        identificador, se conservan los tuyos.
      </p>

      {/* Solo aparece si no hay nada guardado: ayuda a entender la app sin
          obligar a inventarse un paciente para probar. */}
      {!cargando && registros.length === 0 && (
        <div className="rounded-xl border border-dashed border-borde p-3 text-center">
          <p className="text-sm text-texto">Aun no hay mediciones</p>
          <p className="mt-1 text-xs text-texto-suave">
            Carga tres dias de datos de ejemplo para ver como funcionan las
            graficas y los reportes. Luego puedes borrarlos.
          </p>
          <Boton
            variante="secundario"
            ancho
            onClick={() => {
              const demo = crearRegistrosDemo()
              fusionar(demo)
              aviso(`${demo.length} mediciones de ejemplo cargadas`)
            }}
          >
            Cargar datos de ejemplo
          </Boton>
        </div>
      )}

      {idb === false && (
        <p className="rounded-lg bg-aviso-suave px-3 py-2 text-xs text-aviso">
          IndexedDB no esta disponible en este navegador: los datos se guardan
          solo en el almacenamiento local, que tiene menos espacio. Descarga
          backups con frecuencia.
        </p>
      )}

      <div className="border-t border-borde pt-4">
        <Boton variante="peligro" ancho onClick={() => setConfirmando(true)}>
          Borrar todos los datos
        </Boton>
      </div>

      <Modal abierto={confirmando} onCerrar={() => setConfirmando(false)} titulo="Borrar todo">
        <p className="text-sm text-texto">
          Se eliminaran las {registros.length} mediciones y las {visitas.length}{' '}
          visitas guardadas en este dispositivo. Esta accion no se puede deshacer.
        </p>
        <p className="mt-2 text-sm text-texto-suave">
          Descarga un backup antes si quieres conservar la informacion.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <Boton variante="secundario" onClick={() => setConfirmando(false)}>
            Cancelar
          </Boton>
          <Boton
            variante="peligro"
            onClick={() => {
              vaciar()
              vaciarVisitas()
              setConfirmando(false)
              aviso('Todos los datos han sido borrados')
            }}
          >
            Borrar todo
          </Boton>
        </div>
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Apariencia
// ---------------------------------------------------------------------------

function SeccionApariencia() {
  const { ajustes, setAjuste, temaEfectivo } = useAjustes()

  return (
    <div className="space-y-4">
      <Campo etiqueta="Tema">
        <Segmentado
          valor={ajustes.tema}
          opciones={[
            { valor: 'claro', etiqueta: 'Claro' },
            { valor: 'oscuro', etiqueta: 'Oscuro' },
            { valor: 'sistema', etiqueta: 'Sistema' },
          ]}
          onChange={(v) => setAjuste('tema', v)}
          className="w-full"
        />
      </Campo>
      <p className="flex items-center gap-2 text-xs text-texto-suave">
        {temaEfectivo === 'oscuro' ? (
          <IconoLuna width={16} height={16} />
        ) : (
          <IconoSol width={16} height={16} />
        )}
        Tema activo: {temaEfectivo}
      </p>
    </div>
  )
}