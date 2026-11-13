import { useState } from 'react'
import { listCompatModels, listGeminiModels, listOpenRouterFreeModels } from '../agent/providers'
import type { ModelInfo, ProviderId } from '../agent/types'
import type { Settings } from './settings'

const KEY_LINKS: Record<ProviderId, { url: string; label: string }> = {
  gemini: { url: 'https://aistudio.google.com/apikey', label: 'Criar chave grátis no Google AI Studio' },
  openrouter: { url: 'https://openrouter.ai/keys', label: 'Criar chave grátis no OpenRouter' },
  compat: { url: 'https://platform.openai.com/api-keys', label: 'Chave da OpenAI (ou do provedor que você usar)' },
}

export function SettingsPanel(props: { value: Settings; onChange: (s: Settings) => void; onClose: () => void }) {
  const s = props.value
  const p = s.provider
  const [models, setModels] = useState<ModelInfo[]>([])
  const [status, setStatus] = useState('')

  const set = (patch: Partial<Settings>) => props.onChange({ ...s, ...patch })

  async function loadModels() {
    setStatus('Buscando modelos…')
    try {
      const list =
        p === 'gemini'
          ? await listGeminiModels(s.keys.gemini)
          : p === 'openrouter'
            ? await listOpenRouterFreeModels()
            : await listCompatModels(s.compatBaseUrl, s.keys.compat)
      setModels(list)
      setStatus(list.length ? `${list.length} modelos.` : 'Nenhum modelo encontrado.')
    } catch (e) {
      setStatus((e as Error).message)
    }
  }

  function pickModel(id: string) {
    const m = models.find((x) => x.id === id)
    set({ models: { ...s.models, [p]: id }, vision: m ? m.vision : s.vision })
  }

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="cfg-title">
      <div className="sheet-body">
        <header className="sheet-head">
          <h2 id="cfg-title">Configurações</h2>
          <button type="button" className="ghost" onClick={props.onClose}>
            Fechar
          </button>
        </header>

        <label className="field">
          <span>Provedor do modelo</span>
          <select value={p} onChange={(e) => (setModels([]), setStatus(''), set({ provider: e.target.value as ProviderId }))}>
            <option value="gemini">Google Gemini (tier grátis)</option>
            <option value="openrouter">OpenRouter (modelos :free)</option>
            <option value="compat">Outro compatível com OpenAI (OpenAI, DeepSeek, Groq, Ollama…)</option>
          </select>
        </label>

        {p === 'compat' && (
          <label className="field">
            <span>Endereço da API</span>
            <input
              inputMode="url"
              autoComplete="off"
              value={s.compatBaseUrl}
              placeholder="https://api.openai.com/v1"
              onChange={(e) => set({ compatBaseUrl: e.target.value.trim() })}
            />
            <small>Ex.: https://api.deepseek.com/v1 · https://api.groq.com/openai/v1 · Ollama: http://IP-do-PC:11434/v1</small>
          </label>
        )}

        <label className="field">
          <span>Chave da API</span>
          <input
            type="password"
            autoComplete="off"
            value={s.keys[p]}
            placeholder={p === 'compat' ? 'opcional (Ollama local não pede)' : 'cole a chave aqui'}
            onChange={(e) => set({ keys: { ...s.keys, [p]: e.target.value.trim() } })}
          />
          <a href={KEY_LINKS[p].url} target="_blank" rel="noreferrer">
            {KEY_LINKS[p].label} ↗
          </a>
        </label>

        <div className="field">
          <span>Modelo</span>
          <div className="row">
            <input value={s.models[p]} onChange={(e) => set({ models: { ...s.models, [p]: e.target.value.trim() } })} placeholder="id do modelo" />
            <button type="button" onClick={loadModels} disabled={p === 'gemini' && !s.keys.gemini}>
              Listar
            </button>
          </div>
          {models.length > 0 && (
            <select value={s.models[p]} onChange={(e) => pickModel(e.target.value)}>
              <option value="">— escolha —</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.vision ? '' : ' (sem imagem)'}
                </option>
              ))}
            </select>
          )}
          {status && <small>{status}</small>}
        </div>

        <label className="check">
          <input type="checkbox" checked={s.vision} onChange={(e) => set({ vision: e.target.checked })} />
          <span>O modelo enxerga imagens (desligue se o modelo for só texto: a tela vai como desenho em texto)</span>
        </label>

        <label className="check">
          <input type="checkbox" checked={s.showAllDevices} onChange={(e) => set({ showAllDevices: e.target.checked })} />
          <span>Mostrar todos os dispositivos Bluetooth ao conectar (use se o seu Flipper não aparecer)</span>
        </label>

        <p className="note">
          A chave fica salva só neste aparelho. Nos planos grátis, o provedor pode usar o que recebe — inclusive telas e arquivos do
          Flipper — para treinar modelos.
        </p>
      </div>
    </div>
  )
}
