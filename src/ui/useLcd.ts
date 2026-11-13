import { useEffect, type RefObject } from 'react'
import type { FlipperClient } from '../flipper/client'
import { LcdPainter } from '../flipper/paint'

/**
 * Liga a tela ao vivo do Flipper a um <canvas width=128 height=64>.
 *
 * Desempenho:
 * - Os quadros NÃO passam pelo estado do React: um quadro novo não re-renderiza componente nenhum.
 * - Coalescência por requestAnimationFrame: se chegarem 3 quadros entre dois "vsync", só o último é
 *   pintado. Nunca se desenha mais rápido que o display, e nunca em aba escondida.
 * - Pintura em 128x64 com um putImageData; a ampliação é da GPU (CSS image-rendering: pixelated).
 */
export function useLcd(fz: FlipperClient | null, canvas: RefObject<HTMLCanvasElement | null>, fg: string, bg: string) {
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d', { alpha: false })
    if (!fz || !ctx) return
    const painter = new LcdPainter(ctx, fg, bg)
    let raf = 0
    const flush = () => {
      raf = 0
      const f = fz.screen.frame
      if (f) painter.paint(f.data, f.orientation)
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(flush)
    }
    schedule()
    fz.startScreen().catch(() => {})
    const unsubscribe = fz.screen.subscribe(schedule)
    return () => {
      unsubscribe()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [fz, canvas, fg, bg])
}
