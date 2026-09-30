# Signos Vitales

Aplicacion web para registrar y controlar los signos vitales y la diuresis de un
paciente, pensada para sustituir el cuaderno o la hoja de calculo que hasta ahora
se llevaba a mano.

Funciona **sin conexion** y **sin servidor**: todo se guarda en el propio
dispositivo. Ninguna medida sale del telefono o la tablet, que es un requisito
basico cuando se trata de datos de salud.

## Que hace

- **Registro rapido** de presion, oxigeno, pulso y orina, con la hora actual ya
  puesta y validacion de rangos en el momento.
- **Historial** con busqueda, filtros por fecha y nivel de alerta, y edicion o
  borrado de cualquier medicion.
- **Graficas** de tendencias por dia, semana y mes, con lineas de referencia de
  los umbrales configurados.
- **Reportes** diarios, semanales y comparativos entre periodos, exportables a
  PDF y compartibles.
- **Presion habitual configurable** por paciente (o global): quien vive con
  90/60 no ve su medicion de siempre marcada como baja. Solo cambia que se
  considera "normal"; los limites de alerta siguen siendo absolutos.
- **Avisos y alertas** de dos niveles (atencion / urgencia) por falta de
  oxigeno, hipotension, hipertension o orina escasa.
- **Recordatorios** de toma de medicamentos con horas de silencio, usando las
  notificaciones del navegador.
- **Backup** en JSON con restauracion sin sobrescribir lo que ya hay.
- **Exportacion** a CSV y a Excel (.xlsx) con una hoja de resumen diario.
- **Modo claro y oscuro**, y deteccion automatica del tema del sistema.

## Instalacion

Requiere Node.js 20 o superior.

```bash
npm install
npm run dev        # servidor de desarrollo
```

Para generar la version de produccion:

```bash
npm run build      # compila TypeScript y genera dist/
npm run preview    # sirve dist/ para comprobar el resultado
```

### Otros comandos

| Comando            | Que hace                                        |
| ------------------ | ----------------------------------------------- |
| `npm run typecheck`| Comprueba los tipos sin generar nada             |
| `npm run lint`     | Analisis estatico (oxlint)                       |
| `npm test`         | Pruebas de la logica pura (rangos, fechas, backup)|
| `npm run iconos`   | Regenera los iconos PNG de la PWA                |

## Instalar como aplicacion

Al desplegar, se puede instalar desde el navegador (Android: menu > "Instalar
aplicacion"; iOS: Compartir > "Anadir a pantalla de inicio"). Funciona
necesariamente sobre **HTTPS**, salvo en `localhost`.

## Decisiones tecnicas

- **React + Vite + TypeScript**, con Tailwind CSS v4. Sin dependencias de UI de
  terceros: los componentes son propios para mantener el bundle pequeno.
- **Datos locales.** IndexedDB es el almacen principal (soporta cientos o miles
  de mediciones); localStorage actua de espejo y de respaldo si IndexedDB no
  esta disponible. No hay backend ni sincronizacion en la nube.
- **Fechas en hora local.** Se guardan como texto (`AAAA-MM-DD` y `HH:MM`) y se
  reconstruyen con `new Date(ano, mes-1, dia, ...)`. Usar `toISOString()`
  correria el dia cerca de medianoche, que es justo cuando se anota.
- **Graficas SVG propias.** `recharts` pesa mas de 100 kB comprimido; estas
  graficas pesan unos pocos kilobytes y se adaptan al tamano de pantalla.
- **PDF mediante impresion del navegador.** El reporte se genera como HTML con
  estilos de impresion y el usuario elige "Guardar como PDF". Produce mejor
  resultado tipografico que incrustar un generador de PDF en la app.
- **Excel bajo demanda.** `write-excel-file` se importa de forma dinamica y en
  un chunk separado, de modo que su codigo no se descarga hasta que alguien
  exporta.

## Estructura

```
src/
  components/   Componentes de interfaz y graficas
  context/      Estado global (registros y ajustes) con useReducer
  hooks/        Enrutado por hash y hooks de fecha
  lib/          Logica pura: rangos, fechas, resumen, persistencia, exportacion
  pages/        Inicio, Historial, Graficas, Reportes, Ajustes
public/         Manifest, service worker e iconos
tools/          Scripts de mantenimiento (generacion de iconos)
```

## Datos de ejemplo

Ajustes > "Cargar datos de ejemplo" anade tres dias de mediciones ficticias para
ver las graficas y los reportes funcionando. Se quitan con "Borrar todos los
datos".

## Presion habitual

No todos viven con 120/80. En **Ajustes > Umbrales** se puede indicar la
presion de costumbre, con atajos para los valores habituales (90/60, 100/65,
110/70, 120/80, 130/85, 140/90). Cada paciente puede tener la suya en
**Ajustes > Paciente**, si se activa "Su presion habitual es distinta"; el valor
del paciente tiene prioridad sobre el global.

Sirve para una sola cosa: decidir que medicion se marca como *normal*. Se
considera normal lo que queda a +-20 mmHg de la sistolica y +-10 de la
diastolica de ese valor (recortado para que nunca invada la zona de alerta).
Fuera de la banda aparece un aviso en ambar, no una alerta roja.

Los limites de alerta no se tocan: 90 mmHg con costumbre 120/80 sigue siendo una
tension baja que conviene consultar, y 70 mmHg es alerta con cualquier
referencia. Ajuste este valor con el profesional que lleva el caso.

## Aviso

Esta aplicacion **no es un dispositivo medico** y sus umbrales no sustituyen el
criterio de un profesional sanitario. Los datos sensibles se guardan sin cifrar
en el dispositivo: conviene no compartir el equipo y tener el bloqueo de
pantalla activado.