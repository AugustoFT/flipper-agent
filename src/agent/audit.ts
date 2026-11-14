// Registro de auditoria: cada chamada de ferramenta fica anotada neste aparelho (localStorage),
// com a decisão (automática, aprovada, recusada, bloqueada). Anel de 300 entradas; argumentos longos
// (conteúdo de arquivo) são cortados para não guardar dados demais.

import type { Risk } from './safety'

export type Decision = 'auto' | 'approved' | 'denied' | 'blocked'
export type Source = 'local' | 'claude' | 'script'

export interface AuditEntry {
  /** Epoch em ms. */
  t: number
  src: Source
  tool: string
  risk: Risk
  decision: Decision
  /** Argumentos em JSON, com textos longos cortados. */
  args: string
  /** Só preenchido quando a ferramenta chegou a rodar: true = sem erro. */
  ok?: boolean
}

const KEY = 'flipper-agent:audit'
const MAX = 300

/** Corta strings longas dos argumentos (ex.: conteúdo de um arquivo a gravar). */
export function redactArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, (_k, v) => (typeof v === 'string' && v.length > 120 ? `${v.slice(0, 120)}…(+${v.length - 120})` : v))
  } catch {
    return '{}'
  }
}

export function loadAudit(): AuditEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function appendAudit(e: AuditEntry) {
  try {
    const list = loadAudit()
    list.push(e)
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)))
  } catch {
    /* sem armazenamento (navegação privada, Node): segue sem registrar */
  }
}

/** Marca a última entrada da ferramenta como concluída (sucesso ou erro). */
export function finishAudit(t: number, ok: boolean) {
  try {
    const list = loadAudit()
    const e = [...list].reverse().find((x) => x.t === t)
    if (!e) return
    e.ok = ok
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* idem */
  }
}

export function clearAudit() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nada */
  }
}

export function auditAsJson(): string {
  return JSON.stringify(loadAudit(), null, 1)
}
