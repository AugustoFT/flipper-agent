import { useEffect, useRef, useState } from 'react'
import { runTurn } from '../agent/agent'
import { makeProvider } from '../agent/providers'
import type { Msg } from '../agent/types'
import { BleTransport, bleSupported } from '../flipper/ble'
import { FlipperClient } from '../flipper/client'
import { BackgroundTest } from './BackgroundTest'
import { Screen } from './Screen'
import { loadSettings, saveSettings, type Settings } from './settings'
import { SettingsPanel } from './SettingsPanel'

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
  const [conn, setConn] = useState<'off' | 'connecting' | 'on'>('off')
  const [connLog, setConnLog] = useState('')
  const [battery, setBattery] = useState<string>('')
  const [items, setItems] = useState<ChatItem[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const history = useRef<Msg[]>([])
  const abort = useRef<AbortController | null>(null)
  const listEnd = useRef<HTMLDivElement>(null)

  // Corpo com chaves: um efeito só pode devolver uma função de limpeza (ou nada).
  // scrollIntoView passou a devolver Promise em navegadores recentes; sem chaves, o React quebra.
  useEffect(() => {
    saveSettings(settings)
  }, [settings])
  useEffect(() => {
    listEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [items])

  const add = (it: ChatItem) => setItems((xs) => [...xs, it])
  const patchTool = (id: string, patch: Partial<Extract<ChatItem, { kind: 'tool' }>>) =>
    setItems((xs) => xs.map((x) => (x.kind === 'tool' && x.id === id ? { ...x, ...patch } : x)))

  async function connect(showAll = settings.showAllDevices) {
    setConn('connecting')
    setConnLog('Abrindo a lista de dispositivos…')
    try {
      const t = await BleTransport.connect(showAll, setConnLog)
      const client = new FlipperClient(t)
      t.onRpcState = (open) => add({ kind: 'info', text: open ? 'RPC reaberto.' : 'O Flipper fechou o RPC (bloqueado?). Desbloqueie para continuar.' })
      t.onClose((reason) => {
        setConn('off')
        setFz(null)
        abort.current?.abort()
        add({ kind: 'info', text: `Conexão encerrada: ${reason}.` })
      })
      setFz(client)
      setConn('on')
      setConnLog('')
      add({ kind: 'info', text: `Conectado a ${t.name}.` })
      client
        .powerInfo()
        .then((p) => setBattery(p['charge.level'] ?? p['charge_level'] ?? ''))
        .catch(() => {})
    } catch (e) {
      setConn('off')
      const msg = (e as Error).message
      setConnLog(/cancel/i.test(msg) ? '' : `Não conectou: ${msg}`)
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || busy || !fz) return
    const key = settings.keys[settings.provider]
    const model = settings.models[settings.provider]
    if (!key || !model) {
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
        provider: makeProvider(settings.provider, key, model),
        fz,
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
  const needsKey = !settings.keys[settings.provider]

  return (
    <div className="app">
      <header className="top">
        <h1>Flipper Agent</h1>
        <span className={`pill ${conn}`}>
          {conn === 'on' ? `● ${fz?.name ?? ''}${battery ? ` · ${battery}%` : ''}` : conn === 'connecting' ? 'conectando…' : 'desconectado'}
        </span>
        <button type="button" className="ghost" onClick={() => setShowBgTest(true)} aria-label="Teste de segundo plano">
          🧪
        </button>
        <button type="button" className="ghost" onClick={() => setShowSettings(true)} aria-label="Configurações">
          ⚙
        </button>
      </header>

      {noBle ? (
        <section className="empty">
          <h2>Este navegador não tem Bluetooth web</h2>
          <p>
            <b>iPhone:</b> instale o navegador <b>Bluefy</b> (grátis na App Store) e abra este mesmo endereço nele.
          </p>
          <p>
            <b>Android:</b> abra no <b>Chrome</b>.
          </p>
          <p>
            <b>Computador:</b> Chrome ou Edge.
          </p>
        </section>
      ) : !fz ? (
        <section className="empty">
          <h2>Conecte seu Flipper</h2>
          <p>Ligue o Bluetooth do Flipper (Configurações → Bluetooth → ON). Na primeira vez, o celular pede o PIN que aparece na tela do Flipper.</p>
          <div className="row wrap">
            <button type="button" className="primary" onClick={() => connect()} disabled={conn === 'connecting'}>
              {conn === 'connecting' ? 'Conectando…' : 'Conectar Flipper'}
            </button>
            <button type="button" onClick={() => connect(true)} disabled={conn === 'connecting'}>
              Não aparece? Mostrar todos
            </button>
          </div>
          <p className="hint">
            Se o Flipper não aparecer: feche o app oficial do Flipper (ele "segura" a conexão) e confira em Ajustes → Bluefy se o
            Bluetooth está permitido.
          </p>
          {connLog && <p className="log">{connLog}</p>}
          {needsKey && (
            <p className="hint">
              Para conversar com o agente, coloque uma chave grátis em <button type="button" className="link" onClick={() => setShowSettings(true)}>configurações</button>.
            </p>
          )}
        </section>
      ) : (
        <Screen fz={fz} disabled={busy} />
      )}

      <main className="chat" aria-live="polite">
        {items.map((it, i) => (
          <ChatRow key={i} it={it} />
        ))}
        <div ref={listEnd} />
      </main>

      <footer className="composer">
        {items.length > 0 && !busy && (
          <button type="button" className="ghost small" onClick={newChat}>
            Nova conversa
          </button>
        )}
        <div className="row">
          <textarea
            rows={1}
            value={input}
            placeholder={fz ? 'Ex.: abra o Infravermelho e me diga quais controles tenho' : 'Conecte o Flipper primeiro'}
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
            <button type="button" className="stop" onClick={() => abort.current?.abort()}>
              Parar
            </button>
          ) : (
            <button type="button" className="primary" onClick={send} disabled={!fz || !input.trim()}>
              Enviar
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
    <div className={`tool ${it.error ? 'error' : ''}`}>
      <div>
        <b>{it.running ? '⏳' : it.error ? '⚠' : '✓'} {it.label}</b> <span>{it.detail}</span>
      </div>
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
}

const toolLabel = (name: string) => LABELS[name] ?? name

function describeArgs(args: Record<string, unknown>): string {
  if (Array.isArray(args.keys)) return args.keys.join(' ')
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
