// Gate de segurança APLICADO NO CÓDIGO (não no prompt). Toda chamada de ferramenta, venha do agente
// local ou do Claude pelo relay, passa por aqui antes de tocar no Flipper:
//
//   - classifica o risco da chamada (low / medium / high);
//   - modo "só leitura": bloqueia tudo que não seja observar;
//   - ações de risco alto exigem confirmação do usuário na tela;
//   - sem canal de confirmação, ações de risco alto são recusadas (fail-closed);
//   - toda decisão vai para o registro de auditoria.
//
// O modelo pode ser enganado (prompt injection por arquivo, tela ou nome de rede). Este gate não
// depende de o modelo "se comportar".

import { appendAudit, redactArgs, type Decision, type Source } from './audit'
import type { ToolCall } from './types'

export type Risk = 'low' | 'medium' | 'high'
export type SafetyMode = 'readonly' | 'confirm-high' | 'confirm-all'

export interface ConfirmRequest {
  call: ToolCall
  risk: Risk
  source: Source
  /** Pares [campo, valor] já formatados para mostrar ao usuário. */
  details: Array<[string, string]>
  /** Dispara quando o gate desiste (tempo esgotado ou usuário parou o agente): a interface fecha o diálogo. */
  signal: AbortSignal
}

export type Confirm = (req: ConfirmRequest) => Promise<boolean>

export interface SafetyCtx {
  mode: SafetyMode
  confirm?: Confirm
  source: Source
}

/** Padrão quando ninguém configura nada: pede confirmação nas ações de risco alto; sem canal, recusa. */
export const DEFAULT_SAFETY: SafetyCtx = { mode: 'confirm-high', source: 'local' }

/** Só para os scripts de teste em hardware, rodados à mão num terminal. */
export const SCRIPT_SAFETY: SafetyCtx = { mode: 'confirm-high', source: 'script', confirm: async () => true }

const CONFIRM_TIMEOUT_MS = 90_000

/** Classificação por ferramenta (e por ação, no GPIO). Ferramenta desconhecida = alto (fail-closed). */
export function riskOf(name: string, args: Record<string, unknown>): Risk {
  switch (name) {
    case 'flipper_screen':
    case 'flipper_wait':
    case 'flipper_list':
    case 'flipper_read':
    case 'flipper_device_info':
    case 'flipper_power_info':
    case 'flipper_app_exit':
      return 'low'
    case 'flipper_gpio': {
      const action = String(args.action ?? '')
      if (action === 'read' || action === 'mode') return 'low'
      if (action === 'otg') return typeof args.on !== 'boolean' ? 'low' : args.on ? 'high' : 'medium'
      return 'high' // write, ou qualquer coisa estranha
    }
    case 'flipper_press':
    case 'flipper_mkdir':
      return 'medium'
    default:
      // write, delete, rename, app_start, app_control (transmite/emula), handoff (rádio/HID) e o resto.
      return 'high'
  }
}

/** Campos que o usuário precisa ver para decidir. Textos longos são cortados. */
export function describeForConfirm(call: ToolCall): Array<[string, string]> {
  const a = call.args
  const out: Array<[string, string]> = []
  const put = (k: string, v: unknown, max = 160) => {
    if (v === undefined || v === null || v === '') return
    const s = typeof v === 'string' ? v : JSON.stringify(v)
    out.push([k, s.length > max ? `${s.slice(0, max)}… (+${s.length - max})` : s])
  }
  put('path', a.path)
  put('from', a.from)
  put('to', a.to)
  put('app', a.app ?? a.name ?? a.app_name)
  put('file', a.file)
  put('button', a.button)
  put('index', a.index)
  put('seconds', a.seconds)
  put('args', a.args ?? a.app_args)
  put('keys', a.keys)
  put('action', a.action)
  put('pin', a.pin)
  put('value', a.value)
  put('on', a.on)
  put('recursive', a.recursive)
  put('message', a.message, 120)
  if (typeof a.content === 'string') put('content', a.content, 240)
  return out
}

export type GateResult = { ok: true; decision: Decision; auditT: number } | { ok: false; text: string }

/** Decide se a chamada pode rodar. Quem chama só executa a ferramenta se `ok`. */
export async function gate(call: ToolCall, safety: SafetyCtx, signal: AbortSignal): Promise<GateResult> {
  const risk = riskOf(call.name, call.args)
  const t = Date.now()
  const log = (decision: Decision) =>
    appendAudit({ t, src: safety.source, tool: call.name, risk, decision, args: redactArgs(call.args) })

  if (safety.mode === 'readonly' && risk !== 'low') {
    log('blocked')
    return { ok: false, text: 'Bloqueado: modo somente leitura. Só dá para observar (tela, listar, ler). Avise o usuário em vez de tentar outro caminho.' }
  }

  const needsConfirm = risk === 'high' || (safety.mode === 'confirm-all' && risk === 'medium')
  if (!needsConfirm) {
    log('auto')
    return { ok: true, decision: 'auto', auditT: t }
  }

  if (!safety.confirm) {
    log('blocked')
    return { ok: false, text: 'Bloqueado: esta ação exige confirmação do usuário e não há canal de confirmação ativo.' }
  }

  // O diálogo fecha sozinho se o usuário parar o agente ou se passar o tempo.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), CONFIRM_TIMEOUT_MS)
  const onAbort = () => ctrl.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  let approved = false
  try {
    approved = await Promise.race([
      safety.confirm({ call, risk, source: safety.source, details: describeForConfirm(call), signal: ctrl.signal }),
      new Promise<boolean>((res) => ctrl.signal.addEventListener('abort', () => res(false), { once: true })),
    ])
  } catch {
    approved = false
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    ctrl.abort() // fecha o diálogo se ainda estiver aberto
  }

  if (!approved) {
    log('denied')
    return { ok: false, text: 'Não executado: o usuário recusou (ou não respondeu a tempo). Não tente de novo a menos que ele peça.' }
  }
  log('approved')
  return { ok: true, decision: 'approved', auditT: t }
}
