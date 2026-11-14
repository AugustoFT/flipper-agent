// Configurações do usuário, salvas só neste aparelho (localStorage).
// A chave da API nunca sai do celular, a não ser para o próprio provedor.

import type { SafetyMode } from '../agent/safety'
import type { ProviderId } from '../agent/types'
import type { LangSetting } from './i18n'

export interface Settings {
  provider: ProviderId
  keys: Record<ProviderId, string>
  models: Record<ProviderId, string>
  /** Endereço base do provedor "compat" (ex.: https://api.openai.com/v1, http://192.168.0.10:11434/v1). */
  compatBaseUrl: string
  vision: boolean
  showAllDevices: boolean
  /** Modo Claude: o Claude controla o Flipper por um conector MCP, via servidor do relay. */
  relayOn: boolean
  /** Endereço do servidor do relay (Cloudflare Worker). */
  relayUrl: string
  /** Idioma da interface. */
  lang: LangSetting
  /** Guardar a conversa no aparelho para continuar depois. */
  saveChat: boolean
  /** Quanto o agente pode fazer sozinho: só ler, confirmar o risco alto (padrão) ou confirmar tudo que mexe. */
  safetyMode: SafetyMode
}

/** Servidor do relay publicado (Cloudflare Worker). Dá para trocar nas configurações. */
export const RELAY_URL = 'https://flipper-relay.mktjet1.workers.dev'

export const DEFAULT_SETTINGS: Settings = {
  provider: 'gemini',
  keys: { gemini: '', openrouter: '', compat: '' },
  // "gemini-flash-latest" é um alias que o Google mantém apontando para o Flash atual.
  models: { gemini: 'gemini-flash-latest', openrouter: '', compat: '' },
  compatBaseUrl: 'https://api.openai.com/v1',
  vision: true,
  showAllDevices: false,
  relayOn: false,
  relayUrl: RELAY_URL,
  lang: 'auto',
  saveChat: true,
  safetyMode: 'confirm-high',
}

const STORAGE_KEY = 'flipper-agent:settings'

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const s = JSON.parse(raw)
    return {
      ...DEFAULT_SETTINGS,
      ...s,
      keys: { ...DEFAULT_SETTINGS.keys, ...s.keys },
      models: { ...DEFAULT_SETTINGS.models, ...s.models },
      // Quem abriu o app antes do deploy tem "" salvo: vazio volta ao padrão.
      relayUrl: s.relayUrl || DEFAULT_SETTINGS.relayUrl,
      safetyMode: ['readonly', 'confirm-high', 'confirm-all'].includes(s.safetyMode) ? s.safetyMode : DEFAULT_SETTINGS.safetyMode,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    /* navegação privada: segue sem salvar */
  }
}
