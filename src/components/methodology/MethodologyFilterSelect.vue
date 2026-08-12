<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export interface MethodologyFilterOption {
  value: string
  label: string
  searchText?: string
}

const props = withDefaults(
  defineProps<{
    id: string
    label: string
    modelValue: string
    options: MethodologyFilterOption[]
    searchPlaceholder?: string
  }>(),
  { searchPlaceholder: '搜索选项' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const isOpen = ref(false)
const opensUp = ref(false)
const query = ref('')
const highlightedIndex = ref(-1)

const selectedOption = computed(() => props.options.find((option) => option.value === props.modelValue) ?? props.options[0])
const filteredOptions = computed(() => {
  const needle = normalize(query.value)
  if (!needle) return props.options
  return props.options.filter((option) => normalize(`${option.label} ${option.searchText || ''}`).includes(needle))
})
const activeDescendant = computed(() => {
  const option = filteredOptions.value[highlightedIndex.value]
  return option ? optionId(option, highlightedIndex.value) : undefined
})

watch(filteredOptions, (options) => {
  if (!isOpen.value) return
  const selectedIndex = options.findIndex((option) => option.value === props.modelValue)
  highlightedIndex.value = selectedIndex >= 0 ? selectedIndex : options.length ? 0 : -1
}, { flush: 'sync' })

onMounted(() => {
  document.addEventListener('pointerdown', handleOutsidePointer, true)
  window.addEventListener('resize', updateOpeningDirection)
  window.addEventListener('scroll', updateOpeningDirection, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleOutsidePointer, true)
  window.removeEventListener('resize', updateOpeningDirection)
  window.removeEventListener('scroll', updateOpeningDirection, true)
})

function normalize(value: string) {
  return String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, '')
}

function optionId(option: MethodologyFilterOption, index: number) {
  const safe = option.value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
  return `${props.id}-option-${safe || 'item'}-${index}`
}

function openMenu(direction: 1 | -1 = 1) {
  if (!props.options.length) return
  isOpen.value = true
  query.value = ''
  const selectedIndex = props.options.findIndex((option) => option.value === props.modelValue)
  highlightedIndex.value = selectedIndex >= 0 ? selectedIndex : direction > 0 ? 0 : props.options.length - 1
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
  if (!isOpen.value) return
  const rect = trigger.value?.getBoundingClientRect()
  if (!rect) return
  const preferredHeight = Math.min(330, 78 + props.options.length * 38)
  const spaceBelow = window.innerHeight - rect.bottom - 12
  const spaceAbove = rect.top - 12
  opensUp.value = spaceBelow < preferredHeight && spaceAbove > spaceBelow
}

function handleOutsidePointer(event: PointerEvent) {
  if (isOpen.value && !root.value?.contains(event.target as Node)) closeMenu(false)
}

function handleTriggerKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    openMenu(event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu(true)
  }
}

function handleMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu(true)
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    moveHighlight(event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    highlightedIndex.value = event.key === 'Home' ? 0 : filteredOptions.value.length - 1
    scrollHighlightedIntoView()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const option = filteredOptions.value[highlightedIndex.value]
    if (option) selectOption(option)
  }
}

function moveHighlight(direction: 1 | -1) {
  const count = filteredOptions.value.length
  if (!count) return
  highlightedIndex.value = highlightedIndex.value < 0 ? (direction > 0 ? 0 : count - 1) : (highlightedIndex.value + direction + count) % count
  scrollHighlightedIntoView()
}

function scrollHighlightedIntoView() {
  void nextTick(() => {
    const option = filteredOptions.value[highlightedIndex.value]
    if (!option) return
    const element = document.getElementById(optionId(option, highlightedIndex.value))
    if (typeof element?.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest' })
  })
}

function selectOption(option: MethodologyFilterOption) {
  if (option.value !== props.modelValue) emit('update:modelValue', option.value)
  closeMenu(true)
}
</script>

<template>
  <div ref="root" class="methodology-filter-select" :class="{ open: isOpen, 'opens-up': opensUp }">
    <span :id="`${id}-label`" class="methodology-filter-select__label">{{ label }}</span>
    <button
      :id="id"
      ref="trigger"
      class="methodology-filter-select__trigger"
      type="button"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      :aria-labelledby="`${id}-label ${id}`"
      @click="toggleMenu"
      @keydown="handleTriggerKeydown"
    >
      <span :title="selectedOption?.label">{{ selectedOption?.label || '—' }}</span><i aria-hidden="true"></i>
    </button>

    <div v-if="isOpen" class="methodology-filter-select__menu" @keydown="handleMenuKeydown">
      <div class="methodology-filter-select__search">
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
      <div :id="`${id}-listbox`" class="methodology-filter-select__options" role="listbox" :aria-labelledby="`${id}-label`">
        <button
          v-for="(option, index) in filteredOptions"
          :id="optionId(option, index)"
          :key="option.value"
          class="methodology-filter-select__option"
          :class="{ selected: option.value === modelValue, highlighted: index === highlightedIndex }"
          type="button"
          role="option"
          :aria-selected="option.value === modelValue"
          :title="option.label"
          @mouseenter="highlightedIndex = index"
          @click="selectOption(option)"
        >
          <span>{{ option.label }}</span><i aria-hidden="true"></i>
        </button>
        <p v-if="!filteredOptions.length" class="methodology-filter-select__empty">没有匹配选项</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.methodology-filter-select { position: relative; min-width: 0; display: grid; gap: 7px; color: var(--color-text-secondary); }
.methodology-filter-select__label { font-size: 12px; font-weight: 600; }
.methodology-filter-select__trigger { position: relative; width: 100%; min-width: 0; height: 44px; padding: 0 38px 0 12px; border: 1px solid var(--color-border-strong); border-radius: 6px; color: var(--color-text-primary); background: #fff; text-align: left; cursor: pointer; font-size: 14px; transition: border-color .16s ease, box-shadow .16s ease, background .16s ease; }
.methodology-filter-select__trigger > span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.methodology-filter-select__trigger > i { position: absolute; right: 14px; top: 16px; width: 7px; height: 7px; border-right: 1.5px solid var(--color-text-secondary); border-bottom: 1.5px solid var(--color-text-secondary); transform: rotate(45deg); transition: transform .16s ease, top .16s ease; }
.methodology-filter-select__trigger:hover { border-color: var(--color-blue-300); background: #f8fafc; }
.open .methodology-filter-select__trigger, .methodology-filter-select__trigger:focus-visible { border-color: var(--color-blue-600); outline: none; box-shadow: 0 0 0 2px rgba(53, 104, 184, .13); }
.open .methodology-filter-select__trigger > i { top: 20px; transform: rotate(225deg); }
.methodology-filter-select__menu { position: absolute; top: calc(100% + 6px); right: 0; left: 0; z-index: 45; min-width: 250px; overflow: hidden; border: 1px solid var(--color-border-strong); border-radius: 6px; background: #fff; box-shadow: 0 14px 30px rgba(15, 41, 64, .16); }
.opens-up .methodology-filter-select__menu { top: auto; bottom: calc(100% + 6px); }
.methodology-filter-select__search { position: relative; padding: 8px; border-bottom: 1px solid var(--color-border); background: #f8fafc; }
.methodology-filter-select__search > span { position: absolute; top: 18px; left: 19px; width: 8px; height: 8px; border: 1.5px solid var(--color-text-secondary); border-radius: 50%; pointer-events: none; }
.methodology-filter-select__search > span::after { content: ''; position: absolute; right: -5px; bottom: -3px; width: 5px; border-top: 1.5px solid var(--color-text-secondary); transform: rotate(45deg); }
.methodology-filter-select__search input { width: 100%; height: 34px; padding: 0 10px 0 31px; border: 1px solid var(--color-border-strong); border-radius: 4px; color: var(--color-text-primary); background: #fff; outline: none; font-size: 12px; }
.methodology-filter-select__search input:focus { border-color: var(--color-blue-600); box-shadow: 0 0 0 2px rgba(53, 104, 184, .1); }
.methodology-filter-select__options { max-height: min(260px, 42vh); padding: 4px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--color-border-strong) transparent; }
.methodology-filter-select__option { position: relative; width: 100%; min-height: 38px; padding: 7px 34px 7px 10px; border: 0; border-radius: 3px; color: #334155; background: #fff; text-align: left; cursor: pointer; font-size: 13px; line-height: 1.4; }
.methodology-filter-select__option > span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.methodology-filter-select__option:hover, .methodology-filter-select__option.highlighted { color: #1d4ed8; background: #eff6ff; }
.methodology-filter-select__option.selected { color: #1d4ed8; background: #e9f0fa; font-weight: 700; }
.methodology-filter-select__option.selected > i { position: absolute; right: 13px; top: 13px; width: 8px; height: 5px; border-right: 1.5px solid #2563eb; border-bottom: 1.5px solid #2563eb; transform: rotate(45deg); }
.methodology-filter-select__empty { margin: 0; padding: 18px 10px; color: var(--color-text-muted); text-align: center; font-size: 12px; }
@media (max-width: 767px) { .methodology-filter-select__menu { width: 100%; min-width: 0; } .methodology-filter-select__options { max-height: min(240px, 38vh); } }
@media (prefers-reduced-motion: reduce) { .methodology-filter-select__trigger, .methodology-filter-select__trigger > i { transition: none; } }
</style>
