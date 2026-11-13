// Pintura rápida da tela do Flipper.
//
// Antes: um fillRect por pixel aceso (até 8192 chamadas de desenho por quadro) num canvas 512x256,
// mais um array novo alocado a cada quadro. Agora: os bytes do framebuffer viram pixels direto num
// ImageData de 128x64 reaproveitado (escrita de 32 bits por pixel) e UM putImageData. A ampliação
// fica com a GPU (CSS `image-rendering: pixelated`), que faz isso de graça.

import { HEIGHT, WIDTH } from './screen'

/** '#rrggbb' → inteiro RGBA na ordem de bytes do ImageData (little-endian: 0xAABBGGRR). */
export function rgba(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
}

/**
 * Escreve um quadro (1 bit/pixel, 8 linhas por byte, bit 0 em cima) em `out` (Uint32 de 128*64).
 * orientation 1 = girado 180°. As verticais (2, 3) são raras e saem sem rotação, como antes.
 */
export function paintPixels(out: Uint32Array, data: Uint8Array, orientation: number, fg: number, bg: number) {
  const flip = orientation === 1
  for (let page = 0; page < HEIGHT / 8; page++) {
    const rowBase = page * 8
    const src = page * WIDTH
    for (let x = 0; x < WIDTH; x++) {
      const byte = data[src + x]
      for (let bit = 0; bit < 8; bit++) {
        let i = (rowBase + bit) * WIDTH + x
        if (flip) i = WIDTH * HEIGHT - 1 - i
        out[i] = byte & (1 << bit) ? fg : bg
      }
    }
  }
}

/** Mantém o ImageData e desenha no canvas 128x64 (nativo). Um por canvas. */
export class LcdPainter {
  private img: ImageData
  private px: Uint32Array
  private fg: number
  private bg: number

  constructor(
    private ctx: CanvasRenderingContext2D,
    fg = '#1b1b1b',
    bg = '#ff8c29',
  ) {
    this.img = ctx.createImageData(WIDTH, HEIGHT)
    this.px = new Uint32Array(this.img.data.buffer)
    this.fg = rgba(fg)
    this.bg = rgba(bg)
  }

  setColors(fg: string, bg: string) {
    this.fg = rgba(fg)
    this.bg = rgba(bg)
  }

  paint(data: Uint8Array, orientation: number) {
    paintPixels(this.px, data, orientation, this.fg, this.bg)
    this.ctx.putImageData(this.img, 0, 0)
  }
}
