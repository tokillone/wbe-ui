<script setup lang="ts">
import MapFilterSelect, { type MapFilterSelectOption } from '../MapFilterSelect.vue'
import type { MapFilterSelection } from '../../types/map'
import MapBiomarkerSearch from './MapBiomarkerSearch.vue'

defineProps<{
  ui: Record<string, string>
  open: boolean
  selection: MapFilterSelection
  biomarkerPathKey: string
  targetClassOptions: MapFilterSelectOption[]
  categoryOptions: MapFilterSelectOption[]
  subcategoryOptions: MapFilterSelectOption[]
  biomarkerOptions: MapFilterSelectOption[]
  searchOptions: MapFilterSelectOption[]
  yearOptions: MapFilterSelectOption[]
  loadingFilters: boolean
  dirty: boolean
  applying: boolean
  filtersReady: boolean
  searchClearSignal: number
}>()

const emit = defineEmits<{
  change: [key: keyof MapFilterSelection, value: string]
  selectBiomarkerPath: [value: string]
  selectSearchResult: [value: string]
  apply: []
  reset: []
  toggle: []
}>()
</script>

<template>
  <div class="filter-shell" :class="{ collapsed: !open, applying }">
    <form
      class="floating-filters"
      :class="{ applying }"
      :aria-busy="applying"
      :aria-hidden="!open"
      @submit.prevent="emit('apply')"
    >
      <div class="filter-head">
        <strong>{{ ui.filterTitle }}</strong>
        <MapBiomarkerSearch
          id="map-biomarker-quick-search"
          compact
          :label="ui.biomarkerQuickSearch ?? ''"
          :options="searchOptions"
          :placeholder="ui.biomarkerSearchPlaceholder ?? ''"
          :empty-text="ui.biomarkerSearchEmpty ?? ''"
          :applying-text="ui.biomarkerSearchApplying ?? ''"
          :clear-signal="searchClearSignal"
          :disabled="loadingFilters || applying || !filtersReady"
          @select="emit('selectSearchResult', $event)"
        />
      </div>
      <MapFilterSelect
        id="map-target-class-filter"
        :model-value="selection.targetClass"
        :label="ui.targetClass ?? ''"
        :options="targetClassOptions"
        :searchable="false"
        :disabled="loadingFilters || applying || !filtersReady"
        :search-placeholder="ui.filterOptionSearch"
        :empty-text="ui.filterOptionEmpty"
        @update:model-value="emit('change', 'targetClass', $event)"
      />
      <MapFilterSelect
        id="map-category-filter"
        :model-value="selection.category"
        :label="ui.category ?? ''"
        :options="categoryOptions"
        :searchable="false"
        :disabled="loadingFilters || applying || !filtersReady"
        :search-placeholder="ui.filterOptionSearch"
        :empty-text="ui.filterOptionEmpty"
        @update:model-value="emit('change', 'category', $event)"
      />
      <MapFilterSelect
        id="map-subcategory-filter"
        :model-value="selection.subcategory"
        :label="ui.subcategory ?? ''"
        :options="subcategoryOptions"
        :searchable="false"
        :disabled="applying || !subcategoryOptions.length"
        :search-placeholder="ui.filterOptionSearch"
        :empty-text="ui.filterOptionEmpty"
        @update:model-value="emit('change', 'subcategory', $event)"
      />
      <MapFilterSelect
        id="map-biomarker-filter"
        :model-value="biomarkerPathKey"
        :label="ui.biomarker ?? ''"
        :options="biomarkerOptions"
        :searchable="false"
        :disabled="applying || !biomarkerOptions.length"
        :search-placeholder="ui.filterOptionSearch"
        :empty-text="ui.filterOptionEmpty"
        @update:model-value="emit('selectBiomarkerPath', $event)"
      />
      <MapFilterSelect
        id="map-year-filter"
        :model-value="selection.year"
        :label="ui.year ?? ''"
        :options="yearOptions"
        :searchable="false"
        :disabled="applying || !yearOptions.length"
        :search-placeholder="ui.filterOptionSearch"
        :empty-text="ui.filterOptionEmpty"
        @update:model-value="emit('change', 'year', $event)"
      />
      <div class="filter-actions">
        <button
          class="filter-reset-button"
          type="button"
          :disabled="applying"
          @click="emit('reset')"
        >
          {{ ui.resetFilters }}
        </button>
        <button
          class="filter-apply-button"
          type="submit"
          :disabled="loadingFilters || applying || !filtersReady || !dirty"
        >
          {{ applying ? ui.applyingFilters : ui.applyFilters }}
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
