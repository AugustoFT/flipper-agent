import { useCallback, useEffect, useRef, useState } from 'react'
import type { FlipperClient } from '../flipper/client'

/** Sem toque nem agente por este tempo, a tela ao vivo pausa. */
const IDLE_MS = 30_000

/**
 * Pausa a transmissão da tela quando ninguém está olhando.
 *
 * A tela ao vivo é o que mais ocupa o Bluetooth: em telas animadas (o golfinho, por exemplo) o
 * Flipper manda ~18 quadros por segundo, e cada tecla do agente fica na fila atrás deles. Parada,
 * a tela não serve para nada, então pausamos depois de 30 s sem toque e sem o agente trabalhando.
 *
 * - `active` (agente local ou Claude rodando) impede a pausa e recomeça a contagem quando acaba.
 * - As ferramentas do agente ligam a tela sozinhas (`startScreen`); ao chegar um quadro com a
 *   transmissão ligada, o aviso de pausa some.
 * - `wake()` (toque na tela ou numa tecla do controle) religa na hora.
 */
export function useScreenIdle(fz: FlipperClient | null, active: boolean) {
  const [paused, setPaused] = useState(false)
  const last = useRef(Date.now())
  const activeRef = useRef(active)
  activeRef.current = active

  // Agente começou ou terminou: conta o tempo a partir de agora.
  useEffect(() => {
    last.current = Date.now()
  }, [active])

  useEffect(() => {
    setPaused(false)
    last.current = Date.now()
    if (!fz) return
    const id = setInterval(() => {
      if (activeRef.current || !fz.isStreaming) return
      if (Date.now() - last.current < IDLE_MS) return
      fz.stopScreen().catch(() => {})
      setPaused(true)
    }, 2000)
    const off = fz.screen.subscribe(() => {
      if (fz.isStreaming) {
        setPaused((p) => {
          if (p) last.current = Date.now()
          return false
        })
      }
    })
    return () => {
      clearInterval(id)
      off()
    }
  }, [fz])

  const wake = useCallback(() => {
    last.current = Date.now()
    if (!fz) return
    if (!fz.isStreaming) fz.startScreen().catch(() => {})
    setPaused(false)
  }, [fz])

  return { paused, wake }
}
