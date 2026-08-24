<script setup lang="ts">
import { computed } from 'vue'
import { normalizeReportStatus } from '../../utils/methodologyVerification'

const props = defineProps<{ value: string }>()
const status = computed(() => normalizeReportStatus(props.value))
</script>

<template>
  <span class="status-badge" :data-status="status">{{ status }}</span>
</template>
