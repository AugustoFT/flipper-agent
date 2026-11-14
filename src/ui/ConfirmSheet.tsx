import { useEffect, useState } from 'react'
import type { ConfirmRequest } from '../agent/safety'
import { t } from './i18n'

const ARM_MS = 1500

/**
 * Confirmação de ação de risco alto, pensada para o celular: botões grandes, "Recusar" sempre
 * ativo e "Permitir" só destrava depois de 1,5 s (evita toque acidental ou em cima de outro botão).
 * Fecha sozinha (como recusa) se o gate desistir: tempo esgotado ou usuário parou o agente.
 */
export function ConfirmSheet({ req, onAnswer }: { req: ConfirmRequest; onAnswer: (ok: boolean) => void }) {
  const L = t()
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    navigator.vibrate?.([40, 80, 40])
    const id = setTimeout(() => setArmed(true), ARM_MS)
    const close = () => onAnswer(false)
    if (req.signal.aborted) close()
    else req.signal.addEventListener('abort', close, { once: true })
    return () => {
      clearTimeout(id)
      req.signal.removeEventListener('abort', close)
    }
  }, [req, onAnswer])

  const who = req.source === 'claude' ? L.confirmFromClaude : L.confirmFromLocal
  return (
    <div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="sheet-body">
        <h2 id="confirm-title">{L.confirmTitle}</h2>
        <p>
          <strong className="risk-badge">{L.confirmRisk}</strong> <strong>{L.toolLabels[req.call.name] ?? req.call.name}</strong>
        </p>
        <p className="note">{who}</p>
        {req.details.length > 0 && (
          <dl className="confirm-details">
            {req.details.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="note">{L.confirmNote}</p>
        <div className="approve-actions confirm-actions">
          <button type="button" className="btn primary" autoFocus onClick={() => onAnswer(false)}>
            {L.deny}
          </button>
          <button type="button" className="btn quiet" disabled={!armed} onClick={() => onAnswer(true)}>
            {armed ? L.confirmAllow : '…'}
          </button>
        </div>
      </div>
    </div>
  )
}
