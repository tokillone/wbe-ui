<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

export interface SankeySelectOption {
  value: string | number
  label: string
  description?: string
  advanced?: boolean
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number
    options: SankeySelectOption[]
    selectLabel: string
    disabled?: boolean
    mobileTitle?: string
  }>(),
  {
    disabled: false,
    mobileTitle: '请选择',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  change: [value: string | number]
}>()

const rootEl = ref<HTMLElement | null>(null)
const triggerEl = ref<HTMLButtonElement | null>(null)
const menuEl = ref<HTMLElement | null>(null)
const optionEls = ref<HTMLElement[]>([])
const open = ref(false)
const advancedOpen = ref(false)
const activeValue = ref<string | number>(props.modelValue)
const menuStyle = ref<Record<string, string>>({})

const selectedOption = computed(
  () => props.options.find((option) => option.value === props.modelValue) ?? props.options[0],
)
const commonOptions = computed(() => props.options.filter((option) => !option.advanced))
const advancedOptions = computed(() => props.options.filter((option) => option.advanced))
const visibleOptions = computed(() => [
  ...commonOptions.value,
  ...(advancedOpen.value ? advancedOptions.value : []),
])
const activeDescendant = computed(() => `sankey-option-${optionKey(activeValue.value)}`)

watch(
  () => props.modelValue,
  (value) => {
    activeValue.value = value
    if (props.options.find((option) => option.value === value)?.advanced) advancedOpen.value = true
  },
  { immediate: true },
)

function optionKey(value: string | number) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_')
}

function setOptionEl(element: Element | null, index: number) {
  if (element instanceof HTMLElement) optionEls.value[index] = element
}

function positionMenu() {
  const trigger = triggerEl.value
  if (!trigger || window.matchMedia?.('(max-width: 720px)').matches) {
    menuStyle.value = {}
    return
  }
  const rect = trigger.getBoundingClientRect()
  const availableBelow = window.innerHeight - rect.bottom - 12
  const maxHeight = Math.min(360, Math.max(180, availableBelow))
  menuStyle.value = {
    left: `${Math.min(rect.left, window.innerWidth - Math.max(rect.width, 240) - 12)}px`,
    top: `${rect.bottom + 6}px`,
    width: `${Math.max(rect.width, 240)}px`,
    maxHeight: `${maxHeight}px`,
  }
}

async function openMenu(preferLast = false) {
  if (props.disabled) return
  open.value = true
  advancedOpen.value = Boolean(selectedOption.value?.advanced)
  activeValue.value = preferLast
    ? visibleOptions.value[visibleOptions.value.length - 1]?.value ?? props.modelValue
    : props.modelValue
  positionMenu()
  await nextTick()
  menuEl.value?.focus({ preventScroll: true })
  scrollActiveIntoView()
}

function closeMenu(restoreFocus = true) {
  if (!open.value) return
  open.value = false
  if (restoreFocus) nextTick(() => triggerEl.value?.focus({ preventScroll: true }))
}

function toggleMenu() {
  if (open.value) closeMenu()
  else void openMenu()
}

function selectOption(option: SankeySelectOption) {
  emit('update:modelValue', option.value)
  emit('change', option.value)
  closeMenu()
}

function moveActive(offset: number) {
  const options = visibleOptions.value
  if (!options.length) return
  const currentIndex = Math.max(
    0,
    options.findIndex((option) => option.value === activeValue.value),
  )
  const nextIndex = (currentIndex + offset + options.length) % options.length
  activeValue.value = options[nextIndex]?.value ?? props.modelValue
  nextTick(scrollActiveIntoView)
}

function scrollActiveIntoView() {
  const index = visibleOptions.value.findIndex((option) => option.value === activeValue.value)
  optionEls.value[index]?.scrollIntoView?.({ block: 'nearest' })
}

function handleTriggerKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    void openMenu(event.key === 'ArrowUp')
  }
}

function handleMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    moveActive(event.key === 'ArrowDown' ? 1 : -1)
    return
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    activeValue.value =
      (event.key === 'Home'
        ? visibleOptions.value[0]
        : visibleOptions.value[visibleOptions.value.length - 1]
      )?.value ??
      props.modelValue
    nextTick(scrollActiveIntoView)
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    const option = visibleOptions.value.find((item) => item.value === activeValue.value)
    if (option) selectOption(option)
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu()
  }
  if (event.key === 'Tab') closeMenu(false)
}

function handleDocumentPointer(event: PointerEvent) {
  const target = event.target
  if (!(target instanceof Node)) return
  if (rootEl.value?.contains(target) || menuEl.value?.contains(target)) return
  closeMenu(false)
}

function handleViewportChange() {
  if (open.value) positionMenu()
}

document.addEventListener('pointerdown', handleDocumentPointer)
window.addEventListener('resize', handleViewportChange)
window.addEventListener('scroll', handleViewportChange, true)

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointer)
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('scroll', handleViewportChange, true)
})
</script>

<template>
  <div ref="rootEl" class="sankey-select" :class="{ 'is-open': open, 'is-disabled': disabled }">
    <button
      ref="triggerEl"
      class="sankey-select-trigger"
      type="button"
      :disabled="disabled"
      :aria-label="selectLabel"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggleMenu"
      @keydown="handleTriggerKeydown"
    >
      <span :title="selectedOption?.label">{{ selectedOption?.label || '请选择' }}</span>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>

    <Teleport to="body">
      <div v-if="open" class="sankey-select-mobile-backdrop" aria-hidden="true"></div>
      <section
        v-if="open"
        ref="menuEl"
        class="sankey-select-menu"
        :style="menuStyle"
        role="listbox"
        tabindex="-1"
        :aria-label="selectLabel"
        :aria-activedescendant="activeDescendant"
        @keydown="handleMenuKeydown"
      >
        <header class="sankey-select-menu-header">
          <strong>{{ mobileTitle }}</strong>
          <button type="button" aria-label="关闭选项" @click="closeMenu()">×</button>
        </header>
        <div class="sankey-select-options">
          <button
            v-for="(option, index) in commonOptions"
            :id="`sankey-option-${optionKey(option.value)}`"
            :key="option.value"
            :ref="(element) => setOptionEl(element as Element | null, index)"
            class="sankey-select-option"
            :class="{
              'is-selected': option.value === modelValue,
              'is-active': option.value === activeValue,
            }"
            type="button"
            role="option"
            :aria-selected="option.value === modelValue"
            @mouseenter="activeValue = option.value"
            @click="selectOption(option)"
          >
            <span>
              <b>{{ option.label }}</b>
              <small v-if="option.description">{{ option.description }}</small>
            </span>
            <span class="sankey-select-check" aria-hidden="true">✓</span>
          </button>

          <div v-if="advancedOptions.length" class="sankey-select-advanced" role="presentation">
            <button
              type="button"
              :aria-expanded="advancedOpen"
              @click="advancedOpen = !advancedOpen"
            >
              <span>高级选项</span>
              <small>{{ advancedOpen ? '收起' : '展开' }}</small>
            </button>
          </div>

          <template v-if="advancedOpen">
            <button
              v-for="(option, offset) in advancedOptions"
              :id="`sankey-option-${optionKey(option.value)}`"
              :key="option.value"
              :ref="(element) => setOptionEl(element as Element | null, commonOptions.length + offset)"
              class="sankey-select-option is-advanced"
              :class="{
                'is-selected': option.value === modelValue,
                'is-active': option.value === activeValue,
              }"
              type="button"
              role="option"
              :aria-selected="option.value === modelValue"
              @mouseenter="activeValue = option.value"
              @click="selectOption(option)"
            >
              <span>
                <b>{{ option.label }}</b>
                <small v-if="option.description">{{ option.description }}</small>
              </span>
              <span class="sankey-select-check" aria-hidden="true">✓</span>
            </button>
          </template>
        </div>
      </section>
    </Teleport>
  </div>
</template>

<style scoped>
.sankey-select { min-width: 0; }
.sankey-select-trigger {
  width: 100%;
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 10px 0 12px;
  border: 1px solid #cbd5df;
  border-radius: 6px;
  background: #fff;
  color: #263b4a;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.sankey-select-trigger:hover:not(:disabled) { border-color: #8fa8c0; }
.sankey-select-trigger:focus-visible { outline: 3px solid rgba(37, 102, 212, .16); border-color: #2566d4; }
.sankey-select-trigger:disabled { color: #91a0ad; background: #f4f6f8; cursor: not-allowed; }
.sankey-select-trigger > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sankey-select-trigger svg { width: 16px; flex: 0 0 auto; fill: none; stroke: currentColor; stroke-width: 1.8; }
</style>

<style>
.sankey-select-menu {
  position: fixed;
  z-index: 3000;
  overflow: auto;
  padding: 6px;
  border: 1px solid #cfd8e2;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 14px 32px rgba(28, 47, 64, .16);
  color: #263b4a;
}
.sankey-select-menu:focus { outline: none; }
.sankey-select-menu-header { display: none; }
.sankey-select-options { display: grid; gap: 2px; }
.sankey-select-option {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 10px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #2b4050;
  text-align: left;
  cursor: pointer;
}
.sankey-select-option > span:first-child { min-width: 0; display: grid; gap: 2px; }
.sankey-select-option b { overflow: hidden; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.sankey-select-option small { color: #748492; font-size: 11px; line-height: 1.35; }
.sankey-select-option.is-active { background: #f0f5fa; }
.sankey-select-option.is-selected { background: #e8f0fb; color: #1f5fae; }
.sankey-select-check { opacity: 0; color: #2566d4; font-weight: 800; }
.sankey-select-option.is-selected .sankey-select-check { opacity: 1; }
.sankey-select-option.is-advanced { margin-left: 6px; width: calc(100% - 6px); }
.sankey-select-advanced { margin: 5px 4px 2px; padding-top: 5px; border-top: 1px solid #e3e8ed; }
.sankey-select-advanced > button {
  width: 100%; display: flex; justify-content: space-between; padding: 7px 6px;
  border: 0; background: transparent; color: #526574; font: inherit; font-size: 12px; cursor: pointer;
}
.sankey-select-advanced small { color: #7e8d99; }
.sankey-select-mobile-backdrop { display: none; }

@media (max-width: 720px) {
  .sankey-select-mobile-backdrop {
    position: fixed; inset: 0; z-index: 2999; display: block; background: rgba(22, 38, 50, .36);
  }
  .sankey-select-menu {
    inset: auto 0 0 !important;
    width: auto !important;
    max-height: min(72dvh, 560px) !important;
    padding: 0 12px max(14px, env(safe-area-inset-bottom));
    border: 0;
    border-radius: 14px 14px 0 0;
    box-shadow: 0 -16px 38px rgba(18, 35, 48, .22);
  }
  .sankey-select-menu-header {
    position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between;
    padding: 14px 2px 10px; background: #fff; border-bottom: 1px solid #e2e8ed;
  }
  .sankey-select-menu-header strong { font-size: 15px; }
  .sankey-select-menu-header button {
    width: 32px; height: 32px; border: 0; border-radius: 50%; background: #eef2f5;
    color: #435766; font-size: 22px; line-height: 1; cursor: pointer;
  }
  .sankey-select-options { padding-top: 8px; }
  .sankey-select-option { min-height: 48px; padding: 10px 12px; }
  .sankey-select-option b { font-size: 14px; }
}
</style>
