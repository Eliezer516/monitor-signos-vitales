/// <reference types="vite/client" />

/**
 * Tipos de las variables de entorno.
 *
 * Sin este archivo, `import.meta.env` no esta tipado y `VITE_GOOGLE_CLIENT_ID`
 * seria un error de compilacion. El prefijo `VITE_` es obligatorio: Vite solo
 * expone al bundle las variables que empiezan asi, y el resto se quedaria en el
 * servidor. El client ID de OAuth no es un secreto (va incrustado en el
 * JavaScript de la pagina de consentimiento de Google de todas formas), asi que
 * que sea publico no es un problema.
 */
interface ImportMetaEnv {
  readonly GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
