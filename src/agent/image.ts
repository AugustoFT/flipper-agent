// Converte um quadro da tela em PNG (base64) ampliado — modelos enxergam melhor 512x256 que 128x64.

import { LcdPainter } from '../flipper/paint'
import { HEIGHT, WIDTH, type Frame } from '../flipper/screen'

let small: { canvas: HTMLCanvasElement; painter: LcdPainter } | null = null
let big: HTMLCanvasElement | null = null

export function frameToPngBase64(frame: Frame, scale = 4): string {
  // Pinta em 128x64 (rápido) e amplia com drawImage sem suavização: pixels nítidos.
  if (!small) {
    const canvas = document.createElement('canvas')
    canvas.width = WIDTH
    canvas.height = HEIGHT
    small = { canvas, painter: new LcdPainter(canvas.getContext('2d')!, '#000000', '#ffffff') }
  }
  small.painter.paint(frame.data, frame.orientation)
  if (!big) big = document.createElement('canvas')
  big.width = WIDTH * scale
  big.height = HEIGHT * scale
  const ctx = big.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(small.canvas, 0, 0, big.width, big.height)
  return big.toDataURL('image/png').split(',')[1]
}
