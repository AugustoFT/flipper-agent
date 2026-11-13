// Conversa guardada no aparelho (localStorage), para continuar de onde parou ao reabrir a página.
//
// Guardamos duas coisas: o que aparece na tela (`items`) e o histórico que vai para o modelo
// (`history`). O localStorage tem uns 5 MB por site; as telas em PNG são pequenas (~1 KB), mas uma
// conversa longa passa disso. Acima do limite, tiramos as imagens e, se ainda não couber, o histórico
// do modelo — melhor esquecer o começo do que não guardar nada.

import type { Msg } from '../agent/types'

const KEY = 'flipper-agent:chat'
const LIMIT = 1_500_000 // caracteres: folga para as configurações e o código do relay

export interface Saved<Item> {
  items: Item[]
  history: Msg[]
  /** O histórico do modelo não coube e foi descartado. */
  trimmed?: boolean
}

export function loadChat<Item>(): Saved<Item> | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Saved<Item>
    return Array.isArray(s.items) && Array.isArray(s.history) ? s : null
  } catch {
    return null
  }
}

export function saveChat<Item extends object>(items: Item[], history: Msg[]) {
  try {
    if (items.length === 0) {
      localStorage.removeItem(KEY)
      return
    }
    let json = JSON.stringify({ items, history })
    if (json.length > LIMIT) {
      const noImg = items.map((it) => ('image' in it ? { ...it, image: undefined } : it))
      const histNoImg = history.map((m) =>
        m.role === 'tool' ? { ...m, results: m.results.map((r) => ({ ...r, image: undefined })) } : m,
      )
      json = JSON.stringify({ items: noImg, history: histNoImg })
      if (json.length > LIMIT) json = JSON.stringify({ items: noImg.slice(-80), history: [], trimmed: true })
    }
    localStorage.setItem(KEY, json)
  } catch {
    /* sem espaço ou navegação privada: segue sem guardar */
  }
}

export function clearChat() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nada a fazer */
  }
}
