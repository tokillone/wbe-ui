<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export type MapFilterSelectOption = {
  value: string
  label: string
}

const props = withDefaults(
  defineProps<{
    id: string
    label: string
    modelValue: string
    options: MapFilterSelectOption[]
    disabled?: boolean
    searchPlaceholder?: string
    emptyText?: string
  }>(),
  {
    disabled: false,
    searchPlaceholder: '搜索选项',
    emptyText: '没有匹配选项',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const isOpen = ref(false)
const opensUp = ref(false)
const query = ref('')
const highlightedIndex = ref(-1)

const selectedOption = computed(
  () => props.options.find((option) => option.value === props.modelValue) ?? props.options[0],
)
const normalizedQuery = computed(() => normalizeSearch(query.value))
const filteredOptions = computed(() => {
  const search = normalizedQuery.value
  if (!search) return props.options
  return props.options.filter((option) => normalizeSearch(option.label).includes(search))
})
const activeDescendant = computed(() => {
  const option = filteredOptions.value[highlightedIndex.value]
  return option ? optionId(option) : undefined
})

watch(
  filteredOptions,
  (options) => {
    if (!isOpen.value) return
    const selectedIndex = options.findIndex((option) => option.value === props.modelValue)
    highlightedIndex.value = selectedIndex >= 0 ? selectedIndex : options.length ? 0 : -1
  },
  { flush: 'sync' },
)

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) closeMenu(false)
  },
)

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('scroll', handleViewportChange, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('scroll', handleViewportChange, true)
})

function normalizeSearch(value: string) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, '')
}

function optionId(option: MapFilterSelectOption) {
  const safeValue = option.value.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48)
  return `${props.id}-option-${safeValue || 'empty'}`
}

function openMenu(initialDirection: 1 | -1 = 1) {
  if (props.disabled || !props.options.length) return
  isOpen.value = true
  query.value = ''
  const selectedIndex = props.options.findIndex((option) => option.value === props.modelValue)
  highlightedIndex.value = selectedIndex >= 0 ? selectedIndex : initialDirection > 0 ? 0 : props.options.length - 1
  updateOpeningDirection()
  void nextTick(() => {
    searchInput.value?.focus()
    scrollHighlightedIntoView()
  })
}

function closeMenu(restoreFocus = false) {
  if (!isOpen.value) return
  isOpen.value = false
  query.value = ''
  highlightedIndex.value = -1
  if (restoreFocus) void nextTick(() => trigger.value?.focus())
}

function toggleMenu() {
  if (isOpen.value) closeMenu(true)
  else openMenu()
}

function updateOpeningDirection() {
  const rect = trigger.value?.getBoundingClientRect()
  if (!rect) return
  const preferredHeight = Math.min(282, 68 + props.options.length * 36)
  const spaceBelow = window.innerHeight - rect.bottom - 12
  const spaceAbove = rect.top - 12
  opensUp.value = spaceBelow < preferredHeight && spaceAbove > spaceBelow
}

function handleViewportChange() {
  if (isOpen.value) updateOpeningDirection()
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (!isOpen.value || root.value?.contains(event.target as Node)) return
  closeMenu(false)
}

function handleTriggerKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    openMenu(event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'Escape' && isOpen.value) {
    event.preventDefault()
    closeMenu(true)
  }
}

function handleMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu(true)
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    moveHighlight(event.key === 'ArrowDown' ? 1 : -1)
    return
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    highlightedIndex.value = event.key === 'Home' ? 0 : filteredOptions.value.length - 1
    scrollHighlightedIntoView()
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    const option = filteredOptions.value[highlightedIndex.value]
    if (option) selectOption(option)
  }
}

function moveHighlight(direction: 1 | -1) {
  const count = filteredOptions.value.length
  if (!count) return
  const current = highlightedIndex.value
  highlightedIndex.value = current < 0 ? (direction > 0 ? 0 : count - 1) : (current + direction + count) % count
  scrollHighlightedIntoView()
}

function scrollHighlightedIntoView() {
  void nextTick(() => {
    const option = filteredOptions.value[highlightedIndex.value]
    if (!option) return
    document.getElementById(optionId(option))?.scrollIntoView({ block: 'nearest' })
  })
}

function selectOption(option: MapFilterSelectOption) {
  if (option.value !== props.modelValue) emit('update:modelValue', option.value)
  closeMenu(true)
}
</script>

<template>
  <div ref="root" class="map-filter-select" :class="{ open: isOpen, disabled, 'opens-up': opensUp }">
    <span :id="`${id}-label`" class="map-filter-select-label">{{ label }}</span>
    <button
      :id="id"
      ref="trigger"
      class="map-filter-select-trigger"
      type="button"
      :disabled="disabled"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      :aria-labelledby="`${id}-label ${id}`"
      @click="toggleMenu"
      @keydown="handleTriggerKeydown"
    >
      <span>{{ selectedOption?.label || '—' }}</span>
      <i aria-hidden="true"></i>
    </button>

    <div v-if="isOpen" class="map-filter-select-menu" @keydown="handleMenuKeydown">
      <div class="map-filter-select-search">
        <span aria-hidden="true"></span>
        <input
          ref="searchInput"
          v-model="query"
          type="search"
          autocomplete="off"
          :placeholder="searchPlaceholder"
          :aria-label="searchPlaceholder"
          :aria-controls="`${id}-listbox`"
          :aria-activedescendant="activeDescendant"
        />
      </div>
      <div :id="`${id}-listbox`" class="map-filter-select-options" role="listbox" :aria-labelledby="`${id}-label`">
        <button
          v-for="(option, index) in filteredOptions"
          :id="optionId(option)"
          :key="option.value"
          class="map-filter-select-option"
          :class="{
            selected: option.value === modelValue,
            highlighted: index === highlightedIndex,
          }"
          type="button"
          role="option"
          :aria-selected="option.value === modelValue"
          @mouseenter="highlightedIndex = index"
          @click="selectOption(option)"
        >
          <span>{{ option.label }}</span>
          <i aria-hidden="true"></i>
        </button>
        <p v-if="!filteredOptions.length" class="map-filter-select-empty">{{ emptyText }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.map-filter-select {
  position: relative;
  min-width: 0;
  display: grid;
  gap: 5px;
  color: #5d7181;
}

.map-filter-select-label {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
}

.map-filter-select-trigger {
  position: relative;
  width: 100%;
  min-width: 0;
  height: 42px;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18px;
  align-items: center;
  gap: 8px;
  padding: 0 11px;
  border: 1px solid #bcc9d2;
  border-radius: 4px;
  color: #173247;
  background: #ffffff;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.map-filter-select-trigger > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map-filter-select-trigger > i {
  width: 7px;
  height: 7px;
  justify-self: center;
  border-right: 1.5px solid #526a7b;
  border-bottom: 1.5px solid #526a7b;
  transform: translateY(-2px) rotate(45deg);
  transition: transform 0.15s ease;
}

.map-filter-select.open .map-filter-select-trigger,
.map-filter-select-trigger:focus-visible {
  border-color: #174f7c;
  outline: none;
  box-shadow: 0 0 0 2px rgba(23, 79, 124, 0.13);
}

.map-filter-select.open .map-filter-select-trigger > i {
  transform: translateY(2px) rotate(225deg);
}

.map-filter-select.disabled {
  color: #8796a2;
}

.map-filter-select-trigger:disabled {
  color: #7e8d98;
  background: #f4f6f7;
  cursor: not-allowed;
}

.map-filter-select-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  left: 0;
  z-index: 40;
  min-width: 250px;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid #b7c5cf;
  border-radius: 5px;
  background: #ffffff;
  box-shadow: 0 10px 26px rgba(24, 50, 68, 0.16);
}

.map-filter-select.opens-up .map-filter-select-menu {
  top: auto;
  bottom: calc(100% + 6px);
}

.map-filter-select-search {
  position: relative;
  padding: 8px;
  border-bottom: 1px solid #e0e6ea;
  background: #f7f9fa;
}

.map-filter-select-search > span {
  position: absolute;
  top: 17px;
  left: 18px;
  width: 8px;
  height: 8px;
  box-sizing: border-box;
  border: 1.5px solid #60798b;
  border-radius: 50%;
  pointer-events: none;
}

.map-filter-select-search > span::after {
  position: absolute;
  right: -5px;
  bottom: -3px;
  width: 5px;
  border-top: 1.5px solid #60798b;
  transform: rotate(45deg);
  content: '';
}

.map-filter-select-search input {
  width: 100%;
  height: 32px;
  box-sizing: border-box;
  padding: 0 9px 0 30px;
  border: 1px solid #c6d1d8;
  border-radius: 3px;
  outline: none;
  color: #213d52;
  background: #ffffff;
  font: inherit;
  font-size: 12px;
}

.map-filter-select-search input:focus {
  border-color: #5f86a4;
  box-shadow: 0 0 0 2px rgba(23, 79, 124, 0.1);
}

.map-filter-select-options {
  max-height: 214px;
  padding: 5px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #b7c4cd transparent;
}

.map-filter-select-option {
  width: 100%;
  min-height: 34px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18px;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  border-radius: 3px;
  color: #314c60;
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
}

.map-filter-select-option > span {
  overflow-wrap: anywhere;
}

.map-filter-select-option.highlighted {
  color: #173f60;
  background: #edf3f7;
}

.map-filter-select-option.selected {
  color: #174f7c;
  background: #e7f0f7;
  font-weight: 700;
}

.map-filter-select-option > i {
  position: relative;
  width: 14px;
  height: 14px;
  justify-self: center;
  border: 1px solid transparent;
  border-radius: 50%;
}

.map-filter-select-option.selected > i {
  border-color: #174f7c;
  background: #174f7c;
}

.map-filter-select-option.selected > i::after {
  position: absolute;
  top: 2px;
  left: 4px;
  width: 4px;
  height: 7px;
  border-right: 1.5px solid #ffffff;
  border-bottom: 1.5px solid #ffffff;
  transform: rotate(45deg);
  content: '';
}

.map-filter-select-empty {
  margin: 0;
  padding: 18px 10px;
  color: #748693;
  font-size: 12px;
  text-align: center;
}

@media (max-width: 560px) {
  .map-filter-select-menu {
    min-width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .map-filter-select-trigger,
  .map-filter-select-trigger > i {
    transition: none;
  }
}
</style>
