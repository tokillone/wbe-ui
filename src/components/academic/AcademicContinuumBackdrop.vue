<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const root = ref<HTMLElement | null>(null)
let frame = 0
let motionPreference: MediaQueryList | null = null

function updatePosition() {
  frame = 0
  if (!root.value) return
  const disabled = window.innerWidth <= 720 || motionPreference?.matches
  if (disabled) {
    root.value.style.setProperty('--continuum-shift-a', '0px')
    root.value.style.setProperty('--continuum-shift-b', '0px')
    return
  }
  const progress = Math.max(
    0,
    Math.min(
      1,
      window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight),
    ),
  )
  root.value.style.setProperty('--continuum-shift-a', `${(progress * 12).toFixed(2)}px`)
  root.value.style.setProperty('--continuum-shift-b', `${(progress * -9).toFixed(2)}px`)
}

function schedulePosition() {
  if (!frame) frame = window.requestAnimationFrame(updatePosition)
}

onMounted(() => {
  motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
  motionPreference?.addEventListener?.('change', schedulePosition)
  window.addEventListener('scroll', schedulePosition, { passive: true })
  window.addEventListener('resize', schedulePosition)
  schedulePosition()
})

onBeforeUnmount(() => {
  if (frame) window.cancelAnimationFrame(frame)
  motionPreference?.removeEventListener?.('change', schedulePosition)
  window.removeEventListener('scroll', schedulePosition)
  window.removeEventListener('resize', schedulePosition)
})
</script>

<template>
  <div ref="root" class="academic-page-continuum" aria-hidden="true">
    <svg viewBox="0 0 1920 3600" preserveAspectRatio="none" focusable="false">
      <defs>
        <linearGradient id="continuumWash" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#edf6fa" stop-opacity="0" />
          <stop offset="0.12" stop-color="#eaf4f8" stop-opacity="0.64" />
          <stop offset="0.5" stop-color="#f8fbfc" stop-opacity="0.16" />
          <stop offset="0.86" stop-color="#e8f2f6" stop-opacity="0.54" />
          <stop offset="1" stop-color="#f7fafb" stop-opacity="0" />
        </linearGradient>
        <linearGradient id="continuumLine" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="#2186c4" />
          <stop offset="0.52" stop-color="#61b6cf" />
          <stop offset="1" stop-color="#258777" />
        </linearGradient>
      </defs>

      <rect width="1920" height="3600" fill="url(#continuumWash)" />

      <g class="continuum-layer continuum-layer-a" fill="none" stroke="url(#continuumLine)">
        <path
          d="M0 54 C156 98 196 232 142 386 S68 674 186 826 S212 1122 92 1294 S68 1636 190 1800 S218 2166 94 2348 S72 2704 196 2890 S214 3290 72 3540"
        />
        <path
          d="M118 0 C292 128 310 292 230 454 S210 784 332 930 S316 1240 224 1436 S226 1786 352 1940 S310 2300 230 2482 S250 2850 370 3008 S338 3360 260 3600"
        />
        <path
          d="M1920 102 C1742 182 1716 352 1792 510 S1810 828 1680 986 S1694 1312 1790 1482 S1782 1818 1650 1998 S1664 2356 1784 2520 S1772 2880 1654 3050 S1682 3400 1800 3600"
        />
        <path
          d="M1822 0 C1648 150 1640 314 1714 466 S1690 796 1584 956 S1602 1288 1702 1450 S1690 1784 1570 1950 S1576 2296 1690 2472 S1668 2830 1554 3020 S1578 3392 1662 3600"
        />
      </g>

      <g class="continuum-layer continuum-layer-b" fill="none" stroke="#1263a8">
        <path d="M24 520 H138 Q178 520 178 560 V700 Q178 748 224 748 H294" />
        <path d="M1898 742 H1784 Q1744 742 1744 788 V918 Q1744 962 1696 962 H1622" />
        <path d="M0 1554 H112 Q158 1554 158 1600 V1726 Q158 1772 212 1772 H286" />
        <path d="M1920 1860 H1810 Q1764 1860 1764 1906 V2050 Q1764 2094 1708 2094 H1628" />
        <path d="M0 2690 H120 Q166 2690 166 2738 V2888 Q166 2936 222 2936 H316" />
        <path d="M1920 3008 H1818 Q1770 3008 1770 3058 V3200 Q1770 3244 1712 3244 H1626" />
      </g>

      <g class="continuum-nodes" fill="#f8fbfc" stroke="#2587b8">
        <circle cx="178" cy="520" r="11" />
        <circle cx="178" cy="700" r="7" />
        <circle cx="294" cy="748" r="9" />
        <circle cx="1744" cy="742" r="10" />
        <circle cx="1744" cy="918" r="7" />
        <circle cx="1622" cy="962" r="9" />
        <circle cx="158" cy="1554" r="9" />
        <circle cx="158" cy="1726" r="7" />
        <circle cx="286" cy="1772" r="11" />
        <circle cx="1764" cy="1860" r="10" />
        <circle cx="1764" cy="2050" r="7" />
        <circle cx="1628" cy="2094" r="9" />
        <circle cx="166" cy="2690" r="10" />
        <circle cx="166" cy="2888" r="7" />
        <circle cx="316" cy="2936" r="9" />
        <circle cx="1770" cy="3008" r="10" />
        <circle cx="1770" cy="3200" r="7" />
        <circle cx="1626" cy="3244" r="9" />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.academic-page-continuum {
  --continuum-shift-a: 0px;
  --continuum-shift-b: 0px;
  position: absolute;
  inset: 620px 0 240px;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

.academic-page-continuum svg {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 2800px;
}

.continuum-layer-a {
  opacity: 0.12;
  stroke-width: 2.2;
  transform: translate3d(0, var(--continuum-shift-a), 0);
}

.continuum-layer-b {
  opacity: 0.1;
  stroke-width: 2;
  transform: translate3d(0, var(--continuum-shift-b), 0);
}

.continuum-nodes {
  opacity: 0.14;
  stroke-width: 2;
  transform: translate3d(0, var(--continuum-shift-b), 0);
}

.continuum-layer,
.continuum-nodes {
  transition: transform 90ms linear;
  will-change: transform;
}

@media (max-width: 720px) {
  .academic-page-continuum {
    inset-top: 560px;
    opacity: 0.58;
  }

  .continuum-layer-a path:nth-child(even),
  .continuum-layer-b path:nth-child(n + 3),
  .continuum-nodes circle:nth-child(n + 7) {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .continuum-layer,
  .continuum-nodes {
    transform: none;
    transition: none;
  }
}
</style>
