// Converte um quadro da tela em PNG (base64) ampliado — modelos enxergam melhor 512x256 que 128x64.

import { HEIGHT, toPixels, WIDTH, type Frame } from '../flipper/screen'

export function frameToPngBase64(frame: Frame, scale = 4): string {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH * scale
  canvas.height = HEIGHT * scale
  const ctx = canvas.getContext('2d')!
  drawFrame(ctx, frame, scale, '#ffffff', '#000000')
  return canvas.toDataURL('image/png').split(',')[1]
}

/** Desenha o quadro num canvas. Usado tanto para o modelo quanto para a tela ao vivo. */
export function drawFrame(ctx: CanvasRenderingContext2D, frame: Frame, scale: number, bg: string, fg: string) {
  const px = toPixels(frame)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, WIDTH * scale, HEIGHT * scale)
  ctx.fillStyle = fg
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) if (px[y * WIDTH + x]) ctx.fillRect(x * scale, y * scale, scale, scale)
  }
}
