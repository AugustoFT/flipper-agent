import type { FlipperClient } from '../flipper/client'
import type { RelayState } from '../relay/client'
import { formatCode } from '../relay-protocol'
import { usePip } from './usePip'
import { HEIGHT, WIDTH } from '../flipper/screen'

const LABEL: Record<RelayState, string> = {
  off: 'Claude desligado',
  connecting: 'Claude: conectando…',
  online: 'Claude pronto',
  denied: 'Claude: recusado',
}

/**
 * Faixa do modo Claude: estado da ponte, código do aparelho e o botão de PiP, que mantém a página
 * rodando enquanto você usa o app do Claude.
 */
export function RelayBar({ state, detail, code, fz }: { state: RelayState; detail: string; code: string; fz: FlipperClient | null }) {
  const pip = usePip(fz)
  return (
    <div className={`relay-bar ${state}`} role="status">
      {/* Miniatura da tela: é o próprio vídeo do PiP. Precisa estar visível — o iOS não toca vídeo escondido. */}
      <video ref={pip.videoRef} className="relay-thumb" muted playsInline aria-hidden="true" />
      <span className="relay-dot" aria-hidden="true" />
      <span className="relay-text">
        {LABEL[state]}
        {detail && <small> · {detail}</small>}
      </span>
      <span className="relay-code-mini" title="Código do aparelho">
        {formatCode(code)}
      </span>
      <button
        type="button"
        className="relay-pip"
        onClick={pip.toggle}
        disabled={!pip.ready}
        title="Abre a tela do Flipper em picture-in-picture: mantém o modo Claude vivo enquanto você usa o app do Claude"
      >
        {pip.active ? 'Fechar PiP' : 'PiP'}
      </button>
      {/* Fonte do vídeo: o canvas onde a tela é desenhada (não precisa aparecer). */}
      <canvas ref={pip.canvasRef} width={WIDTH * 2} height={HEIGHT * 2} className="pip-src-hidden" aria-hidden="true" />
    </div>
  )
}

/** Pedido do Claude para conectar: só vira token se a pessoa aprovar aqui, no celular. */
export function ApproveSheet({ client, host, onAnswer }: { client: string; host: string; onAnswer: (ok: boolean) => void }) {
  return (
    <div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="approve-title">
      <div className="sheet-body">
        <h2 id="approve-title">Conectar ao Claude?</h2>
        <p>
          <strong>{client}</strong> quer controlar este Flipper. O acesso vai para <strong>{host}</strong>.
        </p>
        <p className="note">Aprove só se foi você quem acabou de conectar o Flipper no Claude.</p>
        <div className="approve-actions">
          <button type="button" className="btn primary" onClick={() => onAnswer(true)}>
            Aprovar
          </button>
          <button type="button" className="btn quiet" onClick={() => onAnswer(false)}>
            Recusar
          </button>
        </div>
      </div>
    </div>
  )
}
