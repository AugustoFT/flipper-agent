import { useEffect, useRef } from 'react'

/**
 * Impede que um arrasto "sobrando" mexa na página inteira no Bluefy.
 *
 * Com o teclado aberto, o iOS deixa a página toda deslizar por baixo do app fixo, o app sai do lugar
 * e aparece por trás o painel de favoritos do Bluefy. Sem teclado, o quique além do fim da página
 * faz a barra de endereço voltar com o mesmo painel.
 *
 * Regra: um arrasto só passa se algo sob o dedo (a conversa, o campo de texto) ainda puder rolar
 * naquela direção. Fora disso:
 *  - digitando: bloqueia nos dois sentidos (não há o que atualizar com o teclado aberto);
 *  - sem teclado: bloqueia só o dedo subindo no fim da página, e puxar para baixo continua
 *    atualizando a página e trazendo a tela cheia.
 */
export function useBottomGuard(typing: boolean): void {
  const typingRef = useRef(typing)
  typingRef.current = typing

  useEffect(() => {
    let startY = 0

    const room = (el: Element) => ({
      down: el.scrollHeight - el.clientHeight - el.scrollTop > 1,
      up: el.scrollTop > 0,
    })

    /** Algum elemento rolável sob o dedo consome este arrasto? (dy = 0: basta poder rolar.) */
    const innerScrolls = (target: Element | null, dy: number) => {
      for (let el = target; el && el !== document.body; el = el.parentElement) {
        const oy = getComputedStyle(el).overflowY
        if (oy !== 'auto' && oy !== 'scroll') continue
        const r = room(el)
        if (dy < 0 ? r.down : dy > 0 ? r.up : r.down || r.up) return true
      }
      return false
    }

    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 1) startY = e.touches[0].clientY
    }

    const onMove = (e: TouchEvent) => {
      // O iOS só deixa cancelar antes de a rolagem começar; por isso decidimos já no primeiro movimento.
      if (e.touches.length !== 1 || !e.cancelable) return
      const dy = e.touches[0].clientY - startY
      if (innerScrolls(e.target as Element | null, dy)) return
      if (!typingRef.current) {
        if (dy >= 0) return // puxar para baixo: atualizar e tela cheia
        const page = document.scrollingElement
        if (page && room(page).down) return // ainda falta rolar: o Bluefy esconde a barra
      }
      e.preventDefault()
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: false })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
    }
  }, [])
}
