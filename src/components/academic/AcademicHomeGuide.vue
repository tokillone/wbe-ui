<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import OperationGuide, { type OperationGuideStep } from '../OperationGuide.vue'
const props = defineProps<{
  ready: boolean
  blocked?: boolean
  returnFocusTo?: HTMLElement | null
}>()
const emit = defineEmits<{ openChange: [open: boolean] }>()
const open = ref(false)
const step = ref(0)
const storageKey = 'wbe-home-guide-v2'
let timer: number | undefined
let mounted = false
let attempted = false
const steps: OperationGuideStep[] = [
  {
    title: '空间分布查询',
    description: '按国家、地区或城市定位研究证据。',
    targetSelectors: ['#visual-map'],
    placement: 'bottom',
    scrollIntoView: true,
    scrollBlock: 'center',
  },
  {
    title: '疾病关联分析',
    description: '沿 ICD-11 层级查看疾病、药物和标记物关系。',
    targetSelectors: ['#visual-disease'],
    placement: 'bottom',
    scrollIntoView: true,
    scrollBlock: 'center',
  },
  {
    title: '标记物优先级评估',
    description: '比较候选因子的证据得分和优先顺序。',
    targetSelectors: ['#visual-priority'],
    placement: 'bottom',
    scrollIntoView: true,
    scrollBlock: 'center',
  },
  {
    title: '高频研究因子',
    description: '字号和数字对应 DOI 去重文献数，点击词条可查看因子详情。',
    targetSelectors: ['.factor-cloud-section'],
    placement: 'bottom',
    scrollIntoView: true,
    scrollBlock: 'center',
  },
  {
    title: '类别与标记物证据分布',
    description: '切换范围与子类，点击左侧类别，右侧展示相应标记物的研究数。',
    targetSelectors: ['.biomarker-panel-head', '.academic-evidence-heading'],
    placement: 'bottom',
    scrollIntoView: true,
    scrollBlock: 'center',
  },
  {
    title: '再次打开导览',
    description: '点击顶部的“首页导览”可以重新查看指引；手机上可点击同一位置的问号按钮。',
    targetSelectors: ['.platform-home-guide-button'],
    placement: 'bottom',
    scrollIntoView: true,
    scrollBlock: 'center',
  },
]
function start() {
  if (props.blocked) return
  step.value = 0
  open.value = true
}
function pause() {
  if (timer) window.clearTimeout(timer)
  timer = undefined
  open.value = false
}
defineExpose({ start, pause })

function finish() {
  open.value = false
  try {
    localStorage.setItem(storageKey, 'seen')
  } catch {
    /* Storage may be unavailable in a private session. */
  }
}
function schedule() {
  if (!mounted || attempted || !props.ready || props.blocked) return
  let seen = false
  try {
    seen = localStorage.getItem(storageKey) === 'seen'
  } catch {
    /* The tour still works without persistence. */
  }
  if (seen || window.location.hash) {
    attempted = true
    return
  }
  attempted = true
  timer = window.setTimeout(() => {
    if (!props.blocked) start()
  }, 900)
}
watch(open, (value) => emit('openChange', value))
watch(() => props.ready, schedule)
watch(() => props.blocked, (blocked) => {
  if (blocked) pause()
  else schedule()
})
onMounted(() => {
  mounted = true
  void nextTick(schedule)
})
onBeforeUnmount(() => {
  if (timer) window.clearTimeout(timer)
})
</script>
<template>
  <Teleport to="body">
    <OperationGuide
      class="home-operation-guide"
      variant="home"
      :open="open"
      :step="step"
      :steps="steps"
      :return-focus-to="returnFocusTo"
      @previous="step = Math.max(0, step - 1)"
      @next="step += 1"
      @skip="finish"
      @finish="finish"
    />
  </Teleport>
</template>
<style scoped>
.home-operation-guide {
  position: fixed;
  inset: 0;
  z-index: 1200;
  pointer-events: none;
}
:deep(.operation-guide__card) {
  pointer-events: auto;
}
:deep(.operation-guide__target),
:deep(.operation-guide__card),
:deep(.operation-guide__card button) {
  border-radius: 0;
}
</style>
