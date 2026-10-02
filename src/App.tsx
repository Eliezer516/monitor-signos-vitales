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
import { registrarActualizacion } from './lib/actualizacion'
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

  // Registra el service worker para que la app funcione sin conexion y se
  // mantenga al dia. El aviso de version nueva lo pinta `AvisoActualizacion`.
  useEffect(registrarActualizacion, [])

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