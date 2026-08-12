<script setup lang="ts">
defineProps<{ label: string; value: string; unit?: string; note: string; accent?: 'blue' | 'teal' }>()
</script>

<template>
  <article class="metric-card" :data-accent="accent || 'blue'">
    <span>{{ label }}</span>
    <strong>{{ value }}</strong>
    <small v-if="unit">{{ unit }}</small>
    <p>{{ note }}</p>
  </article>
</template>
