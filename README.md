# Signos Vitales

Aplicacion web para registrar y controlar los signos vitales y la diuresis de un
paciente, pensada para sustituir el cuaderno o la hoja de calculo que hasta ahora
se llevaba a mano.

Funciona **sin conexion** y **sin servidor**: todo se guarda en el propio
dispositivo. Ninguna medida sale del telefono o la tablet, que es un requisito
basico cuando se trata de datos de salud.

## Que hace

- **Registro rapido** de presion, oxigeno, pulso y orina, con la hora actual ya
  puesta y validacion de rangos en el momento. El acceso al registro es un
  boton flotante en la esquina inferior derecha, siempre al alcance del pulgar.
- **Historial** agrupado por dia, con un encabezado "DD/MM - Dia de la semana" y
  busqueda, filtros por fecha y nivel de alerta. Edicion o borrado de cualquier
  medicion.
- **Copiar mediciones** al portapapeles: un boton por dia y otro por medicion.
  Pega el texto directamente en un WhatsApp o un correo, para pasar "lo de hoy"
  sin tener que montar un archivo.
- **Graficas** de tendencias por dia, semana y mes, con lineas de referencia de
  los umbrales configurados.
- **Reportes** diarios, semanales y comparativos entre periodos, exportables a
  PDF y compartibles.
- **Presion habitual configurable** por paciente (o global): quien vive con
  90/60 no ve su medicion de siempre marcada como baja. Solo cambia que se
  considera "normal"; los limites de alerta siguen siendo absolutos.
- **Visitas medicas y a domicilio** registradas en su propia seccion: tipo,
  fecha y hora, motivo, profesional, indicaciones o medicacion y notas. Se
  pueden buscar, filtrar, editar y borrar, y salen en el reporte.
- **Avisos y alertas** de dos niveles (atencion / urgencia) por falta de
  oxigeno, hipotension, hipertension o orina escasa.
- **Recordatorios** de toma de medicamentos con horas de silencio, usando las
  notificaciones del navegador.
- **Backup** en JSON (incluidas las visitas) con restauracion sin sobrescribir lo
  que ya hay.
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
| `npm test`         | Pruebas de la logica pura (rangos, fechas, visitas, backup)|
| `npm run test:sw`  | Pruebas del service worker (necesita `npm run build` antes)|
| `npm run iconos`   | Regenera los iconos PNG de la PWA                |

## Instalar como aplicacion

Al desplegar, se puede instalar desde el navegador (Android: menu > "Instalar
aplicacion"; iOS: Compartir > "Anadir a pantalla de inicio"). Funciona
necesariamente sobre **HTTPS**, salvo en `localhost`.

## Actualizaciones de la version

Al publicar una version nueva, la app la detecta y ofrece un aviso con
"Actualizar". Recargar no pierde nada: los datos viven en IndexedDB y
localStorage. Tambien se comprueba al abrir la app, al volver a ella, al
recuperar la conexion y cada media hora, porque las rutas van por hash y cambiar
de pantalla no genera peticiones que delaten una version nueva. En
**Ajustes > Aplicacion** hay una comprobacion manual y el boton de instalacion.

La version nueva **no se activa sola**: se queda esperando. Mientras tanto sigue
mandando la version anterior con su propia cache, de modo que la app en pantalla
y los archivos que necesita siempre coinciden, tambien sin conexion. Al
aceptar, se recarga y a partir de ahi la copia sin conexion es la ultima
publicada.

Tres piezas hacen que esto funcione, y conviene no romperlas:

- **El service worker se versiona en el build.** `versionServiceWorker` en
  `vite.config.ts` sustituye `BUILD_ID` en `dist/sw.js` por un hash de
  `index.html` y de los assets del build, y anade esos assets a `PRECARGA`. Sin
  esto el navegador recibe un `sw.js` identico en cada compilacion, no reinstala
  nada y la cache se congela con la primera visita.
- **Cada URL vive en una sola cache** (`assets-<id>`), y todas las lecturas se
  hacen contra una cache nombrada. Guardar el mismo recurso en dos caches hace
  que `caches.match` sin `cacheName` devuelva la copia mas antigua: es
  exactamente el motivo por el que sin conexion salia la version vieja.
- **Los assets van precargados**, no cacheados "al vuelo". De otro modo, la
  primera visita sin conexion tendria el `index.html` pero no el bundle que
  ejecutar.

**Al desplegar, `sw.js` no debe servirse con un `Cache-Control` de larga
duracion.** El registro usa `updateViaCache: 'none'`, pero si el servidor
entrega el mismo archivo cacheado durante semanas, ninguna app puede enterarse
del cambio. En Netlify, Vercel o GitHub Pages conviene anadir `/sw.js` a las
cabeceras sin cache.

## Decisiones tecnicas

- **React + Vite + TypeScript**, con Tailwind CSS v4. Sin dependencias de UI de
  terceros: los componentes son propios para mantener el bundle pequeno.
- **Datos locales.** IndexedDB es el almacen principal (soporta cientos o miles
  de mediciones); localStorage actua de espejo y de respaldo si IndexedDB no
  esta disponible. No hay backend ni sincronizacion en la nube.
- **Una base por tipo de dato.** Cada contexto tiene su almacen y su store
  (`registros`, `ajustes`, `visitas`), todos en la misma base IndexedDB. Asi una
  lista vacia o corrupta en un tipo de dato no puede tirar abajo los demas.
  El backup JSON es un unico archivo con las tres cosas.
- **Fechas en hora local.** Se guardan como texto (`AAAA-MM-DD` y `HH:MM`) y se
  reconstruyen con `new Date(ano, mes-1, dia, ...)`. Usar `toISOString()`
  correria el dia cerca de medianoche, que es justo cuando se anota.
- **Horas en 24, pantalla en 12.** El guardado y los calculos usan `HH:MM`, que
  ordena correctamente y no depende del locale. Al mostrar se pasa por
  `hora12` (`lib/fechas.ts`): historial, graficas, alertas, visitas, el informe
  impreso y los mensajes de confirmacion van en "8:05 AM". Los ficheros CSV y
  XLSX se dejan en 24 h a proposito, porque en una hoja de calculo "8:05 AM" es
  texto y no se puede ordenar por hora.
- **Graficas SVG propias.** `recharts` pesa mas de 100 kB comprimido; estas
  graficas pesan unos pocos kilobytes y se adaptan al tamano de pantalla.
- **PDF mediante impresion del navegador.** El reporte se genera como HTML con
  estilos de impresion y el usuario elige "Guardar como PDF". Produce mejor
  resultado tipografico que incrustar un generador de PDF en la app.
- **Excel bajo demanda.** `write-excel-file` se importa de forma dinamica y en
  un chunk separado, de modo que su codigo no se descarga hasta que alguien
  exporta.
- **Copiar != exportar.** CSV y XLSX sirven para llevarse los datos a un PC, con
  las horas en 24 h para que se puedan ordenar. El portapapeles es para leer y
  reenviar: un bloque por medicion en 12 h, con un dato por linea, que se lee
  bien en un chat y se puede corregir a mano. Los dos formatos no se mezclan a
  proposito (`lib/texto.ts` frente a `lib/exportar.ts`).

## Estructura

```
src/
  components/   Componentes de interfaz y graficas
  context/      Estado global (registros, visitas y ajustes) con useReducer
  hooks/        Enrutado por hash y hooks de fecha
  lib/          Logica pura: rangos, fechas, resumen, persistencia, exportacion,
                y actualizacion del service worker
  pages/        Inicio, Historial, Graficas, Visitas, Reportes, Ajustes
public/        Manifest, service worker e iconos
tools/          Pruebas y scripts de mantenimiento (generacion de iconos)
```

## Datos de ejemplo

Ajustes > "Cargar datos de ejemplo" anade tres dias de mediciones ficticias para
ver las graficas y los reportes funcionando. Se quitan con "Borrar todos los
datos".

En **Visitas**, el estado vacio ofrece cargar visitas de ejemplo por separado, y
el boton "Vaciar visitas" las borra sin tocar las mediciones.

## Visitas

La seccion **Visitas** anota lo que ocurre fuera de la medicion: una consulta en
la consulta o una visita a domicilio. Se guardan tipo, fecha, hora (opcional),
motivo, profesional, indicaciones o medicacion y notas. Solo el motivo es
obligatorio: no siempre se recuerda la hora exacta, y exigirla obligaria a
inventarla.

Las visitas entran en el **reporte** (como tabla propia, filtrada por el mismo
periodo que las mediciones), en el **backup JSON** y en las exportaciones CSV y
XLSX de la propia pagina.

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