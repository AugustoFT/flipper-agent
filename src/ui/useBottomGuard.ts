import { useEffect } from 'react'

/**
 * Segura o arrasto para CIMA quando não há mais nada para rolar.
 *
 * No Bluefy, arrastar para cima além do fim da página (o "quique" do iOS) faz a barra de endereço
 * voltar e abrir o painel de favoritos por cima do app. Só bloqueamos esse caso: se o elemento
 * sob o dedo (a conversa, por exemplo) ou a página ainda puderem rolar para baixo, o gesto segue
 * normal. O arrasto para BAIXO nunca é tocado, então puxar para atualizar continua funcionando.
 */
export function useBottomGuard(): void {
  useEffect(() => {
    let startY = 0

    const canScrollDown = (el: Element) => el.scrollHeight - el.clientHeight - el.scrollTop > 1

    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 1) startY = e.touches[0].clientY
    }

    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !e.cancelable) return
      const dy = e.touches[0].clientY - startY
      if (dy >= 0) return // dedo descendo: puxar para atualizar, nunca bloqueia
      // Campos de texto rolam o próprio conteúdo; não mexemos neles.
      const target = e.target as Element | null
      if (target?.closest('textarea, input, [contenteditable]')) return
      for (let el = target; el && el !== document.body; el = el.parentElement) {
        const oy = getComputedStyle(el).overflowY
        if ((oy === 'auto' || oy === 'scroll') && canScrollDown(el)) return
      }
      const page = document.scrollingElement
      if (page && canScrollDown(page)) return // ainda falta rolar a página: deixa o Bluefy esconder a barra
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
