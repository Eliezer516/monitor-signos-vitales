/**
 * Configuracion de Drizzle Kit.
 *
 * Solo se usa en desarrollo o en el despliegue, para generar y aplicar las
 * migraciones de SQL. La app en si no lo carga nunca: en el navegador se leen
 * los ficheros ya generados, que deben estar junto al codigo.
 */

import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

// Se lee el `.env` para no tener que repetir la credencial. Antes esto exigia
// definir `TURSO_URL` y `TURSO_TOKEN` a mano en la terminal ademas de
// `VITE_TURSO_URL` y `VITE_TURSO_TOKEN` en el `.env`, y con el token duplicado
// en dos sitios: cualquier desajuste entre ellos era un fallo que solo aparecia
// al ejecutar las migraciones, no al desarrollar la app. Ahora hay un unico sitio.
//
// `.env` esta en `.gitignore`, asi que leerlo desde aqui no expone nada. Se
// respeta lo que ya venga en el entorno, que es lo que permite automatizar un
// despliegue sin dejar credenciales en el repositorio.
if (existsSync('.env')) process.loadEnvFile('.env')

const url = process.env.TURSO_URL ?? process.env.VITE_TURSO_URL ?? ''
const authToken = process.env.TURSO_TOKEN ?? process.env.VITE_TURSO_TOKEN ?? ''

// Falla aqui y no al halfway de aplicar la migracion, que es cuando ya se ha
// empieza a tocar el esquema. El mensaje dice que hacer, que es lo que hace
// falta de verdad cuando no hay nada configurado.
if (!url || !authToken) {
  throw new Error(
    'Falta la configuracion de la base de datos. Copia .env.example como .env y rellena\n' +
      '  VITE_TURSO_URL=libsql://tu-base.turso.io\n' +
      '  VITE_TURSO_TOKEN=el-token-de-lectura-y-escritura',
  )
}

export default defineConfig({
  dialect: 'turso',
  // SQLite puro: no hay extensiones ni funciones propias de Postgres.
  schema: './src/lib/turso/schema.ts',
  out: './drizzle',
  dbCredentials: { url, authToken },
  strict: true,
  verbose: true,
})