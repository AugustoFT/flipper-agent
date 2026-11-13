// Teste de segundo plano: mede se o JavaScript da página continua rodando quando o Bluefy
// sai da tela (troca de app, tela bloqueada). É isso que decide se dá para usar o modo relay
// (Claude no mesmo iPhone) ou se o agente precisa ficar dentro da página (Gemini).
//
// Mede três coisas, a cada 2 s:
//   relógio  — se o setInterval atrasa, o JS foi congelado (o buraco aparece no "maior intervalo")
//   flipper  — ping RPC pelo BLE (a conexão e o JS precisam estar vivos)
//   rede     — fetch HTTP a cada 10 s (o relay precisaria disso)

import { useEffect, useRef, useState } from 'react'
import type { FlipperClient } from '../flipper/client'
import { HEIGHT, WIDTH } from '../flipper/screen'
import { drawFrame } from '../agent/image'

interface Sample {
  t: number // ms desde o início
  visible: boolean
  gap: number // ms desde a amostra anterior
  ping?: 'ok' | 'falha' | 'sem-flipper'
  pingMs?: number
  net?: 'ok' | 'falha'
}

interface Ev {
  t: number
  text: string
}

const TICK_MS = 2000
const NET_EVERY = 5 // ticks (10 s)

// Extensões do Bluefy (não documentadas oficialmente; testamos se existem).
type BluefyBluetooth = Bluetooth & { setScreenDimEnabled?: (enabled: boolean) => void }

export function BackgroundTest({ fz, onClose }: { fz: FlipperClient | null; onClose: () => void }) {
  const [running, setRunning] = useState(false)
  const [samples, setSamples] = useState<Sample[]>([])
  const [events, setEvents] = useState<Ev[]>([])
  const [keepAwake, setKeepAwake] = useState(false)
  const [pip, setPip] = useState(false)
  const [pipReady, setPipReady] = useState(false)
  const pipBusy = useRef(false)
  const start = useRef(0)
  const last = useRef(0)
  const tickN = useRef(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const wakeLock = useRef<WakeLockSentinel | null>(null)

  const now = () => Math.round(performance.now() - start.current)
  const log = (text: string) => setEvents((e) => [...e, { t: start.current ? now() : 0, text }])

  // Eventos de ciclo de vida da página: quando o iOS esconde/mostra/congela.
  useEffect(() => {
    if (!running) return
    const vis = () => log(`página ${document.visibilityState === 'visible' ? 'VISÍVEL' : 'OCULTA'}`)
    const hide = () => log('pagehide')
    const show = () => log('pageshow')
    const freeze = () => log('freeze')
    const resume = () => log('resume')
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('pagehide', hide)
    window.addEventListener('pageshow', show)
    document.addEventListener('freeze', freeze)
    document.addEventListener('resume', resume)
    return () => {
      document.removeEventListener('visibilitychange', vis)
      window.removeEventListener('pagehide', hide)
      window.removeEventListener('pageshow', show)
      document.removeEventListener('freeze', freeze)
      document.removeEventListener('resume', resume)
    }
  }, [running])

  // O laço de medição.
  useEffect(() => {
    if (!running) return
    let stop = false
    const id = setInterval(async () => {
      const t = now()
      const gap = t - last.current
      last.current = t
      tickN.current++
      const s: Sample = { t, gap, visible: document.visibilityState === 'visible' }
      if (gap > TICK_MS * 2.5) log(`JS ficou parado ~${Math.round(gap / 1000)} s`)

      const tasks: Promise<void>[] = []
      if (fz && !fz.rpc.closed) {
        const t0 = performance.now()
        tasks.push(
          Promise.race([fz.ping(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))])
            .then(() => {
              s.ping = 'ok'
              s.pingMs = Math.round(performance.now() - t0)
            })
            .catch(() => {
              s.ping = 'falha'
            }),
        )
      } else s.ping = 'sem-flipper'

      if (tickN.current % NET_EVERY === 0) {
        tasks.push(
          fetch(`./manifest.webmanifest?t=${Date.now()}`, { cache: 'no-store' })
            .then((r) => void (s.net = r.ok ? 'ok' : 'falha'))
            .catch(() => void (s.net = 'falha')),
        )
      }
      await Promise.all(tasks)
      if (!stop) setSamples((xs) => [...xs, s])
    }, TICK_MS)
    return () => {
      stop = true
      clearInterval(id)
    }
  }, [running, fz])

  // Canvas com a tela do Flipper, para o PiP.
  useEffect(() => {
    // Redesenha SEMPRE (5x/s), com um relógio no canto: um captureStream sem quadros novos deixa o
    // vídeo sem dados e o iOS aborta o PiP ("The operation was aborted").
    const canvas = canvasRef.current
    const video = videoRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !video || !ctx) return
    const t0 = Date.now()
    const draw = () => {
      if (fz?.screen.frame) drawFrame(ctx, fz.screen.frame, 2, '#ff8c29', '#1b1b1b')
      else {
        ctx.fillStyle = '#ff8c29'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
      ctx.fillStyle = '#1b1b1b'
      ctx.fillRect(canvas.width - 46, 0, 46, 14)
      ctx.fillStyle = '#ff8c29'
      ctx.font = '11px monospace'
      ctx.fillText(`${Math.floor((Date.now() - t0) / 1000)}s`, canvas.width - 42, 11)
    }
    draw()
    const id = setInterval(draw, 200)

    // Prepara o vídeo ANTES do toque: no toque, o pedido de PiP tem que sair na hora.
    if ('captureStream' in canvas && !video.srcObject) {
      video.srcObject = canvas.captureStream(5)
      video.play().then(
        () => setPipReady(true),
        (e) => log(`vídeo do PiP não tocou: ${(e as Error).message}`),
      )
    }
    const onEnter = () => (setPip(true), log('PiP ABERTO'))
    const onLeave = () => (setPip(false), log('PiP fechado'))
    video.addEventListener('enterpictureinpicture', onEnter)
    video.addEventListener('leavepictureinpicture', onLeave)
    return () => {
      clearInterval(id)
      video.removeEventListener('enterpictureinpicture', onEnter)
      video.removeEventListener('leavepictureinpicture', onLeave)
    }
  }, [fz])

  function begin() {
    start.current = performance.now()
    last.current = 0
    tickN.current = 0
    setSamples([])
    const estado = !fz ? 'NÃO conectado' : fz.rpc.closed ? `CONEXÃO MORTA (${fz.rpc.closed}) — reconecte` : 'conectado'
    setEvents([{ t: 0, text: `início · Flipper ${estado} · PiP ${pipReady ? 'pronto' : 'não pronto'} · ${navigator.userAgent}` }])
    setRunning(true)
  }

  async function toggleAwake() {
    const bt = navigator.bluetooth as BluefyBluetooth | undefined
    const next = !keepAwake
    try {
      if (bt?.setScreenDimEnabled) {
        bt.setScreenDimEnabled(!next) // Bluefy: false = não apagar a tela
        log(`Bluefy setScreenDimEnabled(${!next})`)
      }
      if (next && 'wakeLock' in navigator) {
        wakeLock.current = await navigator.wakeLock.request('screen')
        log('Wake Lock ativo')
      } else if (!next) {
        await wakeLock.current?.release()
        wakeLock.current = null
      }
      if (!bt?.setScreenDimEnabled && !('wakeLock' in navigator)) log('nenhuma API para manter a tela acesa')
      setKeepAwake(next)
    } catch (e) {
      log(`manter tela acesa falhou: ${(e as Error).message}`)
    }
  }

  // SEM async/await antes do pedido: no iOS o PiP só é aceito dentro do mesmo "toque" (user
  // activation). Qualquer await antes (como esperar o vídeo tocar) faz o iOS recusar com
  // "The request is not triggered by a user activation".
  function togglePip() {
    const video = videoRef.current as (HTMLVideoElement & { webkitSetPresentationMode?: (m: string) => void }) | null
    if (!video || pipBusy.current) return
    if (pip || document.pictureInPictureElement) {
      document.exitPictureInPicture?.().catch(() => {})
      return
    }
    if (!pipReady) {
      log('PiP: o vídeo ainda não está pronto, toque de novo em 1 s')
      return
    }
    pipBusy.current = true
    const done = () => (pipBusy.current = false)
    try {
      if (video.requestPictureInPicture && document.pictureInPictureEnabled) {
        video.requestPictureInPicture().then(done, (e: Error) => (log(`PiP falhou: ${e.name}: ${e.message}`), done()))
      } else if (video.webkitSetPresentationMode) {
        video.webkitSetPresentationMode('picture-in-picture')
        done()
      } else {
        log('este navegador não oferece Picture in Picture')
        done()
      }
    } catch (e) {
      log(`PiP falhou: ${(e as Error).message}`)
      done()
    }
  }

  // Resumo: o que importa é o que aconteceu enquanto a página estava OCULTA.
  const hidden = samples.filter((s) => !s.visible)
  const maxGap = samples.reduce((m, s) => Math.max(m, s.gap), 0)
  const okHidden = hidden.filter((s) => s.ping === 'ok').length
  const netHidden = hidden.filter((s) => s.net).length
  const netOkHidden = hidden.filter((s) => s.net === 'ok').length
  const leftScreen = events.some((e) => e.text.includes('OCULTA'))
  let verdict = 'Inicie o teste, troque para o app do Claude por 1–2 minutos e volte.'
  // Sem Flipper, o critério é só o relógio do JS (útil para um primeiro teste rápido).
  const aliveHidden = fz ? okHidden : hidden.filter((s) => s.gap < TICK_MS * 2.5).length
  if (leftScreen) {
    if (hidden.length >= 10 && aliveHidden >= hidden.length * 0.8) verdict = '✅ O JavaScript continuou rodando em segundo plano: o modo relay deve funcionar no mesmo iPhone.'
    else if (hidden.length === 0 || maxGap > 20000) verdict = `❌ O JavaScript congelou fora da tela (maior pausa: ${Math.round(maxGap / 1000)} s). O modo relay não funciona no mesmo iPhone.`
    else verdict = `⚠ Parcial: ${okHidden}/${hidden.length} pings ok fora da tela, maior pausa ${Math.round(maxGap / 1000)} s.`
  }

  const report = [
    `RELATÓRIO TESTE SEGUNDO PLANO`,
    verdict,
    `amostras=${samples.length} ocultas=${hidden.length} pingOkOculta=${okHidden} redeOkOculta=${netOkHidden}/${netHidden} maiorPausa=${maxGap}ms`,
    `manterTela=${keepAwake} pip=${pip} bluefyDim=${typeof (navigator.bluetooth as BluefyBluetooth | undefined)?.setScreenDimEnabled === 'function'} pipApi=${'pictureInPictureEnabled' in document}`,
    '--- eventos ---',
    ...events.map((e) => `${(e.t / 1000).toFixed(1)}s ${e.text}`),
    '--- amostras (t, visível, intervalo, ping, rede) ---',
    ...samples.map((s) => `${(s.t / 1000).toFixed(1)} ${s.visible ? 'V' : 'O'} ${s.gap} ${s.ping}${s.pingMs ? `(${s.pingMs}ms)` : ''} ${s.net ?? ''}`),
  ].join('\n')

  async function copy() {
    try {
      await navigator.clipboard.writeText(report)
      log('relatório copiado')
    } catch {
      log('não consegui copiar: selecione o texto abaixo e copie manualmente')
    }
  }

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="bg-title">
      <div className="sheet-body">
        <header className="sheet-head">
          <h2 id="bg-title">Teste de segundo plano</h2>
          <button type="button" className="ghost" onClick={onClose}>
            Fechar
          </button>
        </header>

        <ol className="steps">
          <li>No Bluefy, libere o Flipper nos periféricos de segundo plano (configurações do Bluefy).</li>
          <li>Toque em <b>Iniciar</b> e espere umas 5 amostras.</li>
          <li>Troque para o app do Claude (ou bloqueie a tela) por 1–2 minutos.</li>
          <li>Volte ao Bluefy, toque em <b>Copiar relatório</b> e cole na conversa.</li>
        </ol>

        <div className="row wrap">
          {running ? (
            <button type="button" className="stop" onClick={() => setRunning(false)}>
              Parar
            </button>
          ) : (
            <button type="button" className="primary" onClick={begin}>
              Iniciar
            </button>
          )}
          <button type="button" onClick={toggleAwake}>
            {keepAwake ? 'Tela acesa: ligado' : 'Manter tela acesa'}
          </button>
          <button type="button" onClick={togglePip}>
            {pip ? 'PiP: ligado (toque p/ fechar)' : pipReady ? 'Tentar PiP' : 'PiP preparando…'}
          </button>
          <button type="button" onClick={copy} disabled={samples.length === 0}>
            Copiar relatório
          </button>
        </div>

        <p className="verdict">{verdict}</p>
        <p className="note">
          {samples.length} amostras · fora da tela: {hidden.length} · pings ok fora da tela: {okHidden} · maior pausa do JS:{' '}
          {Math.round(maxGap / 100) / 10} s
        </p>

        {/* Fonte do PiP: precisa existir no DOM; o vídeo fica pequeno e mudo. */}
        <div className="pip-src">
          <canvas ref={canvasRef} width={WIDTH * 2} height={HEIGHT * 2} />
          <video ref={videoRef} muted playsInline />
        </div>

        <pre className="report">{report}</pre>
      </div>
    </div>
  )
}
