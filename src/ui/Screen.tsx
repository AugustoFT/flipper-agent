import { useEffect, useRef } from 'react'
import type { FlipperClient, Key } from '../flipper/client'
import { HEIGHT, WIDTH } from '../flipper/screen'
import { drawFrame } from '../agent/image'

const SCALE = 4

/** Tela ao vivo + controle remoto. Toque = aperto curto; segurar > 0,5 s = aperto longo. */
export function Screen({ fz, disabled }: { fz: FlipperClient; disabled: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const draw = () => fz.screen.frame && drawFrame(ctx, fz.screen.frame, SCALE, '#ff8c29', '#1b1b1b')
    draw()
    fz.startScreen().catch(() => {})
    return fz.screen.subscribe(draw)
  }, [fz])

  return (
    <section className="screen-card">
      <canvas ref={canvas} width={WIDTH * SCALE} height={HEIGHT * SCALE} className="lcd" aria-label="Tela do Flipper ao vivo" />
      <div className="remote" aria-label="Controle remoto">
        <span />
        <RemoteKey fz={fz} k="UP" label="▲" disabled={disabled} />
        <span />
        <RemoteKey fz={fz} k="LEFT" label="◀" disabled={disabled} />
        <RemoteKey fz={fz} k="OK" label="OK" disabled={disabled} className="ok" />
        <RemoteKey fz={fz} k="RIGHT" label="▶" disabled={disabled} />
        <span />
        <RemoteKey fz={fz} k="DOWN" label="▼" disabled={disabled} />
        <RemoteKey fz={fz} k="BACK" label="↩" disabled={disabled} className="back" />
      </div>
      {disabled && <p className="hint">O agente está usando o Flipper. Toque em Parar para assumir o controle.</p>}
    </section>
  )
}

function RemoteKey(props: { fz: FlipperClient; k: Key; label: string; disabled: boolean; className?: string }) {
  const downAt = useRef(0)
  return (
    <button
      type="button"
      className={`key ${props.className ?? ''}`}
      disabled={props.disabled}
      aria-label={props.k}
      onPointerDown={() => (downAt.current = Date.now())}
      onPointerUp={() => {
        if (!downAt.current) return
        const long = Date.now() - downAt.current > 500
        downAt.current = 0
        props.fz.press(props.k, long).catch(() => {})
      }}
      onPointerLeave={() => (downAt.current = 0)}
    >
      {props.label}
    </button>
  )
}
