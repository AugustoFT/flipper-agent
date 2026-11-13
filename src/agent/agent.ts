// O loop do agente: pede ao modelo, executa as ferramentas que ele chamou, devolve os resultados,
// e repete até ele responder só com texto (ou bater o limite de passos, ou o usuário parar).

import type { FlipperLink } from '../flipper/link'
import { SYSTEM_PROMPT, TOOL_SPECS } from './specs'
import { runTool } from './tools'
import type { Msg, Provider, ToolCall, ToolResult } from './types'

export { SYSTEM_PROMPT } from './specs'


export interface AgentEvents {
  onText(text: string): void
  onToolStart(call: ToolCall): void
  onToolProgress(call: ToolCall, msg: string): void
  onToolEnd(result: ToolResult): void
}

export interface RunOptions {
  provider: Provider
  link: FlipperLink
  vision: boolean
  signal: AbortSignal
  maxSteps?: number
  events: AgentEvents
}

/**
 * Roda um turno do usuário. `history` é alterado no lugar (acrescenta as mensagens do turno).
 * O histórico mantém só as imagens das 2 últimas telas: imagens antigas pesam no limite grátis e
 * não ajudam (a tela já mudou).
 */
export async function runTurn(history: Msg[], userText: string, o: RunOptions): Promise<void> {
  history.push({ role: 'user', text: userText })
  const maxSteps = o.maxSteps ?? 25
  for (let step = 0; step < maxSteps; step++) {
    if (o.signal.aborted) throw new DOMException('Parado pelo usuário', 'AbortError')
    pruneImages(history, 2)
    const c = await o.provider.complete(SYSTEM_PROMPT, history, TOOL_SPECS, { vision: o.vision, signal: o.signal })
    history.push({ role: 'assistant', text: c.text, calls: c.calls, raw: c.raw })
    if (c.text) o.events.onText(c.text)
    if (c.calls.length === 0) return

    const results: ToolResult[] = []
    for (const call of c.calls) {
      if (o.signal.aborted) {
        results.push({ id: call.id, name: call.name, text: 'Não executado: o usuário parou o agente.', isError: true })
        continue
      }
      o.events.onToolStart(call)
      const r = await runTool(call, {
        link: o.link,
        vision: o.vision,
        signal: o.signal,
        onProgress: (m) => o.events.onToolProgress(call, m),
      })
      o.events.onToolEnd(r)
      results.push(r)
    }
    history.push({ role: 'tool', results })
  }
  o.events.onText(`(Parei após ${maxSteps} passos. Peça para continuar se quiser.)`)
}

function pruneImages(history: Msg[], keep: number) {
  let seen = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    if (m.role !== 'tool') continue
    for (const r of m.results) {
      if (!r.image) continue
      if (seen < keep) seen++
      else {
        delete r.image
        r.text += ' (imagem antiga removida do histórico)'
      }
    }
  }
}
