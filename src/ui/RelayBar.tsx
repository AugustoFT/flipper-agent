import type { FlipperClient } from '../flipper/client'
import type { RelayState } from '../relay/client'
import { formatCode } from '../relay-protocol'
import { t } from './i18n'
import { usePip } from './usePip'
import { HEIGHT, WIDTH } from '../flipper/screen'

/**
 * Faixa do modo Claude: estado da ponte, código do aparelho e o botão de PiP, que mantém a página
 * rodando enquanto você usa o app do Claude.
 */
export function RelayBar({ state, detail, code, fz }: { state: RelayState; detail: string; code: string; fz: FlipperClient | null }) {
  const L = t()
  const pip = usePip(fz)
  return (
    <div className={`relay-bar ${state}`} role="status">
      {/* Miniatura da tela: é o próprio vídeo do PiP. Precisa estar visível — o iOS não toca vídeo escondido. */}
      <video ref={pip.videoRef} className="relay-thumb" muted playsInline aria-hidden="true" />
      <span className="relay-dot" aria-hidden="true" />
      <span className="relay-text">
        {L.relay[state]}
        {detail && <small> · {detail}</small>}
      </span>
      <span className="relay-code-mini" title={L.deviceCode}>
        {formatCode(code)}
      </span>
      <button type="button" className="relay-pip" onClick={pip.toggle} disabled={!pip.ready} title={L.pipTitle}>
        {pip.active ? L.pipClose : 'PiP'}
      </button>
      {/* Fonte do vídeo: o canvas onde a tela é desenhada (não precisa aparecer). */}
      <canvas ref={pip.canvasRef} width={WIDTH * 2} height={HEIGHT * 2} className="pip-src-hidden" aria-hidden="true" />
    </div>
  )
}

/** Pedido do Claude para conectar: só vira token se a pessoa aprovar aqui, no celular. */
export function ApproveSheet({ client, host, onAnswer }: { client: string; host: string; onAnswer: (ok: boolean) => void }) {
  const L = t()
  return (
    <div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="approve-title">
      <div className="sheet-body">
        <h2 id="approve-title">{L.approveTitle}</h2>
        <p>
          <strong>{client}</strong>
          {L.approveA}
          <strong>{host}</strong>.
        </p>
        <p className="note">{L.approveNote}</p>
        <div className="approve-actions">
          <button type="button" className="btn primary" onClick={() => onAnswer(true)}>
            {L.approve}
          </button>
          <button type="button" className="btn quiet" onClick={() => onAnswer(false)}>
            {L.deny}
          </button>
        </div>
      </div>
    </div>
  )
}
