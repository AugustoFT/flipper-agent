import type { FlipperClient } from './client'

/**
 * A conexão "atual" com o Flipper, que pode cair e voltar (app de Bluetooth no Flipper, cabo puxado).
 * O agente não guarda um FlipperClient fixo: pede o atual antes de cada ferramenta e, se não houver,
 * espera a reconexão em vez de desistir. É o que permite a "passagem de bastão".
 */
export class FlipperLink {
  private client: FlipperClient | null = null
  private listeners = new Set<() => void>()

  get current(): FlipperClient | null {
    return this.client
  }

  set(client: FlipperClient | null) {
    this.client = client
    for (const l of [...this.listeners]) l()
  }

  /**
   * Espera até `ok(cliente atual)` ser verdadeiro. Devolve false no prazo; rejeita se o agente for parado.
   */
  waitFor(ok: (c: FlipperClient | null) => boolean, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
    if (ok(this.client)) return Promise.resolve(true)
    return new Promise((resolve, reject) => {
      const done = (v: boolean | Error) => {
        clearTimeout(timer)
        this.listeners.delete(check)
        signal.removeEventListener('abort', onAbort)
        if (v instanceof Error) reject(v)
        else resolve(v)
      }
      const check = () => {
        if (ok(this.client)) done(true)
      }
      const onAbort = () => done(new DOMException('Parado pelo usuário', 'AbortError'))
      const timer = setTimeout(() => done(false), timeoutMs)
      this.listeners.add(check)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }
}
