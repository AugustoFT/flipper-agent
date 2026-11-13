import { useRef } from 'react'
import type { FlipperClient, Key } from '../flipper/client'
import { HEIGHT, WIDTH } from '../flipper/screen'
import { useLcd } from './useLcd'

/**
 * O "corpo" do Flipper: o LCD ao vivo e o D-pad redondo, com o BACK separado, como no aparelho.
 * As teclas imitam o botão físico: PRESS ao encostar, LONG aos 0,5 s, REPEAT segurando (rola listas
 * rápido), SHORT+RELEASE ao soltar.
 */
export function Device({ fz, locked }: { fz: FlipperClient; locked: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useLcd(fz, canvas, '#1b1b1b', '#ff8c29')

  return (
    <section className="device" aria-label="Flipper">
      <div className="bezel">
        <canvas ref={canvas} width={WIDTH} height={HEIGHT} className="lcd" role="img" aria-label="Tela do Flipper ao vivo" />
      </div>
      <div className="controls" aria-label="Controle">
        <div className="dpad">
          <PadKey fz={fz} k="UP" label="Para cima" locked={locked} />
          <PadKey fz={fz} k="LEFT" label="Esquerda" locked={locked} />
          <PadKey fz={fz} k="OK" label="OK" locked={locked} />
          <PadKey fz={fz} k="RIGHT" label="Direita" locked={locked} />
          <PadKey fz={fz} k="DOWN" label="Para baixo" locked={locked} />
        </div>
        <PadKey fz={fz} k="BACK" label="Voltar" locked={locked} />
      </div>
      {locked && <p className="device-note">O agente está usando o Flipper. Toque em Parar para assumir.</p>}
    </section>
  )
}

const LONG_MS = 500
const REPEAT_MS = 150

function PadKey({ fz, k, label, locked }: { fz: FlipperClient; k: Key; label: string; locked: boolean }) {
  const st = useRef<{ long: boolean; timer: number; rep: number; down: boolean }>({ long: false, timer: 0, rep: 0, down: false })

  const release = (cancelled: boolean) => {
    const s = st.current
    if (!s.down) return
    s.down = false
    clearTimeout(s.timer)
    clearInterval(s.rep)
    if (!s.long && !cancelled) fz.inputEvent(k, 'SHORT')
    fz.inputEvent(k, 'RELEASE')
  }

  return (
    <button
      type="button"
      className={`pad pad-${k.toLowerCase()}`}
      aria-label={label}
      disabled={locked}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        const s = st.current
        s.down = true
        s.long = false
        navigator.vibrate?.(8)
        fz.inputEvent(k, 'PRESS')
        s.timer = window.setTimeout(() => {
          s.long = true
          fz.inputEvent(k, 'LONG')
          s.rep = window.setInterval(() => fz.inputEvent(k, 'REPEAT'), REPEAT_MS)
        }, LONG_MS)
      }}
      onPointerUp={() => release(false)}
      onPointerCancel={() => release(true)}
    >
      {k === 'OK' ? <span className="ok-dot" /> : k === 'BACK' ? <BackIcon /> : <Arrow k={k} />}
    </button>
  )
}

function Arrow({ k }: { k: Key }) {
  const rot = { UP: 0, RIGHT: 90, DOWN: 180, LEFT: 270 }[k as 'UP'] ?? 0
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" style={{ transform: `rotate(${rot}deg)` }}>
      <path d="M8 4 13 11H3z" fill="currentColor" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M7 5 3 9l4 4M3.5 9H12a4.5 4.5 0 0 1 0 9H9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
