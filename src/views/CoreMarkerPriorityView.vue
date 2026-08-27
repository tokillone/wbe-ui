<script setup lang="ts">
import { pinyin } from 'pinyin-pro'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import PlatformHeader from '../components/PlatformHeader.vue'

const isPrototypeReady = ref(false)
const prototypeError = ref('')
const reloadKey = ref(0)
const prototypeFrame = ref<HTMLIFrameElement | null>(null)
type PinyinAliases = { full: string; initials: string }
type PriorityWindow = Window & { __wbePinyin?: (value: string) => PinyinAliases }
const priorityWindow = window as PriorityWindow
const publicBase = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`
const prototypeUrl = computed(
  () => `${publicBase}core-marker-priority/index.html?reload=${reloadKey.value}`,
)
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
    prototypeError.value = ''
  } else if (event.data.type === 'core-marker-priority:error') {
    prototypeError.value = '核心标记物数据加载失败，请稍后重试。'
  }
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
