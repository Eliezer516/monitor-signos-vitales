import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss(), versionServiceWorker()],
  build: {
    // El bundle se divide para que la app cargue rapido en conexiones lentas.
    // `write-excel-file` solo se descarga cuando el usuario exporta a Excel.
    rollupOptions: {
      output: {
        // Se usa la forma de funcion: la de objeto no acepta la lista de
        // dependencias aqui porque el paquete se importa por subruta
        // (`write-excel-file/browser`) para evitar el bundle de Node.
        manualChunks(id) {
          if (id.includes('node_modules/write-excel-file')) return 'excel'
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) {
            return 'react'
          }
        },
      },
    },
  },
})

/**
 * Versiona `sw.js` con el contenido real de la compilacion.
 *
 * El service worker es la unica pieza que decide que se guarda en la cache del
 * navegador, asi que sin esto la cache se queda congelada en la primera visita:
 * el navegador solo reinstala el worker si cambia el BYTE de `sw.js`, y como
 * Vite copia `public/` tal cual, dos compilaciones distintas de la app dan un
 * `sw.js` identico.
 *
 * Se reescriben dos cosas del archivo copiado:
 *
 *  - `BUILD_ID`: hash de `index.html` y de los nombres de los assets (que ya
 *    llevan dentro el hash de su contenido). Cambia con cada bundle nuevo, lo
 *    que dispara la reinstalacion del worker y la limpieza de las caches
 *    viejas en `activate`.
 *
 *  - `PRECARGA`: la lista de base mas los `/assets/*` de ESTA compilacion. Sin
 *    esto, los assets solo se cachean cuando se piden con el worker ya
 *    controlando la pagina, y la primera visita sin conexion se queda sin
 *    bundle que ejecutar.
 */
function versionServiceWorker(): Plugin {
  let salida = ''

  return {
    name: 'version-service-worker',
    apply: 'build',
    configResolved(config) {
      salida = resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      const ruta = join(salida, 'sw.js')
      const original = await readFile(ruta, 'utf8')

      const assets = (await readdir(join(salida, 'assets')).catch(() => [] as string[]))
        .filter((f) => /\.(js|css)$/.test(f))
        .sort()

      const html = await readFile(join(salida, 'index.html'), 'utf8')
      const id = createHash('sha256')
        .update(html)
        .update(assets.join('\n'))
        .digest('hex')
        .slice(0, 12)

      // La base se lee del propio archivo, no se duplica aqui: asi solo hay una
      // lista que mantener y no pueden desincronizarse. Se extraen las URLs
      // sueltas en vez de interpretar el array, porque en el archivo estan
      // escritas con comillas simples y no son JSON.
      const base = /const PRECARGA = \[([\s\S]*?)\]/.exec(original)?.[1]
      if (!base) throw new Error('version-service-worker: no se encontro PRECARGA en sw.js')
      const baseUrls = [...base.matchAll(/'([^']+)'/g)].map((m) => m[1])
      if (!baseUrls.length) throw new Error('version-service-worker: PRECARGA de sw.js esta vacia')
      const completa = [...baseUrls, ...assets.map((a) => `/assets/${a}`)]

      await writeFile(
        ruta,
        original
          .replace("const BUILD_ID = '__BUILD_ID__'", `const BUILD_ID = '${id}'`)
          .replace(/const PRECARGA = \[[\s\S]*?\]/, `const PRECARGA = ${JSON.stringify(completa, null, 2)}`),
        'utf8',
      )

      this.info(`sw.js versionado como ${id} (${completa.length} recursos en precarga)`)
    },
  }
}