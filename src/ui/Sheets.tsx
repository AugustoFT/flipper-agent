import { t } from './i18n'

const SAFETY_KEY = 'flipper-agent:safety-ok'

/** Já viu o aviso de uso responsável neste aparelho? */
export function safetySeen(): boolean {
  try {
    return localStorage.getItem(SAFETY_KEY) === '1'
  } catch {
    return false
  }
}

function markSafetySeen() {
  try {
    localStorage.setItem(SAFETY_KEY, '1')
  } catch {
    /* navegação privada: o aviso volta na próxima visita, sem problema */
  }
}

/** Aviso de uso responsável: aparece no primeiro uso e pode ser reaberto pela Ajuda. */
export function SafetySheet({ onClose }: { onClose: () => void }) {
  const L = t()
  return (
    <div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="safety-title">
      <div className="sheet-body">
        <h2 id="safety-title">{L.safetyTitle}</h2>
        {L.safetyBody.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        <div className="approve-actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              markSafetySeen()
              onClose()
            }}
          >
            {L.safetyOk}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Respostas para os problemas que mais aparecem, abertas uma de cada vez. */
export function HelpSheet({ onClose, onSafety }: { onClose: () => void; onSafety: () => void }) {
  const L = t()
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <div className="sheet-body">
        <header className="sheet-head">
          <h2 id="help-title">{L.helpTitle}</h2>
          <button type="button" className="ghost" onClick={onClose}>
            {L.close}
          </button>
        </header>
        {L.helpItems.map(([q, a]) => (
          <details key={q} className="faq">
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
        <button type="button" className="link small" onClick={onSafety}>
          {L.safetyAgain}
        </button>
        <p className="note">
          <a href="https://github.com/AugustoFT/flipper-agent" target="_blank" rel="noreferrer">
            {L.source}
          </a>
        </p>
      </div>
    </div>
  )
}
