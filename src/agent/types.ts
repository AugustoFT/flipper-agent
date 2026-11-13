// Formato de conversa neutro: cada provedor (Gemini, OpenRouter) converte de/para o seu.

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolResult {
  id: string
  name: string
  text: string
  /** PNG em base64 (sem o prefixo data:), quando a ferramenta devolve a tela. */
  image?: string
  isError?: boolean
}

export type Msg =
  | { role: 'user'; text: string }
  | {
      role: 'assistant'
      text: string
      calls: ToolCall[]
      /** Conteúdo nativo do provedor, devolvido sem mudança (o Gemini exige isso para manter as "thought signatures"). */
      raw?: unknown
    }
  | { role: 'tool'; results: ToolResult[] }

export interface ToolSpec {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface Completion {
  text: string
  calls: ToolCall[]
  raw?: unknown
}

export interface Provider {
  readonly id: ProviderId
  complete(system: string, msgs: Msg[], tools: ToolSpec[], opts: { vision: boolean; signal: AbortSignal }): Promise<Completion>
}

/** gemini e openrouter têm endereço fixo; "compat" é qualquer servidor no formato OpenAI. */
export type ProviderId = 'gemini' | 'openrouter' | 'compat'

export interface ModelInfo {
  id: string
  label: string
  vision: boolean
}
