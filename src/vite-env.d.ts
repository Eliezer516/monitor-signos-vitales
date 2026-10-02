/// <reference types="vite/client" />

/**
 * Tipos de las variables de entorno.
 *
 * Sin este archivo, `import.meta.env` no esta tipado y la variable seria un
 * error de compilacion. El nombre tiene que coincidir exactamente con el que lee
 * `lib/turso/cliente.ts`: Vite solo expone al bundle las variables con prefijo
 * `VITE_`, asi que un nombre distinto aqui compila sin errores pero en el
 * navegador siempre valdria `undefined`.
 */
interface ImportMetaEnv {
  readonly VITE_TURSO_URL?: string;
  readonly VITE_TURSO_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}