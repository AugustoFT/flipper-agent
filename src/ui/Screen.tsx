import { useRef } from 'react'
import type { FlipperClient, Key } from '../flipper/client'
import { HEIGHT, WIDTH } from '../flipper/screen'
import { t } from './i18n'
import { useLcd } from './useLcd'

/**
 * O "corpo" do Flipper: o LCD ao vivo e, ao lado dele, um controle compacto 3×3 (setas, OK e BACK).
 * Fica no canto e não ocupa linha própria: o normal é comandar por mensagem, o controle é reserva.
 * As teclas imitam o botão físico: PRESS ao encostar, LONG aos 0,5 s, REPEAT segurando (rola listas
 * rápido), SHORT+RELEASE ao soltar.
 */
export function Device({ fz, locked, paused, onWake }: { fz: FlipperClient; locked: boolean; paused: boolean; onWake: () => void }) {
  const L = t()
  const canvas = useRef<HTMLCanvasElement>(null)
  useLcd(fz, canvas, '#1b1b1b', '#ff8c29')

  return (
    <section className="device" aria-label={L.device}>
      <div className={`bezel${paused ? ' paused' : ''}`}>
        <canvas ref={canvas} width={WIDTH} height={HEIGHT} className="lcd" role="img" aria-label={L.liveScreen} />
        {paused && (
          <button type="button" className="lcd-paused" onClick={onWake} aria-label={L.resume}>
            <span>{L.paused}</span>
          </button>
        )}
      </div>
      <div className="controls" aria-label={L.controls}>
        <PadKey fz={fz} k="UP" label={L.keyUp} locked={locked} onWake={onWake} />
        <PadKey fz={fz} k="LEFT" label={L.keyLeft} locked={locked} onWake={onWake} />
        <PadKey fz={fz} k="OK" label="OK" locked={locked} onWake={onWake} />
        <PadKey fz={fz} k="RIGHT" label={L.keyRight} locked={locked} onWake={onWake} />
        <PadKey fz={fz} k="DOWN" label={L.keyDown} locked={locked} onWake={onWake} />
        <PadKey fz={fz} k="BACK" label={L.keyBack} locked={locked} onWake={onWake} />
      </div>
      {locked && <p className="device-note">{L.agentUsing}</p>}
    </section>
  )
}

const LONG_MS = 500
const REPEAT_MS = 150

function PadKey({ fz, k, label, locked, onWake }: { fz: FlipperClient; k: Key; label: string; locked: boolean; onWake: () => void }) {
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
        onWake()
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
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" style={{ transform: `rotate(${rot}deg)` }}>
      <path d="M8 4 13 11H3z" fill="currentColor" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
      <path d="M7 5 3 9l4 4M3.5 9H12a4.5 4.5 0 0 1 0 9H9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
