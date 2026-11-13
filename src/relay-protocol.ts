// Mensagens trocadas entre a página (celular) e o servidor do relay, pelo WebSocket.
// Compartilhado: a página e o Worker da Cloudflare importam este mesmo arquivo.

/** Alfabeto do código do aparelho: sem 0/O, 1/I/L, para ler e digitar sem confusão. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 8

/** "abcd-efgh", "ABCD EFGH" → "ABCDEFGH"; devolve null se não for um código válido. */
export function normalizeCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (c.length !== CODE_LENGTH) return null
  for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null
  return c
}

/** "ABCDEFGH" → "ABCD-EFGH" (para mostrar). */
export const formatCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`

export interface RelayToolResult {
  text: string
  /** PNG em base64 da tela do Flipper. */
  image?: string
  isError?: boolean
}

/** Página → servidor */
export type FromDevice =
  | { t: 'hello'; secret: string }
  | { t: 'result'; id: string; result: RelayToolResult }
  | { t: 'approval'; id: string; ok: boolean }

/** Servidor → página */
export type ToDevice =
  | { t: 'ready' }
  | { t: 'denied'; reason: string }
  | { t: 'call'; id: string; name: string; args: Record<string, unknown> }
  | { t: 'approve'; id: string; client: string; redirectHost: string }
