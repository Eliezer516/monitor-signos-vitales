/**
 * Pruebas de la persistencia de borrados.
 *
 *   npm run test:db
 *
 * Aqui no hay IndexedDB, asi que `db.ts` usa el espejo de localStorage. Es
 * justo el camino que importa: el bug que estas pruebas cubren no estaba en las
 * operaciones, sino en que las marcas que traia el otro dispositivo se
 * calculaban contra una copia en memoria y nunca llegaban a escribirse. Al
 * siguiente borrado de cualquier ambito, esa copia se releia del almacen sin
 * ellas y desaparecian para siempre.
 */

/** localStorage minimo, porque en Node no existe. */
const memoria = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => memoria.get(k) ?? null,
    setItem: (k: string, v: string) => void memoria.set(k, v),
    removeItem: (k: string) => void memoria.delete(k),
    clear: () => memoria.clear(),
  },
})

const { cargarBorrados, fusionarBorradosGuardados, guardarBorrados, registrarBorrado } = await import(
  '../src/lib/db'
)

let fallos = 0
let total = 0
function ok(nombre: string, cond: boolean, extra = '') {
  total++
  if (!cond) {
    fallos++
    console.log('  FALLO:', nombre, extra)
  } else console.log('  ok:', nombre)
}

const marca = (ambito: 'registros' | 'visitas' | 'pacientes', id: string, borradoAt: string) => ({
  ambito,
  id,
  borradoAt,
})

console.log('1. Lo que llega de fuera queda escrito')
{
  memoria.clear()
  await fusionarBorradosGuardados([marca('registros', 'r1', '2026-10-01T10:00:00.000Z')])
  const guardado = await cargarBorrados()
  ok('la marca se lee de vuelta', guardado.length === 1 && guardado[0].id === 'r1')
}

console.log('2. Fusionar dos veces no pierde lo anterior')
{
  // El caso que rompia: la primera fusion traia marcas de Drive, y la segunda
  // se fusionaba contra una copia en memoria que no las tenia.
  memoria.clear()
  await fusionarBorradosGuardados([marca('registros', 'r1', '2026-10-01T10:00:00.000Z')])
  await fusionarBorradosGuardados([marca('visitas', 'v1', '2026-10-01T11:00:00.000Z')])
  const guardado = await cargarBorrados()
  ok('estan las dos', guardado.length === 2, `${guardado.length}`)
  ok('una de registros', guardado.some((b) => b.id === 'r1'))
  ok('una de visitas', guardado.some((b) => b.id === 'v1'))
}

console.log('3. Un borrar posterior no se come lo importado')
{
  // El sintoma que se veria en la app: unos dias mas tarde se borra una
  // medicion, y los borrados que trajo el otro dispositivo desaparecen.
  memoria.clear()
  await fusionarBorradosGuardados([marca('registros', 'r1', '2026-10-01T10:00:00.000Z')])
  await registrarBorrado('visitas', 'v9')
  const guardado = await cargarBorrados()
  ok('sigue la marca importada', guardado.some((b) => b.id === 'r1'), JSON.stringify(guardado))
  ok('y esta la nueva', guardado.some((b) => b.id === 'v9'))
}

console.log('4. Un tombstone mas nuevo gana')
{
  memoria.clear()
  await fusionarBorradosGuardados([marca('registros', 'r1', '2026-10-01T10:00:00.000Z')])
  await fusionarBorradosGuardados([marca('registros', 'r1', '2026-10-01T12:00:00.000Z')])
  const guardado = await cargarBorrados()
  ok('no se duplica', guardado.filter((b) => b.id === 'r1').length === 1)
  ok('gana la mas nueva', guardado[0].borradoAt === '2026-10-01T12:00:00.000Z', guardado[0].borradoAt)
}

console.log('5. Sin nada nuevo devuelve lo que ya hay')
{
  memoria.clear()
  await fusionarBorradosGuardados([marca('registros', 'r1', '2026-10-01T10:00:00.000Z')])
  const resultado = await fusionarBorradosGuardados([])
  ok('devuelve lo guardado', resultado.length === 1 && resultado[0].id === 'r1')
}

console.log('6. El store empieza vacio')
{
  memoria.clear()
  ok('no hay nada al principio', (await cargarBorrados()).length === 0)
  await guardarBorrados([marca('pacientes', 'p1', '2026-10-01T10:00:00.000Z')])
  ok('y guardar sustituye la lista entera', (await cargarBorrados()).length === 1)
}

console.log(fallos === 0 ? '\nTODO CORRECTO' : `\n${fallos} FALLOS de ${total}`)
if (fallos > 0) process.exit(1)
