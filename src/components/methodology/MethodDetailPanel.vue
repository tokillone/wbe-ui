<script setup lang="ts">
import { computed } from 'vue'
import type { SamplingMethodItem } from '../../utils/methodologyVerification'
import StatusBadge from './StatusBadge.vue'

const props = defineProps<{ item: SamplingMethodItem | null; status: string; formatNumber: (value: number) => string }>()

const fields = computed(() => {
  const meta = props.item?.meta
  const joined = (value?: string[]) => value?.filter(Boolean).join(' / ') || '未标注'
  return [
    ['采样对象', joined(meta?.sampleObject)],
    ['比例方式', joined(meta?.proportion)],
    ['采样或部署时长', joined(meta?.duration)],
    ['被动采样器', joined(meta?.passiveSampler)],
    ['站点对应状态', joined(meta?.stationStatus)],
  ]
})
</script>

<template>
  <aside class="method-detail" aria-live="polite">
    <template v-if="item">
      <span>标准方法详情</span>
      <h3>{{ item.name }}</h3>
      <div class="method-detail__metric">
        <strong>{{ formatNumber(item.value) }}</strong>
        <span>篇去重文献</span>
        <i :style="{ background: item.color }" aria-hidden="true"></i>
        <b>{{ item.groupName }}</b>
      </div>
      <dl>
        <div v-for="field in fields" :key="field[0]">
          <dt>{{ field[0] }}</dt>
          <dd>{{ field[1] }}</dd>
        </div>
        <div>
          <dt>报告完整性</dt>
          <dd><StatusBadge :value="status" /></dd>
        </div>
      </dl>
    </template>
    <p v-else class="empty-copy">当前筛选下无标准采样方法。</p>
  </aside>
</template>
