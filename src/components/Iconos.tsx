/**
 * Iconos SVG en linea.
 *
 * Se incrustan como componentes en lugar de una fuente o un paquete de iconos:
 * son unos 2 kB en total frente a los ~50 kB de una libreria, y el color lo
 * hereda de `currentColor` para funcionar en los dos temas.
 */

import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement>

const base = (props: Props) => ({
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props,
})

export const IconoCasa = (p: Props) => (
  <svg {...base(p)}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
    <path d="M9.5 21v-6h5v6" />
  </svg>
)

export const IconoMas = (p: Props) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconoHistorial = (p: Props) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="17" rx="2.5" />
    <path d="M3 9.5h18M8 2.5v3M16 2.5v3" />
    <path d="M7.5 14h3M13.5 14h3M7.5 17.5h3M13.5 17.5h3" />
  </svg>
)

export const IconoGrafica = (p: Props) => (
  <svg {...base(p)}>
    <path d="M3 3v18h18" />
    <path d="M7 15.5l4-5 3.5 3L20 6" />
  </svg>
)

export const IconoReporte = (p: Props) => (
  <svg {...base(p)}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </svg>
)

export const IconoAjustes = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
  </svg>
)

export const IconoAlerta = (p: Props) => (
  <svg {...base(p)}>
    <path d="M10.3 3.6 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4.5M12 17.5h.01" />
  </svg>
)

export const IconoGota = (p: Props) => (
  <svg {...base(p)}>
    <path d="M12 2.7 7 9.5a6.5 6.5 0 1 0 10 0z" />
  </svg>
)

export const IconoCorazon = (p: Props) => (
  <svg {...base(p)}>
    <path d="M20.4 5.6a5 5 0 0 0-7.1 0L12 6.9l-1.3-1.3a5 5 0 1 0-7.1 7.1l8.4 8.4 8.4-8.4a5 5 0 0 0 0-7.1z" />
  </svg>
)

export const IconoPulso = (p: Props) => (
  <svg {...base(p)}>
    <path d="M2 12h4l2.5-7 4 14 2.5-7h7" />
  </svg>
)

export const IconoOximetro = (p: Props) => (
  <svg {...base(p)}>
    <rect x="2" y="6" width="20" height="13" rx="2.5" />
    <path d="M5 6V4.5A2.5 2.5 0 0 1 7.5 2h9A2.5 2.5 0 0 1 19 4.5V6" />
    <path d="M6 12.5h3l1.5-3 2 5 1.5-2h4" />
  </svg>
)

export const IconoReloj = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.3l3.2 2" />
  </svg>
)

export const IconoCalendario = (p: Props) => (
  <svg {...base(p)}>
    <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
    <path d="M3 10h18M8 2.5v4M16 2.5v4" />
  </svg>
)

export const IconoDescargar = (p: Props) => (
  <svg {...base(p)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7.5 10.5 12 15l4.5-4.5M12 15V3" />
  </svg>
)

/** Estetoscopio: visitas a consulta. */
export const IconoMedico = (p: Props) => (
  <svg {...base(p)}>
    <path d="M6 3v5a4 4 0 0 0 8 0V3" />
    <path d="M4.5 3h3M12.5 3h3" />
    <path d="M10 12v3a5 5 0 0 0 5 5h.5" />
    <circle cx="18.5" cy="18" r="3" />
  </svg>
)

/** Casa: visitas a domicilio. */
export const IconoCasaVisita = (p: Props) => (
  <svg {...base(p)}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.5 9.2V20a1 1 0 0 0 1 1H10v-5.5h4V21h3.5a1 1 0 0 0 1-1V9.2" />
  </svg>
)

export const IconoEditar = (p: Props) => (
  <svg {...base(p)}>
    <path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
  </svg>
)

export const IconoBorrar = (p: Props) => (
  <svg {...base(p)}>
    <path d="M3 6h18M8 6V4.5a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 1 16 4.5V6" />
    <path d="M18.5 6 18 19.6a1.5 1.5 0 0 1-1.5 1.4h-9A1.5 1.5 0 0 1 6 19.6L5.5 6" />
    <path d="M10 11v5M14 11v5" />
  </svg>
)

export const IconoBuscar = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.9-3.9" />
  </svg>
)

export const IconoCerrar = (p: Props) => (
  <svg {...base(p)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)

export const IconoSol = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 1.5v2.5M12 20v2.5M3.6 3.6l1.8 1.8M18.6 18.6l1.8 1.8M1.5 12H4M20 12h2.5M3.6 20.4l1.8-1.8M18.6 5.4l1.8-1.8" />
  </svg>
)

export const IconoLuna = (p: Props) => (
  <svg {...base(p)}>
    <path d="M21 13.2A9 9 0 1 1 10.8 3a7 7 0 0 0 10.2 10.2z" />
  </svg>
)

export const IconoFlechaIzq = (p: Props) => (
  <svg {...base(p)}>
    <path d="m15 18-6-6 6-6" />
  </svg>
)

export const IconoFlechaDer = (p: Props) => (
  <svg {...base(p)}>
    <path d="m9 18 6-6-6-6" />
  </svg>
)

export const IconoSubir = (p: Props) => (
  <svg {...base(p)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7.5 7.5 12 3l4.5 4.5M12 3v12" />
  </svg>
)

export const IconoCompartir = (p: Props) => (
  <svg {...base(p)}>
    <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
    <path d="M12 15V3M8 7l4-4 4 4" />
  </svg>
)

export const IconoWhatsapp = (p: Props) => (
  <svg {...base(p)}>
    <path d="M17.5 14.4c-.3-.2-1.7-.9-2-1-.3-.1-.4-.2-.6.1-.2.3-.7 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.5-.5.3-.6v-.5l-.9-2.2c-.2-.6-.5-.5-.6-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5 1.9.8 2.6.9 3.5.7.6-.1 1.7-.7 1.9-1.4.3-.7.3-1.3.2-1.4-.1-.2-.3-.2-.6-.4z" />
    <path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2z" />
  </svg>
)

export const IconoFiltro = (p: Props) => (
  <svg {...base(p)}>
    <path d="M3 5h18l-7 8v6l-4 2v-8z" />
  </svg>
)

export const IconoCheck = (p: Props) => (
  <svg {...base(p)}>
    <path d="m4.5 12.5 5 5 10-11" />
  </svg>
)

export const IconoActualizar = (p: Props) => (
  <svg {...base(p)}>
    <path d="M20 11a8 8 0 0 0-13.7-5.3L3 9" />
    <path d="M4 13a8 8 0 0 0 13.7 5.3L21 15" />
    <path d="M3 4v5h5M21 20v-5h-5" />
  </svg>
)

export const IconoCopiar = (p: Props) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
  </svg>
)