<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SamplingAuditItem } from '../../utils/methodologyVerification'
import StatusBadge from './StatusBadge.vue'

type SortKey = 'docs' | 'rows' | 'auditSourceGroups' | 'standard'

const props = defineProps<{
  items: SamplingAuditItem[]
  formatNumber: (value: number) => string
}>()

const sortKey = ref<SortKey>('docs')
const sortDirection = ref<'asc' | 'desc'>('desc')
const expandedRows = ref(new Set<string>())
const expandedText = ref(new Set<string>())

const sortedItems = computed(() =>
  [...props.items].sort((a, b) => {
    const left = a[sortKey.value]
    const right = b[sortKey.value]
    const comparison =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right), 'zh-Hans-CN')
    return sortDirection.value === 'asc' ? comparison : -comparison
  }),
)

function setSort(key: SortKey) {
  if (sortKey.value === key) sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  else {
    sortKey.value = key
    sortDirection.value = key === 'standard' ? 'asc' : 'desc'
  }
}

function sortLabel(key: SortKey) {
  if (sortKey.value !== key) return '可排序'
  return sortDirection.value === 'asc' ? '升序' : '降序'
}

function toggle(set: Set<string>, key: string) {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

function toggleRow(key: string) {
  expandedRows.value = toggle(expandedRows.value, key)
}

function toggleText(key: string) {
  expandedText.value = toggle(expandedText.value, key)
}
</script>

<template>
  <div class="method-table-wrap">
    <div class="method-table-scroll">
      <table>
        <thead>
          <tr>
            <th class="sticky-column"><button type="button" @click="setSort('standard')">标准采样方法 <span :aria-label="sortLabel('standard')">{{ sortKey === 'standard' ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅' }}</span></button></th>
            <th>采样主类</th><th>采样对象</th><th>比例方式</th><th>采样/部署时长</th><th>被动采样器</th><th>站点对应状态</th><th>报告完整性</th>
            <th class="numeric"><button type="button" title="按文献编号去重后的覆盖数" @click="setSort('docs')">文献 <span :aria-label="sortLabel('docs')">{{ sortKey === 'docs' ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅' }}</span></button></th>
            <th class="numeric"><button type="button" title="当前筛选下的原始数据记录数" @click="setSort('rows')">数据记录 <span :aria-label="sortLabel('rows')">{{ sortKey === 'rows' ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅' }}</span></button></th>
            <th class="numeric"><button type="button" title="用于审计追溯的去重原文摘录组" @click="setSort('auditSourceGroups')">审计摘录组 <span :aria-label="sortLabel('auditSourceGroups')">{{ sortKey === 'auditSourceGroups' ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅' }}</span></button></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in sortedItems" :key="item.standard">
            <td class="sticky-column method-name">{{ item.standard }}</td>
            <td>{{ item.samplingClass }}</td>
            <td><button class="clamped-cell" :class="{ expanded: expandedText.has(`${item.standard}-object`) }" type="button" @click="toggleText(`${item.standard}-object`)">{{ item.sampleObject }}</button></td>
            <td><button class="clamped-cell" :class="{ expanded: expandedText.has(`${item.standard}-proportion`) }" type="button" @click="toggleText(`${item.standard}-proportion`)">{{ item.proportion }}</button></td>
            <td><button class="clamped-cell" :class="{ expanded: expandedText.has(`${item.standard}-duration`) }" type="button" @click="toggleText(`${item.standard}-duration`)">{{ item.duration }}</button></td>
            <td>{{ item.passiveSampler }}</td><td>{{ item.stationStatus }}</td><td><StatusBadge :value="item.proportionStatus" /></td>
            <td class="numeric">{{ formatNumber(item.docs) }}</td><td class="numeric">{{ formatNumber(item.rows) }}</td><td class="numeric">{{ formatNumber(item.auditSourceGroups) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="method-card-list" aria-label="标准采样方法移动端列表">
      <article v-for="item in sortedItems" :key="item.standard" class="method-card">
        <button class="method-card__summary" type="button" :aria-expanded="expandedRows.has(item.standard)" @click="toggleRow(item.standard)">
          <span><strong>{{ item.standard }}</strong><small>{{ item.samplingClass }}</small></span>
          <span><b>{{ formatNumber(item.docs) }}</b><small>篇文献</small></span>
          <StatusBadge :value="item.proportionStatus" />
          <i aria-hidden="true">{{ expandedRows.has(item.standard) ? '−' : '＋' }}</i>
        </button>
        <dl v-if="expandedRows.has(item.standard)" class="method-card__details">
          <div><dt>采样对象</dt><dd>{{ item.sampleObject }}</dd></div>
          <div><dt>比例方式</dt><dd>{{ item.proportion }}</dd></div>
          <div><dt>采样/部署时长</dt><dd>{{ item.duration }}</dd></div>
          <div><dt>被动采样器</dt><dd>{{ item.passiveSampler }}</dd></div>
          <div><dt>站点对应状态</dt><dd>{{ item.stationStatus }}</dd></div>
          <div><dt>数据记录</dt><dd>{{ formatNumber(item.rows) }}</dd></div>
          <div><dt>审计摘录组</dt><dd>{{ formatNumber(item.auditSourceGroups) }}</dd></div>
        </dl>
      </article>
    </div>
  </div>
</template>
