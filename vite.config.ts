import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
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
