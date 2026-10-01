/**
 * Visitas medicas y a domicilio.
 *
 * Pantalla propia en lugar de un apartado mas de Ajustes porque el uso es
 * frecuente: se anota cada vez que viene el profesional, y tener que abrir
 * "Ajustes" para dejar constancia de una consulta hace que no se anote.
 *
 * Diseno: formulario siempre visible arriba (crear o editar) e historial debajo.
 * El formulario va primero porque anadir es la accion frecuente y buscar la
 * rara, asi no hay que desplegar nada para registrar la visita de hoy.
 */

import { useMemo, useState } from 'react'
import { useVisitas, valoresVisitaIniciales } from '../context/ContextoVisitas'
import { useAvisos } from '../components/Avisos'
import { claveDia, etiquetaRelativa, fechaCompleta, hora12 } from '../lib/fechas'
import {
  ETIQUETA_CORTA,
  aDatosVisita,
  validarVisita,
  type BorradorVisita,
} from '../lib/visitas'
import { crearVisitasDemo } from '../lib/demo'
import { exportarVisitasCSV, exportarVisitasXLSX } from '../lib/exportar'
import type { TipoVisita, Visita } from '../lib/tipos'
import { useHoy } from '../hooks/useHoy'
import {
  AreaTexto,
  Boton,
  Campo,
  Entrada,
  Insignia,
  Modal,
  Segmentado,
  Tarjeta,
  Vacio,
  cx,
} from '../components/UI'
import {
  IconoBorrar,
  IconoBuscar,
  IconoCasaVisita,
  IconoEditar,
  IconoMas,
  IconoMedico,
} from '../components/Iconos'

/** Filtro por tipo: todas, solo consultas o solo horarios a domicilio. */
type Filtro = 'todas' | TipoVisita

const VACIA: BorradorVisita = {
  fecha: '',
  hora: '',
  tipo: 'consulta',
  motivo: '',
  profesional: '',
  indicaciones: '',
  notas: '',
}

export function PaginaVisitas() {
  const { visitas, cargando, agregar, actualizar, eliminar, vaciar, fusionar } = useVisitas()
  const { aviso } = useAvisos()
  const hoy = useHoy()

  const [editando, setEditando] = useState<Visita | null>(null)
  // El borrador se rellena al pulsar "Editar", no en un efecto: asi el formulario
  // refleja siempre exactamente lo que se esta editando, sin un render extra ni
  // el aviso de `set-state-in-effect`.
  const [borrador, setBorrador] = useState<BorradorVisita>(() => ({
    ...VACIA,
    ...valoresVisitaIniciales(),
  }))
  const [tocado, setTocado] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [borrarAbierto, setBorrarAbierto] = useState(false)
  const [exportando, setExportando] = useState(false)

  const cambiar = <K extends keyof BorradorVisita>(
    clave: K,
    valor: BorradorVisita[K],
  ) => setBorrador((p) => ({ ...p, [clave]: valor }))

  /** Vuelve al formulario de "nueva visita" con la fecha y hora de ahora. */
  const limpiarFormulario = () => {
    setEditando(null)
    setBorrador({ ...VACIA, ...valoresVisitaIniciales() })
    setTocado(false)
  }

  /** Carga una visita en el formulario para editarla. */
  const editar = (v: Visita) => {
    setEditando(v)
    setBorrador({
      fecha: v.fecha,
      hora: v.hora ?? '',
      tipo: v.tipo,
      motivo: v.motivo,
      profesional: v.profesional,
      indicaciones: v.indicaciones,
      notas: v.notas,
    })
    setTocado(false)
  }

  const errores = useMemo(() => validarVisita(borrador), [borrador])

  const guardar = () => {
    setTocado(true)
    // Se bloquea ante cualquier error, no solo motivo y fecha: si un texto
    // supera el maximo el campo ya muestra el aviso, y guardarlo en silencio
    // dejaria datos truncados sin que nadie se entere.
    if (Object.keys(errores).length) {
      aviso('Revisa el formulario', 'error')
      return
    }

    const datos = aDatosVisita(borrador)
    if (editando) {
      actualizar({ ...editando, ...datos })
      aviso('Visita actualizada')
    } else {
      agregar(datos)
      aviso('Visita registrada')
    }
    limpiarFormulario()
  }

  const confirmarBorrado = (v: Visita) => {
    const tipo = v.tipo === 'consulta' ? 'consulta' : 'visita a domicilio'
    const cuando = hora12(v.hora)
      ? ` del ${fechaCompleta(v.fecha)} a las ${hora12(v.hora)}`
      : ` del ${fechaCompleta(v.fecha)}`
    if (confirm(`Eliminar la ${tipo}${cuando}?\n\nEsta accion no se puede deshacer.`)) {
      eliminar(v.id)
      // Si la visita borrada era la que se estaba editando, el formulario vuelve
      // al de "nueva visita" en lugar de quedarse con datos de algo que ya no existe.
      if (editando?.id === v.id) limpiarFormulario()
      aviso('Visita eliminada')
    }
  }

  const filtradas = useMemo(() => {
    const term = busqueda.trim().toLowerCase()
    return visitas.filter((v) => {
      if (filtro !== 'todas' && v.tipo !== filtro) return false
      if (!term) return true
      return (
        v.motivo.toLowerCase().includes(term) ||
        v.profesional.toLowerCase().includes(term) ||
        v.indicaciones.toLowerCase().includes(term) ||
        v.notas.toLowerCase().includes(term) ||
        v.fecha.includes(term)
      )
    })
  }, [visitas, busqueda, filtro])

  const exportar = async (formato: 'csv' | 'xlsx') => {
    setExportando(true)
    try {
      const nombre = `visitas-${claveDia(new Date())}`
      if (formato === 'csv') exportarVisitasCSV(filtradas, nombre)
      else await exportarVisitasXLSX(filtradas, nombre)
      aviso(`Visitas exportadas (${formato.toUpperCase()})`)
    } catch {
      aviso('No se pudo exportar', 'error')
    } finally {
      setExportando(false)
    }
  }

  const hayFiltros = busqueda.trim() !== '' || filtro !== 'todas'

  return (
    <div className="space-y-4">
      <FormularioVisita
        borrador={borrador}
        errores={errores}
        tocado={tocado}
        editando={editando}
        hoy={hoy}
        onCambiar={cambiar}
        onGuardar={guardar}
        onCancelar={limpiarFormulario}
      />

      <Tarjeta className="space-y-3">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-texto">
            Historial de visitas
            {visitas.length > 0 && (
              <span className="ml-1.5 font-normal text-texto-suave">
                ({filtradas.length} de {visitas.length})
              </span>
            )}
          </h2>
          <Segmentado<Filtro>
            valor={filtro}
            onChange={setFiltro}
            className="w-full [&>button]:flex-1"
            opciones={[
              { valor: 'todas', etiqueta: 'Todas' },
              { valor: 'consulta', etiqueta: 'Consultas' },
              { valor: 'domicilio', etiqueta: 'Domicilio' },
            ]}
          />
        </div>

        <div className="relative">
          <IconoBuscar
            width={18}
            height={18}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-texto-suave"
          />
          <Entrada
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por motivo, profesional o fecha"
            aria-label="Buscar visitas"
            className="pl-10"
          />
        </div>

        {filtradas.length > 0 && (
          <div className="grid grid-cols-2 gap-2.5">
            <Boton variante="secundario" disabled={exportando} onClick={() => void exportar('csv')}>
              Exportar CSV
            </Boton>
            <Boton variante="secundario" disabled={exportando} onClick={() => void exportar('xlsx')}>
              Exportar Excel
            </Boton>
          </div>
        )}

        {cargando ? (
          <p className="py-6 text-center text-sm text-texto-suave">Cargando visitas...</p>
        ) : filtradas.length === 0 ? (
          hayFiltros ? (
            <Vacio
              titulo="Ninguna visita coincide"
              descripcion="Prueba a cambiar el filtro o la busqueda."
            />
          ) : (
            <div className="rounded-xl border border-dashed border-borde p-4 text-center">
              <IconoMedico width={32} height={32} className="mx-auto mb-2 text-texto-suave" />
              <p className="text-sm text-texto">Todavia no hay visitas registradas</p>
              <p className="mt-1 text-xs text-texto-suave">
                Anota arriba cada consulta o visita a domicilio que tenga el
                paciente: el informe medico las recoge.
              </p>
              <Boton
                variante="secundario"
                ancho
                className="mt-3"
                onClick={() => {
                  const demo = crearVisitasDemo()
                  fusionar(demo)
                  aviso(`${demo.length} visitas de ejemplo cargadas`)
                }}
              >
                Cargar visitas de ejemplo
              </Boton>
            </div>
          )
        ) : (
          <ul className="space-y-2.5">
            {filtradas.map((v) => (
              <li key={v.id}>
                <TarjetaVisita
                  visita={v}
                  hoy={hoy}
                  onEditar={() => editar(v)}
                  onBorrar={() => confirmarBorrado(v)}
                />
              </li>
            ))}
          </ul>
        )}

        {visitas.length > 0 && (
          <div className="border-t border-borde pt-3">
            <Boton variante="fantasma" ancho onClick={() => setBorrarAbierto(true)}>
              Borrar todas las visitas
            </Boton>
          </div>
        )}
      </Tarjeta>

      <Modal
        abierto={borrarAbierto}
        onCerrar={() => setBorrarAbierto(false)}
        titulo="Borrar visitas"
        ancho="sm"
      >
        <p className="text-sm text-texto">
          Se eliminaran las {visitas.length} visitas registradas en este
          dispositivo. Las mediciones no se tocan.
        </p>
        <p className="mt-2 text-sm text-texto-suave">
          Descarga un backup antes si quieres conservar la informacion.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <Boton variante="secundario" onClick={() => setBorrarAbierto(false)}>
            Cancelar
          </Boton>
          <Boton
            variante="peligro"
            onClick={() => {
              vaciar()
              setBorrarAbierto(false)
              limpiarFormulario()
              aviso('Visitas borradas')
            }}
          >
            Borrar
          </Boton>
        </div>
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------

function FormularioVisita({
  borrador,
  errores,
  tocado,
  editando,
  hoy,
  onCambiar,
  onGuardar,
  onCancelar,
}: {
  borrador: BorradorVisita
  errores: Partial<Record<keyof BorradorVisita, string>>
  tocado: boolean
  editando: Visita | null
  hoy: string
  onCambiar: <K extends keyof BorradorVisita>(clave: K, valor: BorradorVisita[K]) => void
  onGuardar: () => void
  onCancelar: () => void
}) {
  return (
    <Tarjeta className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-texto">
          {editando ? 'Editar visita' : 'Registrar visita'}
        </h2>
        {editando && (
          <Boton variante="fantasma" tamano="sm" onClick={onCancelar}>
            Cancelar
          </Boton>
        )}
      </div>

      {/* El tipo cambia el matiz del resto: una consulta aporta pruebas y receta,
          una visita a domicilio suele revisar el tratamiento en la propia casa. */}
      <Segmentado<TipoVisita>
        valor={borrador.tipo}
        onChange={(v) => onCambiar('tipo', v)}
        className="w-full [&>button]:flex-1"
        opciones={[
          { valor: 'consulta', etiqueta: 'Consulta medica' },
          { valor: 'domicilio', etiqueta: 'Visita a domicilio' },
        ]}
      />

      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Fecha" requerido error={tocado ? errores.fecha : undefined}>
          <Entrada
            type="date"
            value={borrador.fecha}
            max={hoy}
            onChange={(e) => onCambiar('fecha', e.target.value)}
          />
        </Campo>
        <Campo
          etiqueta="Hora"
          ayuda={borrador.tipo === 'domicilio' ? 'Opcional' : undefined}
          error={tocado ? errores.hora : undefined}
        >
          <Entrada
            type="time"
            value={borrador.hora}
            onChange={(e) => onCambiar('hora', e.target.value)}
          />
        </Campo>
      </div>

      <Campo
        etiqueta="Motivo de la visita"
        requerido
        error={tocado ? errores.motivo : undefined}
        ayuda={
          borrador.tipo === 'consulta'
            ? 'Revision, analiticas, cambio de tratamiento...'
            : 'Revision de la medicacion, caidas, como se siente...'
        }
      >
        <Entrada
          value={borrador.motivo}
          onChange={(e) => onCambiar('motivo', e.target.value)}
          placeholder={
            borrador.tipo === 'consulta' ? 'Revision de la tension' : 'Revision de la medicacion'
          }
        />
      </Campo>

      <Campo
        etiqueta="Profesional o centro"
        ayuda="Opcional, pero ayuda a saber quien firmo el informe"
        error={tocado ? errores.profesional : undefined}
      >
        <Entrada
          value={borrador.profesional}
          onChange={(e) => onCambiar('profesional', e.target.value)}
          placeholder="Dra. Garcia / Centro de salud"
        />
      </Campo>

      <Campo
        etiqueta="Indicaciones"
        ayuda="Medicacion, dosis y cambios acordados en la visita"
        error={tocado ? errores.indicaciones : undefined}
      >
        <AreaTexto
          value={borrador.indicaciones}
          onChange={(e) => onCambiar('indicaciones', e.target.value)}
          rows={3}
          placeholder="Continuar furosemida 40 mg. Si la tension baja de 90, avisar."
        />
      </Campo>

      <Campo etiqueta="Notas" ayuda="Opcional" error={tocado ? errores.notas : undefined}>
        <AreaTexto
          value={borrador.notas}
          onChange={(e) => onCambiar('notas', e.target.value)}
          rows={2}
          placeholder="Lo que quedo pendiente, analiticas pedidas..."
        />
      </Campo>

      <Boton ancho onClick={onGuardar} icono={<IconoMas width={18} height={18} />}>
        {editando ? 'Guardar cambios' : 'Registrar visita'}
      </Boton>
    </Tarjeta>
  )
}

// ---------------------------------------------------------------------------
// Tarjeta de una visita
// ---------------------------------------------------------------------------

function TarjetaVisita({
  visita,
  hoy,
  onEditar,
  onBorrar,
}: {
  visita: Visita
  hoy: string
  onEditar: () => void
  onBorrar: () => void
}) {
  const esDomicilio = visita.tipo === 'domicilio'

  return (
    <div className="rounded-xl border border-borde bg-superficie-2 p-3">
      <div className="flex items-start gap-2.5">
        <span
          className={cx(
            'grid size-9 shrink-0 place-items-center rounded-lg',
            esDomicilio ? 'bg-aviso-suave text-aviso' : 'bg-marca-suave text-marca',
          )}
        >
          {esDomicilio ? (
            <IconoCasaVisita width={18} height={18} />
          ) : (
            <IconoMedico width={18} height={18} />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-texto">{visita.motivo}</span>
            <Insignia
              className={esDomicilio ? 'bg-aviso-suave text-aviso' : 'bg-marca-suave text-marca'}
            >
              {ETIQUETA_CORTA[visita.tipo]}
            </Insignia>
          </div>

          <p className="mt-0.5 text-xs text-texto-suave">
            {fechaCompleta(visita.fecha)}
            {hora12(visita.hora) && ` a las ${hora12(visita.hora)}`}
            {` · ${etiquetaRelativa(visita.fecha, hoy)}`}
            {visita.profesional && ` · ${visita.profesional}`}
          </p>

          {visita.indicaciones && (
            <p className="mt-2 whitespace-pre-line rounded-lg bg-ok-suave px-2.5 py-1.5 text-xs text-ok">
              {visita.indicaciones}
            </p>
          )}
          {visita.notas && (
            <p className="mt-1.5 whitespace-pre-line text-xs text-texto-suave">{visita.notas}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-1">
          <button
            onClick={onEditar}
            aria-label={`Editar la visita del ${fechaCompleta(visita.fecha)}`}
            className="grid size-9 place-items-center rounded-lg text-texto-suave hover:bg-superficie-3 hover:text-texto"
          >
            <IconoEditar width={17} height={17} />
          </button>
          <button
            onClick={onBorrar}
            aria-label={`Eliminar la visita del ${fechaCompleta(visita.fecha)}`}
            className="grid size-9 place-items-center rounded-lg text-texto-suave hover:bg-alerta-suave hover:text-alerta"
          >
            <IconoBorrar width={17} height={17} />
          </button>
        </div>
      </div>
    </div>
  )
}