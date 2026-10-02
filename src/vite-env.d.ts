/// <reference types="vite/client" />

/**
 * Tipos de las variables de entorno.
 *
 * Sin este archivo, `import.meta.env` no esta tipado y la variable seria un
 * error de compilacion. El nombre tiene que coincidir exactamente con el que
 * lee `lib/google.ts`: Vite solo expone al bundle las variables con prefijo
 * `VITE_`, asi que un nombre distinto aqui compila sin errores pero en el
 * navegador siempre valdria `undefined`.
 */
interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
