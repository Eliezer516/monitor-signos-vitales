/**
 * Exportacion de datos: CSV, XLSX, JSON (backup) y PDF via impression.
 *
 * Se evita una libreria de PDF (jspdf/pdfmake, +300 kB) porque el reporte
 * medico necesita buena tipografia y saltos de pagina, que el motor de
 * impresion del navegador resuelve mejor. El usuario elige "Guardar como PDF".
 */

import type {
  AjustesCompartidos,
  Borrado,
  MarcasCompartidas,
  Paciente,
  PresionHabitual,
  Registro,
  Umbrales,
  Visita,
} from './tipos'
import { claveDia, fechaCompleta, hora12 } from './fechas'
import { normalizarPaciente } from './db'
import { resumenDia } from './resumen'
import { CABECERA_VISITAS, ETIQUETA_VISITA, filaVisita } from './visitas'
import { CAMPOS_COMPARTIDOS } from './fusion'

/** Descarga un Blob como archivo. */
function descargar(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Se libera en el siguiente tick: cancelar antes puede abortar la descarga
  // en algunos navegadores moviles.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const cabecera = ['Fecha', 'Hora', 'Presion sistolica', 'Presion diastolica', 'O2 (%)', 'Pulso (lpm)', 'Orina (ml)', 'Notas']

/** Filas de un registro, en el orden de `cabecera`. */
const fila = (r: Registro) => [
  r.fecha,
  // CSV y Excel se quedan en 24 h a proposito: en una hoja de calculo "8:05 AM"
  // es texto, y no se puede ordenar por hora ni filtrar por rango. El informe
  // impreso si va en 12 h, porque ahi lo lee una persona.
  r.hora,
  r.presionSis,
  r.presionDia,
  r.o2,
  r.bpm,
  r.orina ?? '',
  r.notas,
]

/**
 * Genera un CSV compatible con Excel.
 * Se anade BOM para que Excel reconozca UTF-8 y muestre bien los acentos.
 */
export function exportarCSV(registros: Registro[], nombreArchivo = 'signos-vitales'): void {
  const escapar = (v: unknown) => {
    const s = String(v ?? '')
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lineas = [
    cabecera.map(escapar).join(';'),
    ...registros.map((r) => fila(r).map(escapar).join(';')),
  ]
  // `sep=;` evita que Excel con locale anglosajona rompa las columnas.
  const csv = '\uFEFFsep=;\n' + lineas.join('\r\n')
  descargar(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${nombreArchivo}.csv`)
}

/**
 * Genera un CSV de las visitas.
 *
 * Se repite el escapado de `exportarCSV` a proposito en lugar de extraerlo a
 * un helper compartido: son dos lineas y asi cada exportacion se lee sola.
 */
export function exportarVisitasCSV(visitas: Visita[], nombreArchivo = 'visitas'): void {
  const escapar = (v: unknown) => {
    const s = String(v ?? '')
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lineas = [
    CABECERA_VISITAS.map(escapar).join(';'),
    ...visitas.map((v) => filaVisita(v).map(escapar).join(';')),
  ]
  const csv = '\uFEFFsep=;\n' + lineas.join('\r\n')
  descargar(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${nombreArchivo}.csv`)
}

/**
 * Exporta las visitas a Excel (.xlsx) con una hoja propia.
 * Es un archivo aparte y no una hoja mas del Excel de mediciones porque se
 * exporta en un momento distinto: el historial de visitas se lleva el medico,
 * las mediciones se analizan en casa.
 */
export async function exportarVisitasXLSX(
  visitas: Visita[],
  nombreArchivo = 'visitas',
): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  const hoja = writeXlsxFile([
    {
      sheet: 'Visitas',
      data: [CABECERA_VISITAS, ...visitas.map((v) => filaVisita(v))],
      columns: CABECERA_VISITAS.map((t) => ({ width: Math.max(14, t.length + 4) })),
    },
  ])
  await hoja.toFile(`${nombreArchivo}.xlsx`)
}

/**
 * Exporta a Excel (.xlsx) con dos hojas: registros y resumen diario.
 * La libreria se carga bajo demanda para no penalizar el arranque.
 */
export async function exportarXLSX(
  registros: Registro[],
  nombreArchivo = 'signos-vitales',
): Promise<void> {
  // Subruta `/browser`: la paquete expone builds separados por plataforma y
  // esta evita arrastrar el code de Node.js.
  const { default: writeXlsxFile } = await import('write-excel-file/browser')

  const filasRegistro: (string | number)[][] = [
    cabecera,
    ...registros.map((r) => fila(r).map((v) => (v === '' ? '' : v))),
  ]

  const dias = [...new Set(registros.map((r) => r.fecha))].sort()
  const resumenes = dias.map((d) => {
    const s = resumenDia(registros, d)
    return [
      d,
      s.registros.length,
      s.totalOrina,
      s.promedioPresionSis ?? '',
      s.promedioPresionDia ?? '',
      s.minO2 ?? '',
      s.maxO2 ?? '',
      s.promedioBPM ?? '',
    ]
  })
  const filasResumen: (string | number)[][] = [
    ['Fecha', 'Mediciones', 'Orina total (ml)', 'Prom. sistolica', 'Prom. diastolica', 'O2 min', 'O2 max', 'Prom. pulso'],
    ...resumenes,
  ]

  // API v4: el nombre del archivo se indica en `.toFile()` y cada hoja usa
  // `sheet` para el nombre y `columns` solo admite anchos.
  const hojaRegistros = writeXlsxFile([
    {
      sheet: 'Registros',
      data: filasRegistro,
      columns: cabecera.map((t) => ({ width: Math.max(14, t.length + 4) })),
    },
    {
      sheet: 'Resumen diario',
      data: filasResumen,
      columns: [18, 14, 18, 18, 19, 11, 11, 15].map((width) => ({ width })),
    },
  ])

  await hojaRegistros.toFile(`${nombreArchivo}.xlsx`)
}

/**
 * Formato del archivo de backup, versionado para restaurarlo en el futuro.
 *
 * Es tambien el formato que se sube a Drive, a proposito: tener dos formatos
 * significaria que una correccion en la fusion llegase a un sitio y no al otro.
 *
 * - v1: solo registros y pacientes.
 * - v2: anade `visitas`.
 * - v3: anade `borrados` (para que un borrado viaje), `ajustes` y `marcas` (la
 *   parte de los ajustes que es igual en todos los dispositivos).
 *
 * Las tres claves nuevas son opcionales porque un backup v1 o v2 no las tiene y
 * debe seguir restaurando. Igual pasa dentro de cada registro: los antiguos no
 * traen `updatedAt`, y `lib/fusion` los trata como si su marca fuera su
 * `createdAt`, de modo que no se pierde nada al subir la version del formato.
 */
export interface Backup {
  version: 1 | 2 | 3
  exportadoEn: string
  app: 'signos-vitales'
  registros: Registro[]
  pacientes: Paciente[]
  /** Presente desde v2. */
  visitas?: Visita[]
  /** Presente desde v3. Marcas de lo que se borro, para propagar el borrado. */
  borrados?: Borrado[]
  /** Presente desde v3. Solo la parte de Ajustes que se comparte. */
  ajustes?: AjustesCompartidos
  /** Presente desde v3. Ultima modificacion de cada campo de `ajustes`. */
  marcas?: MarcasCompartidas
}

/** Datos que se guardan en un backup, tal y como los da cada contexto. */
export interface DatosBackup {
  registros: Registro[]
  pacientes: Paciente[]
  visitas?: Visita[]
  borrados?: Borrado[]
  ajustes?: AjustesCompartidos
  marcas?: MarcasCompartidas
}

/** Monta el backup en memoria, sin descargarlo. Lo usan exportar y Drive. */
export function construirBackup(datos: DatosBackup): Backup {
  return {
    version: 3,
    exportadoEn: new Date().toISOString(),
    app: 'signos-vitales',
    registros: datos.registros,
    pacientes: datos.pacientes,
    visitas: datos.visitas ?? [],
    borrados: datos.borrados ?? [],
    ...(datos.ajustes ? { ajustes: datos.ajustes } : {}),
    ...(datos.marcas ? { marcas: datos.marcas } : {}),
  }
}

/** Nombre de archivo con la fecha, para que varios backups se ordenen solos. */
export function nombreBackup(fecha = new Date()): string {
  const dia = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(
    fecha.getDate(),
  ).padStart(2, '0')}`
  return `signos-vitales-${dia}`
}

/** Descarga un backup completo en JSON, restaurable desde Ajustes. */
export function exportarBackup(datos: DatosBackup, nombre = nombreBackup()): void {
  descargar(
    new Blob([JSON.stringify(construirBackup(datos), null, 2)], { type: 'application/json' }),
    `${nombre}.json`,
  )
}

/**
 * Comparte el backup con otra app sin descargarlo antes.
 *
 * En movil abre la hoja de compartir del sistema, donde Drive aparece como
 * destino.
 * Se apoya en un clic del usuario, que es lo que exige la API de compartir, y no
 * necesita ningun permiso: por eso funciona antes de conectar la cuenta.
 */
export async function compartirBackup(
  datos: DatosBackup,
  nombre = nombreBackup(),
): Promise<'compartido' | 'no-soportado'> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return 'no-soportado'
  const archivo = new File(
    [JSON.stringify(construirBackup(datos), null, 2)],
    `${nombre}.json`,
    { type: 'application/json' },
  )
  if (!nav.canShare({ files: [archivo] })) return 'no-soportado'
  await nav.share({ files: [archivo], title: 'Backup de signos vitales' })
  return 'compartido'
}

/**
 * Valida y normaliza un backup cargado desde archivo.
 * Se filtran los registros mal formados en lugar de rechazar todo el archivo,
 * para no perder datos validos por un registro corrupto.
 */
/**
 * Convierte un valor desconocido en numero, o `null` si no lo es.
 *
 * No basta con `Number.isFinite(Number(v))`: `Number('')` es `0` y
 * `Number(' ')` tambien, de modo que un campo vacio en un backup pasaria la
 * validacion y se importaria como un 0% de oxigeno o 0 mmHg de presion, es
 * decir, como una falsa alarma. Aqui los vacios se rechazan.
 */
function aNumero(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return null
  if (typeof v === 'string' && v.trim() === '') return null
  if (typeof v !== 'number' && typeof v !== 'string') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Valida y normaliza un backup cargado desde archivo.
 * Se filtran los registros mal formados en lugar de rechazar todo el archivo,
 * para no perder datos validos por un registro corrupto.
 */
export function leerBackup(texto: string): {
  registros: Registro[]
  pacientes: Paciente[]
  visitas: Visita[]
  borrados: Borrado[]
  ajustes: Partial<AjustesCompartidos> | null
  marcas: MarcasCompartidas
} {
  const datos = JSON.parse(texto)
  if (!datos || typeof datos !== 'object') throw new Error('Archivo no valido')

  /** `updatedAt` solo si es una cadena; si no, se deja ausente a proposito. */
  const marca = (c: Record<string, unknown>): { updatedAt?: string } =>
    typeof c.updatedAt === 'string' && c.updatedAt ? { updatedAt: c.updatedAt } : {}

  const crudos: unknown[] = Array.isArray(datos.registros) ? datos.registros : []
  const registros: Registro[] = crudos
    .filter((r: unknown): r is Registro => {
      if (!r || typeof r !== 'object') return false
      const c = r as Record<string, unknown>
      return (
        typeof c.fecha === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(c.fecha) &&
        typeof c.hora === 'string' &&
        /^\d{2}:\d{2}$/.test(c.hora) &&
        aNumero(c.presionSis) !== null &&
        aNumero(c.presionDia) !== null &&
        aNumero(c.o2) !== null &&
        aNumero(c.bpm) !== null
      )
    })
    .map((r) => {
      const c = r as unknown as Record<string, unknown>
      // `orina` es opcional: ausente o vacia significa "sin medir".
      return {
        id:
          typeof c.id === 'string' && c.id
            ? c.id
            : `import-${Math.random().toString(36).slice(2)}`,
        fecha: c.fecha as string,
        hora: c.hora as string,
        presionSis: aNumero(c.presionSis) as number,
        presionDia: aNumero(c.presionDia) as number,
        o2: aNumero(c.o2) as number,
        bpm: aNumero(c.bpm) as number,
        orina: aNumero(c.orina),
        notas: typeof c.notas === 'string' ? c.notas : '',
        createdAt:
          typeof c.createdAt === 'string' ? c.createdAt : `${c.fecha}T${c.hora}:00`,
        ...marca(c),
      }
    })

  const pacientes: Paciente[] = (Array.isArray(datos.pacientes) ? datos.pacientes : [])
    .filter((p: unknown) => p && typeof p === 'object' && typeof (p as Paciente).nombre === 'string')
    .map((p: unknown) => normalizarPaciente(p as Paciente & { creadoAt?: string }))

  // Las visitas se validan con la misma politica que los registros: se descarta
  // la que este mal formada en vez de rechazar el archivo entero. Una visita sin
  // `tipo` recogniseda se descarta tambien, porque sin saber si fue consulta o
  // domicilio el informe clinico mentiria.
  const crudasVisitas: unknown[] = Array.isArray(datos.visitas) ? datos.visitas : []
  const visitas: Visita[] = crudasVisitas
    .filter((v: unknown): v is Visita => {
      if (!v || typeof v !== 'object') return false
      const c = v as Record<string, unknown>
      return (
        typeof c.fecha === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(c.fecha) &&
        (c.tipo === 'consulta' || c.tipo === 'domicilio') &&
        typeof c.motivo === 'string' &&
        c.motivo.trim() !== ''
      )
    })
    .map((v) => {
      const c = v as unknown as Record<string, unknown>
      const texto = (x: unknown) => (typeof x === 'string' ? x : '')
      return {
        id:
          typeof c.id === 'string' && c.id ? c.id : `import-${Math.random().toString(36).slice(2)}`,
        fecha: c.fecha as string,
        hora: typeof c.hora === 'string' && /^\d{2}:\d{2}$/.test(c.hora) ? c.hora : undefined,
        tipo: c.tipo as Visita['tipo'],
        motivo: c.motivo as string,
        profesional: texto(c.profesional),
        indicaciones: texto(c.indicaciones),
        notas: texto(c.notas),
        createdAt:
          typeof c.createdAt === 'string' ? c.createdAt : `${c.fecha}T${texto(c.hora) || '12:00'}:00`,
        ...marca(c),
      }
    })

  // Las marcas de borrado llegan de un backup v3. Un v1 o v2 no las tiene y no
  // tiene nada que borrar mas alla de lo que ya no esta, asi que se devuelven
  // vacias en vez de inventarlas.
  const borrados: Borrado[] = (Array.isArray(datos.borrados) ? datos.borrados : []).filter(
    (b: unknown): b is Borrado =>
      !!b &&
      typeof b === 'object' &&
      typeof (b as Borrado).id === 'string' &&
      typeof (b as Borrado).borradoAt === 'string' &&
      ((b as Borrado).ambito === 'registros' ||
        (b as Borrado).ambito === 'visitas' ||
        (b as Borrado).ambito === 'pacientes'),
  )

  const { ajustes, marcas } = leerAjustesCompartidos(datos)

  return { registros, pacientes, visitas, borrados, ajustes, marcas }
}

/**
 * Un registro plano de numeros, como `Umbrales`, `Limites` o `PresionHabitual`.
 *
 * Se comprueba la forma y no la lista de claves a proposito: las claves estan
 * en `tipos.ts` y `rangos.ts`, ycopiarlas aqui seria una tercera lista que
 * alguien tendria que acordarse de actualizar.
 */
function esRegistroDeNumeros(valor: unknown): boolean {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false
  const claves = Object.keys(valor as Record<string, unknown>)
  if (!claves.length) return false
  return claves.every((c) => {
    const v = (valor as Record<string, unknown>)[c]
    return typeof v === 'number' && Number.isFinite(v)
  })
}

/** Lista de plantillas de nota utilizable. */
function esListaDePlantillas(valor: unknown): boolean {
  if (!Array.isArray(valor)) return false
  return valor.every((p) => {
    if (!p || typeof p !== 'object') return false
    const c = p as Record<string, unknown>
    return typeof c.id === 'string' && typeof c.texto === 'string'
  })
}

/**
 * Ajustes y marcas compartidas de un backup, ya saneados.
 *
 * Sin esto, un `ajustes.umbral` que fuera una cadena llegaria tal cual a
 * `setAjuste` y reventaria al pintar `ajustes.umbral.o2Min`. Descartar el campo
 * en vez de todo el archivo es lo razonable: el resto del backup sigue siendo
 * recuperable y el ajuste cae al valor por defecto.
 *
 * Una marca sin su valor tambien se descarta. Si se conservara, `fusionarAjustes`
 * haria que ganara el remoto y asignaria `undefined` sobre un ajuste bueno.
 *
 * @returns `ajustes` es `null` si no queda ningun campo utilizable.
 */
function leerAjustesCompartidos(datos: Record<string, unknown>): {
  ajustes: Partial<AjustesCompartidos> | null
  marcas: MarcasCompartidas
} {
  const crudos = (datos.ajustes ?? {}) as Record<string, unknown>
  const crudasMarcas = (datos.marcas ?? {}) as Record<string, unknown>
  if (typeof crudos !== 'object' || Array.isArray(crudos)) return { ajustes: null, marcas: {} }

  const ajustes: Record<string, unknown> = {}
  const marcas: MarcasCompartidas = {}
  for (const campo of CAMPOS_COMPARTIDOS) {
    const valor = crudos[campo]
    const bueno = campo === 'plantillas' ? esListaDePlantillas(valor) : esRegistroDeNumeros(valor)
    if (!bueno) continue
    ajustes[campo] = campo === 'plantillas' ? valor : { ...(valor as object) }
    // La marca solo cuenta si es una fecha real: `fusionarAjustes` ordena
    // marcas como texto, y un "ayer" haria que el campo perdiera o ganara de
    // forma arbitraria.
    const marca = crudasMarcas[campo]
    if (typeof marca === 'string' && Number.isFinite(Date.parse(marca))) marcas[campo] = marca
  }

  return {
    ajustes: Object.keys(ajustes).length ? (ajustes as Partial<AjustesCompartidos>) : null,
    marcas,
  }
}

/** Genera el HTML del reporte medico para imprimir o guardar como PDF. */
export function reporteHTML(
  registros: Registro[],
  opciones: {
    paciente?: Paciente
    desde: string
    hasta: string
    umbral: Umbrales
    presionHabitual?: PresionHabitual
    /**
     * Visitas del periodo. Es opcional para no romper a quien genere el reporte
     * desde codigo anterior, y porque un paciente puede no tener ninguna.
     */
    visitas?: Visita[]
  },
): string {
  const { paciente, desde, hasta, umbral, presionHabitual, visitas = [] } = opciones
  const dias = [...new Set(registros.map((r) => r.fecha))].sort()
  const esc = (s: unknown) =>
    String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

  const filas = registros
    .map(
      (r) => `<tr>
      <td>${esc(r.fecha.split('-').reverse().join('/'))}</td>
      <td class="nowrap">${esc(hora12(r.hora))}</td>
      <td class="num">${esc(r.presionSis)}/${esc(r.presionDia)}</td>
      <td class="num">${esc(r.o2)}%</td>
      <td class="num">${esc(r.bpm)}</td>
      <td class="num">${r.orina === null ? '-' : esc(r.orina)}</td>
      <td class="notas">${esc(r.notas)}</td>
    </tr>`,
    )
    .join('')

  const resumenFilas = dias
    .map((d) => {
      const s = resumenDia(registros, d)
      return `<tr>
        <td>${esc(fechaCompleta(d))}</td>
        <td class="num">${s.registros.length}</td>
        <td class="num">${s.totalOrina}</td>
        <td class="num">${s.promedioPresionSis ?? '-'}/${s.promedioPresionDia ?? '-'}</td>
        <td class="num">${s.minO2 ?? '-'} - ${s.maxO2 ?? '-'}</td>
        <td class="num">${s.promedioBPM ?? '-'}</td>
      </tr>`
    })
    .join('')

  // Las visitas se filtran por el periodo del reporte. Sin esta tabla el informe
  // que lleva el paciente al centro cuenta solo numeros: el medico ve como
  // evoluciona la tension pero no que se decidio en la ultima consulta.
  const visitasPeriodo = visitas
    .filter((v) => v.fecha >= desde && v.fecha <= hasta)
    .sort((a, b) => (a.fecha === b.fecha ? (b.hora ?? '').localeCompare(a.hora ?? '') : a.fecha.localeCompare(b.fecha)))

  const visitaFilas = visitasPeriodo
    .map(
      (v) => `<tr>
      <td>${esc(v.fecha.split('-').reverse().join('/'))}</td>
      <td class="nowrap">${esc(hora12(v.hora) || '-')}</td>
      <td>${esc(ETIQUETA_VISITA[v.tipo])}</td>
      <td>${esc(v.motivo)}</td>
      <td>${esc(v.profesional || '-')}</td>
      <td class="notas">${esc(v.indicaciones || '-')}</td>
    </tr>`,
    )
    .join('')

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Reporte de signos vitales</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font: 11pt/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 17pt; margin: 0 0 2pt; }
  h2 { font-size: 12pt; margin: 18pt 0 6pt; border-bottom: 1px solid #d0d7de; padding-bottom: 3pt; }
  .sub { color: #555; font-size: 9.5pt; margin: 0 0 12pt; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th, td { border: 1px solid #d0d7de; padding: 4pt 6pt; text-align: left; }
  th { background: #f2f4f7; font-weight: 600; }
  td.num, th.num { text-align: right; }
  td.notas { font-size: 9pt; color: #444; }
  /* La hora en 12 h es mas ancha ("8:05 AM" que "08:05"): si puede partirse
     entre dos lineas, la tabla descuadra al imprimirse. */
  td.nowrap { white-space: nowrap; }
  .pie { margin-top: 16pt; padding-top: 8pt; border-top: 1px solid #d0d7de; font-size: 8.5pt; color: #666; }
  .firma { margin-top: 34pt; }
  .linea-firma { border-top: 1px solid #333; width: 55mm; margin-top: 22pt; padding-top: 3pt; font-size: 8.5pt; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
</style></head><body>
  <h1>Reporte de signos vitales</h1>
  <p class="sub">
    <strong>Paciente:</strong> ${esc(paciente?.nombre || 'No identificado')}<br>
    <strong>Periodo:</strong> ${esc(desde)} a ${esc(hasta)} &nbsp;|&nbsp;
    <strong>Mediciones:</strong> ${registros.length} &nbsp;|&nbsp;
    <strong>Generado:</strong> ${esc(fechaCompleta(claveDia(new Date())))}
    ${paciente?.notas ? `<br><strong>Notas:</strong> ${esc(paciente.notas)}` : ''}
  </p>

  <h2>Resumen por dia</h2>
  <table>
    <thead><tr>
      <th>Fecha</th><th class="num">Tomas</th><th class="num">Orina (ml)</th>
      <th class="num">Presion prom.</th><th class="num">O2 min-max</th><th class="num">Pulso prom.</th>
    </tr></thead>
    <tbody>${resumenFilas || '<tr><td colspan="6">Sin registros en el periodo</td></tr>'}</tbody>
  </table>

  <h2>Detalle de mediciones</h2>
  <table>
    <thead><tr>
      <th>Fecha</th><th>Hora</th><th class="num">Presion</th>
      <th class="num">O2</th><th class="num">Pulso</th><th class="num">Orina</th><th>Notas</th>
    </tr></thead>
    <tbody>${filas || '<tr><td colspan="7">Sin registros en el periodo</td></tr>'}</tbody>
  </table>

  <h2>Visitas medicas y a domicilio</h2>
  <table>
    <thead><tr>
      <th>Fecha</th><th>Hora</th><th>Tipo</th>
      <th>Motivo</th><th>Profesional</th><th>Indicaciones</th>
    </tr></thead>
    <tbody>${visitaFilas || '<tr><td colspan="6">Sin visitas en el periodo</td></tr>'}</tbody>
  </table>

  <div class="pie">
    <strong>Referencias utilizadas</strong> (editables en la app):
    sistolica ${esc(umbral.presionSisMin)}-${esc(umbral.presionSisMax)} mmHg &middot;
    diastolica ${esc(umbral.presionDiaMin)}-${esc(umbral.presionDiaMax)} mmHg &middot;
    O2 &ge; ${esc(umbral.o2Min)}% &middot;
    pulso ${esc(umbral.bpmMin)}-${esc(umbral.bpmMax)} lpm &middot;
    orina ${esc(umbral.orinaMin)}-${esc(umbral.orinaMax)} ml/dia. · Presion habitual: ${esc(
      presionHabitual?.sis ?? paciente?.presionHabitual?.sis ?? 120,
    )}/${esc(presionHabitual?.dia ?? paciente?.presionHabitual?.dia ?? 80)} mmHg.
    Documento generado automaticamente. No sustituye la valoracion medica profesional.
  </div>
  <div class="firma"><div class="linea-firma">Firma y sello del profesional</div></div>
</body></html>`
}

/**
 * Abre el reporte en una pestana nueva e invoca la impresion.
 * Se usa una pestana en lugar de `window.print()` directo para poder aplicar
 * estilos propios via una hoja de estilos en linea.
 */
export function imprimirReporte(html: string): boolean {
  const ventana = window.open('', '_blank')
  if (!ventana) return false
  ventana.document.open()
  ventana.document.write(html)
  ventana.document.close()
  ventana.focus()
  // Se espera a que las fuentes carguen antes de abrir el dialogo de impresion.
  ventana.addEventListener('load', () => {
    setTimeout(() => ventana.print(), 100)
  })
  return true
}

/** Comparte el reporte por la API de compartir nativa (moves) si existe. */
export async function compartirReporte(
  html: string,
  titulo: string,
): Promise<'compartido' | 'no-soportado' | 'cancelado'> {
  if (!('share' in navigator) || typeof File === 'undefined') return 'no-soportado'
  try {
    const blob = new Blob([html], { type: 'text/html' })
    const archivo = new File([blob], `${titulo}.html`, { type: 'text/html' })
    if (!navigator.canShare?.({ files: [archivo] })) return 'no-soportado'
    await navigator.share({ files: [archivo], title: titulo })
    return 'compartido'
  } catch {
    return 'cancelado'
  }
}