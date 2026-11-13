// Configurações do usuário, salvas só neste aparelho (localStorage).
// A chave da API nunca sai do celular, a não ser para o próprio provedor.

import type { ProviderId } from '../agent/types'

export interface Settings {
  provider: ProviderId
  keys: Record<ProviderId, string>
  models: Record<ProviderId, string>
  vision: boolean
  showAllDevices: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'gemini',
  keys: { gemini: '', openrouter: '' },
  // "gemini-flash-latest" é um alias que o Google mantém apontando para o Flash atual.
  models: { gemini: 'gemini-flash-latest', openrouter: '' },
  vision: true,
  showAllDevices: false,
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
