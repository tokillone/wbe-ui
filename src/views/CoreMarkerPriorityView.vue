<script setup lang="ts">
import { pinyin } from 'pinyin-pro'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import OperationGuide, { type OperationGuideStep } from '../components/OperationGuide.vue'
import PlatformHeader from '../components/PlatformHeader.vue'

const CORE_MARKER_OPERATION_GUIDE_STORAGE_KEY = 'wbe:core-marker-priority-operation-guide:v1'
const CORE_MARKER_OPERATION_GUIDE_DELAY_MS = 600
const CORE_MARKER_OPERATION_GUIDE_STEPS: OperationGuideStep[] = [
  {
    title: '使用全库搜索快速定位',
    description: '可按中文、英文、拼音、ATC 或 CAS 搜索分类层级和候选生物标记物。',
    targetSelectors: ['.filter-guide-toolbar'],
    placement: 'bottom',
    scrollIntoView: true,
    scrollBlock: 'start',
  },
  {
    title: '查看并修改四级筛选路径',
    description: '筛选路径会依次记录目标类别、物质类别、物质子类和物质细类，已完成步骤可点击修改。',
    targetSelectors: ['#guideSteps'],
    placement: 'bottom',
    scrollIntoView: true,
    scrollBlock: 'start',
  },
  {
    title: '通过分组条形逐层下钻',
    description: '单击任意分组条形进入下一层；完成第四层后会定位到对应标记物排名。',
    targetSelectors: ['#guidePrompt', '.group-chart-legend'],
    placement: 'bottom',
    scrollIntoView: true,
    scrollBlock: 'center',
  },
  {
    title: '调整排名范围和展示方式',
    description: '选择排名层级，并在排名图与明细表之间切换，查看当前筛选范围内的全部候选项。',
    targetSelectors: ['.ranking-head', '.ranking-toolbar'],
    placement: 'bottom',
    scrollIntoView: true,
    scrollBlock: 'center',
  },
  {
    title: '查看得分构成与详细证据',
    description:
      '查看五项得分构成，单击候选标记物打开详情；底部“计算规则”可核对评分、排名和分层口径。',
    targetSelectors: ['.ranking-chart-legend', '#rankingAxisHead'],
    placement: 'bottom',
    scrollIntoView: true,
    scrollBlock: 'center',
  },
]

const isPrototypeReady = ref(false)
const isPrototypeDataReady = ref(false)
const prototypeError = ref('')
const reloadKey = ref(0)
const prototypeFrame = ref<HTMLIFrameElement | null>(null)
const coreMarkerGuideButton = ref<HTMLButtonElement | null>(null)
const coreMarkerGuideOpen = ref(false)
const coreMarkerGuideStep = ref(0)
const coreMarkerGuideSeen = ref(readCoreMarkerOperationGuideSeen())
const coreMarkerGuideSuppressedForVisit = ref(false)
const coreMarkerGuideShownThisVisit = ref(false)
type PinyinAliases = { full: string; initials: string }
type PriorityWindow = Window & { __wbePinyin?: (value: string) => PinyinAliases }
const priorityWindow = window as PriorityWindow
const route = useRoute()
const publicBase = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`
const prototypeUrl = computed(() => {
  const params = new URLSearchParams({ reload: String(reloadKey.value) })
  if (route.query.ui === 'refresh') params.set('ui', 'refresh')
  if (route.query.ui === 'preserve-v2') {
    params.set('ui', 'preserve-v2')
    const requestedVariant = String(route.query.variant ?? 'standard')
    params.set(
      'variant',
      ['standard', 'dense', 'paper'].includes(requestedVariant) ? requestedVariant : 'standard',
    )
  }
  return `${publicBase}core-marker-priority/index.html?${params.toString()}`
})
const prototypeTargetDocument = computed(() =>
  isPrototypeReady.value ? (prototypeFrame.value?.contentDocument ?? null) : null,
)

let coreMarkerGuideTimer: number | undefined
let observedPrototypeDocument: Document | null = null
let prototypeScrollSnapshot: { left: number; top: number } | null = null

function handlePrototypeLoad() {
  isPrototypeReady.value = true
  isPrototypeDataReady.value = false
  void nextTick(bindPrototypeInteractionListeners)
}

function handlePrototypeError() {
  clearCoreMarkerGuideTimer()
  closeCoreMarkerOperationGuide()
  isPrototypeReady.value = false
  isPrototypeDataReady.value = false
  prototypeError.value = '分析页面加载失败，请检查网络后重试。'
}

function retryPrototype() {
  clearCoreMarkerGuideTimer()
  closeCoreMarkerOperationGuide()
  unbindPrototypeInteractionListeners()
  prototypeError.value = ''
  isPrototypeReady.value = false
  isPrototypeDataReady.value = false
  reloadKey.value += 1
}

function handlePrototypeMessage(event: MessageEvent) {
  if (
    event.origin !== window.location.origin ||
    event.source !== prototypeFrame.value?.contentWindow ||
    typeof event.data !== 'object' ||
    event.data === null
  ) {
    return
  }
  if (event.data.type === 'core-marker-priority:ready') {
    prototypeError.value = ''
    isPrototypeDataReady.value = true
    scheduleCoreMarkerOperationGuide()
  } else if (event.data.type === 'core-marker-priority:error') {
    clearCoreMarkerGuideTimer()
    isPrototypeDataReady.value = false
    prototypeError.value = '核心标记物数据加载失败，请稍后重试。'
  }
}

function readCoreMarkerOperationGuideSeen() {
  if (typeof window === 'undefined') return false
  try {
    return Boolean(window.localStorage.getItem(CORE_MARKER_OPERATION_GUIDE_STORAGE_KEY))
  } catch {
    return false
  }
}

function markCoreMarkerOperationGuideSeen() {
  coreMarkerGuideSeen.value = true
  try {
    window.localStorage.setItem(CORE_MARKER_OPERATION_GUIDE_STORAGE_KEY, 'shown')
  } catch {
    // The in-memory flag still prevents repeated automatic display during this visit.
  }
}

function clearCoreMarkerGuideTimer() {
  if (coreMarkerGuideTimer == null) return
  window.clearTimeout(coreMarkerGuideTimer)
  coreMarkerGuideTimer = undefined
}

function canAutoOpenCoreMarkerGuide() {
  return (
    isPrototypeReady.value &&
    isPrototypeDataReady.value &&
    Boolean(prototypeTargetDocument.value) &&
    !coreMarkerGuideSeen.value &&
    !coreMarkerGuideSuppressedForVisit.value &&
    !coreMarkerGuideShownThisVisit.value
  )
}

function scheduleCoreMarkerOperationGuide() {
  clearCoreMarkerGuideTimer()
  if (!canAutoOpenCoreMarkerGuide()) return
  coreMarkerGuideTimer = window.setTimeout(() => {
    coreMarkerGuideTimer = undefined
    if (!canAutoOpenCoreMarkerGuide()) return
    void openCoreMarkerOperationGuide('auto')
  }, CORE_MARKER_OPERATION_GUIDE_DELAY_MS)
}

function handlePrototypeInteraction() {
  if (coreMarkerGuideOpen.value || coreMarkerGuideShownThisVisit.value) return
  coreMarkerGuideSuppressedForVisit.value = true
  clearCoreMarkerGuideTimer()
}

function unbindPrototypeInteractionListeners() {
  observedPrototypeDocument?.removeEventListener('pointerdown', handlePrototypeInteraction, true)
  observedPrototypeDocument?.removeEventListener('keydown', handlePrototypeInteraction, true)
  observedPrototypeDocument = null
}

function bindPrototypeInteractionListeners() {
  const targetDocument = prototypeFrame.value?.contentDocument ?? null
  if (targetDocument === observedPrototypeDocument) return
  unbindPrototypeInteractionListeners()
  observedPrototypeDocument = targetDocument
  targetDocument?.addEventListener('pointerdown', handlePrototypeInteraction, true)
  targetDocument?.addEventListener('keydown', handlePrototypeInteraction, true)
}

async function openCoreMarkerOperationGuide(source: 'auto' | 'manual' = 'manual') {
  const frame = prototypeFrame.value
  const targetDocument = frame?.contentDocument
  if (coreMarkerGuideOpen.value || !frame || !targetDocument || !isPrototypeDataReady.value) {
    return
  }
  clearCoreMarkerGuideTimer()
  if (source === 'auto') {
    coreMarkerGuideShownThisVisit.value = true
    markCoreMarkerOperationGuideSeen()
  }
  const frameWindow = frame.contentWindow
  prototypeScrollSnapshot = {
    left: frameWindow?.scrollX ?? 0,
    top: frameWindow?.scrollY ?? 0,
  }
  frameWindow?.postMessage({ type: 'core-marker-priority:prepare-guide' }, window.location.origin)
  coreMarkerGuideStep.value = 0
  await nextTick()
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  coreMarkerGuideOpen.value = true
}

function closeCoreMarkerOperationGuide() {
  coreMarkerGuideOpen.value = false
  const snapshot = prototypeScrollSnapshot
  prototypeScrollSnapshot = null
  const frameWindow = prototypeFrame.value?.contentWindow
  if (!snapshot || !frameWindow) return
  void nextTick(() =>
    frameWindow.scrollTo({ left: snapshot.left, top: snapshot.top, behavior: 'auto' }),
  )
}

function previousCoreMarkerGuideStep() {
  coreMarkerGuideStep.value = Math.max(0, coreMarkerGuideStep.value - 1)
}

function nextCoreMarkerGuideStep() {
  coreMarkerGuideStep.value = Math.min(
    CORE_MARKER_OPERATION_GUIDE_STEPS.length - 1,
    coreMarkerGuideStep.value + 1,
  )
}

function createPinyinAliases(value: string): PinyinAliases {
  const options = { toneType: 'none', type: 'array' } as const
  return {
    full: pinyin(value, options).join('').toLowerCase(),
    initials: pinyin(value, { ...options, pattern: 'first' })
      .join('')
      .toLowerCase(),
  }
}

onMounted(() => {
  priorityWindow.__wbePinyin = createPinyinAliases
  window.addEventListener('message', handlePrototypeMessage)
})
onBeforeUnmount(() => {
  clearCoreMarkerGuideTimer()
  unbindPrototypeInteractionListeners()
  delete priorityWindow.__wbePinyin
  window.removeEventListener('message', handlePrototypeMessage)
})
</script>

<template>
  <main class="priority-page">
    <PlatformHeader active="priority" />

    <section
      id="main-content"
      class="prototype-shell"
      aria-label="标记物优先级评估分析工作区"
      tabindex="-1"
    >
      <button
        v-if="isPrototypeDataReady"
        ref="coreMarkerGuideButton"
        class="priority-operation-guide-button"
        type="button"
        aria-label="操作指引"
        title="操作指引"
        @click="openCoreMarkerOperationGuide('manual')"
      >
        <span aria-hidden="true">?</span>
      </button>
      <div v-if="!isPrototypeReady && !prototypeError" class="loading-state" role="status">
        <span></span>
        <strong>正在载入优先级分析数据</strong>
      </div>
      <div v-if="prototypeError" class="loading-state error-state" role="alert">
        <strong>模块暂时不可用</strong>
        <p>{{ prototypeError }}</p>
        <button type="button" @click="retryPrototype">重新加载</button>
      </div>
      <iframe
        ref="prototypeFrame"
        :key="reloadKey"
        class="prototype-frame"
        :class="{ ready: isPrototypeReady }"
        :src="prototypeUrl"
        title="标记物优先级评估交互分析"
        @load="handlePrototypeLoad"
        @error="handlePrototypeError"
      ></iframe>

      <OperationGuide
        :open="coreMarkerGuideOpen"
        :step="coreMarkerGuideStep"
        :steps="CORE_MARKER_OPERATION_GUIDE_STEPS"
        :target-document="prototypeTargetDocument"
        :target-frame="prototypeFrame"
        :return-focus-to="coreMarkerGuideButton"
        @previous="previousCoreMarkerGuideStep"
        @next="nextCoreMarkerGuideStep"
        @skip="closeCoreMarkerOperationGuide"
        @finish="closeCoreMarkerOperationGuide"
      />
    </section>
  </main>
</template>

<style scoped>
:global(*) {
  box-sizing: border-box;
}

:global(html),
:global(body),
:global(#app) {
  min-width: 320px;
  min-height: 100%;
  margin: 0;
}

:global(body) {
  color: #172b3a;
  background: #eef3f6;
  font-family: var(--platform-font-family, 'Microsoft YaHei', '微软雅黑', Arial, sans-serif);
}

.priority-page {
  position: relative;
  height: 100vh;
  height: 100dvh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  background: #eef3f6;
}

.platform-header {
  position: absolute;
  inset: 0 0 auto;
  z-index: 2;
  width: 100%;
  min-height: 72px;
  display: grid;
  grid-template-columns: minmax(250px, auto) minmax(240px, 1fr) auto;
  align-items: center;
  gap: 24px;
  padding: 12px clamp(18px, 3.4vw, 54px);
  border-bottom: 1px solid rgba(96, 124, 143, 0.24);
  background: #ffffff;
  box-shadow: 0 8px 28px rgba(21, 52, 72, 0.08);
  opacity: var(--priority-header-opacity, 1);
  transition:
    opacity 0.45s ease,
    box-shadow 0.45s ease;
  will-change: opacity;
}

.platform-header.is-hidden {
  pointer-events: none;
  box-shadow: none;
}

.brand {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 11px;
  color: #132e3f;
  text-decoration: none;
}

.brand-logo {
  position: relative;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  display: block;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.76);
  border-radius: 8px;
  background: linear-gradient(135deg, #0f6591, #0e8f77);
  box-shadow: 0 12px 26px rgba(15, 101, 145, 0.19);
}

.brand-drop {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 19px;
  height: 19px;
  border: 2px solid rgba(255, 255, 255, 0.92);
  border-radius: 60% 60% 62% 10%;
  background: rgba(255, 255, 255, 0.13);
  transform: rotate(-45deg);
}

.brand-bars {
  position: absolute;
  right: 8px;
  bottom: 9px;
  height: 18px;
  display: inline-flex;
  align-items: end;
  gap: 3px;
}

.brand-bars i {
  width: 4px;
  border-radius: 4px 4px 2px 2px;
  background: rgba(255, 255, 255, 0.94);
}

.brand-bars i:nth-child(1) {
  height: 8px;
}

.brand-bars i:nth-child(2) {
  height: 14px;
}

.brand-bars i:nth-child(3) {
  height: 11px;
}

.brand-line {
  position: absolute;
  right: 7px;
  bottom: 26px;
  width: 20px;
  height: 10px;
  border-top: 2px solid rgba(198, 237, 232, 0.95);
  border-right: 2px solid rgba(198, 237, 232, 0.95);
  transform: skewX(-18deg) rotate(-9deg);
}

.brand-line i {
  position: absolute;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #ffffff;
}

.brand-line i:first-child {
  top: -4px;
  left: -2px;
}

.brand-line i:last-child {
  right: -4px;
  bottom: -3px;
}

.brand-copy {
  min-width: 0;
}

.brand-copy strong,
.brand-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brand-copy strong {
  font-size: 16px;
  line-height: 1.25;
}

.brand-copy small {
  margin-top: 3px;
  color: #697d8a;
  font-size: 10px;
}

.module-heading {
  min-width: 0;
  display: grid;
  justify-items: center;
  gap: 2px;
}

.module-heading strong {
  overflow: hidden;
  color: #173247;
  font-size: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.module-heading small {
  overflow: hidden;
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.module-nav {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.module-nav a {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 11px;
  border: 1px solid rgba(95, 124, 143, 0.18);
  border-radius: 7px;
  color: #385466;
  background: #f8fbfc;
  font-size: 13px;
  font-weight: 800;
  text-decoration: none;
  white-space: nowrap;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    transform 0.18s ease;
}

.module-nav a:hover,
.module-nav a:focus-visible {
  border-color: rgba(14, 143, 119, 0.48);
  background: #eef8f6;
  outline: none;
  transform: translateY(-1px);
}

.module-nav .home-link {
  color: #ffffff;
  border-color: #173247;
  background: #173247;
}

.prototype-shell {
  position: relative;
  height: auto;
  min-height: 0;
  overflow: hidden;
  background: #f3f5f7;
}

.prototype-frame {
  width: 100%;
  height: 100%;
  display: block;
  border: 0;
  opacity: 0;
  background: #f3f5f7;
  transition: opacity 0.2s ease;
}

.prototype-frame.ready {
  opacity: 1;
}

.priority-operation-guide-button {
  position: absolute;
  z-index: 4;
  top: 20px;
  right: 7px;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid #aeb9c6;
  border-radius: 6px;
  color: #3e566b;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 5px 16px rgba(21, 52, 72, 0.12);
  font: inherit;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
}

.priority-operation-guide-button:hover,
.priority-operation-guide-button:focus-visible {
  border-color: #5f84b3;
  color: #24558d;
  background: #eef4ff;
  outline: 2px solid rgba(37, 102, 212, 0.14);
  outline-offset: 2px;
}

.loading-state {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 14px;
  color: #506a7c;
  background: #f3f5f7;
}

.loading-state span {
  width: 32px;
  height: 32px;
  border: 3px solid #cbd8df;
  border-top-color: #0f6591;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.loading-state strong {
  font-size: 13px;
}

.loading-state p {
  max-width: min(520px, calc(100vw - 40px));
  margin: 0;
  color: #6b7e8b;
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}

.loading-state button {
  min-height: 38px;
  padding: 0 16px;
  border: 1px solid #0f6591;
  border-radius: 6px;
  color: #ffffff;
  background: #0f6591;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.error-state {
  color: #8a332d;
  background: #fff8f7;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1180px) {
  .platform-header {
    grid-template-columns: minmax(230px, auto) minmax(220px, 1fr) auto;
    gap: 14px;
  }

  .module-nav > a:not(.home-link) {
    display: none;
  }
}

@media (max-width: 760px) {
  .platform-header {
    min-height: 64px;
    grid-template-columns: minmax(0, 1fr) auto;
    padding: 9px 14px;
  }

  .brand-logo {
    width: 40px;
    height: 40px;
  }

  .brand-copy small,
  .module-heading {
    display: none;
  }

  .module-nav .home-link {
    min-height: 36px;
    padding: 0 10px;
  }

  .priority-operation-guide-button {
    position: fixed;
    z-index: 72;
    top: auto;
    right: 14px;
    bottom: max(14px, env(safe-area-inset-bottom));
    border-radius: 50%;
    box-shadow: 0 7px 20px rgba(21, 52, 72, 0.18);
  }
}

@media (max-width: 430px) {
  .brand-copy strong {
    max-width: 150px;
    font-size: 14px;
  }

  .home-link {
    font-size: 0;
  }

  .home-link span {
    font-size: 18px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .platform-header,
  .prototype-frame,
  .module-nav a {
    transition: none;
  }

  .loading-state span {
    animation: none;
  }
}
</style>
