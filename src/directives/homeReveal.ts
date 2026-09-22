import type { Directive } from 'vue'

const observers = new WeakMap<Element, IntersectionObserver>()

export const homeReveal: Directive<HTMLElement, number | undefined> = {
  mounted(element, binding) {
    element.classList.add('home-reveal')
    element.style.setProperty('--home-reveal-delay', `${binding.value ?? 0}ms`)

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced || typeof IntersectionObserver === 'undefined') {
      element.classList.add('is-revealed')
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        element.classList.add('is-revealed')
        observer.disconnect()
        observers.delete(element)
      },
      { threshold: [0.15], rootMargin: '0px' },
    )
    observers.set(element, observer)
    observer.observe(element)
  },
  unmounted(element) {
    observers.get(element)?.disconnect()
    observers.delete(element)
  },
}
