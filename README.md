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

| Comando             | Que hace                                        |
| ------------------- | ----------------------------------------------- |
| `npm run typecheck` | Comprueba los tipos sin generar nada             |
| `npm run lint`      | Analisis estatico (oxlint)                       |
| `npm test`          | Pruebas de la logica pura (rangos, fechas, visitas, backup)|
| `npm run test:todo` | Todas las suites de pruebas                      |
| `npm run test:sw`   | Pruebas del service worker (necesita `npm run build` antes)|
| `npm run iconos`    | Regenera los iconos PNG de la PWA                |
| `npm run db:generate` | Regenera el SQL de migraciones tras tocar el esquema |
| `npm run db:migrate`  | Aplica las migraciones a la base de datos        |
| `npm run db:comprobar`| Comprueba que el esquema esta en la base (solo lee) |
| `npm run db:probar`   | Prueba de escritura real. **Borra sus propias filas** |
| `npm run db:studio`   | Abre el explorador de la base de datos          |

Las suites sueltas tambien se pueden lanzar por separado: `test:fusion`
(union de datos), `test:db` (persistencia de borrados), `test:sincronizar`
(fusion entre dispositivos), `test:db-turso` (esquema contra una base SQLite
real), `test:replica` (el ciclo completo de replica) y `test:sw`.

## Sincronizar entre dispositivos

Los datos se guardan siempre en el dispositivo. Para tenerlos en otro sitio hay
dos caminos, y se pueden usar los dos a la vez.

### 1. Copia en la nube (Turso), automatica

Si hay `VITE_TURSO_URL` y `VITE_TURSO_TOKEN` configurados, aparece **Ajustes >
Datos > Copia en la nube**. A partir de ahi:

- Cada vez que se anade, cambia o borra algo, se sube despues de un momento de
  espera. El temporalizador se reinicia con cada cambio, asi que veinte
  mediciones seguidas son una sola subida.
- Al abrir la app y al volver a ella con el telefono en la mano, se descarga lo
  que haya cambiado en los demas dispositivos.
- Hay un boton **Sincronizar ahora**, que va sin esperar.
- Si algo va mal, el motivo se ensena en esa misma pantalla. Los datos del
  telefono no se tocan: un fallo de red deja los datos donde estaban y se
  reintenta la proxima vez que cambie algo.
- Al restaurar un backup, la subida se pide al momento, para que lo restaurado no
  se quede solo en ese dispositivo.

**Lo que llega de fuera nunca se aplica encima de lo local.** La base se trata
como un objetivo de fusion, no como una copia que se restaure encima. Si las dos
cosas cambian lo mismo, gana la mas nueva (last-write-wins), el perdedor se
conserva en el telefono y vuelve a subir en el siguiente ciclo, y un borrado
viaja como un *tombstone* para que no resucite en el otro dispositivo.

### 2. Backup manual (sin configurar nada)

En **Ajustes > Datos** esta "Descargar backup (JSON)", "Restaurar" y
"Compartir backup". El archivo es un JSON que se puede mandar por el medio que
sea: correo, WhatsApp, o el servicio de archivos que se use. Funciona con la app recien instalada y sin conexion
a la hora de restaurar. Es la opcion que no depende de ninguna configuracion
externa, y la que sigue funcionando si la base de datos no esta disponible.

### Que se replica

| Dato                                      | Se replica   |
| ----------------------------------------- | ------------ |
| Signos vitales                            | Si           |
| Visitas                                   | Si           |
| Pacientes                                 | Si           |
| Umbrales, limites, presion habitual y plantillas de nota | Si |
| Borrados                                  | Si, de forma propagada |
| Tema, recordatorio, paciente activo y fecha del ultimo backup | No, son de cada dispositivo |

Estas reglas viven en `src/lib/sincronizar.ts` y son puro: no saben de donde
vienen los datos ni como se guardan. Por eso las comparten el backup manual y la
replica, y por eso las dos dan el mismo resultado.

## La base de datos de Turso

El esquema, el cliente y el ciclo de replica estan en `src/lib/turso/`, escritos
con Drizzle ORM y probados contra una base de verdad.

| Pieza                        | Para que sirve                                     |
| ---------------------------- | -------------------------------------------------- |
| `src/lib/turso/schema.ts`    | Las 6 tablas y sus indices                         |
| `drizzle.config.ts`          | Generar y aplicar el SQL de migraciones            |
| `src/lib/turso/cliente.ts`   | Cliente perezoso y comprobacion de credenciales    |
| `src/lib/turso/mapeo.ts`     | Conversiones entre filas y tipos de la app         |
| `src/lib/turso/replica.ts`   | El ciclo: leer, fusionar y escribir la union        |
| `src/context/ContextoReplica.tsx` | Cuando sincronizar, y como parar el bucle     |
| `npm run test:db-turso`      | Pruebas del esquema                                 |
| `npm run test:replica`       | Pruebas del ciclo, contra un SQLite local          |
| `npm run db:replica`         | El ciclo contra la base real. **Borra lo que escribe** |

Las tablas son `pacientes`, `registros`, `visitas`, `borrados`, `ajustes` y
`replica`. No hay tabla de usuarios: cada despliegue tiene su propia base, y no
hay cuentas ni contrasenas que gestionar.

Las pruebas de `test:replica` corren contra un fichero SQLite local (`file:`)
porque el protocolo es el mismo, y asi corren sin conexion y sin credenciales.
Lo que no se comprueba de esa forma es el comportamiento del servicio en si: la
latencia, los limites de uso y una peticion cortada a mitad solo se ven contra
Turso, y para eso esta `db:replica`.

### Las decisiones que importan

- **`registros` y `visitas` llevan `paciente_id`, y en `lib/tipos.ts` no.** En la
  app, `pacienteActivo` es un ajuste del dispositivo y todas las mediciones
  cuelgan de el. En una base compartida eso no sirve: con dos personas medidas
  desde el mismo movil sus series quedarian mezcladas y sin forma de separarlas
  despues. El dato original no sabe a quien pertenecia, asi que hay que
  migrarlo asignandole su paciente actual.
- **Toda fila lleva `updatedAt`, y `borrados` es una tabla aparte.** Es lo mismo
  que hace ya la fusion: cuando dos dispositivos cambian lo mismo gana el mas
  nuevo, y un borrado tiene que viajar como una marca para no resucitar. La
  condicion esta en el `where` del `upsert`, no en el codigo de quien llama,
  porque si el telefono se corta a mitad de subir y reintenta, la comparacion
  tiene que hacerla SQLite.
- **`ajustes` es una sola fila con los cambios por campo dentro.** Sin el mapa de
  marcas, un cambio de umbral hecho a la vez que uno de plantillas se llevaria
  por delante el otro.
- **`replica` guarda hasta donde se ha subido y bajado.** Sin eso no hay forma
  de distinguir "esto no lo he subido" de "esto ya estaba".

### Ponerla en marcha

```powershell
# 1. Crear la base en https://turso.tech y un token de lectura y escritura.
# 2. Copiar .env.example como .env y rellenar:
#      VITE_TURSO_URL=libsql://tu-base.turso.io
#      VITE_TURSO_TOKEN=el-token
# 3. Aplicar el esquema. No hay que definir nada mas: el comando lee el .env.
npm run db:migrate
npm run db:comprobar
```

`drizzle-kit` respeta lo que ya venga en el entorno (`TURSO_URL` y
`TURSO_TOKEN`) y, si no hay nada, lee el `.env`. Con eso la credencial esta
escrita en un unico sitio; si se duplicara en los dos pares de nombres, un
desajuste entre ellos solo apareceria al ejecutar las migraciones.

**`db:comprobar` y `db:probar` no son lo mismo.** El primero solo lee y
confirma que las tablas, los indices y las claves foraneas existen: es que
`drizzle-kit migrate` no haya fallado, no que el esquema este bien. El segundo
escribe y borra su propia fila, y es el que detecta un token de **solo
lectura**, que es el error mas probable despues de crear la base: hasta que no
se intenta subir algo no se ve. La limpieza va en un `finally`, asi que
tambien se ejecuta si una comprobacion falla a la mitad.

Sobre el prefijo `VITE_`: lo que lo lleva se incrusta en el paquete que descarga
el navegador. Aqui no es un problema, porque cada despliegue tiene su propia
base y sus credenciales no se comparten con nadie. Si se publicara una
instancia unica y compartida, si seria un fallo grave, porque contendria datos
de pacientes. Para ese caso habria que poner un proxy delante.

### El token

El token es de lectura y escritura, y da acceso a todo lo que hay en la base. Va
en el `.env`, que esta en `.gitignore`, pero conviene recordar dos cosas:

- **Si se filtra, hay que revocarlo** en el panel de Turso y generar otro. No
  basta con borrarlo del archivo: el token sigue valiendo hasta que se revoque.
- `db:studio` y cualquier consulta manual usan la misma credencial. El token de
  solo lectura sirve para mirar, pero no para la replica.

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
  esta disponible. No hay backend propio: la copia entre dispositivos va contra
  una base Turso que se configura por despliegue, y si no se configura, sigue
  funcionando con un backup manual (ver "Sincronizar entre dispositivos").
- **Una base por tipo de dato.** Cada contexto tiene su almacen y su store
  (`registros`, `ajustes`, `visitas`, `borrados`), todos en la misma base
  IndexedDB. Asi una lista vacia o corrupta en un tipo de dato no puede tirar
  abajo los demas. El backup JSON es un unico archivo con todo.
- **Fusionar, no restaurar.** Dos dispositivos se combinan con
  `lib/fusion.ts`: por identificador gana la version mas reciente
  (last-write-wins), un empate exacto gana el local, y los borrados viajan como
  *tombstones* para que no reaparezcan. Lo que se guarda al otro lado es siempre
  la union de los dos, no la foto de uno. `lib/fusion.ts` trabaja con datos y
  `lib/sincronizar.ts` con el paquete entero; los ajustes compartidos se fusionan
  campo a campo con su propia marca de tiempo, y el resto (tema, recordatorio,
  paciente activo) se queda en cada dispositivo.
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
  context/      Estado global (registros, visitas, ajustes y replica) con useReducer
  hooks/        Enrutado por hash y hooks de fecha
  lib/          Logica pura: rangos, fechas, resumen, persistencia, exportacion,
                fusion de datos y actualizacion del service worker
    turso/      Esquema, mapeo y ciclo de replica contra la base de datos (Drizzle)
  pages/        Inicio, Historial, Graficas, Visitas, Reportes, Ajustes
public/         Manifest, service worker e iconos
drizzle/        SQL de migraciones, generado y versionado
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
