<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export type MapOperationGuideStep = {
  title: string
  description: string
  targetSelectors: string[]
  placement: 'right' | 'left' | 'bottom'
}

const props = defineProps<{
  open: boolean
  step: number
  steps: MapOperationGuideStep[]
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

function targetElements() {
  const selectors = currentStep.value?.targetSelectors ?? []
  return selectors.flatMap((selector) =>
    Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }),
  )
}

function combinedTargetRect(elements: HTMLElement[]) {
  if (!elements.length) return null
  const rects = elements.map((element) => element.getBoundingClientRect())
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

function observeLayoutTargets() {
  resizeObserver?.disconnect()
  if (!props.open) return
  if (root.value) resizeObserver?.observe(root.value)
  if (card.value) resizeObserver?.observe(card.value)
  targetElements().forEach((element) => resizeObserver?.observe(element))
}

function updateLayout() {
  if (!props.open || !root.value || !currentStep.value) return
  const scrollContainer = root.value.parentElement
  if (scrollContainer && (scrollContainer.scrollTop || scrollContainer.scrollLeft)) {
    scrollContainer.scrollTop = 0
    scrollContainer.scrollLeft = 0
  }
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

  hasTarget.value = true
  const localRect = {
    left: rect.left - rootRect.left,
    top: rect.top - rootRect.top,
    right: rect.right - rootRect.left,
    bottom: rect.bottom - rootRect.top,
  }
  const targetWidth = localRect.right - localRect.left
  const targetHeight = localRect.bottom - localRect.top
  targetStyle.value = {
    left: `${Math.max(0, localRect.left - gap)}px`,
    top: `${Math.max(0, localRect.top - gap)}px`,
    width: `${Math.min(rootRect.width, targetWidth + gap * 2)}px`,
    height: `${Math.min(rootRect.height, targetHeight + gap * 2)}px`,
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
    top = localRect.bottom - cardHeight - 24
  }

  cardStyle.value = {
    left: `${clamp(left, edge, rootRect.width - cardWidth - edge)}px`,
    top: `${clamp(top, edge, rootRect.height - cardHeight - edge)}px`,
  }
}

function focusPrimaryAction() {
  void nextTick(() => primaryAction.value?.focus({ preventScroll: true }))
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
    card.value.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'),
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
  () => [props.open, props.step, props.steps] as const,
  async ([open]) => {
    if (!open) return
    await nextTick()
    observeLayoutTargets()
    updateLayout()
    focusPrimaryAction()
  },
  { deep: true, flush: 'post', immediate: true },
)

onMounted(() => {
  resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateLayout)
  window.addEventListener('resize', updateLayout)
  window.addEventListener('scroll', updateLayout, true)
  document.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', updateLayout)
  window.removeEventListener('scroll', updateLayout, true)
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div
    v-if="open && currentStep"
    ref="root"
    class="map-operation-guide"
    data-map-guide
    @pointerdown.self.prevent
  >
    <div
      v-if="hasTarget"
      class="map-operation-guide__target"
      :style="targetStyle"
      aria-hidden="true"
    ></div>

    <section
      ref="card"
      class="map-operation-guide__card"
      :style="cardStyle"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="`map-guide-title-${step}`"
      :aria-describedby="`map-guide-description-${step}`"
    >
      <span class="map-operation-guide__progress">第 {{ step + 1 }} / {{ steps.length }} 步</span>
      <h2 :id="`map-guide-title-${step}`">{{ currentStep.title }}</h2>
      <p :id="`map-guide-description-${step}`">{{ currentStep.description }}</p>

      <footer>
        <button class="map-operation-guide__skip" type="button" @click="emit('skip')">
          跳过指引
        </button>
        <div>
          <button
            v-if="step > 0"
            class="map-operation-guide__previous"
            type="button"
            @click="emit('previous')"
          >
            上一步
          </button>
          <button
            ref="primaryAction"
            class="map-operation-guide__next"
            type="button"
            @click="handlePrimaryAction"
          >
            {{ isLastStep ? '开始探索' : '下一步' }}
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.map-operation-guide {
  position: absolute;
  inset: 0;
  z-index: 70;
  overflow: hidden;
  color: var(--academic-ink, #183244);
  font-family:
    Inter, 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif;
}

.map-operation-guide__target {
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

.map-operation-guide__card {
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

.map-operation-guide__progress {
  color: var(--academic-muted, #5f7180);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.map-operation-guide__card h2 {
  margin: 7px 0 0;
  color: var(--academic-ink, #183244);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.35;
}

.map-operation-guide__card p {
  margin: 9px 0 0;
  color: var(--academic-muted, #5f7180);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.65;
}

.map-operation-guide__card footer {
  margin-top: 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.map-operation-guide__card footer > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.map-operation-guide__card button {
  min-height: 34px;
  box-sizing: border-box;
  padding: 0 13px;
  border-radius: 4px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.map-operation-guide__skip {
  padding-inline: 0 !important;
  border: 0;
  color: var(--academic-muted, #5f7180);
  background: transparent;
}

.map-operation-guide__skip:hover {
  color: var(--academic-ink, #183244);
}

.map-operation-guide__previous {
  border: 1px solid var(--academic-border, #cbd5dc);
  color: var(--academic-ink, #183244);
  background: #ffffff;
}

.map-operation-guide__previous:hover {
  background: var(--academic-surface-muted, #f5f7f8);
}

.map-operation-guide__next {
  border: 1px solid var(--academic-accent, #174f7c);
  color: #ffffff;
  background: var(--academic-accent, #174f7c);
}

.map-operation-guide__next:hover {
  border-color: var(--academic-accent-dark, #123e62);
  background: var(--academic-accent-dark, #123e62);
}

.map-operation-guide__card button:focus-visible {
  outline: 2px solid var(--academic-accent, #174f7c);
  outline-offset: 2px;
}

@media (max-width: 760px) {
  .map-operation-guide__card {
    top: auto !important;
    right: 12px;
    bottom: 12px;
    left: 12px !important;
    width: auto;
    padding: 15px 16px 14px;
  }

  .map-operation-guide__card footer {
    margin-top: 15px;
  }

  .map-operation-guide__card footer > div,
  .map-operation-guide__card footer button {
    white-space: nowrap;
  }
}

@media (prefers-reduced-motion: reduce) {
  .map-operation-guide__target {
    transition: none;
  }
}
</style>
