<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import type { PrescriptionSummary } from '../../utils/icd11SankeyDisplay'

const props = defineProps<{ summary: PrescriptionSummary }>()
const helpOpen = ref(false)
const helpId = useId()
const categories = [
  { key: 'prescription', label: '处方药', color: '#245f8e' },
  { key: 'nonprescription', label: '非处方药', color: '#24877f' },
  { key: 'conflict', label: '记录不一致', color: '#b48642' },
  { key: 'unknown', label: '未匹配', color: '#a3afb7' },
] as const
const segments = computed(() =>
  categories
    .map((category) => ({
      ...category,
      count: props.summary.counts[category.key],
      percent: props.summary.total
        ? (props.summary.counts[category.key] / props.summary.total) * 100
        : 0,
    }))
    .filter((segment) => segment.count > 0),
)
const singleSegment = computed(() => segments.value[0] ?? null)
</script>

<template>
  <section class="prescription-ratio" aria-label="处方属性比例（按药物数）">
    <header>
      <div class="prescription-title">
        <strong>处方属性比例</strong
        ><button
          type="button"
          class="prescription-help"
          aria-label="处方属性分类说明"
          :aria-expanded="helpOpen"
          :aria-controls="helpId"
          @click="helpOpen = !helpOpen"
          @keydown.esc.stop="helpOpen = false"
        >
          说明
        </button>
      </div>
      <span>共 {{ summary.total }} 种药物</span>
    </header>
    <p v-if="helpOpen" :id="helpId" class="prescription-explanation">
      未匹配：方法学表中没有完全同名药物。记录不一致：同一药物的原始记录同时标为处方药和非处方药。为避免错误归类，两类均单独保留。
    </p>
    <p v-if="!summary.available" class="prescription-unavailable">属性数据暂不可用</p>
    <p v-else-if="!summary.total" class="prescription-unavailable">当前范围暂无药物</p>
    <div v-else-if="summary.total === 1 && singleSegment" class="single-prescription-status">
      <span>
        <i :style="{ background: singleSegment.color }" aria-hidden="true"></i>
        {{ singleSegment.label }}
      </span>
      <strong>1 种</strong>
    </div>
    <template v-else>
      <div
        class="prescription-track"
        role="img"
        :aria-label="segments.map((item) => `${item.label} ${item.percent.toFixed(1)}%`).join('，')"
      >
        <i
          v-for="segment in segments"
          :key="segment.key"
          :style="{ width: `${segment.percent}%`, background: segment.color }"
          :title="`${segment.label} ${segment.percent.toFixed(1)}%（${segment.count} 种）`"
        ></i>
      </div>
      <ul>
        <li v-for="segment in segments" :key="segment.key">
          <span class="prescription-label">
            <i :style="{ background: segment.color }" aria-hidden="true"></i>
            {{ segment.label }}
          </span>
          <span class="prescription-count">{{ segment.count }} 种</span>
          <strong>{{ segment.percent.toFixed(1) }}%</strong>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.prescription-ratio {
  width: 100%;
  box-sizing: border-box;
  padding: 14px 0 13px;
  margin: 0 0 18px;
  color: #173247;
  border-top: 1px solid #dce5eb;
  border-bottom: 1px solid #dce5eb;
  background: transparent;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 11px;
}
.prescription-title {
  display: flex;
  align-items: center;
  gap: 5px;
}
.prescription-help {
  min-height: 24px;
  padding: 0;
  border: 0;
  border-bottom: 1px solid #a9bbc6;
  border-radius: 0;
  background: transparent;
  color: #687d8a;
  font: inherit;
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
}
.prescription-help:hover {
  color: #245f8e;
  border-bottom-color: #245f8e;
}
.prescription-help:focus-visible {
  outline: 2px solid #245f8e;
  outline-offset: 2px;
}
.prescription-explanation {
  margin: 10px 0 0;
  padding-top: 9px;
  border-top: 1px solid #dbe7e7;
  color: #526b76;
  font-size: 11px;
  line-height: 1.65;
}
header strong {
  font-size: 13px;
  font-weight: 650;
}
header span,
.prescription-count,
.prescription-unavailable {
  color: #657985;
}
.single-prescription-status {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  margin-top: 11px;
  padding-top: 10px;
  border-top: 1px solid #dbe7e7;
  font-size: 12px;
}
.single-prescription-status span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.single-prescription-status span i {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 2px;
}
.single-prescription-status strong {
  color: #173247;
  font-variant-numeric: tabular-nums;
}
.prescription-track {
  display: flex;
  width: 100%;
  height: 8px;
  min-height: 8px;
  flex: 0 0 8px;
  align-items: stretch;
  margin: 13px 0 9px;
  overflow: hidden;
  border-radius: 1px;
  background: #edf2f4;
}
.prescription-track i {
  display: block;
  flex: 0 0 auto;
  height: 8px;
  min-height: 8px;
  font-style: normal;
}
ul {
  list-style: none;
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
}
li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 4.5ch 5.5ch;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  font-size: 11px;
  white-space: normal;
}
.prescription-label {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.prescription-label i {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 2px;
}
li strong {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.prescription-count {
  font-size: 10px;
  text-align: right;
  white-space: nowrap;
}
.prescription-unavailable {
  margin: 10px 0 0;
  font-size: 12px;
}
@media (max-width: 360px) {
  li {
    grid-template-columns: minmax(0, 1fr) 4ch 5.2ch;
    gap: 7px;
  }
}
</style>
