<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { MapFilterSelectOption } from '../MapFilterSelect.vue'

const props = withDefaults(
  defineProps<{
    id: string
    label: string
    options: MapFilterSelectOption[]
    placeholder: string
    emptyText: string
    applyingText: string
    clearSignal?: number
    disabled?: boolean
    compact?: boolean
  }>(),
  { clearSignal: 0, disabled: false, compact: false },
)

const emit = defineEmits<{
  select: [value: string]
}>()

const root = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const query = ref('')
const focused = ref(false)
const highlightedIndex = ref(0)

const normalizedQuery = computed(() => normalizeSearch(query.value))
const matchingOptions = computed(() => {
  const search = normalizedQuery.value
  if (!search) return []
  return props.options
    .map((option, index) => ({ option, index, score: matchScore(option, search) }))
    .filter(({ option, score }) => option.value !== 'ALL' && score >= 0)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, 10)
    .map(({ option }) => option)
})
const menuOpen = computed(() => focused.value && Boolean(normalizedQuery.value) && !props.disabled)
const activeDescendant = computed(() => {
  const option = matchingOptions.value[highlightedIndex.value]
  return option ? optionId(option) : undefined
})

watch(matchingOptions, (options) => {
  highlightedIndex.value = options.length
    ? Math.min(highlightedIndex.value, options.length - 1)
    : -1
})

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) focused.value = false
  },
)

watch(
  () => props.clearSignal,
  () => {
    query.value = ''
    focused.value = false
    highlightedIndex.value = 0
  },
)

onMounted(() => document.addEventListener('pointerdown', handleDocumentPointerDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', handleDocumentPointerDown, true))

function normalizeSearch(value: string) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, '')
}

function matchScore(option: MapFilterSelectOption, search: string) {
  const label = normalizeSearch(option.label)
  const meta = normalizeSearch(option.meta ?? '')
  const content = normalizeSearch(`${option.label} ${option.meta ?? ''} ${option.searchText ?? ''}`)
  if (label === search) return 0
  if (label.startsWith(search)) return 1
  if (meta === search) return 2
  return content.includes(search) ? 3 : -1
}

function optionId(option: MapFilterSelectOption) {
  let hash = 2166136261
  for (const character of option.value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `${props.id}-option-${(hash >>> 0).toString(36)}`
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (root.value?.contains(event.target as Node)) return
  focused.value = false
}

function handleInput() {
  focused.value = true
  highlightedIndex.value = 0
}

function moveHighlight(direction: 1 | -1) {
  const count = matchingOptions.value.length
  if (!count) return
  highlightedIndex.value =
    highlightedIndex.value < 0
      ? direction > 0
        ? 0
        : count - 1
      : (highlightedIndex.value + direction + count) % count
  void nextTick(() => {
    const option = matchingOptions.value[highlightedIndex.value]
    if (option) document.getElementById(optionId(option))?.scrollIntoView({ block: 'nearest' })
  })
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    focused.value = true
    moveHighlight(event.key === 'ArrowDown' ? 1 : -1)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    const option = matchingOptions.value[highlightedIndex.value]
    if (!option) return
    selectOption(option)
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    query.value = ''
    focused.value = false
  }
}

function selectOption(option: MapFilterSelectOption) {
  emit('select', option.value)
  focused.value = false
  highlightedIndex.value = 0
}
</script>

<template>
  <div ref="root" class="map-biomarker-search" :class="{ compact }">
    <label :for="id">{{ label }}</label>
    <div class="map-biomarker-search-field">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.8" cy="10.8" r="6.2"></circle>
        <path d="m15.4 15.4 4.2 4.2"></path>
      </svg>
      <input
        :id="id"
        ref="input"
        v-model="query"
        type="search"
        autocomplete="off"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="menuOpen"
        :aria-controls="`${id}-listbox`"
        :aria-activedescendant="activeDescendant"
        :placeholder="compact ? '' : disabled ? applyingText : placeholder"
        :disabled="disabled"
        @focus="focused = true"
        @input="handleInput"
        @keydown="handleKeydown"
      />
    </div>

    <div v-if="menuOpen" :id="`${id}-listbox`" class="map-biomarker-search-menu" role="listbox">
      <div v-if="matchingOptions.length">
        <button
          v-for="(option, index) in matchingOptions"
          :id="optionId(option)"
          :key="option.value"
          class="map-biomarker-search-option"
          :class="{ highlighted: index === highlightedIndex }"
          type="button"
          role="option"
          :aria-selected="index === highlightedIndex"
          @mouseenter="highlightedIndex = index"
          @click="selectOption(option)"
        >
          <span class="map-biomarker-search-title">
            <span>
              <small v-if="option.levelLabel" class="map-biomarker-search-level">
                {{ option.levelLabel }}
              </small>
              <strong>{{ option.label }}</strong>
            </span>
            <small v-if="option.meta" class="map-biomarker-search-meta"
              >CAS {{ option.meta }}</small
            >
          </span>
          <span v-if="option.description" class="map-biomarker-search-path">
            {{ option.description }}
          </span>
        </button>
      </div>
      <p v-else class="map-biomarker-search-empty" role="status">
        {{ emptyText }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.map-biomarker-search {
  position: relative;
  min-width: 0;
  display: grid;
  gap: 5px;
  color: #5f7180;
}

.map-biomarker-search > label {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
}

.map-biomarker-search-field {
  position: relative;
}

.map-biomarker-search-field svg {
  position: absolute;
  top: 50%;
  left: 12px;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: #526a7b;
  stroke-width: 1.8;
  transform: translateY(-50%);
  pointer-events: none;
}

.map-biomarker-search-field input {
  width: 100%;
  height: 42px;
  box-sizing: border-box;
  padding: 0 11px 0 36px;
  border: 1px solid #9eafbb;
  border-radius: 4px;
  outline: none;
  color: #183244;
  background: #ffffff;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.map-biomarker-search-field input::placeholder {
  color: #718492;
  font-weight: 500;
}

.map-biomarker-search-field input:focus {
  border-color: #8097a8;
  box-shadow: 0 0 0 1px rgba(23, 79, 124, 0.08);
}

.map-biomarker-search-field input:focus-visible {
  border-color: #8097a8;
  outline: 1px solid #a8b7c1;
  outline-offset: 1px;
  box-shadow: none;
}

.map-biomarker-search-field input:disabled {
  color: #748693;
  background: #f1f4f6;
  cursor: not-allowed;
}

.map-biomarker-search.compact {
  width: min(164px, 100%);
  display: block;
  justify-self: end;
}

.map-biomarker-search.compact > label {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.map-biomarker-search.compact .map-biomarker-search-field svg {
  left: 10px;
  width: 15px;
  height: 15px;
}

.map-biomarker-search.compact .map-biomarker-search-field input {
  height: 34px;
  padding: 0 9px 0 31px;
  border-color: #aebec9;
  background: #f9fbfc;
  font-size: 12px;
}

.map-biomarker-search.compact .map-biomarker-search-field input:focus {
  border-color: #6888a0;
  background: #ffffff;
}

.map-biomarker-search.compact .map-biomarker-search-menu {
  right: 0;
  left: auto;
  width: min(284px, calc(100vw - 48px));
  min-width: 0;
}

.map-biomarker-search-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  left: 0;
  z-index: 45;
  min-width: 284px;
  max-height: 318px;
  box-sizing: border-box;
  overflow-y: auto;
  border: 1px solid #b8c5cd;
  border-radius: 4px;
  background: #ffffff;
  box-shadow: 0 6px 18px rgba(24, 50, 68, 0.15);
  scrollbar-width: thin;
  scrollbar-color: #b7c4cd transparent;
}

.map-biomarker-search-option {
  width: 100%;
  display: grid;
  gap: 4px;
  padding: 9px 10px;
  border: 0;
  border-bottom: 1px solid #e4e9ec;
  border-radius: 0;
  color: #183244;
  background: #ffffff;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.map-biomarker-search-option:last-child {
  border-bottom: 0;
}

.map-biomarker-search-option.highlighted {
  background: #f5f7f8;
}

.map-biomarker-search-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.map-biomarker-search-title > span {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 7px;
}

.map-biomarker-search-title strong {
  overflow-wrap: anywhere;
  font-size: 12px;
  font-weight: 700;
}

.map-biomarker-search-level {
  flex: 0 0 auto;
  padding: 1px 4px;
  border: 1px solid #d4dde3;
  border-radius: 3px;
  color: #627582;
  background: #f7f7f8;
  font-size: 9px;
  font-weight: 600;
}

.map-biomarker-search-meta {
  flex: 0 0 auto;
  color: #536b7c;
  font-size: 10px;
  font-weight: 600;
}

.map-biomarker-search-path {
  overflow: hidden;
  color: #657987;
  font-size: 10px;
  font-weight: 500;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map-biomarker-search-empty {
  margin: 0;
  padding: 14px 12px;
  color: #657987;
  font-size: 12px;
  font-weight: 500;
  text-align: center;
}

@media (max-width: 560px) {
  .map-biomarker-search-menu {
    min-width: 100%;
  }

  .map-biomarker-search-title {
    align-items: flex-start;
    flex-direction: column;
    gap: 2px;
  }
}
</style>
