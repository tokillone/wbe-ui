<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const isPrototypeReady = ref(false)
const prototypeError = ref('')
const reloadKey = ref(0)
const prototypeFrame = ref<HTMLIFrameElement | null>(null)
const summary = ref<{
  rowCount?: number
  scoreVersion?: string
  targetFineGroupCount?: number
  sourceModifiedAt?: string
} | null>(null)
const publicBase = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`
const prototypeUrl = computed(
  () => `${publicBase}core-marker-priority/index.html?reload=${reloadKey.value}`,
)
const fineGroupCount = computed(() => summary.value?.targetFineGroupCount)
const dataDate = computed(() => summary.value?.sourceModifiedAt?.split(' ')[0])

function handlePrototypeLoad() {
  isPrototypeReady.value = true
}

function handlePrototypeError() {
  isPrototypeReady.value = false
  prototypeError.value = '分析页面加载失败，请检查网络后重试。'
}

function retryPrototype() {
  prototypeError.value = ''
  isPrototypeReady.value = false
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
    summary.value = event.data.summary ?? null
    prototypeError.value = ''
  } else if (event.data.type === 'core-marker-priority:error') {
    prototypeError.value = String(event.data.message || '核心标记物数据加载失败，请重试。')
  }
}

onMounted(() => window.addEventListener('message', handlePrototypeMessage))
onBeforeUnmount(() => window.removeEventListener('message', handlePrototypeMessage))
</script>

<template>
  <main class="priority-page">
    <header class="platform-header">
      <RouterLink class="brand" to="/" aria-label="返回污水信息因子数据库首页">
        <span class="brand-logo" aria-hidden="true">
          <span class="brand-drop"></span>
          <span class="brand-bars"><i></i><i></i><i></i></span>
          <span class="brand-line"><i></i><i></i></span>
        </span>
        <span class="brand-copy">
          <strong>污水信息因子数据库</strong>
          <small>Wastewater Biomarker Evidence</small>
        </span>
      </RouterLink>

      <div class="module-heading">
        <span>分析模块</span>
        <strong>核心标记物优先级识别</strong>
      </div>

      <nav class="module-nav" aria-label="模块导航">
        <RouterLink to="/map-visualization">空间分布</RouterLink>
        <RouterLink to="/icd11-sankey">ICD11 桑基图</RouterLink>
        <RouterLink class="home-link" to="/" aria-label="返回首页">
          <span aria-hidden="true">←</span>
          返回首页
        </RouterLink>
      </nav>
    </header>

    <section class="module-status" aria-label="模块状态">
      <div>
        <span class="status-dot" aria-hidden="true"></span>
        <strong>优先级证据分析</strong>
        <span>四级分类分别进行组内评分与相对优先级识别</span>
      </div>
      <div class="status-metrics" aria-label="数据概览">
        <span><b>{{ summary?.rowCount ?? '—' }}</b> 核心标记物</span>
        <span><b>{{ fineGroupCount ?? '—' }}</b> 目标物质细类组</span>
        <span>{{ dataDate ? `数据更新 ${dataDate}` : '数据源：后端 API' }}</span>
      </div>
    </section>

    <section class="prototype-shell" aria-label="核心标记物优先级分析工作区">
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
        title="核心标记物优先级识别交互分析"
        @load="handlePrototypeLoad"
        @error="handlePrototypeError"
      ></iframe>
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
  font-family: Inter, 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif;
}

.priority-page {
  height: 100vh;
  height: 100dvh;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
  background: #eef3f6;
}

.platform-header {
  position: relative;
  z-index: 2;
  min-height: 72px;
  display: grid;
  grid-template-columns: minmax(250px, auto) minmax(240px, 1fr) auto;
  align-items: center;
  gap: 24px;
  padding: 12px clamp(18px, 3.4vw, 54px);
  border-bottom: 1px solid rgba(96, 124, 143, 0.24);
  background: #ffffff;
  box-shadow: 0 8px 28px rgba(21, 52, 72, 0.08);
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

.module-heading span {
  color: #0b7868;
  font-size: 11px;
  font-weight: 900;
}

.module-heading strong {
  overflow: hidden;
  color: #173247;
  font-size: 18px;
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
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
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

.module-status {
  position: relative;
  z-index: 1;
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 8px clamp(18px, 3.4vw, 54px);
  border-bottom: 1px solid #ccd6df;
  background: #f7fafb;
  color: #607684;
  font-size: 12px;
}

.module-status > div,
.status-metrics {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.module-status strong,
.status-metrics b {
  color: #173247;
}

.status-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #0b7868;
  box-shadow: 0 0 0 3px rgba(11, 120, 104, 0.12);
}

.status-metrics span {
  padding-left: 10px;
  border-left: 1px solid #d3dce4;
  white-space: nowrap;
}

.prototype-shell {
  position: relative;
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
    padding: 10px 14px;
  }

  .brand-logo {
    width: 40px;
    height: 40px;
  }

  .brand-copy small,
  .module-heading,
  .module-status > div > span:last-child,
  .status-metrics span:nth-child(n + 2) {
    display: none;
  }

  .module-nav .home-link {
    min-height: 36px;
    padding: 0 10px;
  }

  .module-status {
    min-height: 38px;
    padding: 7px 14px;
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
  .prototype-frame,
  .module-nav a {
    transition: none;
  }

  .loading-state span {
    animation: none;
  }
}
</style>
