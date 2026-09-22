<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'

interface AnalysisModule {
  icon: string
  title: string
  value: string
  route: string
}

interface ModuleDetail {
  id: string
  description: string
  action: string
  image: string
  poster: string
  alt: string
  steps: string[]
}

const props = defineProps<{ modules: AnalysisModule[] }>()

const emit = defineEmits<{
  preload: [route: string]
}>()

const moduleDetails: Record<string, ModuleDetail> = {
  '/map-visualization': {
    id: 'visual-map',
    description: '从国家到城市定位研究证据，并比较人群归一化负荷。',
    action: '进入空间分析',
    image: '/academic-home/gifs/map-usage.gif',
    poster: '/academic-home/posters/map-usage.webp',
    alt: '从空间总览切换到卡马西平彩色研究热区的操作演示',
    steps: ['选择范围', '确认标记物', '查看热区'],
  },
  '/icd11-sankey': {
    id: 'visual-disease',
    description: '沿 ICD-11 层级追踪疾病、药物与生物标记物的证据路径。',
    action: '进入关联分析',
    image: '/academic-home/gifs/sankey-usage.gif',
    poster: '/academic-home/posters/sankey-usage.webp',
    alt: '从疾病范围总览切换到代表性桑基路径的操作演示',
    steps: ['选择疾病层级', '定位节点', '追踪流带'],
  },
  '/core-marker-priority': {
    id: 'visual-priority',
    description: '用分层证据评分识别核心标记物，并定位证据缺口。',
    action: '进入优先级评估',
    image: '/academic-home/gifs/priority-usage.gif',
    poster: '/academic-home/posters/priority-usage.webp',
    alt: '从目标类别筛选切换到标记物优先级排名的操作演示',
    steps: ['选择目标类别', '比较评分', '查看排名'],
  },
}

const moduleItems = computed(() =>
  props.modules.flatMap((module) => {
    const detail = moduleDetails[module.route]
    return detail ? [{ module, detail }] : []
  }),
)

const activeDemoIndex = ref<number | null>(null)
const demoRun = ref(0)

function isDemoActive(index: number) {
  return activeDemoIndex.value === index
}

function activateDemo(index: number, route: string) {
  if (activeDemoIndex.value !== index) {
    activeDemoIndex.value = index
    demoRun.value += 1
  }
  emit('preload', route)
}

function deactivateDemo(index: number) {
  if (activeDemoIndex.value === index) activeDemoIndex.value = null
}

function demoImage(entry: ModuleDetail, index: number) {
  return isDemoActive(index) ? `${entry.image}?run=${demoRun.value}` : entry.poster
}
</script>

<template>
  <section id="visual-entry" class="academic-modules" aria-labelledby="modulesTitle">
    <div class="academic-modules-inner">
      <header class="academic-modules-heading">
        <div>
          <p>01 / ANALYSIS</p>
          <h2 id="modulesTitle">按研究问题选择分析工具</h2>
        </div>
      </header>

      <div class="academic-module-grid">
        <RouterLink
          v-for="(entry, index) in moduleItems"
          :id="entry.detail.id"
          :key="entry.module.title"
          class="academic-module"
          :class="{ 'is-demo-active': isDemoActive(index) }"
          :to="entry.module.route"
          :aria-label="`${entry.module.title}。${entry.detail.description}`"
          @pointerenter="activateDemo(index, entry.module.route)"
          @pointerleave="deactivateDemo(index)"
          @focus="activateDemo(index, entry.module.route)"
          @blur="deactivateDemo(index)"
        >
          <header class="academic-module-head">
            <span class="academic-module-index" aria-hidden="true">0{{ index + 1 }}</span>
            <h3>{{ entry.module.title }}</h3>
          </header>

          <figure class="academic-module-visual">
            <div class="academic-module-preview">
              <picture>
                <source media="(prefers-reduced-motion: reduce)" :srcset="entry.detail.poster" />
                <img
                  :key="`${entry.module.route}-${isDemoActive(index) ? demoRun : 'poster'}`"
                  :src="demoImage(entry.detail, index)"
                  :alt="entry.detail.alt"
                  loading="lazy"
                  decoding="async"
                />
              </picture>
              <span
                class="academic-module-demo-pointer"
                :class="`is-pointer-${index + 1}`"
                aria-hidden="true"
              ></span>
            </div>
          </figure>

          <ol class="academic-module-steps" aria-label="基本使用步骤">
            <li v-for="(step, stepIndex) in entry.detail.steps" :key="step">
              <span aria-hidden="true">{{ stepIndex + 1 }}</span>
              {{ step }}
            </li>
          </ol>

          <div class="academic-module-copy">
            <p>{{ entry.detail.description }}</p>
            <span class="academic-module-action">
              <span>{{ entry.detail.action }}</span>
              <i aria-hidden="true">→</i>
            </span>
          </div>
        </RouterLink>
      </div>
    </div>
  </section>
</template>

<style scoped>
.academic-modules {
  position: relative;
  z-index: 1;
  color: #ffffff;
  background: #176ca7;
  scroll-margin-top: 92px;
}

.academic-modules-inner {
  width: min(calc(100% - 48px), 1260px);
  margin: 0 auto;
  padding: 78px 0 88px;
}

.academic-modules-heading {
  display: block;
  margin-bottom: 42px;
}

.academic-modules-heading p {
  margin: 0 0 17px;
  color: #cce8f7;
  font-size: 12px;
  font-weight: 760;
  letter-spacing: 0.16em;
}

.academic-modules-heading h2 {
  max-width: 14em;
  margin: 0;
  font-size: clamp(36px, 3.2vw, 46px);
  font-weight: 700;
  letter-spacing: -0.045em;
  line-height: 1.16;
  text-wrap: balance;
}

.academic-module-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  overflow: hidden;
  color: #13344d;
  background: #f6fafc;
  border: 1px solid rgba(210, 226, 235, 0.92);
  border-radius: 3px;
  box-shadow: 0 24px 64px rgba(5, 40, 65, 0.2);
}

.academic-module {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: clamp(22px, 2.1vw, 30px);
  color: inherit;
  text-decoration: none;
  scroll-margin-top: 104px;
  transition: background-color 220ms ease;
}

.academic-module::after {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 1px;
  content: '';
  background: #d3e2eb;
}

.academic-module:last-child::after {
  display: none;
}

.academic-module-head {
  width: 100%;
  min-height: 70px;
  display: flex;
  align-items: baseline;
  gap: 13px;
  padding-bottom: 20px;
}

.academic-module-index {
  color: #2d79aa;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.academic-module-copy {
  min-height: 114px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  flex: 1 1 auto;
}

.academic-module h3 {
  margin: 0;
  color: #0c2d46;
  font-size: clamp(22px, 1.85vw, 27px);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.2;
  transition: color 180ms ease;
}

.academic-module-copy > p {
  min-height: 50px;
  margin: 16px 0 20px;
  color: #597487;
  font-size: 14px;
  line-height: 1.75;
  text-wrap: pretty;
}

.academic-module-action {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding-bottom: 7px;
  color: #176ca7;
  font-size: 14px;
  font-weight: 700;
}

.academic-module-action::before,
.academic-module-action::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 1px;
  content: '';
  background: #b9d3e3;
}

.academic-module-action::after {
  background: #176ca7;
  transform: scaleX(0.24);
  transform-origin: left;
  transition: transform 220ms ease;
}

.academic-module-action i {
  font-size: 18px;
  font-style: normal;
  font-weight: 500;
  transition: transform 180ms ease;
}

.academic-module-visual {
  width: 100%;
  margin: 0;
}

.academic-module-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border: 1px solid #c9dce7;
  border-radius: 2px;
  background: #fff;
  box-shadow: 0 11px 28px rgba(16, 60, 88, 0.13);
  transition:
    transform 260ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 260ms ease;
}

.academic-module-preview::before {
  position: absolute;
  inset: 0;
  z-index: 1;
  content: '';
  pointer-events: none;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.68);
}

.academic-module-preview picture,
.academic-module-preview img {
  width: 100%;
  height: 100%;
  display: block;
}

.academic-module-preview img {
  object-fit: cover;
  filter: saturate(0.86) contrast(1.01) brightness(1.015);
}

.academic-module-demo-pointer {
  position: absolute;
  z-index: 3;
  width: 19px;
  height: 25px;
  display: block;
  opacity: 0;
  background: #0b3552;
  clip-path: polygon(0 0, 0 84%, 28% 65%, 44% 100%, 62% 91%, 46% 59%, 82% 57%);
  filter: drop-shadow(0 4px 5px rgba(7, 43, 67, 0.28));
  pointer-events: none;
  transform: translate(-15%, -10%);
}

.academic-module-demo-pointer::after {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 19px;
  content: '';
  background: #ffffff;
  clip-path: inherit;
}

.academic-module.is-demo-active .academic-module-demo-pointer.is-pointer-1 {
  animation: academic-demo-pointer-map 3s cubic-bezier(0.22, 1, 0.36, 1) 1 both;
}

.academic-module.is-demo-active .academic-module-demo-pointer.is-pointer-2 {
  animation: academic-demo-pointer-sankey 3s cubic-bezier(0.22, 1, 0.36, 1) 1 both;
}

.academic-module.is-demo-active .academic-module-demo-pointer.is-pointer-3 {
  animation: academic-demo-pointer-priority 3s cubic-bezier(0.22, 1, 0.36, 1) 1 both;
}

.academic-module-steps {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 12px 0 0;
  padding: 12px 0;
  list-style: none;
  border-top: 1px solid #dce8ef;
  border-bottom: 1px solid #dce8ef;
  color: #385a70;
  font-size: 11px;
  font-weight: 600;
}

.academic-module-steps li {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.academic-module-steps li + li::before {
  margin-right: 2px;
  color: #8ba8ba;
  content: '→';
  font-weight: 400;
}

.academic-module-steps li > span {
  color: #2d79aa;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.academic-module:hover h3,
.academic-module:focus-visible h3 {
  color: #176ca7;
}

.academic-module:hover .academic-module-action::after,
.academic-module:focus-visible .academic-module-action::after {
  transform: scaleX(1);
}

.academic-module:hover .academic-module-action i,
.academic-module:focus-visible .academic-module-action i {
  transform: translateX(4px);
}

.academic-module:hover,
.academic-module:focus-visible {
  background: #ffffff;
}

.academic-module:hover .academic-module-preview,
.academic-module:focus-visible .academic-module-preview {
  transform: translateY(-4px);
  box-shadow: 0 17px 36px rgba(16, 60, 88, 0.18);
}

.academic-module:focus-visible {
  z-index: 2;
  outline: 3px solid rgba(255, 255, 255, 0.9);
  outline-offset: -3px;
}

@keyframes academic-demo-pointer-map {
  0% {
    left: 7%;
    top: 18%;
    opacity: 0;
    transform: translate(-15%, -10%) scale(0.94);
  }

  7% {
    left: 7%;
    top: 18%;
    opacity: 1;
    transform: translate(-15%, -10%) scale(1);
  }

  25% {
    left: 15%;
    top: 32%;
    opacity: 1;
    transform: translate(-15%, -10%) scale(1);
  }

  31% {
    left: 15%;
    top: 32%;
    opacity: 1;
    transform: translate(-15%, -10%) scale(0.82);
  }

  38%,
  100% {
    left: 15%;
    top: 32%;
    opacity: 0;
    transform: translate(-15%, -10%) scale(1);
  }
}

@keyframes academic-demo-pointer-sankey {
  0% {
    left: 49%;
    top: 20%;
    opacity: 0;
    transform: translate(-15%, -10%) scale(0.94);
  }

  7% {
    left: 49%;
    top: 20%;
    opacity: 1;
    transform: translate(-15%, -10%) scale(1);
  }

  25% {
    left: 63%;
    top: 38%;
    opacity: 1;
    transform: translate(-15%, -10%) scale(1);
  }

  31% {
    left: 63%;
    top: 38%;
    opacity: 1;
    transform: translate(-15%, -10%) scale(0.82);
  }

  38%,
  100% {
    left: 63%;
    top: 38%;
    opacity: 0;
    transform: translate(-15%, -10%) scale(1);
  }
}

@keyframes academic-demo-pointer-priority {
  0% {
    left: 18%;
    top: 20%;
    opacity: 0;
    transform: translate(-15%, -10%) scale(0.94);
  }

  7% {
    left: 18%;
    top: 20%;
    opacity: 1;
    transform: translate(-15%, -10%) scale(1);
  }

  25% {
    left: 37%;
    top: 54%;
    opacity: 1;
    transform: translate(-15%, -10%) scale(1);
  }

  31% {
    left: 37%;
    top: 54%;
    opacity: 1;
    transform: translate(-15%, -10%) scale(0.82);
  }

  38%,
  100% {
    left: 37%;
    top: 54%;
    opacity: 0;
    transform: translate(-15%, -10%) scale(1);
  }
}

@media (max-width: 920px) and (min-width: 721px) {
  .academic-module {
    padding: 20px 18px 24px;
  }

  .academic-module h3 {
    font-size: 21px;
  }

  .academic-module-copy {
    min-height: 128px;
  }

  .academic-module-steps {
    align-items: flex-start;
    flex-direction: column;
  }

  .academic-module-steps li + li::before {
    content: none;
  }
}

@media (max-width: 720px) {
  .academic-modules-inner {
    width: min(calc(100% - 36px), 1200px);
    padding: 62px 0 56px;
  }

  .academic-modules-heading {
    margin-bottom: 28px;
  }

  .academic-modules-heading h2 {
    font-size: clamp(32px, 9vw, 38px);
  }

  .academic-module-grid {
    grid-template-columns: 1fr;
    overflow: visible;
    background: transparent;
    border-right: 0;
    border-left: 0;
    box-shadow: none;
  }

  .academic-module,
  .academic-module:first-child,
  .academic-module:last-child {
    min-height: 0;
    padding: 28px 22px 34px;
    background: #f6fafc;
    border-top: 1px solid #d3e2eb;
  }

  .academic-module::after {
    display: none;
  }

  .academic-module-index {
    font-size: 14px;
  }

  .academic-module-head {
    min-height: 0;
    padding-bottom: 18px;
  }

  .academic-module-copy {
    min-height: 0;
  }

  .academic-module-copy > p {
    min-height: 0;
    margin: 12px 0 19px;
  }

  .academic-module-visual {
    max-width: 560px;
  }

  .academic-module-steps {
    align-items: center;
    flex-direction: row;
  }

  .academic-module-steps li + li::before {
    content: '→';
  }
}

@media (prefers-reduced-motion: reduce) {
  .academic-module h3,
  .academic-module-action::after,
  .academic-module-action i,
  .academic-module-preview,
  .academic-module {
    transition: none;
  }

  .academic-module-demo-pointer {
    display: none;
  }
}
</style>
