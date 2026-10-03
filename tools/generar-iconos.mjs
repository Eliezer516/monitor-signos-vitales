/**
 * Genera los iconos PNG del manifest PWA sin dependencias.
 *
 * Se evita `sharp` (binario nativo, ~30 MB) solo para pintar cuatro imagenes:
 * el script rasteriza a mano un cuadrado redondeado con la linea de pulso y
 * escribe el PNG con `zlib`, que ya viene en Node.
 *
 * Uso:  node tools/generar-iconos.mjs
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const SALIDA = join(RAIZ, 'public')

const AZUL = [0x25, 0x63, 0xeb]
const BLANCO = [0xff, 0xff, 0xff]

// Trayectoria de la linea de pulso en coordenadas normalizadas 0..1.
const PULSO = [
  [0.125, 0.5],
  [0.28, 0.5],
  [0.39, 0.27],
  [0.56, 0.73],
  [0.66, 0.5],
  [0.875, 0.5],
]

/** Distancia de un punto al segmento AB (para trazar la linea con grosor). */
function distanciaSegmento(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const largo = dx * dx + dy * dy
  const t = largo === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / largo))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

/** Distancia con signo al borde de un rectangulo redondeado (negativa dentro). */
function dentroRectRedondeado(px, py, x0, y0, x1, y1, r) {
  const cx = Math.max(x0 + r, Math.min(px, x1 - r))
  const cy = Math.max(y0 + r, Math.min(py, y1 - r))
  if (px >= x0 + r && px <= x1 - r) return py >= y0 && py <= y1
  if (py >= y0 + r && py <= y1 - r) return px >= x0 && px <= x1
  return Math.hypot(px - cx, py - cy) <= r
}

/**
 * Dibuja un icono y devuelve un Uint8Array RGBA.
 * `maskable` reserva margen para que el icono siga siendo legible cuando
 * Android lo recorta en circulo.
 */
function dibujar(tamano, { maskable = false } = {}) {
  const salida = new Uint8Array(tamano * tamano * 4)
  const margen = maskable ? tamano * 0.12 : 0
  const escala = tamano - margen * 2

  // El radio es una fraccion del RECTANGULO, no del lienzo. Antes valia
  // `tamano * 0.5` en el maskable, donde el rectangulo mide 0.76 * tamano: al
  // pasar de la mitad, `dentroRectRedondeado` degeneraba en un circulo desplazado
  // hacia la esquina inferior derecha que se salia del lienzo. Es el corte que se
  // veia en el icono de la app.
  //
  // 0.5 seria un circulo; 0.4 sigue leyendose como cuadrado pero con las esquinas
  // muy redondeadas, que es lo que se quiere.
  const radio = escala * 0.4

  // `grosor` es la SEMIanchura: la condicion mide distancia al segmento, asi que
  // el ancho real de la linea es el doble. Antes valia 0.075 * tamano y la linea
  // salia con un ancho de 0.15 del icono, que es lo que fusionaba las crestas en
  // una sola mancha.
  const grosor = escala * 0.035
  const fijar = (valor) => Math.max(0, Math.min(255, Math.round(valor)))

  for (let y = 0; y < tamano; y++) {
    for (let x = 0; x < tamano; x++) {
      const i = (y * tamano + x) * 4
      // Muestreo 2x2 para suavizar los bordes sin necesidad de filtro.
      let fondo = 0
      let linea = 0
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const px = x + (sx + 0.5) / 2
          const py = y + (sy + 0.5) / 2
          if (
            dentroRectRedondeado(
              px,
              py,
              margen,
              margen,
              tamano - margen,
              tamano - margen,
              radio,
            )
          ) {
            fondo++
          }
          const nx = (px - margen) / escala
          const ny = (py - margen) / escala
          // Cada segmento se trata como una capsula: la distancia al segmento
          // MENOS el radio. Asi el trazo sale con los extremos y las uniones
          // redondeados de una sola vez, y con exactamente `grosor` de semianchura.
          //
          // Restar el radio fuera del `min` y no dentro importa: si no, el extremo
          // redondo sale con el doble de ancho que la linea y la linea acaba
          // pareciendo un hueso.
          let d = Infinity
          for (let s = 0; s < PULSO.length - 1; s++) {
            d = Math.min(d, distanciaSegmento(nx, ny, PULSO[s], PULSO[s + 1]) - grosor / escala)
          }
          if (d <= 0) linea++
        }
      }

      const nFondo = fondo / 4
      const nLinea = linea / 4
      for (let c = 0; c < 3; c++) {
        // La linea blanca se compone sobre el azul; el resultado se recorta
        // despues con el canal alpha del fondo.
        salida[i + c] = fijar(AZUL[c] * (1 - nLinea) + BLANCO[c] * nLinea)
      }
      salida[i + 3] = fijar(255 * Math.max(nFondo, nLinea))
    }
  }
  return salida
}

/**
 * Codifica un buffer de bytes RGBA en PNG (color type 6, 8 bits).
 * `rgba` es un Uint8Array de `ancho * alto * 4` bytes.
 */
function codificarPNG(rgba, ancho, alto) {
  // Cada fila lleva delante su byte de filtro; con filtro "None" (0) los datos
  // son los pixeles tal cual.
  const crudo = Buffer.alloc((ancho * 4 + 1) * alto)
  for (let y = 0; y < alto; y++) {
    const origen = y * ancho * 4
    crudo[y * (ancho * 4 + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + origen, ancho * 4).copy(
      crudo,
      y * (ancho * 4 + 1) + 1,
    )
  }

  const crc = (() => {
    const tabla = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      tabla[n] = c
    }
    return (buf) => {
      let c = -1
      for (const b of buf) c = tabla[(c ^ b) & 0xff] ^ (c >>> 8)
      return (c ^ -1) >>> 0
    }
  })()

  const trozo = (tipo, datos) => {
    const largo = Buffer.alloc(4)
    largo.writeUInt32BE(datos.length)
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos])
    const verificacion = Buffer.alloc(4)
    verificacion.writeUInt32BE(crc(cuerpo))
    return Buffer.concat([largo, cuerpo, verificacion])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(ancho, 0)
  ihdr.writeUInt32BE(alto, 4)
  ihdr[8] = 8 // profundidad de bits
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(crudo, { level: 9 })),
    trozo('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(SALIDA, { recursive: true })

const iconos = [
  { nombre: 'icono-192.png', tamano: 192 },
  { nombre: 'icono-512.png', tamano: 512 },
  { nombre: 'icono-maskable.png', tamano: 512, maskable: true },
]

for (const { nombre, tamano, maskable } of iconos) {
  const rgba = dibujar(tamano, { maskable })
  writeFileSync(join(SALIDA, nombre), codificarPNG(rgba, tamano, tamano))
  console.log(`Generado ${nombre} (${tamano}x${tamano})`)
}