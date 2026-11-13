import { useEffect, useRef, useState } from 'react'
import type { FlipperClient } from '../flipper/client'
import { LcdPainter } from '../flipper/paint'
import { HEIGHT, WIDTH } from '../flipper/screen'

/**
 * Picture-in-picture com a tela do Flipper: no iPhone, enquanto o PiP está aberto o JavaScript da
 * página continua rodando em segundo plano (medido: 92 s sem pausa). É o que mantém o modo Claude
 * vivo enquanto você usa o app do Claude.
 *
 * Duas regras do iOS que este código respeita (aprendidas no teste de segundo plano):
 * - o vídeo precisa receber quadros novos sempre, senão o iOS aborta o PiP — redesenhamos 5x/s;
 * - o pedido de PiP tem que sair no MESMO toque, sem nenhum await antes — por isso o vídeo é
 *   preparado antes e `toggle` é síncrono.
 */
export function usePip(fz: FlipperClient | null) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [active, setActive] = useState(false)
  const [ready, setReady] = useState(false)
  const fzRef = useRef(fz)
  fzRef.current = fz

  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !video || !ctx) return
    const lcd = document.createElement('canvas')
    lcd.width = WIDTH
    lcd.height = HEIGHT
    const painter = new LcdPainter(lcd.getContext('2d')!)
    ctx.imageSmoothingEnabled = false
    let tick = 0
    const draw = () => {
      const f = fzRef.current?.screen.frame
      if (f) {
        painter.paint(f.data, f.orientation)
        ctx.drawImage(lcd, 0, 0, canvas.width, canvas.height)
      } else {
        ctx.fillStyle = '#ff8c29'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
      // Um pixel que muda a cada quadro garante "quadro novo" mesmo com a tela do Flipper parada.
      ctx.fillStyle = tick++ % 2 ? '#ff8c29' : '#fe8b28'
      ctx.fillRect(0, 0, 1, 1)
    }
    draw()
    const id = setInterval(draw, 200)
    if ('captureStream' in canvas && !video.srcObject) {
      video.srcObject = canvas.captureStream(5)
      video.play().then(
        () => setReady(true),
        () => setReady(false),
      )
    }
    const onEnter = () => setActive(true)
    const onLeave = () => setActive(false)
    video.addEventListener('enterpictureinpicture', onEnter)
    video.addEventListener('leavepictureinpicture', onLeave)
    return () => {
      clearInterval(id)
      video.removeEventListener('enterpictureinpicture', onEnter)
      video.removeEventListener('leavepictureinpicture', onLeave)
    }
  }, [])

  /** Abre/fecha o PiP. Chame direto no onClick, sem await antes. */
  function toggle() {
    const video = videoRef.current as (HTMLVideoElement & { webkitSetPresentationMode?: (m: string) => void }) | null
    if (!video) return
    if (active || document.pictureInPictureElement) {
      document.exitPictureInPicture?.().catch(() => {})
      return
    }
    if (video.requestPictureInPicture && document.pictureInPictureEnabled) {
      video.requestPictureInPicture().catch(() => setActive(false))
    } else {
      video.webkitSetPresentationMode?.('picture-in-picture')
    }
  }

  return { canvasRef, videoRef, active, ready, toggle }
}
