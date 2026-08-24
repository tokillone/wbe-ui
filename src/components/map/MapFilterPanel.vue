<script setup lang="ts">
import MapFilterSelect, { type MapFilterSelectOption } from '../MapFilterSelect.vue'
import type { MapFilterSelection } from '../../types/map'

defineProps<{
  ui: Record<string, string>
  open: boolean
  selection: MapFilterSelection
  targetClassOptions: MapFilterSelectOption[]
  categoryOptions: MapFilterSelectOption[]
  subcategoryOptions: MapFilterSelectOption[]
  biomarkerOptions: MapFilterSelectOption[]
  yearOptions: MapFilterSelectOption[]
  loadingFilters: boolean
  loadingStats: boolean
  filtersReady: boolean
}>()

const emit = defineEmits<{
  change: [key: keyof MapFilterSelection, value: string]
  refresh: []
  reset: []
  toggle: []
}>()
</script>

<template>
  <div class="filter-shell" :class="{ collapsed: !open }">
    <form class="floating-filters" :aria-hidden="!open" @submit.prevent="emit('refresh')">
      <div class="filter-head"><strong>{{ ui.filterTitle }}</strong></div>
      <MapFilterSelect
        id="map-target-class-filter"
        :model-value="selection.targetClass"
        :label="ui.targetClass ?? ''"
        :options="targetClassOptions"
        :disabled="loadingFilters || !filtersReady"
        :search-placeholder="ui.filterOptionSearch"
        :empty-text="ui.filterOptionEmpty"
        @update:model-value="emit('change', 'targetClass', $event)"
      />
      <MapFilterSelect
        id="map-category-filter"
        :model-value="selection.category"
        :label="ui.category ?? ''"
        :options="categoryOptions"
        :disabled="loadingFilters || !filtersReady"
        :search-placeholder="ui.filterOptionSearch"
        :empty-text="ui.filterOptionEmpty"
        @update:model-value="emit('change', 'category', $event)"
      />
      <MapFilterSelect
        id="map-subcategory-filter"
        :model-value="selection.subcategory"
        :label="ui.subcategory ?? ''"
        :options="subcategoryOptions"
        :disabled="!subcategoryOptions.length"
        :search-placeholder="ui.filterOptionSearch"
        :empty-text="ui.filterOptionEmpty"
        @update:model-value="emit('change', 'subcategory', $event)"
      />
      <MapFilterSelect
        id="map-biomarker-filter"
        :model-value="selection.biomarkerKey"
        :label="ui.biomarker ?? ''"
        :options="biomarkerOptions"
        :disabled="!biomarkerOptions.length"
        :search-placeholder="ui.filterOptionSearch"
        :empty-text="ui.filterOptionEmpty"
        @update:model-value="emit('change', 'biomarkerKey', $event)"
      />
      <MapFilterSelect
        id="map-year-filter"
        :model-value="selection.year"
        :label="ui.year ?? ''"
        :options="yearOptions"
        :disabled="!yearOptions.length"
        :search-placeholder="ui.filterOptionSearch"
        :empty-text="ui.filterOptionEmpty"
        @update:model-value="emit('change', 'year', $event)"
      />
      <div class="filter-actions">
        <button class="filter-reset-button" type="button" @click="emit('reset')">
          {{ ui.resetFilters }}
        </button>
        <button class="filter-refresh-button" type="submit" :disabled="loadingStats">
          {{ loadingStats ? ui.refreshing : ui.refresh }}
        </button>
      </div>
    </form>
    <button
      class="filter-toggle"
      type="button"
      :aria-label="open ? ui.collapseFilters : ui.expandFilters"
      @click="emit('toggle')"
    >
      <span aria-hidden="true"></span>
    </button>
  </div>
</template>
