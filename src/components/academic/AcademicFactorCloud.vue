<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type ComponentPublicInstance,
} from 'vue'
import {
  buildFactorOrbit,
  FACTOR_ORBIT_DIRECTION,
  factorOrbitLimit,
  factorOrbitVelocityStep,
  prepareCloudWords,
  projectFactorOrbit,
  type CloudWord,
  type FactorKeyword,
  type FactorCloudState,
  type FactorOrbitPoint,
  type FactorOrbitProjection,
} from '../../utils/factorCloud'

const props = defineProps<{
  items: FactorKeyword[]
  state?: FactorCloudState
  loading?: boolean
  unavailable?: boolean
  paused?: boolean
}>()
const emit = defineEmits<{ retry: [] }>()
const root = ref<HTMLElement | null>(null)
const canvas = ref<HTMLElement | null>(null)
const helpOpen = ref(false)
const helpHover = ref(false)
const pointerPause = ref(false)
const suppressPointerPause = ref(false)
const focusPause = ref(false)
const reducedMotion = ref(false)
const inViewport = ref(true)
const viewportWidth = ref(1440)
const selected = ref<CloudWord | null>(null)
const detailPanel = ref<HTMLElement | null>(null)
const words = computed(() => prepareCloudWords(props.items))
const categoryLabel = (item: FactorKeyword) => {
  const targetLabel = item.targetLabel?.trim()
  if (targetLabel) return targetLabel
  if (item.category === 'drug') return '药物类'
  if (item.category === 'consumer') return '消费与生活方式类'
  return item.category?.trim() || '未分类'
}
const categoryCount = computed(() => new Set(words.value.map(categoryLabel)).size)
const currentHighestDocs = computed(() =>
  words.value.reduce((highest, word) => Math.max(highest, word.docs ?? word.value), 0),
)
const orbitLimit = computed(() => factorOrbitLimit(viewportWidth.value))
const orbitPoints = computed(() => buildFactorOrbit(words.value, orbitLimit.value))
const sparse = computed(() => orbitPoints.value.length < 8)
const resolvedState = computed<FactorCloudState>(() => {
  if (props.state) return props.state
  if (props.loading) return 'loading'
  if (props.unavailable) return 'error'
  return words.value.length ? 'ready' : 'empty'
})
const statusMessage = computed(() => {
  if (resolvedState.value === 'loading') return '正在读取研究因子…'
  if (resolvedState.value === 'incompatible') return '当前首页接口版本缺少研究因子数据'
  if (resolvedState.value === 'error') return '研究因子加载失败'
  return '数据库当前没有研究因子记录'
})
const paused = computed(
  () =>
    !!(
      props.paused ||
      pointerPause.value ||
      focusPause.value ||
      selected.value ||
      reducedMotion.value ||
      sparse.value ||
      !inViewport.value
    ),
)
let viewportObserver: IntersectionObserver | null = null
let resizeObserver: ResizeObserver | null = null
let media: MediaQueryList | null = null
let lastTrigger: HTMLElement | null = null
let animationFrame: number | null = null
let lastFrameTime = 0
let rotation = 0
let angularVelocity = 0
let focusTween: { from: number; to: number; startedAt: number } | null = null
let focusedWordName = ''
let suppressFocusPositioning = false

const wordElements = new Map<string, HTMLElement>()
const wordMeasurements = new Map<string, { width: number; height: number }>()
const displayedOpacity = new Map<string, number>()
const ORBIT_REVOLUTION_MS = 46_000
const ORBIT_SPEED = (FACTOR_ORBIT_DIRECTION * Math.PI * 2) / ORBIT_REVOLUTION_MS
const ORBIT_FOCUS_DURATION = 420
const ORBIT_DECELERATION_SECONDS = 0.26
const ORBIT_ACCELERATION_SECONDS = 0.42

interface ProjectedWord {
  point: FactorOrbitPoint
  projection: FactorOrbitProjection
  x: number
  y: number
  width: number
  height: number
  opacity: number
  obscured: boolean
}

function closeHelp() {
  helpOpen.value = false
  helpHover.value = false
}

function wordStyle(word: CloudWord) {
  const responsiveScale = viewportWidth.value < 720 ? 0.86 : 1
  return {
    '--factor-ink': word.color,
    fontSize: `${(word.size * responsiveScale).toFixed(2)}px`,
  }
}

function wordDomId(index: number) {
  return `factor-cloud-word-${index}`
}

function setWordElement(name: string, element: Element | ComponentPublicInstance | null) {
  if (element instanceof HTMLElement) {
    wordElements.set(name, element)
    return
  }
  wordElements.delete(name)
  wordMeasurements.delete(name)
  displayedOpacity.delete(name)
}

function openWord(word: CloudWord, event: MouseEvent) {
  // Pointer focus may start the keyboard-only positioning tween immediately before click.
  // Cancel it so opening details freezes the orbit exactly where the user selected the word.
  focusTween = null
  focusedWordName = ''
  angularVelocity = 0
  selected.value = word
  lastTrigger = event.currentTarget as HTMLElement
  void nextTick(() => detailPanel.value?.focus())
}
function trapDetailFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !detailPanel.value) return
  const elements = [
    ...detailPanel.value.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]'),
  ]
  const first = elements[0]
  const last = elements[elements.length - 1]
  if (!first) {
    event.preventDefault()
    return
  }
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === detailPanel.value)
  ) {
    event.preventDefault()
    last?.focus()
  } else if (
    !event.shiftKey &&
    (document.activeElement === last || document.activeElement === detailPanel.value)
  ) {
    event.preventDefault()
    first.focus()
  }
}
function closeWord() {
  selected.value = null
  pointerPause.value = false
  suppressPointerPause.value = true
  suppressFocusPositioning = true
  void nextTick(() => {
    lastTrigger?.focus()
    focusedWordName = ''
    focusTween = null
    focusPause.value = false
    suppressFocusPositioning = false
    ensureAnimationFrame()
  })
}
function handlePointerEnter() {
  if (!suppressPointerPause.value) pointerPause.value = true
}
function handlePointerLeave() {
  suppressPointerPause.value = false
  pointerPause.value = false
}
function isWordTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('.factor-cloud-word')
}
function handleFocusIn(event: FocusEvent) {
  const target =
    event.target instanceof Element ? event.target.closest<HTMLElement>('.factor-cloud-word') : null
  focusPause.value = Boolean(target)
  focusedWordName = target?.dataset.word ?? ''
  if (focusedWordName && !suppressFocusPositioning) focusWord(focusedWordName)
}
function handleFocusOut(event: FocusEvent) {
  focusPause.value = isWordTarget(event.relatedTarget)
  if (!focusPause.value) {
    focusedWordName = ''
    focusTween = null
    ensureAnimationFrame()
  }
}
function onMotionChange() {
  reducedMotion.value = media?.matches ?? false
  resetOrbitMotion()
}

function updateViewportWidth() {
  viewportWidth.value = Math.max(
    320,
    window.innerWidth || document.documentElement.clientWidth || 1440,
  )
}

function measureWords() {
  for (const point of orbitPoints.value) {
    const element = wordElements.get(point.word.name)
    if (!element) continue
    const fontSize = Number.parseFloat(getComputedStyle(element).fontSize) || point.word.size
    wordMeasurements.set(point.word.name, {
      width: element.offsetWidth || Math.max(fontSize * 2, [...point.word.name].length * fontSize),
      height: element.offsetHeight || Math.max(28, fontSize * 1.35),
    })
  }
}

function nearestRotation(target: number, current: number) {
  return current + Math.atan2(Math.sin(target - current), Math.cos(target - current))
}

function focusWord(name: string) {
  if (reducedMotion.value || sparse.value) {
    renderOrbit(0, true)
    return
  }
  const point = orbitPoints.value.find((entry) => entry.word.name === name)
  if (!point) return
  const target = nearestRotation(point.longitude - Math.PI / 2, rotation)
  focusTween = {
    from: rotation,
    to: target,
    startedAt: performance.now(),
  }
  angularVelocity = 0
  ensureAnimationFrame()
}

function staticSparseProjection(index: number, count: number): FactorOrbitProjection {
  if (count <= 1) {
    return {
      x: 0,
      y: 0,
      depth: 1,
      scale: 1,
      edgeFade: 1,
      frontVisibility: 1,
      opacity: 1,
    }
  }
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2
  return {
    x: Math.cos(angle) * 0.76,
    y: Math.sin(angle) * 0.62,
    depth: 0.72,
    scale: 1,
    edgeFade: 1,
    frontVisibility: 1,
    opacity: 1,
  }
}

function overlapRatio(a: ProjectedWord, b: ProjectedWord) {
  const left = Math.max(a.x - a.width / 2, b.x - b.width / 2)
  const right = Math.min(a.x + a.width / 2, b.x + b.width / 2)
  const top = Math.max(a.y - a.height / 2, b.y - b.height / 2)
  const bottom = Math.min(a.y + a.height / 2, b.y + b.height / 2)
  if (right <= left || bottom <= top) return 0
  const intersection = (right - left) * (bottom - top)
  return intersection / Math.max(1, Math.min(a.width * a.height, b.width * b.height))
}

function renderOrbit(deltaSeconds = 0, immediate = false) {
  const element = canvas.value
  const points = orbitPoints.value
  if (!element || !points.length) return
  const width = element.clientWidth || Math.min(1440, viewportWidth.value - 24)
  const height = element.clientHeight || (viewportWidth.value < 720 ? 240 : 340)
  const radiusX = width * 0.42
  const radiusY = height * 0.39
  const collisionEnabled = !sparse.value
  const projected = points.map<ProjectedWord>((point, index) => {
    const projection = sparse.value
      ? staticSparseProjection(index, points.length)
      : projectFactorOrbit(point, reducedMotion.value ? 0 : rotation)
    const measurement = wordMeasurements.get(point.word.name) ?? {
      width: Math.max(point.word.size * 2, [...point.word.name].length * point.word.size),
      height: Math.max(28, point.word.size * 1.35),
    }
    return {
      point,
      projection,
      x: projection.x * radiusX,
      y: projection.y * radiusY,
      width: measurement.width * projection.scale * 0.8,
      height: measurement.height * projection.scale * 0.8,
      opacity: projection.opacity,
      obscured: false,
    }
  })

  const accepted: ProjectedWord[] = []
  for (const entry of [...projected].sort(
    (a, b) =>
      Number(b.point.word.name === focusedWordName) -
        Number(a.point.word.name === focusedWordName) || b.projection.depth - a.projection.depth,
  )) {
    const focused = entry.point.word.name === focusedWordName
    const collides =
      collisionEnabled && !focused && accepted.some((item) => overlapRatio(entry, item) > 0.58)
    if (collides) {
      entry.opacity = 0
      entry.obscured = true
    } else if (entry.opacity >= 0.24 || focused) {
      accepted.push(entry)
    }
    if (focused) entry.opacity = 1
  }

  const opacityResponse = immediate || deltaSeconds <= 0 ? 1 : 1 - Math.exp(-deltaSeconds / 0.18)
  for (const entry of projected) {
    const element = wordElements.get(entry.point.word.name)
    if (!element) continue
    const previousOpacity = displayedOpacity.get(entry.point.word.name) ?? entry.opacity
    const nextOpacity = previousOpacity + (entry.opacity - previousOpacity) * opacityResponse
    displayedOpacity.set(entry.point.word.name, nextOpacity)
    element.style.setProperty('--orbit-x', `${entry.x.toFixed(2)}px`)
    element.style.setProperty('--orbit-y', `${entry.y.toFixed(2)}px`)
    element.style.setProperty('--orbit-scale', entry.projection.scale.toFixed(4))
    element.style.opacity = nextOpacity.toFixed(4)
    element.style.zIndex = String(
      entry.point.word.name === focusedWordName
        ? 200
        : Math.max(1, Math.round(entry.projection.depth * 100)),
    )
    element.dataset.obscured = entry.obscured ? 'true' : 'false'
  }
  element.dataset.orbitRotation = rotation.toFixed(6)
}

function ensureAnimationFrame() {
  if (animationFrame !== null || resolvedState.value !== 'ready') return
  if (reducedMotion.value || sparse.value) {
    renderOrbit(0, true)
    return
  }
  animationFrame = window.requestAnimationFrame(animateOrbit)
}

function animateOrbit(timestamp: number) {
  animationFrame = null
  const deltaSeconds = lastFrameTime
    ? Math.min(0.05, Math.max(0, (timestamp - lastFrameTime) / 1000))
    : 1 / 60
  lastFrameTime = timestamp

  if (focusTween) {
    const progress = Math.min(
      1,
      Math.max(0, (timestamp - focusTween.startedAt) / ORBIT_FOCUS_DURATION),
    )
    const eased = 1 - Math.pow(1 - progress, 3)
    rotation = focusTween.from + (focusTween.to - focusTween.from) * eased
    if (progress >= 1) focusTween = null
  } else {
    const targetVelocity = paused.value ? 0 : ORBIT_SPEED
    const responseSeconds = paused.value ? ORBIT_DECELERATION_SECONDS : ORBIT_ACCELERATION_SECONDS
    angularVelocity = factorOrbitVelocityStep(
      angularVelocity,
      targetVelocity,
      deltaSeconds,
      responseSeconds,
    )
    if (paused.value && Math.abs(angularVelocity) < Math.abs(ORBIT_SPEED) * 0.002)
      angularVelocity = 0
    rotation = (rotation + angularVelocity * deltaSeconds * 1000) % (Math.PI * 2)
  }

  renderOrbit(deltaSeconds)
  if (focusTween || !paused.value || Math.abs(angularVelocity) > 0) ensureAnimationFrame()
}

function resetOrbitMotion() {
  if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
  animationFrame = null
  lastFrameTime = 0
  focusTween = null
  angularVelocity = paused.value ? 0 : ORBIT_SPEED
  displayedOpacity.clear()
  void nextTick(() => {
    measureWords()
    renderOrbit(0, true)
    ensureAnimationFrame()
  })
}

watch(words, () => {
  selected.value = null
})
watch(orbitPoints, resetOrbitMotion)
watch(paused, ensureAnimationFrame)
onMounted(() => {
  updateViewportWidth()
  media = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
  onMotionChange()
  media?.addEventListener?.('change', onMotionChange)
  if (typeof IntersectionObserver !== 'undefined' && root.value) {
    viewportObserver = new IntersectionObserver(
      ([entry]) => {
        inViewport.value = entry?.isIntersecting ?? true
      },
      { threshold: 0.01 },
    )
    viewportObserver.observe(root.value)
  }
  if (typeof ResizeObserver !== 'undefined' && canvas.value) {
    resizeObserver = new ResizeObserver(() => {
      measureWords()
      renderOrbit(0, true)
    })
    resizeObserver.observe(canvas.value)
  }
  window.addEventListener('resize', updateViewportWidth)
  resetOrbitMotion()
  void document.fonts?.ready.then(() => {
    measureWords()
    renderOrbit(0, true)
  })
})
onBeforeUnmount(() => {
  if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
  viewportObserver?.disconnect()
  resizeObserver?.disconnect()
  media?.removeEventListener?.('change', onMotionChange)
  window.removeEventListener('resize', updateViewportWidth)
  wordElements.clear()
  wordMeasurements.clear()
  displayedOpacity.clear()
})
</script>

<template>
  <section
    id="visual"
    ref="root"
    class="factor-cloud-section"
    aria-labelledby="visualTitle"
    @focusin="handleFocusIn"
    @focusout="handleFocusOut"
  >
    <article class="factor-cloud-card">
      <header class="factor-cloud-heading">
        <div class="factor-title-copy">
          <div class="factor-title-group">
            <h2 id="visualTitle">高频研究因子</h2>
            <span
              class="factor-help-wrap"
              @mouseenter="helpHover = true"
              @mouseleave="helpHover = false"
            >
              <button
                type="button"
                class="factor-help"
                aria-label="高频研究因子说明"
                :aria-expanded="helpOpen || helpHover"
                aria-controls="factor-help-text"
                @focus="helpHover = true"
                @blur="helpHover = false"
                @click="helpOpen = !helpOpen"
                @keydown.esc="closeHelp"
              >
                ?
              </button>
              <span
                v-if="helpOpen || helpHover"
                id="factor-help-text"
                class="factor-help-text"
                role="tooltip"
                >字号表示 DOI
                去重文献量，颜色用于区分目标类别。点击任一词条，可查看对应文献量与分类信息。</span
              >
            </span>
          </div>
        </div>

        <dl class="factor-summary" aria-label="研究因子统计">
          <div>
            <dt>当前因子</dt>
            <dd>{{ words.length }}<small>项</small></dd>
          </div>
          <div>
            <dt>目标类别</dt>
            <dd>{{ categoryCount }}<small>类</small></dd>
          </div>
          <div>
            <dt>最高文献量</dt>
            <dd>{{ currentHighestDocs }}<small>篇</small></dd>
          </div>
        </dl>
      </header>

      <div
        :data-paused="paused"
        :data-state="resolvedState"
        class="factor-cloud-canvas"
        :class="{ 'is-compact': resolvedState !== 'ready' }"
        aria-label="高频因子词云"
        ref="canvas"
        @pointerenter="handlePointerEnter"
        @pointerleave="handlePointerLeave"
      >
        <div class="factor-science-layer" aria-hidden="true">
          <span class="factor-radar"></span>
          <span class="factor-molecule factor-molecule-left"
            ><i></i><i></i><i></i><b></b><b></b
          ></span>
          <span class="factor-molecule factor-molecule-right"
            ><i></i><i></i><i></i><b></b><b></b
          ></span>
        </div>
        <div v-if="resolvedState !== 'ready'" class="factor-cloud-empty" role="status">
          <span v-if="resolvedState === 'loading'" class="factor-cloud-skeleton" aria-hidden="true"
            ><i></i><i></i><i></i
          ></span>
          <p>{{ statusMessage }}</p>
          <button
            v-if="resolvedState === 'error' || resolvedState === 'incompatible'"
            type="button"
            @click="emit('retry')"
          >
            重新加载
          </button>
        </div>
        <div v-else class="factor-orbit" :class="{ 'is-sparse': sparse }" role="group">
          <button
            v-for="(point, index) in orbitPoints"
            :id="wordDomId(index)"
            :key="point.word.name"
            :ref="(element) => setWordElement(point.word.name, element)"
            type="button"
            class="factor-cloud-word"
            :class="{ 'is-selected': selected?.name === point.word.name }"
            :data-word="point.word.name"
            :style="wordStyle(point.word)"
            :aria-label="`${point.word.name}，${point.word.docs ?? point.word.value} 篇文献，查看详情`"
            @click="openWord(point.word, $event)"
          >
            <span>{{ point.word.name }}</span>
          </button>
        </div>
      </div>
    </article>

    <Transition name="factor-detail-pop">
      <div v-if="selected" class="factor-detail-backdrop" @click="closeWord">
        <section
          ref="detailPanel"
          class="factor-detail"
          role="dialog"
          aria-modal="true"
          aria-labelledby="factor-detail-title"
          tabindex="-1"
          @click.stop
          @keydown.esc="closeWord"
          @keydown="trapDetailFocus"
        >
          <header>
            <span>研究因子详情</span
            ><button type="button" aria-label="关闭研究因子详情" @click="closeWord">×</button>
          </header>
          <h3 id="factor-detail-title" :style="{ color: selected.color }">{{ selected.name }}</h3>
          <dl>
            <div>
              <dt>DOI 去重文献数</dt>
              <dd>{{ (selected.docs ?? selected.value).toLocaleString('zh-CN') }}</dd>
            </div>
            <div>
              <dt>数据行</dt>
              <dd>{{ selected.rows == null ? '暂无' : selected.rows.toLocaleString('zh-CN') }}</dd>
            </div>
            <div>
              <dt>目标类别</dt>
              <dd>{{ selected.targetLabel || '暂无' }}</dd>
            </div>
            <div>
              <dt>研究范围</dt>
              <dd>
                {{
                  selected.category === 'drug'
                    ? '药物'
                    : selected.category === 'consumer'
                      ? '消费相关因子'
                      : selected.category || '暂无'
                }}
              </dd>
            </div>
          </dl>
          <p v-if="selected.subcategories?.length" class="factor-detail-tags">
            <span v-for="tag in selected.subcategories" :key="tag">{{ tag }}</span>
          </p>
        </section>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.factor-cloud-section {
  position: relative;
  max-width: 1320px;
  margin: 0 auto;
  padding: 44px clamp(20px, 4vw, 56px) 48px;
  color: #18364d;
  scroll-margin-top: 112px;
  isolation: isolate;
}
.factor-cloud-card {
  position: relative;
  overflow: visible;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.factor-cloud-heading {
  position: relative;
  z-index: 4;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 36px;
  padding: 12px 0 24px;
  background: transparent;
}
.factor-title-copy {
  min-width: 0;
}
.factor-title-group {
  display: flex;
  align-items: center;
  gap: 9px;
}
h2 {
  margin: 0;
  font-size: clamp(36px, 3.2vw, 46px);
  letter-spacing: -0.045em;
  line-height: 1.12;
  font-weight: 680;
}
.factor-help-wrap {
  position: relative;
  display: inline-flex;
}
.factor-help {
  width: 19px;
  height: 19px;
  padding: 0;
  border: 1px solid #9ab0bf;
  border-radius: 50%;
  color: #547085;
  background: #f8fbfc;
  font-size: 12px;
  cursor: pointer;
}
.factor-help-text {
  position: absolute;
  z-index: 12;
  left: 0;
  top: 27px;
  width: min(340px, 72vw);
  padding: 14px 16px;
  border: 1px solid #c4d3de;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 8px 28px #18364d18;
  font-size: 13px;
  line-height: 1.7;
}
.factor-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(96px, 1fr));
  margin: 0;
}
.factor-summary > div {
  min-width: 108px;
  padding: 1px 22px 3px;
  border-left: 1px solid #d5e3ec;
}
.factor-summary dt {
  margin-bottom: 7px;
  color: #698092;
  font-size: 12px;
  line-height: 1.4;
}
.factor-summary dd {
  margin: 0;
  color: var(--academic-accent, #0b5f9d);
  font-size: 27px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}
.factor-summary small {
  margin-left: 4px;
  color: #60798c;
  font-size: 12px;
  font-weight: 600;
}
.factor-cloud-canvas {
  position: relative;
  width: 100%;
  min-height: 308px;
  overflow: hidden;
  background-color: transparent;
  background-image:
    linear-gradient(rgba(36, 105, 154, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(36, 105, 154, 0.045) 1px, transparent 1px),
    radial-gradient(circle at 50% 48%, rgba(255, 255, 255, 0.96) 0, rgba(249, 252, 254, 0) 58%);
  background-size:
    36px 36px,
    36px 36px,
    100% 100%;
  transition: min-height 240ms ease;
}
.factor-cloud-canvas.is-compact {
  min-height: 160px;
}
.factor-science-layer {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}
.factor-radar {
  position: absolute;
  right: -54px;
  bottom: -112px;
  width: 330px;
  height: 330px;
  border: 1px solid rgba(36, 105, 154, 0.08);
  border-radius: 50%;
  background: repeating-radial-gradient(
    circle,
    transparent 0 47px,
    rgba(36, 105, 154, 0.07) 48px 49px
  );
}
.factor-molecule {
  position: absolute;
  width: 180px;
  height: 104px;
  opacity: 0.24;
}
.factor-molecule-left {
  top: 24px;
  left: 30px;
}
.factor-molecule-right {
  right: 170px;
  bottom: 14px;
  transform: rotate(178deg) scale(0.76);
  opacity: 0.15;
}
.factor-molecule i,
.factor-molecule b {
  position: absolute;
  display: block;
}
.factor-molecule i {
  z-index: 1;
  width: 11px;
  height: 11px;
  border: 2px solid #2473aa;
  border-radius: 50%;
  background: #f8fbfd;
}
.factor-molecule i:nth-child(1) {
  top: 54px;
  left: 4px;
}
.factor-molecule i:nth-child(2) {
  top: 12px;
  left: 82px;
}
.factor-molecule i:nth-child(3) {
  top: 66px;
  left: 160px;
}
.factor-molecule b {
  width: 84px;
  height: 1px;
  background: #2473aa;
  transform-origin: left center;
}
.factor-molecule b:nth-of-type(1) {
  top: 59px;
  left: 14px;
  transform: rotate(-28deg);
}
.factor-molecule b:nth-of-type(2) {
  top: 19px;
  left: 91px;
  transform: rotate(31deg);
}
.factor-orbit {
  position: absolute;
  inset: 0;
  z-index: 1;
  contain: layout paint;
}
.factor-cloud-word {
  --orbit-x: 0px;
  --orbit-y: 0px;
  --orbit-scale: 1;

  position: absolute;
  top: 50%;
  left: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 36px;
  margin: 0;
  padding: 4px 6px;
  border: 0;
  border-radius: 2px;
  color: var(--factor-ink);
  background: transparent;
  transform: translate3d(calc(-50% + var(--orbit-x)), calc(-50% + var(--orbit-y)), 0)
    scale(var(--orbit-scale));
  transform-origin: center;
  white-space: nowrap;
  line-height: 1.12;
  font-family: var(--platform-font-family, 'Microsoft YaHei', '微软雅黑', Arial, sans-serif);
  font-weight: 650;
  cursor: pointer;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.78);
  opacity: 0;
  will-change: transform, opacity;
}
.factor-cloud-word > span {
  display: block;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.19em;
  transition:
    color 180ms ease,
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
    text-decoration-color 180ms ease;
}
.factor-cloud-word:hover > span,
.factor-cloud-word:focus-visible > span,
.factor-cloud-word.is-selected > span {
  color: color-mix(in srgb, var(--factor-ink) 82%, #12364e 18%);
  transform: scale(1.035);
  text-decoration-color: currentColor;
}
.factor-cloud-word:focus-visible {
  outline: 1px solid rgba(40, 104, 152, 0.76);
  outline-offset: 2px;
  opacity: 1 !important;
}
.factor-cloud-word[data-obscured='true'] {
  pointer-events: none;
}
.factor-cloud-word[data-obscured='true']:focus-visible {
  pointer-events: auto;
}
button:focus-visible {
  outline: 2px solid #286898;
  outline-offset: 2px;
}
.factor-cloud-empty {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px;
  color: #6f8391;
  font-size: 15px;
}
.factor-cloud-empty p {
  margin: 0;
}
.factor-cloud-empty button {
  min-height: 34px;
  padding: 0 13px;
  border: 1px solid #8fa8b9;
  color: #17364c;
  background: #fff;
  cursor: pointer;
}
.factor-cloud-skeleton {
  width: 128px;
  display: grid;
  gap: 7px;
}
.factor-cloud-skeleton i {
  height: 7px;
  display: block;
  background: linear-gradient(90deg, #d8e3e9 20%, #eef3f6 50%, #d8e3e9 80%);
  background-size: 220% 100%;
  animation: factor-loading 1.4s ease infinite;
}
.factor-cloud-skeleton i:nth-child(2) {
  width: 78%;
}
.factor-cloud-skeleton i:nth-child(3) {
  width: 56%;
}
@keyframes factor-loading {
  to {
    background-position: -120% 0;
  }
}
.factor-detail-backdrop {
  position: fixed;
  inset: 0;
  z-index: 900;
  display: grid;
  place-items: center;
  padding: 24px;
  background: transparent;
}
.factor-detail {
  width: min(430px, 100%);
  max-height: 80vh;
  overflow: auto;
  padding: 24px;
  background: rgba(255, 255, 255, 0.97);
  border: 1px solid rgba(117, 148, 166, 0.44);
  border-radius: 16px;
  box-shadow: 0 22px 72px rgba(12, 34, 53, 0.2);
  backdrop-filter: blur(16px);
}
.factor-detail-pop-enter-active,
.factor-detail-pop-leave-active {
  transition: opacity 220ms ease;
}
.factor-detail-pop-enter-active .factor-detail,
.factor-detail-pop-leave-active .factor-detail {
  transition:
    opacity 260ms ease,
    transform 320ms cubic-bezier(0.22, 1, 0.36, 1);
}
.factor-detail-pop-enter-from,
.factor-detail-pop-leave-to,
.factor-detail-pop-enter-from .factor-detail,
.factor-detail-pop-leave-to .factor-detail {
  opacity: 0;
}
.factor-detail-pop-enter-from .factor-detail,
.factor-detail-pop-leave-to .factor-detail {
  transform: translateY(14px) scale(0.97);
}
.factor-detail header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #607686;
  font-size: 13px;
}
.factor-detail header button {
  background: transparent;
  border: 0;
  padding: 4px 8px;
  color: #436278;
  font-size: 24px;
  cursor: pointer;
}
.factor-detail h3 {
  font-size: 27px;
  margin: 14px 0 24px;
  overflow-wrap: anywhere;
}
.factor-detail dl {
  margin: 0;
}
.factor-detail dl div {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 12px 0;
  border-top: 1px solid #e1e8ed;
  font-size: 14px;
}
.factor-detail dt {
  color: #697f8f;
  flex-shrink: 0;
}
.factor-detail dd {
  margin: 0;
  text-align: right;
}
.factor-detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 18px 0 0;
}
.factor-detail-tags span {
  padding: 5px 8px;
  background: #eff4f7;
  font-size: 12px;
}
@media (max-width: 720px) {
  .factor-cloud-heading h2 {
    font-size: clamp(30px, 9vw, 34px);
  }
}
@media (max-width: 1023px) {
  .factor-cloud-heading {
    grid-template-columns: 1fr;
    align-items: start;
    gap: 22px;
  }
  .factor-summary {
    justify-self: stretch;
  }
  .factor-summary > div:first-child {
    border-left: 0;
    padding-left: 0;
  }
}
@media (max-width: 1023px) and (min-width: 601px) {
  .factor-cloud-canvas {
    min-height: 300px;
  }
}
@media (max-width: 600px) {
  .factor-cloud-section {
    padding: 36px 14px 40px;
  }
  .factor-cloud-card {
    border-radius: 5px;
  }
  .factor-cloud-heading {
    gap: 20px;
    padding: 8px 0 20px;
  }
  .factor-cloud-heading h2 {
    font-size: clamp(30px, 9vw, 34px);
  }
  .factor-summary > div {
    min-width: 0;
    padding: 0 12px;
  }
  .factor-summary > div:first-child {
    padding-left: 0;
  }
  .factor-summary > div:last-child {
    padding-right: 0;
  }
  .factor-summary dt {
    font-size: 11px;
  }
  .factor-summary dd {
    font-size: clamp(20px, 6.5vw, 25px);
  }
  .factor-summary small {
    font-size: 11px;
  }
  .factor-cloud-canvas {
    min-height: 240px;
    background-size:
      30px 30px,
      30px 30px,
      100% 100%;
  }
  .factor-cloud-canvas.is-compact {
    min-height: 140px;
  }
  .factor-cloud-word {
    min-height: 44px;
    padding: 7px 5px;
  }
  .factor-cloud-empty {
    gap: 10px;
    flex-wrap: wrap;
  }
  .factor-cloud-skeleton {
    width: 96px;
  }
  .factor-help-text {
    left: auto;
    right: -18px;
  }
  .factor-molecule-left {
    top: 18px;
    left: -54px;
    transform: scale(0.72);
  }
  .factor-molecule-right {
    display: none;
  }
  .factor-radar {
    right: -112px;
    bottom: -138px;
    transform: scale(0.78);
  }
}
@media (prefers-reduced-motion: reduce) {
  .factor-cloud-word,
  .factor-cloud-word > span {
    transition: none;
    animation: none !important;
  }
  .factor-detail-pop-enter-active,
  .factor-detail-pop-leave-active,
  .factor-detail-pop-enter-active .factor-detail,
  .factor-detail-pop-leave-active .factor-detail {
    transition: none;
  }
  .factor-cloud-skeleton i {
    animation: none;
  }
}
</style>
