/**
 * Raiz de la aplicacion.
 *
 * Orden de los proveedores, de fuera hacia dentro:
 *   Avisos  ->  Ajustes  ->  Registros  ->  Visitas  ->  Estructura  ->  Paginas
 *
 * `Avisos` envuelve al resto para poder notificar desde los contextos; los
 * proveedores de datos van antes de la estructura porque las paginas los
 * necesitan.
 */

import { useEffect } from 'react'
import { ProveedorAvisos } from './components/Avisos'
import { ProveedorAjustes } from './context/ContextoAjustes'
import { ProveedorRegistros } from './context/ContextoRegistros'
import { ProveedorVisitas } from './context/ContextoVisitas'
import { Estructura } from './components/Estructura'
import { useRuta } from './hooks/useRuta'
import { PaginaInicio } from './pages/Inicio'
import { PaginaHistorial } from './pages/Historial'
import { PaginaVisitas } from './pages/Visitas'
import { PaginaGraficas } from './pages/Graficas'
import { PaginaReportes } from './pages/Reportes'
import { PaginaAjustes, useRecordatoriosActivos } from './pages/Ajustes'
import { FormularioRegistro } from './components/FormularioRapido'

export function App() {
  return (
    <ProveedorAvisos>
      <ProveedorAjustes>
        <ProveedorRegistros>
          <ProveedorVisitas>
            <Aplicacion />
          </ProveedorVisitas>
        </ProveedorRegistros>
      </ProveedorAjustes>
    </ProveedorAvisos>
  )
}

function Aplicacion() {
  const [ruta, navegar] = useRuta()
  useRecordatoriosActivos()

  // Registra el service worker para que la app funcione sin conexion.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    // Solo en produccion: en desarrollo interfiere con el HMR de Vite.
    if (!import.meta.env.PROD) return
    const registrar = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Sin service worker la app sigue funcionando, solo que sin modo
        // offline. No es motivo para mostrar un error al usuario.
      })
    }
    // Se registra despues de cargar para no competir con los recursos criticos.
    if (document.readyState === 'complete') registrar()
    else window.addEventListener('load', registrar, { once: true })
    return () => window.removeEventListener('load', registrar)
  }, [])

  return (
    <Estructura ruta={ruta} onNavegar={navegar}>
      {ruta === 'inicio' && <PaginaInicio onIrRegistrar={() => navegar('registrar')} />}
      {ruta === 'registrar' && <PaginaRegistrar />}
      {ruta === 'historial' && <PaginaHistorial />}
      {ruta === 'visitas' && <PaginaVisitas />}
      {ruta === 'graficas' && <PaginaGraficas />}
      {ruta === 'reportes' && <PaginaReportes />}
      {ruta === 'ajustes' && <PaginaAjustes />}
    </Estructura>
  )
}

function PaginaRegistrar() {
  return (
    <div className="mx-auto max-w-2xl">
      <FormularioRegistro />
    </div>
  )
}