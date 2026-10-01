/**
 * Historial completo con filtros y busqueda.
 *
 * Los registros se agrupan por dia, cada uno con su encabezado "DD/MM - Dia".
 * Quien lleva un paciente casi siempre piensa en dias ("el martes tomaste dos
 * veces"), no en una lista plana de filas.
 *
 * La paginacion va por dias, no por filas: un dia no se parte entre dos paginas,
 * que dejaria el encabezado de un grupo abajo y sus mediciones en la siguiente.
 * El filtrado se hace en memoria: el volumen de datos de un paciente (unas
 * cientos de filas al año) no justifica indices ni paginacion en base de datos.
 */

import { useMemo, useState } from 'react'
import { useRegistros } from '../context/ContextoRegistros'
import { useAjustes } from '../context/ContextoAjustes'
import { useAvisos } from '../components/Avisos'
import { claveDia, etiquetaDia, fechaCompleta, hora12 } from '../lib/fechas'
import { agruparPorDia, rangoTotal } from '../lib/resumen'
import { exportarCSV, exportarXLSX } from '../lib/exportar'
import type { Registro } from '../lib/tipos'
import { ListaMediciones } from '../components/Resumen'
import { Boton, Campo, Entrada, Selector, Tarjeta, Vacio } from '../components/UI'
import {
  IconoBuscar,
  IconoBorrar,
  IconoCheck,
  IconoCerrar,
  IconoDescargar,
  IconoHistorial,
  IconoWhatsapp,
} from '../components/Iconos'
import { FormularioRegistro } from '../components/FormularioRapido'

/** Dias por pagina. Un dia son unas pocas tomas, asi que 10 da paginas manejables. */
const DIAS_POR_PAGINA = 10

type Orden = 'reciente' | 'antiguo'

export function PaginaHistorial() {
  const { registros, eliminar } = useRegistros()
  const { ajustes, presionHabitual } = useAjustes()
  const { aviso } = useAvisos()

  const [busqueda, setBusqueda] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [soloConAlertas, setSoloConAlertas] = useState(false)
  const [orden, setOrden] = useState<Orden>('reciente')
  const [pagina, setPagina] = useState(1)
  const [editando, setEditando] = useState<Registro | null>(null)
  const [exportando, setExportando] = useState(false)
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false)

  const rango = useMemo(() => rangoTotal(registros), [registros])

  const filtrados = useMemo(() => {
    const term = busqueda.trim().toLowerCase()
    let lista = registros

    if (desde) lista = lista.filter((r) => r.fecha >= desde)
    if (hasta) lista = lista.filter((r) => r.fecha <= hasta)
    if (soloConAlertas) {
      lista = lista.filter(
        (r) =>
          r.o2 < ajustes.umbral.o2Min ||
          r.bpm < ajustes.umbral.bpmMin ||
          r.bpm > ajustes.umbral.bpmMax ||
          r.presionSis < ajustes.umbral.presionSisMin ||
          r.presionSis > ajustes.umbral.presionSisMax ||
          r.presionDia < ajustes.umbral.presionDiaMin ||
          r.presionDia > ajustes.umbral.presionDiaMax,
      )
    }
    if (term) {
      // La busqueda cubre notas y tambien los valores, para poder buscar
      // "furosemida" o "O2 99" sin filtros adicionales.
lista = lista.filter(
        (r) =>
          r.notas.toLowerCase().includes(term) ||
          r.fecha.includes(term) ||
          // Se buscan las dos formas: quien teclea "13" y quien teclea "1 PM".
          r.hora.includes(term) ||
          hora12(r.hora).toLowerCase().includes(term) ||
          String(r.presionSis).includes(term) ||
          String(r.presionDia).includes(term) ||
          String(r.o2).includes(term) ||
          String(r.bpm).includes(term) ||
          (r.orina !== null && String(r.orina).includes(term)),
      )
    }

    return orden === 'reciente' ? lista : [...lista].reverse()
  }, [registros, busqueda, desde, hasta, soloConAlertas, orden, ajustes.umbral])

// El agrupado por dia vive en `lib/resumen` para poder probarlo sin montar la
  // pagina: es la logica que sostiene la paginacion por dias.
  const grupos = useMemo(() => agruparPorDia(filtrados), [filtrados])

  const totalPaginas = Math.max(1, Math.ceil(grupos.length / DIAS_POR_PAGINA))
  const paginaActual = Math.min(pagina, totalPaginas)
  const visibles = grupos.slice(
    (paginaActual - 1) * DIAS_POR_PAGINA,
    paginaActual * DIAS_POR_PAGINA,
  )

  const hayFiltros = Boolean(busqueda || desde || hasta || soloConAlertas)
  const limpiar = () => {
    setBusqueda('')
    setDesde('')
    setHasta('')
    setSoloConAlertas(false)
    setPagina(1)
  }

const confirmarBorrado = (r: Registro) => {
    if (
      confirm(
        `Eliminar la medicion del ${fechaCompleta(r.fecha)} a las ${hora12(r.hora)}?\n\nEsta accion no se puede deshacer.`,
      )
    ) {
      eliminar(r.id)
      aviso('Medicion eliminada')
    }
  }

  const exportar = async (formato: 'csv' | 'xlsx') => {
    if (!filtrados.length) {
      aviso('No hay registros para exportar', 'error')
      return
    }
    setExportando(true)
    try {
      const nombre = `signos-vitales-${claveDia(new Date())}`
      if (formato === 'csv') {
        exportarCSV(filtrados, nombre)
      } else {
        await exportarXLSX(filtrados, nombre)
      }
      aviso(`${filtrados.length} registros exportados`)
    } catch {
      aviso('No se pudo exportar. Intenta de nuevo.', 'error')
    } finally {
      setExportando(false)
    }
  }

  if (editando) {
    return (
      <div className="space-y-4">
        <Tarjeta className="flex items-center justify-between gap-3">
<p className="text-sm text-texto-suave">
            Editando la medicion del{' '}
            <strong className="text-texto">{fechaCompleta(editando.fecha)}</strong> a las{' '}
            <strong className="text-texto">{hora12(editando.hora)}</strong>
          </p>
          <button
            onClick={() => setEditando(null)}
            aria-label="Cancelar edicion"
            className="grid size-11 place-items-center rounded-xl text-texto-suave hover:bg-superficie-3"
          >
            <IconoCerrar />
          </button>
        </Tarjeta>
        <FormularioRegistro registroEditando={editando} onCancelar={() => setEditando(null)} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Buscador */}
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-texto-suave">
          <IconoBuscar width={18} height={18} />
        </span>
        <Entrada
          type="search"
          value={busqueda}
          onChange={(e) => {
            setBusqueda(e.target.value)
            setPagina(1)
          }}
          placeholder="Buscar en notas, fechas o valores"
          className="pl-10 pr-10"
          aria-label="Buscar registros"
        />
        {busqueda && (
          <button
            onClick={() => setBusqueda('')}
            aria-label="Limpiar busqueda"
            className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-texto-suave hover:bg-superficie-3"
          >
            <IconoCerrar width={16} height={16} />
          </button>
        )}
      </div>

      {/* Filtros */}
      <Tarjeta className="space-y-3">
        <button
          onClick={() => setFiltrosAbiertos((a) => !a)}
          aria-expanded={filtrosAbiertos}
          className="flex w-full items-center justify-between text-sm font-medium text-texto"
        >
          <span className="flex items-center gap-1.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 5h18l-7 8v6l-4 2v-8z" />
            </svg>
            Filtros
            {hayFiltros && (
              <span className="rounded-full bg-marca px-1.5 text-[0.65rem] font-semibold text-white">
                activos
              </span>
            )}
          </span>
          <span className="text-texto-suave">{filtrosAbiertos ? 'Ocultar' : 'Mostrar'}</span>
        </button>

        {filtrosAbiertos && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Desde">
                <Entrada
                  type="date"
                  value={desde}
                  max={rango?.hasta}
                  onChange={(e) => {
                    setDesde(e.target.value)
                    setPagina(1)
                  }}
                />
              </Campo>
              <Campo etiqueta="Hasta">
                <Entrada
                  type="date"
                  value={hasta}
                  min={rango?.desde}
                  onChange={(e) => {
                    setHasta(e.target.value)
                    setPagina(1)
                  }}
                />
              </Campo>
            </div>

            <label className="flex min-h-11 items-center gap-2.5 rounded-xl bg-superficie-2 px-3 text-sm text-texto">
              <input
                type="checkbox"
                checked={soloConAlertas}
                onChange={(e) => {
                  setSoloConAlertas(e.target.checked)
                  setPagina(1)
                }}
                className="size-4 accent-[var(--color-marca)]"
              />
              Solo mediciones fuera de rango
            </label>

            <div>
              <span className="mb-1.5 block text-sm font-medium text-texto">Orden</span>
              <Selector
                value={orden}
                onChange={(e) => {
                  setOrden(e.target.value as Orden)
                  setPagina(1)
                }}
                aria-label="Orden de los registros"
              >
                <option value="reciente">Mas recientes primero</option>
                <option value="antiguo">Mas antiguos primero</option>
              </Selector>
            </div>

            {hayFiltros && (
              <Boton variante="secundario" ancho onClick={limpiar} icono={<IconoBorrar width={16} height={16} />}>
                Limpiar filtros
              </Boton>
            )}
          </div>
        )}
      </Tarjeta>

      {/* Resultado */}
      <Tarjeta className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-texto">
            {filtrados.length}{' '}
            {filtrados.length === 1 ? 'registro' : 'registros'}
            {hayFiltros && <span className="font-normal text-texto-suave"> filtrados</span>}
          </h2>
          {rango && (
            <span className="text-xs text-texto-suave">
              {rango.desde.slice(8)}/{rango.desde.slice(5, 7)} &ndash; {rango.hasta.slice(8)}/
              {rango.hasta.slice(5, 7)}
            </span>
          )}
        </div>

{filtrados.length === 0 ? (
          <Vacio
            icono={<IconoHistorial width={34} height={34} />}
            titulo={registros.length === 0 ? 'Sin registros' : 'Sin resultados'}
            descripcion={
              registros.length === 0
                ? 'Registra la primera medicion desde la pestana Inicio.'
                : 'Prueba a cambiar los filtros o la busqueda.'
            }
            accion={
              hayFiltros ? (
                <Boton variante="secundario" onClick={limpiar}>
                  Limpiar filtros
                </Boton>
              ) : undefined
            }
          />
        ) : (
          <>
            <ul className="space-y-5">
              {visibles.map((g) => (
                <li key={g.fecha}>
                  {/* Encabezado del grupo de dia: "30/09 - Miercoles" */}
                  <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b border-borde pb-1.5">
                    <h3 className="text-sm font-semibold text-texto">
                      {etiquetaDia(g.fecha)}
                    </h3>
                    <span className="text-xs text-texto-suave">
                      {g.registros.length}{' '}
                      {g.registros.length === 1 ? 'medicion' : 'mediciones'}
                    </span>
                  </div>
                  <ListaMediciones
                    registros={g.registros}
                    umbral={ajustes.umbral}
                    habitual={presionHabitual}
                    sinCabecera
                    onEditar={setEditando}
                    onEliminar={confirmarBorrado}
                  />
                </li>
              ))}
            </ul>

            {totalPaginas > 1 && (
              <Paginacion
                pagina={paginaActual}
                total={totalPaginas}
                onChange={(p) => {
                  setPagina(p)
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
              />
            )}
          </>
        )}
      </Tarjeta>

      {/* Exportacion */}
      <Tarjeta className="space-y-3">
        <h2 className="text-sm font-semibold text-texto">Exportar</h2>
        <p className="text-xs text-texto-suave">
          Se exportan los {filtrados.length} registros
          {hayFiltros ? ' que cumplen los filtros actuales' : ''}.
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          <Boton
            variante="secundario"
            onClick={() => void exportar('csv')}
            disabled={exportando || !filtrados.length}
            icono={<IconoDescargar width={18} height={18} />}
          >
            Excel (CSV)
          </Boton>
          <Boton
            variante="secundario"
            onClick={() => void exportar('xlsx')}
            disabled={exportando || !filtrados.length}
            icono={exportando ? <IconoCheck width={18} height={18} /> : <IconoWhatsapp width={18} height={18} />}
          >
            Excel (XLSX)
          </Boton>
        </div>
      </Tarjeta>
    </div>
  )
}

/** Paginacion compacta con primera/anterior/siguiente/ultima. */
function Paginacion({
  pagina,
  total,
  onChange,
}: {
  pagina: number
  total: number
  onChange: (p: number) => void
}) {
  return (
    <nav className="flex items-center justify-between gap-2 border-t border-borde pt-3" aria-label="Paginacion">
      <Boton
        variante="secundario"
        tamano="sm"
        disabled={pagina === 1}
        onClick={() => onChange(pagina - 1)}
      >
        Anterior
      </Boton>
      <span className="text-sm text-texto-suave">
        Pagina {pagina} de {total}
      </span>
      <Boton
        variante="secundario"
        tamano="sm"
        disabled={pagina === total}
        onClick={() => onChange(pagina + 1)}
      >
        Siguiente
      </Boton>
    </nav>
  )
}