import { useEffect, useRef, useState } from 'react'
import { runTurn } from '../agent/agent'
import { makeProvider } from '../agent/providers'
import type { Msg } from '../agent/types'
import { BleTransport, bleSupported } from '../flipper/ble'
import { FlipperClient } from '../flipper/client'
import { FlipperLink } from '../flipper/link'
import { UsbTransport, usbKind } from '../flipper/usb'
import { BackgroundTest } from './BackgroundTest'
import { Device } from './Screen'
import { loadSettings, saveSettings, type Settings } from './settings'
import { SettingsPanel } from './SettingsPanel'
import { useKeyboard } from './useKeyboard'

type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'agent'; text: string }
  | { kind: 'tool'; id: string; label: string; detail: string; image?: string; error?: boolean; running: boolean }
  | { kind: 'info'; text: string }

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [showBgTest, setShowBgTest] = useState(false)
  const [fz, setFz] = useState<FlipperClient | null>(null)
  const [conn, setConn] = useState<'off' | 'connecting' | 'reconnecting' | 'on'>('off')
  /** Por onde está (ou estava) a conexão: muda a explicação da reconexão. */
  const [via, setVia] = useState<'ble' | 'usb'>('ble')
  const [connLog, setConnLog] = useState('')
  const [connTrace, setConnTrace] = useState<string[]>([])
  const [battery, setBattery] = useState<string>('')
  const [latency, setLatency] = useState<number | null>(null)
  const [items, setItems] = useState<ChatItem[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const history = useRef<Msg[]>([])
  const abort = useRef<AbortController | null>(null)
  const chatRef = useRef<HTMLElement>(null)
  /** Conexão atual para o agente: troca a cada reconexão sem interromper a tarefa. */
  const link = useRef(new FlipperLink()).current
  const typing = useKeyboard()
  /** Ficha da reconexão em andamento; `stop` interrompe o laço. */
  const recon = useRef<{ stop: boolean } | null>(null)

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

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
      t.onRpcState = (open) => add({ kind: 'info', text: open ? 'RPC reaberto.' : 'O Flipper fechou o RPC (bloqueado?). Desbloqueie para continuar.' })
    t.onClose((reason) => {
      link.set(null)
      setFz(null)
      setLatency(null)
      // O agente NÃO é parado: as ferramentas dele esperam a reconexão (passagem de bastão).
      add({ kind: 'info', text: `Conexão caiu (${reason}). Tentando reconectar…` })
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
      setConnLog(`Tentativa ${attempt}…`)
      try {
        const t = await reopen()
        if (token.stop) {
          t.close().catch(() => {})
          return
        }
        recon.current = null
        attach(t, reopen)
        add({ kind: 'info', text: `Reconectado a ${t.name}.` })
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
      add({ kind: 'info', text: 'Não reconectou em 10 minutos. Toque em Conectar Flipper.' })
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
    setConnLog('Abrindo a lista de dispositivos…')
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
      add({ kind: 'info', text: `Conectado a ${t.name}.` })
    } catch (e) {
      // Nunca esconder o erro: um "cancelled" pode significar lista vazia, não só o usuário fechando.
      setConn('off')
      const err = e as Error
      trace.push(`ERRO FINAL ${err.name}: ${err.message}`)
      setConnTrace([...trace])
      setConnLog(`Não conectou: ${err.message}
${connectHint(err)}`)
    }
  }

  /** Cabo USB: Web Serial no computador, WebUSB no Android (cabo OTG). Não existe no iPhone. */
  async function connectUsb() {
    const kind = usbKind()
    if (!kind) return
    setConn('connecting')
    setConnLog('Abrindo a lista de portas USB…')
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
      add({ kind: 'info', text: `Conectado a ${t.name}. O Bluetooth do Flipper está livre para Bad KB e Remote.` })
    } catch (e) {
      setConn('off')
      const err = e as Error
      trace.push(`ERRO FINAL ${err.name}: ${err.message}`)
      setConnTrace([...trace])
      setConnLog(
        err.name === 'NotFoundError'
          ? 'Nenhuma porta escolhida. O Flipper está ligado no cabo e desbloqueado? No Android, use um cabo OTG.'
          : `Não conectou: ${err.message}`,
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
      add({ kind: 'info', text: err.name === 'AbortError' ? 'Parado.' : `Erro: ${err.message}` })
    } finally {
      setBusy(false)
      abort.current = null
    }
  }

  function newChat() {
    history.current = []
    setItems([])
  }

  const noBle = !bleSupported()
  const cable = usbKind()
  const needsKey = settings.provider !== 'compat' && !settings.keys[settings.provider]

  return (
    <div className={`app${typing ? ' typing' : ''}`}>
      <header className="status">
        <span className={`dot ${conn === 'reconnecting' ? 'connecting' : conn}`} aria-hidden="true" />
        <span className="device-name">
          {conn === 'on' ? fz?.name : conn === 'connecting' ? 'Conectando' : conn === 'reconnecting' ? 'Reconectando' : 'Sem Flipper'}
        </span>
        {conn === 'on' && (
          <span className="readouts">
            {latency !== null && <span title="Latência da conexão (ida e volta)">{latency} ms</span>}
            {battery && <span title="Bateria do Flipper">{battery}%</span>}
          </span>
        )}
        <span className="spacer" />
        <button type="button" className="icon-btn" onClick={() => setShowBgTest(true)} aria-label="Teste de segundo plano">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M7 2h6M8 2v5L3.5 15a2 2 0 0 0 1.7 3h9.6a2 2 0 0 0 1.7-3L12 7V2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Configurações">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M3 6h9m4 0h1M3 14h1m4 0h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="14" cy="6" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="6" cy="14" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      </header>

      {noBle && !cable ? (
        <section className="onboard">
          <div className="bezel">
            <div className="lcd lcd-text">Sem Bluetooth neste navegador</div>
          </div>
          <dl className="where">
            <dt>iPhone</dt>
            <dd>Instale o navegador Bluefy (grátis na App Store) e abra este mesmo endereço nele.</dd>
            <dt>Android</dt>
            <dd>Abra no Chrome.</dd>
            <dt>Computador</dt>
            <dd>Chrome ou Edge.</dd>
          </dl>
        </section>
      ) : !fz && conn === 'reconnecting' ? (
        <section className="onboard">
          <div className="bezel">
            <div className="lcd lcd-text">Reconectando…</div>
          </div>
          <p className="hint">
            {via === 'usb'
              ? 'O cabo foi desconectado. Encaixe de novo e a conexão volta sozinha.'
              : 'Se você abriu um app de Bluetooth no Flipper (Remote, Bad KB), ele trocou o rádio para modo teclado e a conexão caiu. Saia do app no Flipper e a conexão volta sozinha.'}
          </p>
          {connLog && <p className="log">{connLog}</p>}
          <button type="button" className="btn quiet wide" onClick={stopReconnect}>
            Parar de tentar
          </button>
        </section>
      ) : !fz ? (
        <section className="onboard">
          <div className="bezel">
            <div className="lcd lcd-text">{conn === 'connecting' ? 'Procurando…' : 'Aguardando Flipper'}</div>
          </div>
          {!noBle && (
            <button type="button" className="btn primary wide" onClick={() => connect()} disabled={conn === 'connecting'}>
              {conn === 'connecting' ? 'Conectando…' : 'Conectar por Bluetooth'}
            </button>
          )}
          {cable && (
            <button type="button" className={`btn ${noBle ? 'primary' : 'quiet'} wide`} onClick={connectUsb} disabled={conn === 'connecting'}>
              Conectar pelo cabo USB
            </button>
          )}
          {!noBle && (
            <button type="button" className="link small" onClick={() => connect(true)} disabled={conn === 'connecting'}>
              Não aparece? Mostrar todos os aparelhos Bluetooth
            </button>
          )}
          <p className="hint">
            {!noBle &&
              'Deixe o Bluetooth do Flipper ligado e na tela inicial. Feche o app oficial do Flipper: ele prende a conexão. Na primeira vez, digite o PIN que aparece no Flipper.'}
            {cable &&
              ` Pelo cabo${cable === 'webusb' ? ' (OTG)' : ''}, o Bluetooth do Flipper fica livre: Bad KB e Bluetooth Remote funcionam sem derrubar a conexão.`}
          </p>
          {connLog && <p className="log">{connLog}</p>}
          {connTrace.length > 0 && conn !== 'connecting' && (
            <details className="diag">
              <summary>Diagnóstico da conexão ({connTrace.length} linhas)</summary>
              <pre className="report">{connTrace.join('\n')}</pre>
              <button type="button" className="btn quiet" onClick={() => copyText(connTrace.join('\n'))}>
                Copiar diagnóstico
              </button>
            </details>
          )}
        </section>
      ) : (
        <Device fz={fz} locked={busy} />
      )}

      <main className="chat" aria-live="polite" ref={chatRef}>
        {items.length === 0 && fz && (
          <div className="chat-empty">
            {needsKey ? (
              <p>
                Para conversar com o agente, escolha uma IA em{' '}
                <button type="button" className="link" onClick={() => setShowSettings(true)}>
                  configurações
                </button>
                . O Gemini tem plano grátis.
              </p>
            ) : (
              <p>Peça em português: “abra o Infravermelho e me diga quais controles eu tenho”.</p>
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
            Nova conversa
          </button>
        )}
        <div className="compose-row">
          <textarea
            rows={1}
            value={input}
            aria-label="Mensagem para o agente"
            placeholder={fz ? 'Peça algo ao agente' : 'Conecte o Flipper primeiro'}
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
            <button type="button" className="send stop" onClick={() => abort.current?.abort()} aria-label="Parar o agente">
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                <rect x="5" y="5" width="10" height="10" rx="1.5" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button type="button" className="send" onClick={send} disabled={!fz || !input.trim()} aria-label="Enviar">
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                <path d="M10 16V4m0 0-5 5m5-5 5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </footer>

      {showBgTest && <BackgroundTest fz={fz} onClose={() => setShowBgTest(false)} />}
      {showSettings && <SettingsPanel value={settings} onChange={setSettings} onClose={() => setShowSettings(false)} />}
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
      {it.image && <img src={`data:image/png;base64,${it.image}`} alt="Tela do Flipper vista pelo agente" />}
    </div>
  )
}

const LABELS: Record<string, string> = {
  flipper_screen: 'olhou a tela',
  flipper_press: 'apertou',
  flipper_wait: 'esperou',
  flipper_app_start: 'abriu app',
  flipper_app_exit: 'fechou app',
  flipper_list: 'listou',
  flipper_read: 'leu',
  flipper_write: 'gravou',
  flipper_mkdir: 'criou pasta',
  flipper_delete: 'apagou',
  flipper_rename: 'renomeou',
  flipper_device_info: 'info do aparelho',
  flipper_power_info: 'bateria',
  flipper_handoff: 'passou o bastão',
}

const toolLabel = (name: string) => LABELS[name] ?? name

/** Dica em português para os erros mais comuns da Web Bluetooth (pelo nome do erro e pela etapa). */
function connectHint(e: Error): string {
  const m = e.message
  if (e.name === 'NotFoundError' && m.startsWith('escolher aparelho'))
    return 'A lista fechou sem aparelho escolhido. Se o Flipper não estava na lista: Bluetooth dele ligado? App oficial do Flipper fechado? Tente "Mostrar todos".'
  if (e.name === 'SecurityError') return 'O navegador bloqueou o Bluetooth. Em Ajustes do iPhone → Bluefy, permita o Bluetooth.'
  if (e.name === 'NetworkError' || m.startsWith('conectar GATT'))
    return 'Achou o Flipper mas não conectou. Ele pode estar conectado a outro app/celular: feche o app oficial e, em Ajustes → Bluetooth, desconecte o Flipper.'
  if (m.startsWith('abrir serviço serial'))
    return 'Conectou, mas o serviço serial não apareceu. Se o Flipper estiver em modo "Bad BT"/HID, saia desse app e tente de novo.'
  if (m.includes('characteristic') || m.includes('notificações'))
    return 'Falhou no pareamento ou na permissão. No iPhone: Ajustes → Bluetooth → "Esquecer" o Flipper e conectar de novo, aceitando o PIN.'
  return 'Copie o diagnóstico abaixo e mande na conversa.'
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
        return `${sym[name] ?? name}${mod === 'LONG' ? '(longo)' : ''}`
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
