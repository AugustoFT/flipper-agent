import { useEffect, useState } from 'react'

/**
 * Faz o app ocupar só a área que sobra acima do teclado e diz se o teclado está aberto.
 *
 * No iPhone o teclado NÃO encolhe a página: ele a cobre e o Safari/Bluefy empurra o documento
 * para cima até o campo aparecer — é o "tela sobe" com um buraco embaixo. A `visualViewport`
 * informa o retângulo realmente visível (altura e deslocamento); o app, fixo na tela, copia esse
 * retângulo por variáveis CSS e passa a caber exatamente entre o topo e o teclado.
 *
 * Teclado aberto = a área visível ficou bem menor que a maior altura já vista nesta largura
 * (no iPhone `innerHeight` não muda com o teclado; no Android muda, por isso guardamos o máximo).
 */
export function useKeyboard(): boolean {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    let baseWidth = window.innerWidth
    let baseHeight = window.innerHeight
    let raf = 0

    const apply = () => {
      raf = 0
      if (window.innerWidth !== baseWidth) {
        // Girou o aparelho: recomeça a medida.
        baseWidth = window.innerWidth
        baseHeight = window.innerHeight
      }
      baseHeight = Math.max(baseHeight, window.innerHeight)
      const zoomed = vv.scale > 1.01
      const kb = !zoomed && baseHeight - vv.height > 150
      if (kb) {
        root.style.setProperty('--app-h', `${Math.round(vv.height)}px`)
        root.style.setProperty('--app-y', `${Math.round(vv.offsetTop)}px`)
      } else {
        // Teclado fechado: volta ao 100dvh. No Bluefy a visualViewport inclui a faixa atrás da barra
        // de endereço flutuante, e o campo de mensagem ficava escondido embaixo dela.
        root.style.removeProperty('--app-h')
        root.style.removeProperty('--app-y')
      }
      setOpen(kb)
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply)
    }

    apply()
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    return () => {
      cancelAnimationFrame(raf)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      root.style.removeProperty('--app-h')
      root.style.removeProperty('--app-y')
    }
  }, [])

  return open
}
