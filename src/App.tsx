/**
 * Raiz de la aplicacion.
 *
 * Orden de los proveedores, de fuera hacia dentro:
 *   Avisos  ->  Ajustes  ->  Registros  ->  Visitas  ->  Sondas  ->  Replica  ->
 *   Estructura  ->  Paginas
 *
 * `Avisos` envuelve al resto para poder notificar desde los contextos; los
 * proveedores de datos van antes de la estructura porque las paginas los
 * necesitan.
 *
 * `Replica` va el ultimo de los proveedores de datos, y por un motivo concreto:
 * necesita leer los otros cuatro para saber que hay que subir. Si fuera al reves, no
 * tendria nada que mandar.
 */

import { useEffect } from 'react'
import { ProveedorAvisos } from './components/Avisos'
import { ProveedorAjustes } from './context/ContextoAjustes'
import { ProveedorRegistros } from './context/ContextoRegistros'
import { ProveedorVisitas } from './context/ContextoVisitas'
import { ProveedorSondas } from './context/ContextoSondas'
import { ProveedorReplica } from './context/ContextoReplica'
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
            <ProveedorSondas>
              <ProveedorReplica>
                <Aplicacion />
              </ProveedorReplica>
            </ProveedorSondas>
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