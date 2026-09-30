/**
 * Exportacion de datos: CSV, XLSX, JSON (backup) y PDF via impression.
 *
 * Se evita una libreria de PDF (jspdf/pdfmake, +300 kB) porque el reporte
 * medico necesita buena tipografia y saltos de pagina, que el motor de
 * impresion del navegador resuelve mejor. El usuario elige "Guardar como PDF".
 */

import type { Paciente, PresionHabitual, Registro, Umbrales } from './tipos'
import { claveDia, fechaCompleta } from './fechas'
import { resumenDia } from './resumen'

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

/** Formato del archivo de backup, versionado para restaurarlo en el futuro. */
export interface Backup {
  version: 1
  exportadoEn: string
  app: 'signos-vitales'
  registros: Registro[]
  pacientes: Paciente[]
}

/** Descarga un backup completo en JSON, restaurable desde Ajustes. */
export function exportarBackup(
  registros: Registro[],
  pacientes: Paciente[],
  nombreArchivo = 'backup-signos-vitales',
): void {
  const backup: Backup = {
    version: 1,
    exportadoEn: new Date().toISOString(),
    app: 'signos-vitales',
    registros,
    pacientes,
  }
  descargar(
    new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
    `${nombreArchivo}.json`,
  )
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
export function leerBackup(texto: string): { registros: Registro[]; pacientes: Paciente[] } {
  const datos = JSON.parse(texto)
  if (!datos || typeof datos !== 'object') throw new Error('Archivo no valido')

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
      }
    })

  const pacientes = Array.isArray(datos.pacientes) ? (datos.pacientes as Paciente[]) : []
  return { registros, pacientes }
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
  },
): string {
  const { paciente, desde, hasta, umbral, presionHabitual } = opciones
  const dias = [...new Set(registros.map((r) => r.fecha))].sort()
  const esc = (s: unknown) =>
    String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

  const filas = registros
    .map(
      (r) => `<tr>
      <td>${esc(r.fecha.split('-').reverse().join('/'))}</td>
      <td>${esc(r.hora)}</td>
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