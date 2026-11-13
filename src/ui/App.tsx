import { useEffect, useRef, useState } from 'react'
import { runTurn } from '../agent/agent'
import { makeProvider } from '../agent/providers'
import type { Msg } from '../agent/types'
import { BleTransport, bleSupported } from '../flipper/ble'
import { FlipperClient } from '../flipper/client'
import { FlipperLink } from '../flipper/link'
import { UsbTransport, usbKind } from '../flipper/usb'
import { loadIdentity, RelayClient, resetIdentity, type RelayState } from '../relay/client'
import { BackgroundTest } from './BackgroundTest'
import { clearChat, loadChat, saveChat } from './chatStore'
import { setLang, t } from './i18n'
import { ApproveSheet, RelayBar } from './RelayBar'
import { Device } from './Screen'
import { loadSettings, saveSettings, type Settings } from './settings'
import { SettingsPanel } from './SettingsPanel'
import { HelpSheet, SafetySheet, safetySeen } from './Sheets'
import { useBottomGuard } from './useBottomGuard'
import { useKeyboard } from './useKeyboard'
import { useScreenIdle } from './useScreenIdle'

type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'agent'; text: string }
  | { kind: 'tool'; id: string; label: string; detail: string; image?: string; error?: boolean; running: boolean }
  | { kind: 'info'; text: string }

/** Conversa guardada da visita anterior (lida uma vez, ao abrir). */
const saved = loadSettings().saveChat ? loadChat<ChatItem>() : null

/** O teste de segundo plano é ferramenta de quem mantém o app: só aparece com ?diag no endereço. */
const DIAG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('diag')
/** ?demo: Flipper simulado, para conhecer o app sem aparelho (sem aviso inicial e com os pedidos prontos à mostra). */
const DEMO = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo')

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  setLang(settings.lang) // antes de qualquer texto: os componentes leem t() ao desenhar
  const L = t()
  const [showSettings, setShowSettings] = useState(false)
  const [showBgTest, setShowBgTest] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showSafety, setShowSafety] = useState(() => !DEMO && !safetySeen())
  /** Chamadas do Claude em andamento: enquanto houver, a tela não pausa. */
  const [claudeRunning, setClaudeRunning] = useState(0)
  const [fz, setFz] = useState<FlipperClient | null>(null)
  const [conn, setConn] = useState<'off' | 'connecting' | 'reconnecting' | 'on'>('off')
  /** Por onde está (ou estava) a conexão: muda a explicação da reconexão. */
  const [via, setVia] = useState<'ble' | 'usb'>('ble')
  const [connLog, setConnLog] = useState('')
  const [connTrace, setConnTrace] = useState<string[]>([])
  const [battery, setBattery] = useState<string>('')
  const [latency, setLatency] = useState<number | null>(null)
  const [items, setItems] = useState<ChatItem[]>(() =>
    saved
      ? [
          ...saved.items.map((it) => (it.kind === 'tool' ? { ...it, running: false } : it)),
          { kind: 'info', text: saved.trimmed ? `${t().restored} ${t().historyTrimmed}` : t().restored },
        ]
      : [],
  )
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const history = useRef<Msg[]>(saved?.history ?? [])
  const abort = useRef<AbortController | null>(null)
  const chatRef = useRef<HTMLElement>(null)
  /** Conexão atual para o agente: troca a cada reconexão sem interromper a tarefa. */
  const link = useRef(new FlipperLink()).current
  // Modo Claude: código do aparelho, estado da ponte e o pedido de aprovação aberto (se houver).
  const [relayId, setRelayId] = useState(loadIdentity)
  const [relayState, setRelayState] = useState<RelayState>('off')
  const [relayDetail, setRelayDetail] = useState('')
  const [approval, setApproval] = useState<{ client: string; host: string; answer: (ok: boolean) => void } | null>(null)
  const typing = useKeyboard()
  useBottomGuard(typing)
  const idle = useScreenIdle(fz, busy || claudeRunning > 0)
  /** Ficha da reconexão em andamento; `stop` interrompe o laço. */
  const recon = useRef<{ stop: boolean } | null>(null)

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  // Guarda a conversa quando ela muda (e só quando o agente não está no meio de um passo).
  useEffect(() => {
    if (!settings.saveChat) {
      clearChat()
      return
    }
    if (!busy) saveChat(items.filter((it) => it.kind !== 'info'), history.current)
  }, [items, busy, settings.saveChat])

  // ?demo na URL: conecta num Flipper simulado (conhecer o app sem aparelho, revisar o design).
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('demo')) return
    import('../flipper/demo').then(({ DemoTransport }) => {
      const client = new FlipperClient(new DemoTransport())
      link.set(client)
      setFz(client)
      setConn('on')
      setBattery('87')
    })
  }, [])
  // Rola só a conversa (scrollIntoView rolaria também o documento, brigando com o teclado do iOS).
  // Ao abrir o teclado a conversa encolhe: volta para a última mensagem.
  useEffect(() => {
    const el = chatRef.current
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [items, typing])

  // Latência real do Bluetooth (ida e volta de um ping RPC), a cada 5 s enquanto o agente está parado.
  // Serve de "sinal de vida" visível e mantém a conexão aquecida.
  useEffect(() => {
    if (!fz || busy) return
    let alive = true
    const tick = async () => {
      const t0 = performance.now()
      try {
        await fz.ping()
        if (alive) setLatency(Math.round(performance.now() - t0))
      } catch {
        if (alive) setLatency(null)
      }
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [fz, busy])

  const add = (it: ChatItem) => setItems((xs) => [...xs, it])
  // Liga/desliga a ponte com o Claude. As ferramentas usam o mesmo `link` do agente local: se a
  // conexão com o Flipper cair, a chamada do Claude espera a reconexão como as do Gemini.
  useEffect(() => {
    if (!settings.relayOn || !settings.relayUrl) {
      setRelayState('off')
      return
    }
    const client = new RelayClient(settings.relayUrl, relayId, link, {
      onState: (st, detail) => (setRelayState(st), setRelayDetail(detail ?? '')),
      onApprove: (clientName, host) =>
        new Promise<boolean>((resolve) => {
          navigator.vibrate?.([30, 60, 30])
          setApproval({ client: clientName, host, answer: (ok) => (setApproval(null), resolve(ok)) })
        }),
      onToolStart: (c) => {
        setClaudeRunning((n) => n + 1)
        add({ kind: 'tool', id: `claude-${c.id}`, label: `Claude ${toolLabel(c.name)}`, detail: describeArgs(c.args), running: true })
      },
      onToolEnd: (r) => {
        setClaudeRunning((n) => Math.max(0, n - 1))
        patchTool(`claude-${r.id}`, { running: false, image: r.image, error: r.isError, detail: r.isError ? r.text : summarize(r.text) })
      },
    })
    client.start()
    return () => client.stop()
  }, [settings.relayOn, settings.relayUrl, relayId, link])

  const patchTool = (id: string, patch: Partial<Extract<ChatItem, { kind: 'tool' }>>) =>
    setItems((xs) => xs.map((x) => (x.kind === 'tool' && x.id === id ? { ...x, ...patch } : x)))

  /**
   * Liga um transporte já aberto à interface. Usado na primeira conexão e em cada reconexão.
   * `reopen` sabe reabrir ESTA conexão sem seletor (mesmo aparelho Bluetooth, ou porta USB já autorizada).
   */
  function attach(t: BleTransport | UsbTransport, reopen: () => Promise<BleTransport | UsbTransport>) {
    const client = new FlipperClient(t)
    setVia(t instanceof UsbTransport ? 'usb' : 'ble')
    if (t instanceof BleTransport)
      t.onRpcState = (open) => add({ kind: 'info', text: open ? L.rpcReopened : L.rpcClosed })
    t.onClose((reason) => {
      link.set(null)
      setFz(null)
      setLatency(null)
      // O agente NÃO é parado: as ferramentas dele esperam a reconexão (passagem de bastão).
      add({ kind: 'info', text: L.dropped(reason) })
      reconnectLoop(reopen)
    })
    link.set(client)
    setFz(client)
    setConn('on')
    setConnLog('')
    client
      .powerInfo()
      .then((p) => setBattery(p['charge.level'] ?? p['charge_level'] ?? ''))
      .catch(() => {})
  }

  /**
   * Abrir um app de Bluetooth no Flipper (Remote, Bad KB…) troca o rádio para o perfil de teclado e
   * derruba o serial; no cabo, é ele ser puxado. Insistimos na MESMA conexão, sem abrir a lista, até
   * ela voltar. Intervalo crescente até 5 s; desiste em 10 min.
   */
  async function reconnectLoop(reopen: () => Promise<BleTransport | UsbTransport>) {
    if (recon.current) recon.current.stop = true
    const token = { stop: false }
    recon.current = token
    setConn('reconnecting')
    const started = Date.now()
    for (let attempt = 1; !token.stop && Date.now() - started < 10 * 60_000; attempt++) {
      setConnLog(L.attempt(attempt))
      try {
        const t = await reopen()
        if (token.stop) {
          t.close().catch(() => {})
          return
        }
        recon.current = null
        attach(t, reopen)
        add({ kind: 'info', text: L.reconnected(t.name) })
        return
      } catch {
        await new Promise((r) => setTimeout(r, Math.min(1000 * attempt, 5000)))
      }
    }
    if (!token.stop) {
      recon.current = null
      abort.current?.abort()
      setConn('off')
      setConnLog('')
      add({ kind: 'info', text: t().gaveUp })
    }
  }

  function stopReconnect() {
    abort.current?.abort()
    if (recon.current) recon.current.stop = true
    recon.current = null
    setConn('off')
    setConnLog('')
  }

  async function connect(showAll = settings.showAllDevices) {
    setConn('connecting')
    setConnLog(L.openingList)
    const t0 = performance.now()
    const trace: string[] = []
    const log = (s: string) => {
      trace.push(`${((performance.now() - t0) / 1000).toFixed(1)}s ${s}`)
      setConnTrace([...trace])
      if (!s.startsWith('navegador') && !s.startsWith('bluetooth')) setConnLog(s)
    }
    try {
      const t = await BleTransport.connect(showAll, log)
      const device = t.bluetoothDevice
      attach(t, () => BleTransport.reconnect(device))
      add({ kind: 'info', text: L.connected(t.name) })
    } catch (e) {
      // Nunca esconder o erro: um "cancelled" pode significar lista vazia, não só o usuário fechando.
      setConn('off')
      const err = e as Error
      trace.push(`ERRO FINAL ${err.name}: ${err.message}`)
      setConnTrace([...trace])
      setConnLog(`${L.notConnected(err.message)}
${connectHint(err)}`)
    }
  }

  /** Cabo USB: Web Serial no computador, WebUSB no Android (cabo OTG). Não existe no iPhone. */
  async function connectUsb() {
    const kind = usbKind()
    if (!kind) return
    setConn('connecting')
    setConnLog(L.openingPorts)
    const t0 = performance.now()
    const trace: string[] = [`navegador: ${navigator.userAgent}`, `cabo via ${kind === 'serial' ? 'Web Serial' : 'WebUSB'}`]
    const log = (s: string) => {
      trace.push(`${((performance.now() - t0) / 1000).toFixed(1)}s ${s}`)
      setConnTrace([...trace])
      setConnLog(s)
    }
    try {
      const t = await UsbTransport.connect(kind, log)
      attach(t, () => UsbTransport.reconnect(kind))
      add({ kind: 'info', text: L.connectedUsb(t.name) })
    } catch (e) {
      setConn('off')
      const err = e as Error
      trace.push(`ERRO FINAL ${err.name}: ${err.message}`)
      setConnTrace([...trace])
      setConnLog(
        err.name === 'NotFoundError'
          ? L.noPort
          : L.notConnected(err.message),
      )
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || busy || !fz) return
    const key = settings.keys[settings.provider]
    const model = settings.models[settings.provider]
    const needsKey = settings.provider !== 'compat'
    if ((needsKey && !key) || !model || (settings.provider === 'compat' && !settings.compatBaseUrl)) {
      setShowSettings(true)
      return
    }
    setInput('')
    add({ kind: 'user', text })
    setBusy(true)
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      await runTurn(history.current, text, {
        provider: makeProvider(settings.provider, key, model, settings.compatBaseUrl),
        link,
        vision: settings.vision,
        signal: ctrl.signal,
        events: {
          onText: (t) => add({ kind: 'agent', text: t }),
          onToolStart: (c) => add({ kind: 'tool', id: c.id, label: toolLabel(c.name), detail: describeArgs(c.args), running: true }),
          onToolProgress: (c, m) => patchTool(c.id, { detail: m }),
          onToolEnd: (r) =>
            patchTool(r.id, { running: false, image: r.image, error: r.isError, detail: r.isError ? r.text : summarize(r.text) }),
        },
      })
    } catch (e) {
      const err = e as Error
      add({ kind: 'info', text: err.name === 'AbortError' ? t().stopped : t().error(err.message) })
    } finally {
      setBusy(false)
      abort.current = null
    }
  }

  function newChat() {
    history.current = []
    setItems([])
    clearChat()
  }

  const noBle = !bleSupported()
  const cable = usbKind()
  const needsKey = settings.provider !== 'compat' && !settings.keys[settings.provider]

  return (
    <div className={`app${typing ? ' typing' : ''}`}>
      <header className="status">
        <span className={`dot ${conn === 'reconnecting' ? 'connecting' : conn}`} aria-hidden="true" />
        <span className="device-name">
          {conn === 'on' ? fz?.name : conn === 'connecting' ? L.connecting : conn === 'reconnecting' ? L.reconnecting : L.noFlipper}
        </span>
        {conn === 'on' && (
          <span className="readouts">
            {latency !== null && <span title={L.latencyTitle}>{latency} ms</span>}
            {battery && <span title={L.batteryTitle}>{battery}%</span>}
          </span>
        )}
        <span className="spacer" />
        {DIAG && (
          <button type="button" className="icon-btn" onClick={() => setShowBgTest(true)} aria-label="Teste de segundo plano">
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
              <path d="M7 2h6M8 2v5L3.5 15a2 2 0 0 0 1.7 3h9.6a2 2 0 0 0 1.7-3L12 7V2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <button type="button" className="icon-btn" onClick={() => setShowHelp(true)} aria-label={L.help}>
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M7.8 7.8a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.5v.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="10" cy="14.6" r="1" fill="currentColor" />
          </svg>
        </button>
        <button type="button" className="icon-btn" onClick={() => setShowSettings(true)} aria-label={L.settings}>
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M3 6h9m4 0h1M3 14h1m4 0h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="14" cy="6" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="6" cy="14" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      </header>

      {settings.relayOn && settings.relayUrl && <RelayBar state={relayState} detail={relayDetail} code={relayId.code} fz={fz} />}

      {noBle && !cable ? (
        <section className="onboard">
          <div className="bezel">
            <div className="lcd lcd-text">{L.noBluetooth}</div>
          </div>
          <dl className="where">
            <dt>iPhone</dt>
            <dd>{L.whereIphone}</dd>
            <dt>Android</dt>
            <dd>{L.whereAndroid}</dd>
            <dt>{L.computer}</dt>
            <dd>{L.wherePc}</dd>
          </dl>
        </section>
      ) : !fz && conn === 'reconnecting' ? (
        <section className="onboard">
          <div className="bezel">
            <div className="lcd lcd-text">{L.reconnectingScreen}</div>
          </div>
          <p className="hint">{via === 'usb' ? L.reconnectUsb : L.reconnectBle}</p>
          {connLog && <p className="log">{connLog}</p>}
          <button type="button" className="btn quiet wide" onClick={stopReconnect}>
            {L.stopTrying}
          </button>
        </section>
      ) : !fz ? (
        <section className="onboard">
          <div className="bezel">
            <div className="lcd lcd-text">{conn === 'connecting' ? L.searching : L.waiting}</div>
          </div>
          {!noBle && (
            <button type="button" className="btn primary wide" onClick={() => connect()} disabled={conn === 'connecting'}>
              {conn === 'connecting' ? L.connectingBtn : L.connectBle}
            </button>
          )}
          {cable && (
            <button type="button" className={`btn ${noBle ? 'primary' : 'quiet'} wide`} onClick={connectUsb} disabled={conn === 'connecting'}>
              {L.connectUsb}
            </button>
          )}
          {!noBle && (
            <button type="button" className="link small" onClick={() => connect(true)} disabled={conn === 'connecting'}>
              {L.showAllBle}
            </button>
          )}
          <p className="hint">
            {!noBle && L.bleHint}
            {cable && L.cableHint(cable === 'webusb')}
          </p>
          {connLog && <p className="log">{connLog}</p>}
          {connTrace.length > 0 && conn !== 'connecting' && (
            <details className="diag">
              <summary>{L.diagSummary(connTrace.length)}</summary>
              <pre className="report">{connTrace.join('\n')}</pre>
              <button type="button" className="btn quiet" onClick={() => copyText(connTrace.join('\n'))}>
                {L.copyDiag}
              </button>
            </details>
          )}
        </section>
      ) : (
        <Device fz={fz} locked={busy} paused={idle.paused} onWake={idle.wake} />
      )}

      <main className="chat" aria-live="polite" ref={chatRef}>
        {items.length === 0 && fz && (
          <div className="chat-empty">
            {settings.relayOn && settings.relayUrl ? (
              <p>{L.claudeEmpty}</p>
            ) : needsKey && !DEMO ? (
              <p>
                {L.needKeyA}
                <button type="button" className="link" onClick={() => setShowSettings(true)}>
                  {L.needKeyLink}
                </button>
                {L.needKeyB}
              </p>
            ) : (
              <>
                <p>{L.tryOne}</p>
                <div className="recipes">
                  {L.recipes.map((r) => (
                    <button key={r} type="button" className="recipe" onClick={() => setInput(r)}>
                      {r}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {items.map((it, i) => (
          <ChatRow key={i} it={it} />
        ))}
      </main>

      <footer className="composer">
        {items.length > 0 && !busy && (
          <button type="button" className="link small" onClick={newChat}>
            {L.newChat}
          </button>
        )}
        <div className="compose-row">
          <textarea
            rows={1}
            value={input}
            aria-label={L.msgLabel}
            placeholder={fz ? L.askPlaceholder : L.connectFirst}
            disabled={!fz}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          {busy ? (
            <button type="button" className="send stop" onClick={() => abort.current?.abort()} aria-label={L.stopAgent}>
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                <rect x="5" y="5" width="10" height="10" rx="1.5" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button type="button" className="send" onClick={send} disabled={!fz || !input.trim()} aria-label={L.send}>
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                <path d="M10 16V4m0 0-5 5m5-5 5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </footer>

      {showBgTest && <BackgroundTest fz={fz} onClose={() => setShowBgTest(false)} />}
      {showSettings && (
        <SettingsPanel
          value={settings}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
          relayCode={relayId.code}
          onResetCode={() => setRelayId(resetIdentity())}
        />
      )}
      {showHelp && (
        <HelpSheet
          onClose={() => setShowHelp(false)}
          onSafety={() => {
            setShowHelp(false)
            setShowSafety(true)
          }}
        />
      )}
      {showSafety && <SafetySheet onClose={() => setShowSafety(false)} />}
      {approval && <ApproveSheet client={approval.client} host={approval.host} onAnswer={approval.answer} />}
    </div>
  )
}

function ChatRow({ it }: { it: ChatItem }) {
  if (it.kind === 'user') return <div className="bubble user">{it.text}</div>
  if (it.kind === 'agent') return <div className="bubble agent">{it.text}</div>
  if (it.kind === 'info') return <div className="info">{it.text}</div>
  return (
    <div className={`tool${it.error ? ' error' : ''}${it.running ? ' running' : ''}`}>
      <p>
        <span className="tool-name">{it.label}</span> {it.detail}
      </p>
      {it.image && <img src={`data:image/png;base64,${it.image}`} alt={t().agentScreenAlt} />}
    </div>
  )
}

const toolLabel = (name: string) => t().toolLabels[name] ?? name

/** Dica para os erros mais comuns da Web Bluetooth (pelo nome do erro e pela etapa). */
function connectHint(e: Error): string {
  const L = t()
  const m = e.message
  if (e.name === 'NotFoundError' && m.startsWith('escolher aparelho')) return L.hintClosedList
  if (e.name === 'SecurityError') return L.hintSecurity
  if (e.name === 'NetworkError' || m.startsWith('conectar GATT')) return L.hintGatt
  if (m.startsWith('abrir serviço serial')) return L.hintSerial
  if (m.includes('characteristic') || m.includes('notificações')) return L.hintPairing
  return L.hintOther
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* sem permissão de área de transferência: o texto continua visível para copiar à mão */
  }
}

function describeArgs(args: Record<string, unknown>): string {
  if (Array.isArray(args.keys)) {
    const sym: Record<string, string> = { UP: '▲', DOWN: '▼', LEFT: '◀', RIGHT: '▶', OK: 'OK', BACK: '↩' }
    return args.keys
      .map((k) => {
        const [name, mod] = String(k).toUpperCase().split(':')
        return `${sym[name] ?? name}${mod === 'LONG' ? t().long : ''}`
      })
      .join(' ')
  }
  return Object.values(args)
    .filter((v) => typeof v === 'string' || typeof v === 'number')
    .join(' · ')
    .slice(0, 80)
}

/** Resumo curto do resultado (sem as tags de dados não confiáveis). */
function summarize(text: string): string {
  const t = text.replace(/<\/?dados_flipper[^>]*>/g, '').trim()
  const first = t.split('\n').find((l) => l.trim()) ?? ''
  return first.length > 90 ? `${first.slice(0, 90)}…` : first
}
