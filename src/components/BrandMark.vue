<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: 32 | 40 | 44
    compact?: boolean
    variant?: 'default' | 'academic'
  }>(),
  {
    size: 40,
    compact: false,
    variant: 'default',
  },
)
</script>

<template>
  <span
    class="site-emblem"
    :class="[{ compact }, `is-${variant}`]"
    :style="{ '--emblem-size': `${size}px` }"
    aria-hidden="true"
  >
    <svg
      v-if="variant === 'academic'"
      class="site-emblem-symbol"
      viewBox="0 0 35 32"
      fill="none"
      aria-hidden="true"
    >
      <path class="site-emblem-path" d="M3 6.5 9.5 25 17.5 13.5 25.5 25 32 6.5" />
      <circle class="site-emblem-node" cx="3" cy="6.5" r="2.25" />
      <circle class="site-emblem-node" cx="9.5" cy="25" r="2.25" />
      <circle class="site-emblem-node" cx="25.5" cy="25" r="2.25" />
      <circle class="site-emblem-node" cx="32" cy="6.5" r="2.25" />
    </svg>
    <strong>WBE</strong>
  </span>
</template>

<style scoped>
.site-emblem {
  --emblem-size: 40px;
  width: var(--emblem-size);
  height: var(--emblem-size);
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border: 1px solid #07519c;
  border-radius: calc(var(--emblem-size) * 0.18);
  color: #ffffff;
  background: #07519c;
  box-shadow: 0 5px 12px rgba(7, 81, 156, 0.16);
}

.site-emblem strong {
  font-family: var(--platform-font-family, 'Microsoft YaHei', '微软雅黑', Arial, sans-serif);
  font-size: calc(var(--emblem-size) * 0.27);
  font-weight: 760;
  letter-spacing: -0.035em;
  line-height: 1;
}

.site-emblem.compact {
  box-shadow: none;
}

.site-emblem.is-academic {
  width: auto;
  min-width: calc(var(--emblem-size) * 1.92);
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: calc(var(--emblem-size) * 0.15);
  overflow: visible;
  border: 0;
  border-radius: 0;
  color: #0b1f33;
  background: transparent;
  box-shadow: none;
}

.site-emblem-symbol {
  width: calc(var(--emblem-size) * 0.86);
  height: calc(var(--emblem-size) * 0.78);
  flex: 0 0 auto;
  overflow: visible;
}

.site-emblem-path {
  stroke: #0b1f33;
  stroke-width: 2.25;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.site-emblem-node {
  fill: #1263a8;
  stroke: #ffffff;
  stroke-width: 1.25;
}

.site-emblem.is-academic strong {
  font-size: calc(var(--emblem-size) * 0.44);
  font-weight: 780;
  letter-spacing: -0.055em;
}
</style>
