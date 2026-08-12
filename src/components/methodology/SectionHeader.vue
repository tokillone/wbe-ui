<script setup lang="ts">
defineProps<{ index: string; english: string; title: string; description: string }>()
</script>

<template>
  <header class="section-heading">
    <div>
      <span>{{ index }} / {{ english }}</span>
      <h2>{{ title }}</h2>
    </div>
    <p>{{ description }}</p>
  </header>
</template>
