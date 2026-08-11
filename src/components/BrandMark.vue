<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: 32 | 40 | 44
    compact?: boolean
  }>(),
  {
    size: 40,
    compact: false,
  },
)
</script>

<template>
  <span
    class="site-emblem"
    :class="{ compact }"
    :style="{ '--emblem-size': `${size}px` }"
    aria-hidden="true"
  >
    <span class="drop-shape">
      <i class="wave wave-one"></i>
      <i class="wave wave-two"></i>
      <b class="data-point"></b>
    </span>
  </span>
</template>

<style scoped>
.site-emblem {
  --emblem-size: 40px;
  width: var(--emblem-size);
  height: var(--emblem-size);
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border: 1px solid #064786;
  border-radius: calc(var(--emblem-size) * 0.14);
  color: #ffffff;
  background: #07519c;
  box-shadow: 0 5px 12px rgba(7, 81, 156, 0.16);
}

.site-emblem.compact {
  box-shadow: none;
}

.drop-shape {
  position: relative;
  width: 50%;
  height: 62%;
  margin-top: 5%;
  border: max(1.5px, calc(var(--emblem-size) * 0.05)) solid currentColor;
  border-radius: 54% 54% 62% 62% / 45% 45% 72% 72%;
}

.drop-shape::before {
  position: absolute;
  top: -14%;
  left: 50%;
  width: 44%;
  height: 38%;
  border-top: max(1.5px, calc(var(--emblem-size) * 0.05)) solid currentColor;
  border-left: max(1.5px, calc(var(--emblem-size) * 0.05)) solid currentColor;
  content: '';
  transform: translateX(-50%) rotate(45deg);
}

.wave {
  position: absolute;
  left: 16%;
  width: 68%;
  height: 12%;
  border-bottom: max(1px, calc(var(--emblem-size) * 0.034)) solid currentColor;
  border-radius: 50%;
}

.wave-one {
  top: 38%;
}

.wave-two {
  top: 60%;
}

.data-point {
  position: absolute;
  top: 57%;
  right: 10%;
  width: max(2px, calc(var(--emblem-size) * 0.075));
  height: max(2px, calc(var(--emblem-size) * 0.075));
  border-radius: 50%;
  background: currentColor;
}
</style>
