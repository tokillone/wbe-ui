<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export type OperationGuideStep = {
  title: string
  description: string
  targetSelectors: string[]
  placement: 'right' | 'left' | 'bottom'
  scrollIntoView?: boolean
  scrollBlock?: ScrollLogicalPosition
}

const props = defineProps<{
  open: boolean
  step: number
  steps: OperationGuideStep[]
  variant?: 'default' | 'home'
  targetDocument?: Document | null
  targetFrame?: HTMLIFrameElement | null
  returnFocusTo?: HTMLElement | null
}>()

const emit = defineEmits<{
  previous: []
  next: []
  skip: []
  finish: []
}>()

const root = ref<HTMLElement | null>(null)
const card = ref<HTMLElement | null>(null)
const primaryAction = ref<HTMLButtonElement | null>(null)
const targetStyle = ref<Record<string, string>>({})
const cardStyle = ref<Record<string, string>>({})
const hasTarget = ref(false)

const currentStep = computed(() => props.steps[props.step] ?? props.steps[0])
const isLastStep = computed(() => props.step >= props.steps.length - 1)

let resizeObserver: ResizeObserver | null = null
let observedTargetWindow: Window | null = null
let previousActiveElement: HTMLElement | null = null

function guideTargetDocument() {
  return props.targetDocument ?? document
}

function targetElements() {
  const targetDocument = guideTargetDocument()
  const selectors = currentStep.value?.targetSelectors ?? []
  return selectors.flatMap((selector) =>
    Array.from(targetDocument.querySelectorAll<HTMLElement>(selector)).filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }),
  )
}

function viewportRect(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  if (element.ownerDocument === document) {
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
  }

  const frame = props.targetFrame ?? element.ownerDocument.defaultView?.frameElement
  if (!frame || typeof frame.getBoundingClientRect !== 'function') {
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
  }
  const frameRect = frame.getBoundingClientRect()
  return {
    left: frameRect.left + rect.left,
    top: frameRect.top + rect.top,
    right: frameRect.left + rect.right,
    bottom: frameRect.top + rect.bottom,
  }
}

function combinedTargetRect(elements: HTMLElement[]) {
  if (!elements.length) return null
  const rects = elements.map(viewportRect)
  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    top: Math.min(...rects.map((rect) => rect.top)),
    right: Math.max(...rects.map((rect) => rect.right)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function unbindTargetWindow() {
  if (!observedTargetWindow || observedTargetWindow === window) {
    observedTargetWindow = null
    return
  }
  observedTargetWindow.removeEventListener('resize', updateLayout)
  observedTargetWindow.removeEventListener('scroll', updateLayout, true)
  observedTargetWindow = null
}

function bindTargetWindow() {
  const nextWindow = guideTargetDocument().defaultView
  if (nextWindow === observedTargetWindow) return
  unbindTargetWindow()
  observedTargetWindow = nextWindow
  if (!nextWindow || nextWindow === window) return
  nextWindow.addEventListener('resize', updateLayout)
  nextWindow.addEventListener('scroll', updateLayout, true)
}

function observeLayoutTargets() {
  resizeObserver?.disconnect()
  if (!props.open) return
  bindTargetWindow()
  if (root.value) resizeObserver?.observe(root.value)
  if (card.value) resizeObserver?.observe(card.value)
  targetElements().forEach((element) => resizeObserver?.observe(element))
}

function updateLayout() {
  if (!props.open || !root.value || !currentStep.value) return
  const rootRect = root.value.getBoundingClientRect()
  const elements = targetElements()
  const rect = combinedTargetRect(elements)
  const cardRect = card.value?.getBoundingClientRect()
  const cardWidth = cardRect?.width || Math.min(344, rootRect.width - 32)
  const cardHeight = cardRect?.height || 210
  const edge = 16
  const gap = 8

  if (!rect) {
    hasTarget.value = false
    targetStyle.value = {}
    cardStyle.value = {
      left: `${clamp((rootRect.width - cardWidth) / 2, edge, rootRect.width - cardWidth - edge)}px`,
      top: `${clamp((rootRect.height - cardHeight) / 2, edge, rootRect.height - cardHeight - edge)}px`,
    }
    return
  }

  const clippedRect = {
    left: Math.max(rootRect.left, rect.left),
    top: Math.max(rootRect.top, rect.top),
    right: Math.min(rootRect.right, rect.right),
    bottom: Math.min(rootRect.bottom, rect.bottom),
  }
  if (clippedRect.right <= clippedRect.left || clippedRect.bottom <= clippedRect.top) {
    hasTarget.value = false
    targetStyle.value = {}
    cardStyle.value = {
      left: `${clamp((rootRect.width - cardWidth) / 2, edge, rootRect.width - cardWidth - edge)}px`,
      top: `${clamp((rootRect.height - cardHeight) / 2, edge, rootRect.height - cardHeight - edge)}px`,
    }
    return
  }

  hasTarget.value = true
  const localRect = {
    left: clippedRect.left - rootRect.left,
    top: clippedRect.top - rootRect.top,
    right: clippedRect.right - rootRect.left,
    bottom: clippedRect.bottom - rootRect.top,
  }
  const targetWidth = localRect.right - localRect.left
  const targetHeight = localRect.bottom - localRect.top
  const targetLeft = Math.max(0, localRect.left - gap)
  const targetTop = Math.max(0, localRect.top - gap)
  targetStyle.value = {
    left: `${targetLeft}px`,
    top: `${targetTop}px`,
    width: `${Math.min(rootRect.width - targetLeft, targetWidth + gap * 2)}px`,
    height: `${Math.min(rootRect.height - targetTop, targetHeight + gap * 2)}px`,
  }

  let left = localRect.right + gap + 12
  let top = localRect.top + targetHeight / 2 - cardHeight / 2
  if (currentStep.value.placement === 'left') {
    left = localRect.left - cardWidth - gap - 12
    if (left < edge) left = localRect.right + gap + 12
  } else if (currentStep.value.placement === 'right') {
    if (left + cardWidth > rootRect.width - edge) {
      left = localRect.left - cardWidth - gap - 12
    }
  } else {
    left = localRect.left + targetWidth / 2 - cardWidth / 2
    top = localRect.bottom + gap + 12
    if (top + cardHeight > rootRect.height - edge) {
      top = localRect.top - cardHeight - gap - 12
    }
    if (top < edge) {
      top = localRect.bottom - cardHeight - 24
    }
  }

  cardStyle.value = {
    left: `${clamp(left, edge, rootRect.width - cardWidth - edge)}px`,
    top: `${clamp(top, edge, rootRect.height - cardHeight - edge)}px`,
  }
}

function focusPrimaryAction() {
  void nextTick(() => primaryAction.value?.focus({ preventScroll: true }))
}

function scrollCurrentTargetIntoView() {
  if (!currentStep.value?.scrollIntoView) return
  const target = targetElements()[0]
  if (!target) return
  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView({
    behavior: reducedMotion ? 'auto' : 'smooth',
    block: currentStep.value.scrollBlock ?? 'center',
    inline: 'nearest',
  })
}

function handleKeydown(event: KeyboardEvent) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('skip')
    return
  }
  if (event.key !== 'Tab' || !card.value) return
  const focusable = Array.from(
    card.value.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('disabled'))
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus({ preventScroll: true })
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus({ preventScroll: true })
  }
}

function handlePrimaryAction() {
  if (isLastStep.value) emit('finish')
  else emit('next')
}

watch(
  () =>
    [
      props.open,
      props.step,
      props.steps,
      props.targetDocument,
      props.targetFrame,
      props.returnFocusTo,
    ] as const,
  async ([open], previous) => {
    if (!open) {
      resizeObserver?.disconnect()
      unbindTargetWindow()
      const focusTarget = props.returnFocusTo?.isConnected
        ? props.returnFocusTo
        : previousActiveElement?.isConnected
          ? previousActiveElement
          : null
      if (previous?.[0] && focusTarget) {
        focusTarget.focus({ preventScroll: true })
      }
      previousActiveElement = null
      return
    }
    if (!previous?.[0]) {
      previousActiveElement =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    await nextTick()
    scrollCurrentTargetIntoView()
    observeLayoutTargets()
    updateLayout()
    requestAnimationFrame(updateLayout)
    focusPrimaryAction()
  },
  { flush: 'post', immediate: true },
)

onMounted(() => {
  resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateLayout)
  window.addEventListener('resize', updateLayout)
  window.addEventListener('scroll', updateLayout, true)
  document.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  unbindTargetWindow()
  window.removeEventListener('resize', updateLayout)
  window.removeEventListener('scroll', updateLayout, true)
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div
    v-if="open && currentStep"
    ref="root"
    class="operation-guide"
    :class="{ 'is-home': variant === 'home' }"
    data-operation-guide
    @pointerdown.self.prevent
    @wheel.prevent
  >
    <div
      v-if="hasTarget"
      class="operation-guide__target"
      :style="targetStyle"
      aria-hidden="true"
    ></div>
    <div v-else class="operation-guide__backdrop" aria-hidden="true"></div>

    <section
      ref="card"
      class="operation-guide__card"
      :style="cardStyle"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="`operation-guide-title-${step}`"
      :aria-describedby="`operation-guide-description-${step}`"
    >
      <div v-if="variant === 'home'" class="operation-guide__rail" aria-hidden="true">
        <i v-for="(_, index) in steps" :key="index" :class="{ active: index <= step }"></i>
      </div>
      <div :key="step" class="operation-guide__content">
        <span class="operation-guide__progress">
          {{
            variant === 'home'
              ? `${step + 1} / ${steps.length}`
              : `第 ${step + 1} / ${steps.length} 步`
          }}
        </span>
        <h2 :id="`operation-guide-title-${step}`">{{ currentStep.title }}</h2>
        <p :id="`operation-guide-description-${step}`">{{ currentStep.description }}</p>
        <footer>
          <button class="operation-guide__skip" type="button" @click="emit('skip')">
            {{ variant === 'home' ? '跳过' : '跳过指引' }}
          </button>
          <div>
            <button
              v-if="step > 0"
              class="operation-guide__previous"
              type="button"
              @click="emit('previous')"
            >
              上一步
            </button>
            <button
              ref="primaryAction"
              class="operation-guide__next"
              type="button"
              @click="handlePrimaryAction"
            >
              {{ isLastStep ? (variant === 'home' ? '完成' : '开始探索') : '下一步' }}
            </button>
          </div>
        </footer>
      </div>
    </section>
  </div>
</template>

<style scoped>
.operation-guide {
  position: absolute;
  inset: 0;
  z-index: 70;
  overflow: hidden;
  color: var(--academic-ink, #183244);
  font-family: var(--platform-font-family, 'Microsoft YaHei', '微软雅黑', Arial, sans-serif);
}

.operation-guide__target {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid #6f8796;
  border-radius: 6px;
  box-shadow: 0 0 0 9999px rgba(20, 42, 57, 0.24);
  pointer-events: none;
  transition:
    left 0.16s ease,
    top 0.16s ease,
    width 0.16s ease,
    height 0.16s ease;
}

.operation-guide.is-home .operation-guide__target {
  border-color: #38a68d;
  box-shadow:
    0 0 0 9999px rgba(8, 31, 49, 0.62),
    0 0 0 4px rgba(56, 166, 141, 0.18);
  transition:
    left 320ms cubic-bezier(0.22, 1, 0.36, 1),
    top 320ms cubic-bezier(0.22, 1, 0.36, 1),
    width 320ms cubic-bezier(0.22, 1, 0.36, 1),
    height 320ms cubic-bezier(0.22, 1, 0.36, 1);
}

.operation-guide.is-home .operation-guide__backdrop {
  background: rgba(8, 31, 49, 0.62);
}

.operation-guide__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(20, 42, 57, 0.24);
  pointer-events: none;
}

.operation-guide__card {
  position: absolute;
  z-index: 1;
  width: min(344px, calc(100% - 32px));
  box-sizing: border-box;
  padding: 17px 18px 16px;
  border: 1px solid var(--academic-border, #cbd5dc);
  border-radius: 6px;
  background: var(--academic-surface, #ffffff);
  box-shadow: 0 8px 24px rgba(24, 50, 68, 0.16);
}

.operation-guide.is-home .operation-guide__card {
  width: min(356px, calc(100% - 32px));
  padding: 20px 21px 18px;
  border-color: rgba(80, 118, 139, 0.42);
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.965);
  box-shadow: 0 22px 64px rgba(4, 25, 41, 0.28);
  backdrop-filter: blur(12px);
  transition:
    left 320ms cubic-bezier(0.22, 1, 0.36, 1),
    top 320ms cubic-bezier(0.22, 1, 0.36, 1);
}

.operation-guide__rail {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 5px;
  margin-bottom: 15px;
}

.operation-guide__rail i {
  height: 2px;
  background: #d6e0e6;
  transform-origin: left;
  transition:
    background-color 220ms ease,
    transform 220ms ease;
}

.operation-guide__rail i.active {
  background: #2a8a77;
}

.operation-guide.is-home .operation-guide__content {
  animation: home-guide-content-in 360ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.operation-guide.is-home .operation-guide__content h2,
.operation-guide.is-home .operation-guide__content p,
.operation-guide.is-home .operation-guide__content footer {
  animation: home-guide-item-in 340ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.operation-guide.is-home .operation-guide__content p {
  animation-delay: 55ms;
}

.operation-guide.is-home .operation-guide__content footer {
  animation-delay: 100ms;
}

@keyframes home-guide-content-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}

@keyframes home-guide-item-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

.operation-guide__progress {
  color: var(--academic-muted, #5f7180);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.operation-guide.is-home .operation-guide__progress {
  color: #2a806f;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.08em;
}

.operation-guide__card h2 {
  margin: 7px 0 0;
  color: var(--academic-ink, #183244);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.35;
}

.operation-guide__card p {
  margin: 9px 0 0;
  color: var(--academic-muted, #5f7180);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.65;
}

.operation-guide__card footer {
  margin-top: 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.operation-guide__card footer > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.operation-guide__card button {
  min-height: 34px;
  box-sizing: border-box;
  padding: 0 13px;
  border-radius: 4px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.operation-guide.is-home .operation-guide__card button {
  border-radius: 1px;
}

.operation-guide__skip {
  padding-inline: 0 !important;
  border: 0;
  color: var(--academic-muted, #5f7180);
  background: transparent;
}

.operation-guide__skip:hover {
  color: var(--academic-ink, #183244);
}

.operation-guide__previous {
  border: 1px solid var(--academic-border, #cbd5dc);
  color: var(--academic-ink, #183244);
  background: #ffffff;
}

.operation-guide__previous:hover {
  background: var(--academic-surface-muted, #f5f7f8);
}

.operation-guide__next {
  border: 1px solid var(--academic-accent, #174f7c);
  color: #ffffff;
  background: var(--academic-accent, #174f7c);
}

.operation-guide__next:hover {
  border-color: var(--academic-accent-dark, #123e62);
  background: var(--academic-accent-dark, #123e62);
}

.operation-guide__card button:focus-visible {
  outline: 2px solid var(--academic-accent, #174f7c);
  outline-offset: 2px;
}

@media (max-width: 760px) {
  .operation-guide__card {
    top: auto !important;
    right: 12px;
    bottom: 12px;
    left: 12px !important;
    width: auto;
    padding: 15px 16px 14px;
  }

  .operation-guide__card footer {
    margin-top: 15px;
  }

  .operation-guide__card footer > div,
  .operation-guide__card footer button {
    white-space: nowrap;
  }

  .operation-guide.is-home .operation-guide__card {
    right: max(12px, env(safe-area-inset-right));
    bottom: max(12px, env(safe-area-inset-bottom));
    left: max(12px, env(safe-area-inset-left)) !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  .operation-guide__target {
    transition: none;
  }

  .operation-guide.is-home .operation-guide__card,
  .operation-guide.is-home .operation-guide__target,
  .operation-guide.is-home .operation-guide__content,
  .operation-guide.is-home .operation-guide__content h2,
  .operation-guide.is-home .operation-guide__content p,
  .operation-guide.is-home .operation-guide__content footer,
  .operation-guide__rail i {
    animation: none;
    transition: none;
  }
}
</style>
