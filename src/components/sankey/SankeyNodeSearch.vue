<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { SankeyNodeSearchResult } from '../../utils/icd11SankeySearch'

const props = withDefaults(
  defineProps<{
    modelValue: string
    results: SankeyNodeSearchResult[]
    selectedNodeId?: string
    disabled?: boolean
  }>(),
  {
    selectedNodeId: '',
    disabled: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  select: [result: SankeyNodeSearchResult]
  clear: []
}>()

const KIND_LABELS: Record<SankeyNodeSearchResult['kind'], string> = {
  level1: 'ICD11_Level1',
  level2: 'ICD11_Level2',
  level3: 'ICD11_Level3',
  drug: '药物',
  biomarker: '生物标记物',
}

const rootEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const optionEls = ref<HTMLElement[]>([])
const open = ref(false)
const activeIndex = ref(0)
const panelStyle = ref<Record<string, string>>({})

const hasQuery = computed(() => Boolean(props.modelValue.trim()))
const groupedResults = computed(() => {
  const groups = new Map<number, SankeyNodeSearchResult[]>()
  for (const result of props.results) {
    const items = groups.get(result.depth) ?? []
    items.push(result)
    groups.set(result.depth, items)
  }
  return [...groups.entries()]
    .sort(([depthA], [depthB]) => depthA - depthB)
    .map(([depth, items]) => ({ depth, label: KIND_LABELS[items[0]?.kind ?? 'level1'], items }))
})

watch(
  () => props.results,
  () => {
    activeIndex.value = Math.max(0, Math.min(activeIndex.value, props.results.length - 1))
  },
)

function positionPanel() {
  const root = rootEl.value
  if (!root || window.matchMedia?.('(max-width: 720px)').matches) {
    panelStyle.value = {}
    return
  }
  const rect = root.getBoundingClientRect()
  const width = Math.max(320, rect.width)
  panelStyle.value = {
    left: `${Math.min(rect.left, window.innerWidth - width - 12)}px`,
    top: `${rect.bottom + 6}px`,
    width: `${width}px`,
    maxHeight: `${Math.min(440, Math.max(220, window.innerHeight - rect.bottom - 18))}px`,
  }
}

function handleInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  emit('update:modelValue', value)
  activeIndex.value = 0
  open.value = Boolean(value.trim())
  positionPanel()
}

function handleFocus() {
  if (hasQuery.value) open.value = true
  positionPanel()
}

function closePanel(restoreFocus = false) {
  open.value = false
  if (restoreFocus) nextTick(() => inputEl.value?.focus({ preventScroll: true }))
}

function clearSearch() {
  emit('update:modelValue', '')
  emit('clear')
  activeIndex.value = 0
  open.value = false
  nextTick(() => inputEl.value?.focus({ preventScroll: true }))
}

function chooseResult(result: SankeyNodeSearchResult) {
  emit('select', result)
  closePanel()
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!hasQuery.value) return
    event.preventDefault()
    open.value = true
    if (props.results.length) {
      const offset = event.key === 'ArrowDown' ? 1 : -1
      activeIndex.value = (activeIndex.value + offset + props.results.length) % props.results.length
      nextTick(() => optionEls.value[activeIndex.value]?.scrollIntoView?.({ block: 'nearest' }))
    }
    return
  }
  const activeResult = props.results[activeIndex.value]
  if (event.key === 'Enter' && open.value && activeResult) {
    event.preventDefault()
    chooseResult(activeResult)
    return
  }
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    closePanel(true)
  }
}

function resultIndex(result: SankeyNodeSearchResult) {
  return props.results.findIndex((item) => item.nodeId === result.nodeId)
}

function setOptionEl(element: Element | null, result: SankeyNodeSearchResult) {
  if (!(element instanceof HTMLElement)) return
  const index = resultIndex(result)
  if (index >= 0) optionEls.value[index] = element
}

function handleDocumentPointer(event: PointerEvent) {
  const target = event.target
  if (!(target instanceof Node)) return
  if (rootEl.value?.contains(target) || panelEl.value?.contains(target)) return
  closePanel()
}

function handleViewportChange() {
  if (open.value) positionPanel()
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointer)
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('scroll', handleViewportChange, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointer)
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('scroll', handleViewportChange, true)
})
</script>

<template>
  <div ref="rootEl" class="sankey-node-search" :class="{ 'is-disabled': disabled }">
    <svg class="sankey-node-search-icon" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="m12.5 12.5 4 4" />
    </svg>
    <input
      ref="inputEl"
      type="search"
      autocomplete="off"
      :value="modelValue"
      :disabled="disabled"
      placeholder="搜索 ICD、药物或生物标记物"
      role="combobox"
      aria-label="搜索五层节点"
      aria-autocomplete="list"
      :aria-expanded="open && hasQuery"
      aria-controls="sankey-search-results"
      :aria-activedescendant="results[activeIndex] ? `sankey-search-${activeIndex}` : undefined"
      @input="handleInput"
      @focus="handleFocus"
      @keydown="handleKeydown"
    />
    <button
      v-if="modelValue"
      class="sankey-node-search-clear"
      type="button"
      aria-label="清空搜索"
      @click="clearSearch"
    >
      ×
    </button>

    <Teleport to="body">
      <button
        v-if="open && hasQuery"
        class="sankey-search-mobile-backdrop"
        type="button"
        aria-label="关闭搜索结果"
        @click="closePanel()"
      ></button>
      <section
        v-if="open && hasQuery"
        id="sankey-search-results"
        ref="panelEl"
        class="sankey-search-panel"
        :style="panelStyle"
        role="listbox"
        aria-label="五层节点搜索结果"
      >
        <header class="sankey-search-panel-header">
          <div>
            <strong>搜索五层节点</strong>
            <small>{{ results.length }} 项匹配</small>
          </div>
          <button type="button" aria-label="关闭搜索结果" @click="closePanel(true)">×</button>
        </header>

        <div v-if="!results.length" class="sankey-search-empty">
          <strong>未找到匹配条目</strong>
          <span>请尝试输入更完整或更简短的名称。</span>
        </div>

        <div v-else class="sankey-search-groups">
          <section v-for="group in groupedResults" :key="group.depth" class="sankey-search-group">
            <h3>{{ group.label }}</h3>
            <button
              v-for="result in group.items"
              :id="`sankey-search-${resultIndex(result)}`"
              :key="result.nodeId"
              :ref="(element) => setOptionEl(element as Element | null, result)"
              class="sankey-search-result"
              :class="{
                'is-active': resultIndex(result) === activeIndex,
                'is-selected': result.nodeId === selectedNodeId,
              }"
              type="button"
              role="option"
              :aria-selected="result.nodeId === selectedNodeId"
              @mouseenter="activeIndex = resultIndex(result)"
              @click="chooseResult(result)"
            >
              <span class="sankey-search-result-main">
                <b :title="result.name">{{ result.name }}</b>
                <small>{{ result.pathCount }} 条关联路径</small>
              </span>
              <span class="sankey-search-result-weight">{{ result.weight }}</span>
            </button>
          </section>
        </div>
      </section>
    </Teleport>
  </div>
</template>

<style scoped>
.sankey-node-search {
  position: relative;
  min-width: 0;
}
.sankey-node-search input {
  width: 100%;
  min-height: 36px;
  padding: 0 34px 0 34px;
  border: 1px solid #cbd5df;
  border-radius: 6px;
  background: #fff;
  color: #263b4a;
  font: inherit;
  font-size: 13px;
  font-weight: 550;
  outline: none;
  box-sizing: border-box;
}
.sankey-node-search input::placeholder {
  color: #84929e;
  font-weight: 450;
}
.sankey-node-search input::-webkit-search-cancel-button {
  appearance: none;
}
.sankey-node-search input:hover:not(:disabled) {
  border-color: #8fa8c0;
}
.sankey-node-search input:focus {
  border-color: #2566d4;
  box-shadow: 0 0 0 3px rgba(37, 102, 212, 0.14);
}
.sankey-node-search input:disabled {
  background: #f4f6f8;
  cursor: not-allowed;
}
.sankey-node-search-icon {
  position: absolute;
  z-index: 1;
  top: 50%;
  left: 11px;
  width: 16px;
  height: 16px;
  transform: translateY(-50%);
  fill: none;
  stroke: #60788a;
  stroke-width: 1.7;
}
.sankey-node-search-clear {
  position: absolute;
  z-index: 1;
  top: 50%;
  right: 7px;
  width: 25px;
  height: 25px;
  padding: 0;
  transform: translateY(-50%);
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #657887;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
.sankey-node-search-clear:hover {
  background: #eef2f5;
  color: #264d70;
}
</style>

<style>
.sankey-search-panel {
  position: fixed;
  z-index: 3100;
  overflow: auto;
  padding: 6px;
  border: 1px solid #cfd8e2;
  border-radius: 8px;
  background: #fff;
  color: #263b4a;
  box-shadow: 0 15px 36px rgba(28, 47, 64, 0.18);
}
.sankey-search-panel-header {
  display: none;
}
.sankey-search-groups {
  display: grid;
  gap: 6px;
}
.sankey-search-group + .sankey-search-group {
  padding-top: 6px;
  border-top: 1px solid #e5eaee;
}
.sankey-search-group h3 {
  margin: 0;
  padding: 5px 9px 4px;
  color: #71818e;
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.02em;
}
.sankey-search-result {
  width: 100%;
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 9px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #2b4050;
  text-align: left;
  cursor: pointer;
}
.sankey-search-result.is-active {
  background: #f0f5fa;
}
.sankey-search-result.is-selected {
  background: #e6eff9;
  color: #1f5b8b;
}
.sankey-search-result-main {
  min-width: 0;
  display: grid;
  gap: 2px;
}
.sankey-search-result-main b {
  overflow: hidden;
  font-size: 13px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sankey-search-result-main small {
  color: #7a8995;
  font-size: 10px;
}
.sankey-search-result-weight {
  flex: 0 0 auto;
  color: #647887;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.sankey-search-empty {
  display: grid;
  gap: 4px;
  padding: 22px 14px;
  text-align: center;
}
.sankey-search-empty strong {
  font-size: 13px;
}
.sankey-search-empty span {
  color: #7a8995;
  font-size: 11px;
}
.sankey-search-mobile-backdrop {
  display: none;
}

@media (max-width: 720px) {
  .sankey-search-mobile-backdrop {
    position: fixed;
    inset: 0;
    z-index: 3099;
    display: block;
    border: 0;
    background: rgba(22, 38, 50, 0.36);
  }
  .sankey-search-panel {
    inset: auto 0 0 !important;
    width: auto !important;
    max-height: min(76dvh, 620px) !important;
    padding: 0 12px max(14px, env(safe-area-inset-bottom));
    border: 0;
    border-radius: 14px 14px 0 0;
    box-shadow: 0 -16px 38px rgba(18, 35, 48, 0.24);
  }
  .sankey-search-panel-header {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 2px 10px;
    border-bottom: 1px solid #e2e8ed;
    background: #fff;
  }
  .sankey-search-panel-header > div {
    display: grid;
    gap: 2px;
  }
  .sankey-search-panel-header strong {
    font-size: 15px;
  }
  .sankey-search-panel-header small {
    color: #748492;
    font-size: 10px;
  }
  .sankey-search-panel-header button {
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 50%;
    background: #eef2f5;
    color: #435766;
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
  }
  .sankey-search-groups {
    padding-top: 8px;
  }
  .sankey-search-result {
    min-height: 50px;
    padding: 9px 11px;
  }
  .sankey-search-result-main b {
    font-size: 14px;
  }
}
</style>
