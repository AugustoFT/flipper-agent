import { useState } from 'react'
import { listCompatModels, listGeminiModels, listOpenRouterFreeModels } from '../agent/providers'
import type { ModelInfo, ProviderId } from '../agent/types'
import { formatCode } from '../relay-protocol'
import { t, type LangSetting } from './i18n'
import type { Settings } from './settings'

const KEY_URLS: Record<ProviderId, string> = {
  gemini: 'https://aistudio.google.com/apikey',
  openrouter: 'https://openrouter.ai/keys',
  compat: 'https://platform.openai.com/api-keys',
}

export function SettingsPanel(props: {
  value: Settings
  onChange: (s: Settings) => void
  onClose: () => void
  /** Código deste aparelho no modo Claude. */
  relayCode: string
  onResetCode: () => void
}) {
  const L = t()
  const s = props.value
  const p = s.provider
  const [models, setModels] = useState<ModelInfo[]>([])
  const [status, setStatus] = useState('')
  const keyLabel = { gemini: L.keyLinkGemini, openrouter: L.keyLinkOpenRouter, compat: L.keyLinkCompat }[p]

  const set = (patch: Partial<Settings>) => props.onChange({ ...s, ...patch })

  async function loadModels() {
    setStatus(L.fetchingModels)
    try {
      const list =
        p === 'gemini'
          ? await listGeminiModels(s.keys.gemini)
          : p === 'openrouter'
            ? await listOpenRouterFreeModels()
            : await listCompatModels(s.compatBaseUrl, s.keys.compat)
      setModels(list)
      setStatus(list.length ? L.nModels(list.length) : L.noModels)
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
          <h2 id="cfg-title">{L.settings}</h2>
          <button type="button" className="ghost" onClick={props.onClose}>
            {L.close}
          </button>
        </header>

        <label className="field">
          <span>{L.language}</span>
          <select value={s.lang} onChange={(e) => set({ lang: e.target.value as LangSetting })}>
            <option value="auto">{L.langAuto}</option>
            <option value="pt">Português</option>
            <option value="en">English</option>
          </select>
        </label>

        <label className="field">
          <span>{L.provider}</span>
          <select value={p} onChange={(e) => (setModels([]), setStatus(''), set({ provider: e.target.value as ProviderId }))}>
            <option value="gemini">{L.provGemini}</option>
            <option value="openrouter">{L.provOpenRouter}</option>
            <option value="compat">{L.provCompat}</option>
          </select>
        </label>

        {p === 'compat' && (
          <label className="field">
            <span>{L.apiUrl}</span>
            <input
              inputMode="url"
              autoComplete="off"
              value={s.compatBaseUrl}
              placeholder="https://api.openai.com/v1"
              onChange={(e) => set({ compatBaseUrl: e.target.value.trim() })}
            />
            <small>{L.apiUrlEx}</small>
          </label>
        )}

        <label className="field">
          <span>{L.apiKey}</span>
          <input
            type="password"
            autoComplete="off"
            value={s.keys[p]}
            placeholder={p === 'compat' ? L.keyOptional : L.keyPaste}
            onChange={(e) => set({ keys: { ...s.keys, [p]: e.target.value.trim() } })}
          />
          <a href={KEY_URLS[p]} target="_blank" rel="noreferrer">
            {keyLabel} ↗
          </a>
        </label>

        <div className="field">
          <span>{L.model}</span>
          <div className="row">
            <input value={s.models[p]} onChange={(e) => set({ models: { ...s.models, [p]: e.target.value.trim() } })} placeholder={L.modelId} />
            <button type="button" onClick={loadModels} disabled={p === 'gemini' && !s.keys.gemini}>
              {L.list}
            </button>
          </div>
          {models.length > 0 && (
            <select value={s.models[p]} onChange={(e) => pickModel(e.target.value)}>
              <option value="">{L.choose}</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.vision ? '' : L.noImage}
                </option>
              ))}
            </select>
          )}
          {status && <small>{status}</small>}
        </div>

        <label className="check">
          <input type="checkbox" checked={s.vision} onChange={(e) => set({ vision: e.target.checked })} />
          <span>{L.vision}</span>
        </label>

        <label className="check">
          <input type="checkbox" checked={s.showAllDevices} onChange={(e) => set({ showAllDevices: e.target.checked })} />
          <span>{L.showAll}</span>
        </label>

        <label className="check">
          <input type="checkbox" checked={s.saveChat} onChange={(e) => set({ saveChat: e.target.checked })} />
          <span>{L.saveChat}</span>
        </label>

        <h3 className="sheet-sub">{L.claudeMode}</h3>
        <p className="note">{L.claudeNote}</p>
        <label className="field">
          <span>{L.relayUrl}</span>
          <input
            inputMode="url"
            autoComplete="off"
            value={s.relayUrl}
            placeholder="https://flipper-relay.example.workers.dev"
            onChange={(e) => set({ relayUrl: e.target.value.trim() })}
          />
          <small>{L.relayUrlNote}</small>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.relayOn} disabled={!s.relayUrl} onChange={(e) => set({ relayOn: e.target.checked })} />
          <span>{L.claudeOn}</span>
        </label>
        <div className="field">
          <span>{L.thisCode}</span>
          <div className="row">
            <output className="relay-code">{formatCode(props.relayCode)}</output>
            <button type="button" onClick={props.onResetCode}>
              {L.newCode}
            </button>
          </div>
          <small>{L.codeNote}</small>
        </div>

        <p className="note">{L.keyNote}</p>
      </div>
    </div>
  )
}
